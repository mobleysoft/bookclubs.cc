// Pages Function - real server-side roster backend for bookclubs.cc.
// Same schema and logic as the shared fleet worker's isBookclubsRosterAddPost
// handler, deployed here instead because bookclubs.cc's custom domain is
// bound to this Pages project (not routed to the fleet Worker), and this
// session's Cloudflare API tokens are expired so a new Worker Route can't be
// added right now. Same D1 database (venture_mvp_db), same book_club_members
// table, same venture-scoping convention as every other venture.

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export async function onRequestPost({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ detail: { message: "invalid JSON body" } }, 400);
  }
  const clubCode = String(body?.club_code || "").trim().slice(0, 100);
  const name = String(body?.name || "").trim().slice(0, 100);
  const availability = Array.isArray(body?.availability)
    ? body.availability.map((d) => String(d).trim().toLowerCase().slice(0, 20)).filter(Boolean).slice(0, 7)
    : [];
  if (!clubCode || !name) {
    return jsonResponse({ detail: { message: "club_code and name are required" } }, 400);
  }
  let existing;
  try {
    existing = await env.DB.prepare(
      "SELECT id FROM book_club_members WHERE venture = ? AND club_code = ? AND LOWER(name) = LOWER(?)"
    ).bind("bookclubs.cc", clubCode, name).first();
  } catch (err) {
    return jsonResponse({ detail: { message: err.message } }, 500);
  }
  if (existing) {
    return jsonResponse({ ok: false, reason: "duplicate member" }, 409);
  }
  const id = crypto.randomUUID();
  try {
    await env.DB.prepare(
      "INSERT INTO book_club_members (id, venture, club_code, name, availability) VALUES (?, ?, ?, ?, ?)"
    ).bind(id, "bookclubs.cc", clubCode, name, JSON.stringify(availability)).run();
  } catch (err) {
    return jsonResponse({ detail: { message: err.message } }, 500);
  }
  return jsonResponse({ ok: true, id }, 201);
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const clubCode = String(url.searchParams.get("club_code") || "").trim().slice(0, 100);
  if (!clubCode) {
    return jsonResponse({ detail: { message: "club_code is required" } }, 400);
  }
  let rows;
  try {
    rows = await env.DB.prepare(
      "SELECT name, availability FROM book_club_members WHERE venture = ? AND club_code = ? ORDER BY created_at ASC"
    ).bind("bookclubs.cc", clubCode).all();
  } catch {
    return jsonResponse({ detail: { message: "Roster storage is temporarily unreachable - try again shortly." } }, 503);
  }
  const roster = (rows.results || []).map((r) => ({ name: r.name, availability: JSON.parse(r.availability || "[]") }));
  const dayMap = {};
  roster.forEach((m) => {
    m.availability.forEach((day) => {
      if (!dayMap[day]) dayMap[day] = [];
      dayMap[day].push(m.name);
    });
  });
  const matches = Object.entries(dayMap)
    .map(([day, members]) => ({ day, members, count: members.length }))
    .sort((a, b) => b.count - a.count);
  return jsonResponse({ club_code: clubCode, roster, matches });
}
