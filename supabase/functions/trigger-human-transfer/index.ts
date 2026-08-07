/**
 * Internal edge function — called mid-call from voicebot server (Deno Deploy).
 * Fires a Bonvoice click2call to bridge the waiting school with staff immediately.
 * No user JWT required. Staff destination is picked at random from the
 * transfer_staff table (managed by staff themselves on the Call Center page)
 * instead of a single hardcoded number, so the roster scales past one person.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const AUTH_URL      = "https://backend.pbx.bonvoice.com/usermanagement/external-auth/";
const CALL_URL      = "https://backend.pbx.bonvoice.com/autoDialManagement/autoCallBridging/";
const SB_URL        = Deno.env.get("SUPABASE_URL")!;
const SB_KEY        = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TELEGRAM_TOKEN   = Deno.env.get("TELEGRAM_BOT_TOKEN");
const TELEGRAM_CHAT_ID = Deno.env.get("TELEGRAM_CHAT_ID");

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function cleanPhone(raw: string): string {
  return raw.replace(/\D/g, "").slice(-10);
}

function isValidPhone(p: string): boolean {
  return /^\d{10}$/.test(p);
}

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

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

  try {
    const { schoolPhone, callId, schoolId, prospectId, summary } = await req.json();
    const supabase = createClient(SB_URL, SB_KEY);

    // ── Pick a random active staff member ───────────────────────────────────
    const { data: staffRows, error: staffErr } = await supabase
      .from("transfer_staff")
      .select("name, phone")
      .eq("active", true);
    if (staffErr) throw staffErr;
    if (!staffRows || staffRows.length === 0) {
      console.error("No active transfer_staff rows — cannot bridge transfer");
      return json({ error: "No active transfer staff configured" }, 400);
    }
    const staffPick = staffRows[Math.floor(Math.random() * staffRows.length)];

    // ── Validate phones ───────────────────────────────────────────────────────
    const staffClean  = cleanPhone(staffPick.phone);
    const schoolClean = cleanPhone(schoolPhone || "");

    if (!isValidPhone(staffClean)) {
      console.error(`Invalid staff phone after clean: "${staffClean}" (staff: ${staffPick.name})`);
      return json({ error: "Selected staff phone is not a valid 10-digit number" }, 400);
    }
    if (!isValidPhone(schoolClean)) {
      console.error(`Invalid schoolPhone after clean: "${schoolClean}" (raw: "${schoolPhone}")`);
      return json({ error: "schoolPhone is not a valid 10-digit number" }, 400);
    }

    // ── Bonvoice click2call ───────────────────────────────────────────────────
    const token   = await getBonvoiceToken();
    const DID     = Deno.env.get("BONVOICE_DID")!;
    const eventID = `trns${Date.now().toString(36)}`;

    const callRes = await fetch(CALL_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Token ${token}` },
      body: JSON.stringify({
        autocallType:      "3",
        destination:       staffClean,      // legA — staff answers first
        ringStrategy:      "ringall",
        legACallerID:      DID,
        legAChannelID:     "1",
        legADialAttempts:  "1",
        legBDestination:   schoolClean,     // legB — school called after staff answers
        legBCallerID:      DID,
        legBChannelID:     "1",
        legBDialAttempts:  "1",
        eventID,
        callBackParams: { transferred_from_call: callId || "", summary: summary || "" },
      }),
    });

    const callData = await callRes.json().catch(() => ({}));

    if (Number(callData.responseCode) !== 200) {
      console.error("Bonvoice transfer click2call failed:", callData);
      return json({ error: callData.responseDescription ?? "Click2call failed", raw: callData }, 502);
    }

    // ── Log transfer attempt ──────────────────────────────────────────────────
    await supabase.from("bonvoice_call_logs").insert({
      event_id:          eventID,
      school_phone:      schoolClean,
      staff_phone:       staffClean,
      call_mode:         "click2call",
      direction:         "inbound",
      status:            "initiated",
      outcome:           "transfer_bridge",
      ai_summary:        summary || null,
      prospect_school_id: prospectId ?? null,
      ...(schoolId ? { school_id: schoolId } : {}),
    });

    await sendTelegram(
      `📞 <b>AI call transferred to ${staffPick.name}</b>\n` +
      `School: ${schoolClean}\n` +
      (summary ? `Summary: ${summary}\n` : "") +
      `Staff: ${staffPick.name} (${staffClean})`
    );

    console.log(`Transfer bridge: staff=${staffPick.name}/${staffClean} ↔ school=${schoolClean} eventID=${eventID}`);
    return json({ ok: true, eventId: eventID, staff: staffClean, school: schoolClean });

  } catch (err) {
    console.error("trigger-human-transfer error:", err);
    return json({ error: err instanceof Error ? err.message : "Internal error" }, 500);
  }
});
