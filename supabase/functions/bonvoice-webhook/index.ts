import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, x-webhook-token",
};

const TELEGRAM_TOKEN   = Deno.env.get("TELEGRAM_BOT_TOKEN");
const TELEGRAM_CHAT_ID = Deno.env.get("TELEGRAM_CHAT_ID");

async function sendTelegram(text: string) {
  if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT_ID) return;
  try {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text, parse_mode: "HTML" }),
    });
  } catch (e) {
    console.error("Telegram notify failed:", e);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

  const WEBHOOK_TOKEN = Deno.env.get("BONVOICE_WEBHOOK_TOKEN");
  if (WEBHOOK_TOKEN) {
    const url   = new URL(req.url);
    const token = url.searchParams.get("token") ?? req.headers.get("x-webhook-token") ?? "";
    if (token !== WEBHOOK_TOKEN) return new Response("Unauthorized", { status: 401 });
  }

  const contentType = req.headers.get("content-type") ?? "";
  const body: Record<string, any> = {};

  if (contentType.includes("application/x-www-form-urlencoded")) {
    const text = await req.text();
    for (const [k, v] of new URLSearchParams(text).entries()) body[k] = v;
  } else {
    try { Object.assign(body, await req.json()); } catch { /* empty body */ }
  }

  console.log("Bonvoice webhook:", JSON.stringify(body));

  // Bonvoice sends naive IST timestamps ("2026-07-08 16:23:03") — tag them so
  // Postgres doesn't store them as UTC (which displayed +5:30 twice in the UI)
  const asIST = (t: string | undefined) =>
    t && !/[+Z]/i.test(t) ? `${t}+05:30` : t;

  const eventID      = body.eventID      as string | undefined;
  const callType     = body.callType     !== undefined ? Number(body.callType) : null;
  const callID       = body.callID       as string | undefined;
  const direction    = body.Direction    as string | undefined;
  const sourceNumber = body.SourceNumber as string | undefined;
  const startTime    = asIST(body.StartTime as string | undefined);
  const endTime      = asIST(body.EndTime as string | undefined);
  const callDuration = body.CallDuration !== undefined ? Number(body.CallDuration) : null;
  const dtmf         = body.DTMF         as string | undefined;
  const resourceURL  = body.ResourceURL  as string | undefined;
  // Raw Bonvoice statuses (ANSWERED/NOANSWER/BUSY/NOINPUT/NO_CHANNEL) — richer
  // than the callType-derived status; captured as-is for the Call Center UI
  const bvStatus     = body.Status       as string | undefined;
  const agentStatus  = body.AgentStatus  as string | undefined;

  // Inbound calls carry no eventID (it's outbound-only per Bonvoice docs) — key them by callID
  if (!eventID && !callID) return new Response("ok", { status: 200, headers: CORS });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const isInbound = (direction ?? "").toLowerCase() === "inbound";

  let newStatus: string | null = null;
  if (callType === 0) newStatus = "ringing";
  else if (callType === 1) newStatus = "answered";
  else if (callType === 2) newStatus = (callDuration && callDuration > 0) ? "completed" : "no_answer";

  const update: Record<string, unknown> = {};
  if (newStatus)             update.status        = newStatus;
  if (callID)                update.call_id       = callID;
  if (startTime)             update.start_time    = startTime;
  if (endTime)               update.end_time      = endTime;
  if (callDuration !== null) update.call_duration = callDuration;
  if (dtmf)                  update.dtmf          = dtmf;
  if (resourceURL)           update.resource_url  = resourceURL;
  if (bvStatus)              update.bonvoice_status = bvStatus;
  if (agentStatus)           update.agent_status  = agentStatus;

  if (Object.keys(update).length > 0 && eventID) {
    await supabase.from("bonvoice_call_logs").update(update).eq("event_id", eventID);
  }

  // ── Calls not originated by the CRM (inbound, or dialed from the Bonvoice
  //    dashboard): create/update the log row keyed by callID, matched to
  //    school/prospect by the other party's number ─────────────────────────
  const destinationNumber = body.DestinationNumber as string | undefined;
  if (!eventID && callID) {
    const otherParty = isInbound ? sourceNumber : destinationNumber;
    const last10 = (otherParty ?? "").replace(/\D/g, "").slice(-10);

    // Who is calling? CRM school first, then prospect (via saved numbers)
    let schoolId: string | null = null;
    let prospectId: string | null = null;
    if (/^[6-9]\d{9}$/.test(last10)) {
      const { data: m } = await supabase.rpc("match_phone_all", { p_last10: last10 });
      const row = Array.isArray(m) ? m[0] : m;
      schoolId = row?.school_id ?? null;
      prospectId = row?.prospect_school_id ?? null;
    }

    const { data: existing } = await supabase
      .from("bonvoice_call_logs").select("id").eq("call_id", callID).maybeSingle();

    if (existing) {
      await supabase.from("bonvoice_call_logs").update({
        ...update,
        ...(schoolId && { school_id: schoolId }),
        ...(prospectId && { prospect_school_id: prospectId }),
      }).eq("call_id", callID);
    } else {
      await supabase.from("bonvoice_call_logs").insert({
        call_id: callID,
        event_id: null,
        school_phone: last10 || otherParty || null,
        call_mode: isInbound ? "inbound" : "manual_outbound",
        direction: isInbound ? "inbound" : "outbound",
        status: newStatus ?? "ringing",
        start_time: startTime ?? null,
        end_time: endTime ?? null,
        call_duration: callDuration,
        resource_url: resourceURL ?? null,
        bonvoice_status: bvStatus ?? null,
        agent_status: agentStatus ?? null,
        school_id: schoolId,
        prospect_school_id: prospectId,
      });
    }

    // Completed call with a known CRM school → its communication history, with recording
    if (callType === 2 && schoolId) {
      const mins = Math.floor((callDuration ?? 0) / 60);
      const secs = (callDuration ?? 0) % 60;
      const answered = (callDuration ?? 0) > 0;
      // communications.project_id is NOT NULL — fall back to the active project
      const { data: schoolRow } = await supabase.from("schools").select("current_project_id").eq("id", schoolId).maybeSingle();
      let projectId = schoolRow?.current_project_id ?? null;
      if (!projectId) {
        const { data: proj } = await supabase.from("olympiad_projects").select("id").eq("is_active", true).maybeSingle();
        projectId = proj?.id ?? null;
      }
      await supabase.from("communications").insert({
        school_id: schoolId,
        project_id: projectId,
        communication_type: "Phone",
        direction: isInbound ? "inbound" : "outbound",
        message: `${isInbound ? "Incoming call from" : "Outbound call to"} ${last10} — ${
          answered ? `answered, ${mins}m ${secs}s` : isInbound ? "missed" : "no answer"
        }`,
        contacted_mobile_no: last10,
        duration_seconds: callDuration ?? null,
        recording_url: resourceURL ?? null,
        bonvoice_call_id: callID,
        user_id: "8dd2a8b7-1349-4e7e-b821-3171bd6bf2cc", // iPlus Super Admin's profiles.user_id (FK target, not profiles.id)
      }).then(({ error }) => { if (error) console.error("Comm log insert failed:", error.message); });
    }
  }

  // ── On hangup: update campaign stats + send Telegram notification ─────────
  if (callType === 2) {
    const wasAnswered = callDuration !== null && callDuration > 0;

    const { data: vcs } = await supabase
      .from("voice_campaign_schools")
      .update({
        status: wasAnswered ? "answered" : "no_answer",
        call_duration: callDuration ?? null,
        dtmf: dtmf ?? null,
      })
      .eq("event_id", eventID)
      .select("campaign_id")
      .single();

    if (wasAnswered && vcs?.campaign_id) {
      await supabase.rpc("increment_voice_campaign_counts", {
        p_campaign_id: vcs.campaign_id,
        p_answered: 1,
      });
    }

    // ── Telegram: notify staff on completed or transferred calls ─────────────
    if (wasAnswered) {
      const { data: log } = await supabase
        .from("bonvoice_call_logs")
        .select("school_phone, direction, outcome, transfer_reason, ai_summary, transcript")
        .eq("event_id", eventID)
        .maybeSingle();

      const mins = Math.floor((callDuration ?? 0) / 60);
      const secs = (callDuration ?? 0) % 60;
      const dur  = `${mins}m ${secs}s`;
      const dir  = log?.direction === "inbound" ? "📲 Inbound" : "📞 Outbound";
      const phone = log?.school_phone || sourceNumber || "Unknown";

      if (log?.outcome === "transferred_to_human") {
        // click2call was already triggered mid-call by the voicebot server.
        // This alert confirms it happened and gives staff full context.
        await sendTelegram(
          `🚨 <b>Transfer to Human — Action Required</b>\n\n` +
          `${dir} call from <b>${phone}</b>\n` +
          `Duration: ${dur}\n` +
          `Reason: ${log?.transfer_reason || "Caller requested human agent"}\n\n` +
          `Staff click2call was initiated mid-call.\n` +
          `If school did not receive a call, please ring <b>${phone}</b> manually.`
        );
      } else if (log?.outcome === "interested" || dtmf) {
        await sendTelegram(
          `✅ <b>Interested School — Follow Up Needed</b>\n\n` +
          `${dir} call from <b>${phone}</b>\n` +
          `Duration: ${dur}\n` +
          `DTMF: ${dtmf || "none"}\n` +
          `Summary: ${log?.ai_summary || "School expressed interest in iPlus Olympiads"}`
        );
      } else if (log?.direction === "inbound" && wasAnswered) {
        await sendTelegram(
          `📲 <b>Inbound Call Completed</b>\n\n` +
          `From: <b>${phone}</b>\n` +
          `Duration: ${dur}\n` +
          `Summary: ${log?.ai_summary || "Call handled by AI agent"}`
        );
      }
    }
  }

  return new Response("ok", { status: 200, headers: CORS });
});
