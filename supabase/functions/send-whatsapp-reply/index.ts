import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const ASKEVA_URL = "https://backend.askeva.io/v1/message/send-message";
const ASKEVA_API_TOKEN = Deno.env.get("ASKEVA_API_TOKEN") ?? "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Freeform WhatsApp reply from the Message Centre's "Needs Reply" tab — a
// genuine session message (type: "text"), not a template. Only valid within
// WhatsApp's 24-hour customer-service window after the inbound message this
// answers; AskEVA/Meta reject it outside that window, surfaced below as a
// normal error rather than a crash.
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const { waReplyId, phone, text } = await req.json();

    if (!phone || typeof phone !== "string") {
      return new Response(JSON.stringify({ error: "phone is required" }), {
        status: 400, headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }
    const trimmedText = typeof text === "string" ? text.trim() : "";
    if (!trimmedText) {
      return new Response(JSON.stringify({ error: "text is required" }), {
        status: 400, headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const payload = { to: phone, type: "text", text: { body: trimmedText } };

    let askevaStatus = 0;
    let askevaResponse: any = null;
    try {
      const res = await fetch(`${ASKEVA_URL}?token=${encodeURIComponent(ASKEVA_API_TOKEN)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      askevaStatus = res.status;
      const rawText = await res.text();
      try { askevaResponse = JSON.parse(rawText); } catch { askevaResponse = { raw: rawText }; }
    } catch (e: any) {
      askevaResponse = { error: e?.message || "network error" };
    }

    const wamid: string | undefined = askevaResponse?.messages?.[0]?.id;
    const httpOk = askevaStatus >= 200 && askevaStatus < 300;
    const askevaOk = httpOk && !!wamid;

    if (!askevaOk) {
      const message =
        askevaResponse?.error?.message ||
        askevaResponse?.message ||
        askevaResponse?.error ||
        "AskEVA rejected the message (commonly: outside the 24-hour reply window)";
      return new Response(JSON.stringify({ error: message, askevaResponse }), {
        status: 502, headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    const authHeader = req.headers.get("Authorization") ?? "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "");
    const { data: { user } } = await supabase.auth.getUser(jwt);

    await supabase.from("wa_reply_responses").insert({
      wa_reply_id: waReplyId ?? null,
      phone,
      message_text: trimmedText,
      wamid,
      sent_by: user?.id ?? null,
    });

    if (waReplyId) {
      await supabase.from("wa_replies").update({ status: "replied" }).eq("id", waReplyId);
    }

    return new Response(JSON.stringify({ success: true, wamid }), {
      status: 200, headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || "Unexpected error" }), {
      status: 500, headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }
});
