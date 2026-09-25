// Real checkout wiring to VendyAI (the shared selling backend every venture
// in this portfolio uses per the 2026-09-03 standing policy) - implements
// the $29/mo store plan named in ventures.json's spec_v2. Uses VendyAI's v2
// (price_ref-based) catalog rather than v1's raw-Stripe-price-id contract
// because this is bookclubs.cc's first-ever VendyAI integration - no
// existing hardcoded Stripe price id to preserve, so there is nothing v1
// would buy over the provider-neutral v2 path.
//
// RESOLVED 2026-09-25 (depth audit): the ADMIN_SECRET blocker recorded here
// since 2026-09-20 (and re-confirmed still-blocked on 09-21 and 09-23) is
// gone - the env var now authenticates correctly against vendyai.com. Ran
// the two admin calls this comment used to only document: "bookclubs" is
// registered as a real venture_id (webhook_url + a fresh HMAC secret set as
// this Pages project's VENDYAI_HMAC_SECRET), and its $29/mo product is
// minted (price_ref vpr_3fee4b9776b0453a986658b54bdd925e, set as
// BOOKCLUBS_STORE_PLAN_PRICE_REF). Live-verified end-to-end against the real
// production domain, not the preview URL: a real POST here returns a real
// checkout_url on checkout.stripe.com (session created, not completed - no
// real charge was made), and a correctly-HMAC-signed
// checkout.session.completed webhook against vendyai-webhook.js was
// accepted (200) and its test row written to bookclubs_store_orders then
// deleted again, rather than left as fake production data.

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
  const email = String(body?.customer_email || "").trim().slice(0, 200);
  if (!email || !email.includes("@")) {
    return jsonResponse({ detail: { message: "a valid customer_email is required" } }, 400);
  }
  const priceRef = env.BOOKCLUBS_STORE_PLAN_PRICE_REF;
  const origin = new URL(request.url).origin;

  let vendyaiRes, vendyaiData;
  try {
    vendyaiRes = await fetch("https://vendyai.com/api/v2/checkout/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        venture_id: "bookclubs",
        mode: "subscription",
        customer_email: email,
        success_url: `${origin}/?checkout=success`,
        cancel_url: `${origin}/?checkout=cancelled`,
        price_refs: [{ price_ref: priceRef || "pending_registration" }],
        metadata: { source: "bookclubs.cc mvp" },
      }),
    });
    vendyaiData = await vendyaiRes.json().catch(() => ({}));
  } catch (err) {
    return jsonResponse({ detail: { message: `Could not reach billing backend: ${err.message}` } }, 502);
  }

  if (!vendyaiRes.ok) {
    // UNKNOWN_VENTURE / UNKNOWN_PRICE_REF are the expected real responses
    // until the registration steps above run - surface an honest, specific
    // message instead of a generic failure or a fabricated success.
    const code = vendyaiData?.error?.code;
    const message =
      code === "UNKNOWN_VENTURE" || code === "UNKNOWN_PRICE_REF"
        ? "The store plan isn't open for signups yet - check back soon."
        : vendyaiData?.error?.message || "Could not start checkout.";
    return jsonResponse({ detail: { message } }, 503);
  }

  return jsonResponse({ checkout_url: vendyaiData.session?.url }, 201);
}
