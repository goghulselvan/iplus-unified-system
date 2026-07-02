import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ASKEVA_URL = "https://backend.askeva.io/v1/message/send-message";

function normalizeMobile(raw: string): string | null {
  const digits = String(raw).replace(/\D/g, "");
  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 12 && digits.startsWith("91")) return digits;
  return null;
}

function isParamError(err: string | null): boolean {
  return !!err && (err.includes("#132000") || err.includes("media file is absent") || err.includes("parameter"));
}

async function sendOne(
  mobile: string,
  schoolName: string,
  templateName: string,
  token: string,
  brochureUrl: string,
  brochureYear: number,
  hasFileHeader: boolean,
  bodyParamCount: number,
): Promise<{ wamid: string | null; error: string | null }> {
  const components: any[] = [];

  if (hasFileHeader) {
    components.push({
      type: "header",
      parameters: [{ type: "document", document: { link: brochureUrl, filename: `iPlus Olympiads ${brochureYear} Brochure.pdf` } }],
    });
  }

  const bodyParams = Array.from({ length: bodyParamCount }, () => ({ type: "text", text: schoolName }));
  components.push({ type: "body", parameters: bodyParams });

  const payload = {
    messaging_product: "whatsapp",
    to: mobile,
    type: "template",
    template: { name: templateName, language: { code: "en" }, components },
  };

  try {
    const res = await fetch(`${ASKEVA_URL}?token=${encodeURIComponent(token)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const rawText = await res.text();
    console.log("Askeva status:", res.status, "cfg:", hasFileHeader ? "header" : "noheader", bodyParamCount, "body:", rawText);
    let body: any = {};
    try { body = JSON.parse(rawText); } catch { body = { _raw: rawText }; }
    if (res.ok && body?.messages?.[0]?.id) return { wamid: body.messages[0].id, error: null };
    const errMsg = body?.error?.message ?? body?.message ?? body?.error ?? rawText ?? `HTTP ${res.status}`;
    return { wamid: null, error: `HTTP ${res.status}: ${errMsg}` };
  } catch (e: any) {
    return { wamid: null, error: e.message };
  }
}

// Auto-detects the correct template config by trying combinations.
// Returns the working config so the batch can reuse it without retrying.
async function autoSend(
  mobile: string,
  schoolName: string,
  templateName: string,
  token: string,
  brochureUrl: string,
  brochureYear: number,
  knownCfg: { hasFileHeader: boolean; bodyParamCount: number } | null,
): Promise<{ wamid: string | null; error: string | null; cfg: { hasFileHeader: boolean; bodyParamCount: number } }> {
  // If config already detected in this batch, go straight to it
  if (knownCfg) {
    const result = await sendOne(mobile, schoolName, templateName, token, brochureUrl, brochureYear, knownCfg.hasFileHeader, knownCfg.bodyParamCount);
    return { ...result, cfg: knownCfg };
  }

  // Try combinations in priority order: file header first, then text-only; 1 param then 2 then 3
  const configs = [
    { hasFileHeader: true,  bodyParamCount: 1 },
    { hasFileHeader: true,  bodyParamCount: 2 },
    { hasFileHeader: true,  bodyParamCount: 3 },
    { hasFileHeader: false, bodyParamCount: 1 },
    { hasFileHeader: false, bodyParamCount: 2 },
    { hasFileHeader: false, bodyParamCount: 3 },
  ];

  let lastError: string | null = null;
  for (const cfg of configs) {
    const result = await sendOne(mobile, schoolName, templateName, token, brochureUrl, brochureYear, cfg.hasFileHeader, cfg.bodyParamCount);
    if (result.wamid) {
      console.log("Auto-detected config:", JSON.stringify(cfg));
      return { wamid: result.wamid, error: null, cfg };
    }
    lastError = result.error;
    if (!isParamError(result.error)) break; // non-retryable error, stop trying
  }
  return { wamid: null, error: lastError, cfg: configs[0] };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const ASKEVA_API_TOKEN = Deno.env.get("ASKEVA_API_TOKEN");
  if (!ASKEVA_API_TOKEN) {
    return new Response(JSON.stringify({ error: "ASKEVA_API_TOKEN not set" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // JWT pre-validated by Supabase gateway (verify_jwt: true)
  const authToken = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  let userId = "unknown";
  try { const [, b64] = authToken.split("."); userId = JSON.parse(atob(b64)).sub ?? "unknown"; } catch { /* ok */ }

  try {
    const body = await req.json();
    const { campaign_id, template_name, batch_size = 50, test_numbers } = body;
    if (!template_name) throw new Error("template_name required");

    const { data: project, error: projErr } = await supabase
      .from("olympiad_projects").select("id, brochure_url, project_year").eq("is_active", true).maybeSingle();
    if (projErr || !project?.brochure_url) throw new Error("No brochure uploaded for the active project.");
    const brochureUrl = project.brochure_url as string;
    const brochureYear = project.project_year as number;

    // ── TEST MODE ──
    if (Array.isArray(test_numbers) && test_numbers.length > 0) {
      const results = [];
      let detectedCfg: { hasFileHeader: boolean; bodyParamCount: number } | null = null;
      for (const raw of test_numbers.slice(0, 10)) {
        const mobile = normalizeMobile(String(raw));
        if (!mobile) { results.push({ number: raw, success: false, error: "Invalid number" }); continue; }
        const { wamid, error, cfg } = await autoSend(mobile, "Test School", template_name, ASKEVA_API_TOKEN, brochureUrl, brochureYear, detectedCfg);
        if (wamid) detectedCfg = cfg;
        results.push({ number: raw, success: !!wamid, ...(wamid && { wamid }), ...(error && { error }) });
      }
      return new Response(JSON.stringify({ test: true, results }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ── CAMPAIGN MODE ──
    if (!campaign_id) throw new Error("campaign_id required");

    // Bail out immediately if campaign was paused or cancelled
    const { data: campaign } = await supabase
      .from("campaigns").select("status").eq("id", campaign_id).single();
    if (campaign?.status === "paused" || campaign?.status === "cancelled") {
      return new Response(JSON.stringify({ skipped: true, reason: campaign.status }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Atomically claim a batch using FOR UPDATE SKIP LOCKED — prevents duplicate sends
    // when multiple cron invocations run concurrently for the same campaign.
    const { data: schools, error: fetchErr } = await supabase
      .rpc("claim_wa_campaign_batch", { p_campaign_id: campaign_id, p_batch_size: batch_size });

    if (fetchErr) throw fetchErr;
    if (!schools || schools.length === 0) {
      // Check remaining pending (not counting in-progress 'sending' rows from parallel runs)
      const { count: remaining } = await supabase.from("campaign_schools").select("id", { count: "exact", head: true })
        .eq("campaign_id", campaign_id).eq("status", "pending");
      if ((remaining ?? 0) === 0) {
        await supabase.from("campaigns").update({ status: "sent" }).eq("id", campaign_id);
        return new Response(JSON.stringify({ done: true, sent: 0, failed: 0 }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({ done: false, sent: 0, failed: 0, note: "batch claimed by another invocation" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    let sent = 0, failed = 0;
    let detectedCfg: { hasFileHeader: boolean; bodyParamCount: number } | null = null;

    for (const row of schools) {
      const mobile = normalizeMobile(row.mobile ?? "");
      if (!mobile) {
        await supabase.from("campaign_schools").update({ status: "failed", error_message: "Invalid mobile" }).eq("id", row.id);
        failed++; continue;
      }
      const { wamid, error, cfg } = await autoSend(mobile, row.school_name ?? "School", template_name, ASKEVA_API_TOKEN, brochureUrl, brochureYear, detectedCfg);
      if (wamid) { detectedCfg = cfg; await supabase.from("campaign_schools").update({ status: "sent", sent_at: new Date().toISOString(), wamid, delivery_status: "sent" }).eq("id", row.id); sent++; }
      else { await supabase.from("campaign_schools").update({ status: "failed", error_message: error, delivery_status: "failed" }).eq("id", row.id); failed++; }
    }

    await supabase.rpc("increment_campaign_counts", { p_campaign_id: campaign_id, p_sent: sent, p_failed: failed }).catch(() => {});
    const { count: remaining } = await supabase.from("campaign_schools").select("id", { count: "exact", head: true })
      .eq("campaign_id", campaign_id).eq("status", "pending");
    const done = (remaining ?? 0) === 0;

    // Only update status if campaign wasn't paused/cancelled mid-batch
    const { data: currentCampaign } = await supabase.from("campaigns").select("status").eq("id", campaign_id).single();
    if (currentCampaign?.status !== "paused" && currentCampaign?.status !== "cancelled") {
      await supabase.from("campaigns").update({ status: done ? "sent" : "sending" }).eq("id", campaign_id);
    }

    return new Response(JSON.stringify({ done, sent, failed }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
