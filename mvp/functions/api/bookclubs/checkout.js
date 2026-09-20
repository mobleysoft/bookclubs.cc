// Real checkout wiring to VendyAI (the shared selling backend every venture
// in this portfolio uses per the 2026-09-03 standing policy) - implements
// the $29/mo store plan named in ventures.json's spec_v2. Uses VendyAI's v2
// (price_ref-based) catalog rather than v1's raw-Stripe-price-id contract
// because this is bookclubs.cc's first-ever VendyAI integration - no
// existing hardcoded Stripe price id to preserve, so there is nothing v1
// would buy over the provider-neutral v2 path.
//
// BLOCKED as of 2026-09-20: registering "bookclubs" as a venture_id and
// minting its $29/mo product both require VendyAI's ADMIN_SECRET, which
// mascom/.rotated_secrets_20260920.txt confirms was rotated today by a
// separate process. Neither this session's env var nor macOS Keychain
// (com.mobleysoft.vendyai.*) holds the new value. Until someone who does
// runs the two admin calls below, VendyAI will correctly reject every real
// request here with UNKNOWN_VENTURE - verified live 2026-09-20, not
// assumed:
//
//   curl -X POST https://vendyai.com/api/ventures/register \
//     -H "X-Admin-Secret: $VENDYAI_ADMIN_SECRET" -H "Content-Type: application/json" \
//     -d '{"venture_id":"bookclubs","webhook_url":"https://bookclubs.cc/api/bookclubs/vendyai-webhook","hmac_secret":"<value already stored as this Pages project's VENDYAI_HMAC_SECRET>"}'
//
//   curl -X POST https://vendyai.com/api/v2/products \
//     -H "X-Admin-Secret: $VENDYAI_ADMIN_SECRET" -H "Content-Type: application/json" \
//     -d '{"venture_id":"bookclubs","name":"bookclubs.cc Store Plan","unit_amount_cents":2900,"currency":"usd","recurring_interval":"month"}'
//
// The second call's response includes a price_ref (vpr_...) - set that as
// this Pages project's BOOKCLUBS_STORE_PLAN_PRICE_REF env var and this
// endpoint starts working with no code change.

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
