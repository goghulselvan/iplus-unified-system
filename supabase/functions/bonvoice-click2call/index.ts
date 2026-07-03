import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const AUTH_URL = "https://backend.pbx.bonvoice.com/usermanagement/external-auth/";
const CALL_URL = "https://backend.pbx.bonvoice.com/autoDialManagement/autoCallBridging/";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, x-client-info, apikey",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });

// Strips non-digits, removes leading 91 country code, returns last 10 digits
function cleanPhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  return digits.startsWith("91") && digits.length === 12 ? digits.slice(2) : digits.slice(-10);
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
  const data = await res.json();
  if (String(data.status) !== "1") throw new Error("Bonvoice auth failed: " + JSON.stringify(data));
  return data.data.token;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  let body: any;
  try { body = await req.json(); } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const { type, prospect_school_id, school_phone, staff_phone, speech_content, speech_language } = body;

  if (!type || !school_phone) return json({ error: "type and school_phone required" }, 400);

  const cleanSchoolPhone = cleanPhone(school_phone);
  if (cleanSchoolPhone.length !== 10) return json({ error: `Invalid school phone: ${school_phone}` }, 400);

  const DID = Deno.env.get("BONVOICE_DID")!;
  const eventID = `ips${Date.now().toString(36)}`;

  let token: string;
  try {
    token = await getBonvoiceToken();
  } catch (e: any) {
    return json({ error: e.message }, 502);
  }

  let payload: Record<string, unknown>;

  if (type === "click2call") {
    if (!staff_phone) return json({ error: "staff_phone required for click2call" }, 400);
    const cleanStaffPhone = cleanPhone(staff_phone);
    if (cleanStaffPhone.length !== 10) return json({ error: `Invalid staff phone: ${staff_phone}` }, 400);
    payload = {
      autocallType: "3",
      destination: cleanStaffPhone,
      ringStrategy: "ringall",
      legACallerID: DID,
      legAChannelID: "1",
      legADialAttempts: "1",
      legBDestination: cleanSchoolPhone,
      legBCallerID: DID,
      legBChannelID: "1",
      legBDialAttempts: "1",
      eventID,
      callBackParams: { prospect_school_id: String(prospect_school_id ?? "") },
    };
  } else if (type === "tts") {
    if (!speech_content) return json({ error: "speech_content required for tts" }, 400);
    payload = {
      autocallType: "4",
      destination: cleanSchoolPhone,
      legACallerID: DID,
      speechContent: speech_content,
      speechLanguage: speech_language ?? "ENGLISH",
      legADialAttempts: "1",
      eventID,
    };
  } else {
    return json({ error: "type must be click2call or tts" }, 400);
  }

  const callRes = await fetch(CALL_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Token ${token}` },
    body: JSON.stringify(payload),
  });
  const callData = await callRes.json();

  if (Number(callData.responseCode) !== 200) {
    console.error("Bonvoice call failed:", callData);
    return json({ error: callData.responseDescription ?? "Call initiation failed", raw: callData }, 502);
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  const { data: { user } } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));

  await supabase.from("bonvoice_call_logs").insert({
    prospect_school_id: prospect_school_id ?? null,
    event_id: eventID,
    staff_phone: type === "click2call" ? cleanPhone(staff_phone) : null,
    school_phone: cleanSchoolPhone,
    call_mode: type,
    speech_content: type === "tts" ? speech_content : null,
    status: "initiated",
    created_by: user?.id ?? null,
  });

  console.log(`Call initiated: ${type} eventID=${eventID} school=${cleanSchoolPhone}`);
  return json({ ok: true, event_id: eventID });
});
