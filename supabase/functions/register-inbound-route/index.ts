/**
 * One-time setup: registers the Bonvoice inbound DID route to point at
 * the voicebot WebSocket server (Deno Deploy).
 *
 * Call once after VOICEBOT_WSS_URL is set.
 * POST { did, provider_name? } → registers route for did → VOICEBOT_WSS_URL
 *
 * The DID must be passed explicitly — BONVOICE_DID is the MAIN incoming line
 * (8065453052) and must never be voicebot-routed by accident. Voicebot DID
 * decided 2026-07-16: 8065453051.
 */

const AUTH_URL  = "https://backend.pbx.bonvoice.com/usermanagement/external-auth/";
const ROUTE_URL = "https://backend.pbx.bonvoice.com/external-route-create/";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function getBonvoiceToken(): Promise<string> {
  const res = await fetch(AUTH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: Deno.env.get("BONVOICE_USERNAME")!,
      password: Deno.env.get("BONVOICE_PASSWORD")!,
    }),
  });
  const d = await res.json();
  if (String(d.status) !== "1") throw new Error("Bonvoice auth failed: " + JSON.stringify(d));
  return d.data.token;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const wssUrl = Deno.env.get("VOICEBOT_WSS_URL");
  const body = await req.json().catch(() => ({}));
  const did = body.did as string | undefined;
  const providerName = (body.provider_name as string | undefined) ?? "iplus_voicebot";

  if (!wssUrl) {
    return new Response(JSON.stringify({ error: "VOICEBOT_WSS_URL secret not set" }), {
      status: 400, headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
  if (!did) {
    return new Response(JSON.stringify({ error: "Pass { did } explicitly — refusing to default to the main line" }), {
      status: 400, headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  try {
    const token = await getBonvoiceToken();

    const res = await fetch(ROUTE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Token ${token}` },
      body: JSON.stringify({
        scope:         "voicebot",
        did,
        provider_name: providerName,
        template_url:  wssUrl,
      }),
    });

    const data = await res.json().catch(() => ({}));
    console.log("Bonvoice route registration response:", data);

    if (!res.ok || (data.status !== undefined && String(data.status) !== "1")) {
      return new Response(JSON.stringify({ error: "Route registration failed", raw: data }), {
        status: 502, headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({
      ok: true,
      did,
      wssUrl,
      message: `Inbound calls on ${did} will now be answered by Arya (voicebot).`,
      raw: data,
    }), { headers: { ...CORS, "Content-Type": "application/json" } });

  } catch (err) {
    console.error("register-inbound-route error:", err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "Internal error" }), {
      status: 500, headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});
