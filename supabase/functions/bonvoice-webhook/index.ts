import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, x-webhook-token",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

  const WEBHOOK_TOKEN = Deno.env.get("BONVOICE_WEBHOOK_TOKEN");
  if (WEBHOOK_TOKEN) {
    const url = new URL(req.url);
    const token = url.searchParams.get("token") ?? req.headers.get("x-webhook-token") ?? "";
    if (token !== WEBHOOK_TOKEN) return new Response("Unauthorized", { status: 401 });
  }

  // Parse body — Bonvoice sends either form-urlencoded or JSON
  const contentType = req.headers.get("content-type") ?? "";
  const body: Record<string, any> = {};

  if (contentType.includes("application/x-www-form-urlencoded")) {
    const text = await req.text();
    for (const [k, v] of new URLSearchParams(text).entries()) body[k] = v;
  } else {
    try { Object.assign(body, await req.json()); } catch { /* ok — empty body */ }
  }

  console.log("Bonvoice webhook body:", JSON.stringify(body));

  const eventID      = body.eventID as string | undefined;
  const callType     = body.callType !== undefined ? Number(body.callType) : null;
  const callID       = body.callID   as string | undefined;
  const startTime    = body.StartTime  as string | undefined;
  const endTime      = body.EndTime    as string | undefined;
  const callDuration = body.CallDuration !== undefined ? Number(body.CallDuration) : null;
  const dtmf         = body.DTMF        as string | undefined;
  const resourceURL  = body.ResourceURL as string | undefined;

  if (!eventID) return new Response("ok", { status: 200, headers: CORS });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  // Map callType to status
  // 0 = call initiated/ringing, 1 = call answered, 2 = call hangup
  let newStatus: string | null = null;
  if (callType === 0) newStatus = "ringing";
  else if (callType === 1) newStatus = "answered";
  else if (callType === 2) newStatus = (callDuration && callDuration > 0) ? "completed" : "no_answer";

  const update: Record<string, unknown> = {};
  if (newStatus)       update.status        = newStatus;
  if (callID)          update.call_id       = callID;
  if (startTime)       update.start_time    = startTime;
  if (endTime)         update.end_time      = endTime;
  if (callDuration !== null) update.call_duration = callDuration;
  if (dtmf)            update.dtmf          = dtmf;
  if (resourceURL)     update.resource_url  = resourceURL;

  if (Object.keys(update).length > 0) {
    await supabase.from("bonvoice_call_logs").update(update).eq("event_id", eventID);
  }

  // Update voice campaign schools on hangup
  if (callType === 2) {
    await supabase.from("voice_campaign_schools").update({
      status: (callDuration && callDuration > 0) ? "answered" : "no_answer",
      call_duration: callDuration ?? null,
      dtmf: dtmf ?? null,
    }).eq("event_id", eventID);
  }

  return new Response("ok", { status: 200, headers: CORS });
});
