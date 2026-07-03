import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const AUTH_URL = "https://backend.pbx.bonvoice.com/usermanagement/external-auth/";
const CALL_URL = "https://backend.pbx.bonvoice.com/autoDialManagement/autoCallBridging/";
const BATCH_SIZE = 10;

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
  const { campaign_id } = await req.json();
  if (!campaign_id) return new Response(JSON.stringify({ error: "campaign_id required" }), { status: 400, headers: { "Content-Type": "application/json" } });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  // Load campaign
  const { data: campaign, error: campErr } = await supabase
    .from("voice_campaigns")
    .select("*")
    .eq("id", campaign_id)
    .single();

  if (campErr || !campaign) return new Response(JSON.stringify({ error: "Campaign not found" }), { status: 404, headers: { "Content-Type": "application/json" } });
  if (campaign.status === "paused") return new Response(JSON.stringify({ ok: false, reason: "paused" }), { headers: { "Content-Type": "application/json" } });

  // Mark as sending
  await supabase.from("voice_campaigns").update({ status: "sending" }).eq("id", campaign_id);

  // Get pending schools
  const { data: schools } = await supabase
    .from("voice_campaign_schools")
    .select("id, phone, event_id, prospect_school_id")
    .eq("campaign_id", campaign_id)
    .eq("status", "pending")
    .limit(BATCH_SIZE);

  if (!schools || schools.length === 0) {
    await supabase.from("voice_campaigns").update({ status: "sent" }).eq("id", campaign_id);
    return new Response(JSON.stringify({ ok: true, sent: 0, done: true }), { headers: { "Content-Type": "application/json" } });
  }

  const DID = Deno.env.get("BONVOICE_DID")!;
  let token: string;
  try { token = await getBonvoiceToken(); }
  catch (e: any) { return new Response(JSON.stringify({ error: e.message }), { status: 502, headers: { "Content-Type": "application/json" } }); }

  let sent = 0;
  let failed = 0;

  for (const school of schools) {
    // Use first 16 chars of UUID (no dashes) — globally unique, within 8-16 char ideal
    const eventID = school.id.replace(/-/g, "").slice(0, 16);

    try {
      const res = await fetch(CALL_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Token ${token}` },
        body: JSON.stringify({
          autocallType: "4",
          destination: school.phone,
          legACallerID: DID,
          speechContent: campaign.speech_content,
          speechLanguage: campaign.speech_language ?? "ENGLISH",
          legADialAttempts: "1",
          eventID,
        }),
      });
      const data = await res.json();

      if (Number(data.responseCode) === 200) {
        await supabase.from("voice_campaign_schools").update({
          status: "calling",
          event_id: eventID,
          sent_at: new Date().toISOString(),
        }).eq("id", school.id);

        // Log to call logs
        await supabase.from("bonvoice_call_logs").insert({
          prospect_school_id: school.prospect_school_id,
          event_id: eventID,
          school_phone: school.phone,
          call_mode: "tts",
          speech_content: campaign.speech_content,
          status: "initiated",
        });
        sent++;
      } else {
        await supabase.from("voice_campaign_schools").update({ status: "failed" }).eq("id", school.id);
        failed++;
      }
    } catch {
      await supabase.from("voice_campaign_schools").update({ status: "failed" }).eq("id", school.id);
      failed++;
    }
  }

  // Update campaign counts
  await supabase.rpc("increment_voice_campaign_counts", {
    p_campaign_id: campaign_id,
    p_sent: sent,
    p_failed: failed,
  });

  // Check if all done
  const { count: pending } = await supabase
    .from("voice_campaign_schools")
    .select("id", { count: "exact", head: true })
    .eq("campaign_id", campaign_id)
    .eq("status", "pending");

  const done = (pending ?? 0) === 0;
  if (done) {
    await supabase.from("voice_campaigns").update({ status: "sent" }).eq("id", campaign_id);
  }

  console.log(`Voice campaign ${campaign_id}: sent=${sent} failed=${failed} done=${done}`);
  return new Response(JSON.stringify({ ok: true, sent, failed, done }), { headers: { "Content-Type": "application/json" } });
});
