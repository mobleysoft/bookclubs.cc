// Real receiving endpoint for VendyAI's forwarded checkout.session.completed
// events (see vendyai-com-worker/src/worker.js's forwardToVenture()). This
// didn't exist before 2026-09-21 - checkout.js could create a session, but
// nothing on bookclubs.cc's side recorded a completed order, so the "store
// plan" purchase would have vanished the moment Stripe's payment landed.
// Registration at vendyai.com (POST /api/ventures/register, admin-secret
// protected) is still a separate, unfinished step - see checkout.js's own
// header comment for why. This handler is ready the moment that runs.

async function hmacSha256Base64Url(message, secret) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  const binary = String.fromCharCode(...new Uint8Array(sig));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export async function onRequestPost({ request, env }) {
  const signature = request.headers.get("X-Webhook-Signature") || "";
  const timestamp = request.headers.get("X-Webhook-Timestamp") || "";
  const rawBody = await request.text();

  if (!env.VENDYAI_HMAC_SECRET) {
    return jsonResponse({ detail: { message: "webhook not configured" } }, 503);
  }
  if (!signature || !timestamp) {
    return jsonResponse({ detail: { message: "missing signature headers" } }, 401);
  }
  // Reject stale deliveries/replays - same 5-minute window Stripe itself uses.
  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > 300) {
    return jsonResponse({ detail: { message: "stale or invalid timestamp" } }, 401);
  }
  const expected = await hmacSha256Base64Url(`${timestamp}.${rawBody}`, env.VENDYAI_HMAC_SECRET);
  if (!timingSafeEqual(expected, signature)) {
    return jsonResponse({ detail: { message: "invalid signature" } }, 401);
  }

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return jsonResponse({ detail: { message: "invalid JSON body" } }, 400);
  }

  if (event?.type === "checkout.session.completed") {
    const data = event.data || {};
    try {
      await env.DB.prepare(
        "INSERT INTO bookclubs_store_orders (id, venture, stripe_customer_id, amount_total_cents, currency, net_to_venture_cents, event_type) VALUES (?, ?, ?, ?, ?, ?, ?)"
      ).bind(
        crypto.randomUUID(),
        "bookclubs.cc",
        data.stripe_customer_id || null,
        data.amount_total ?? null,
        data.currency || null,
        data.net_to_venture_cents ?? null,
        event.type
      ).run();
    } catch (err) {
      return jsonResponse({ detail: { message: err.message } }, 500);
    }
  }

  return jsonResponse({ received: true });
}
