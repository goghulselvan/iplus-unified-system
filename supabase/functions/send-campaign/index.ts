import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

const DEFAULT_FROM = "iPlus Olympiads <olympiads@news.iplusedu.in>";
const REPLY_TO = "info@iplusedu.in";
const PROJECT = { name: "iPlus Olympiads", year: "2026" };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_TEST = 25;
const SEED_SAMPLE = { id: "seed", school_name: "Sample School", principal_name: "the Principal", district: "Your District", state: "Your State", board: "State Board", ss_no: 0 };

function parseEmails(raw: unknown): { valid: string[]; invalid: string[] } {
  const list = Array.isArray(raw) ? raw.map(String) : String(raw ?? "").split(/[\s,;]+/);
  const uniq = [...new Set(list.map((e) => e.trim()).filter(Boolean))];
  return { valid: uniq.filter((e) => EMAIL_RE.test(e)), invalid: uniq.filter((e) => !EMAIL_RE.test(e)) };
}

function fill(t: string, s: any, unsubUrl: string): string {
  const m: Record<string, string> = {
    school_name: s.school_name ?? "", principal_name: s.principal_name ?? "", district: s.district ?? "",
    state: s.state ?? "", board: s.board ?? "", ss_no: String(s.ss_no ?? ""),
    project_name: PROJECT.name, project_year: PROJECT.year, unsubscribe_url: unsubUrl,
  };
  let out = t || "";
  for (const k in m) out = out.replaceAll("{{" + k + "}}", m[k]).replaceAll("{" + k + "}", m[k]);
  return out;
}

function brandedHtml(bodyHtml: string, unsubUrl: string): string {
  return `<!doctype html><html><body style="margin:0;background:#f4f4f7;font-family:Arial,Helvetica,sans-serif;">`
    + `<div style="max-width:600px;margin:0 auto;background:#ffffff;"><div style="padding:28px;color:#111827;font-size:15px;line-height:1.6;">${bodyHtml}</div>`
    + `<div style="padding:18px 28px;border-top:1px solid #eee;color:#9ca3af;font-size:11px;text-align:center;">iPlus Olympiads · <a href="${unsubUrl}" style="color:#6b7280;">Unsubscribe</a></div></div></body></html>`;
}
function renderHtml(body: string, s: any, unsubUrl: string): string {
  const filled = fill(body, s, unsubUrl);
  return /<!doctype|<html/i.test(body) ? filled : brandedHtml(filled, unsubUrl);
}

async function sendViaElastic(apiKey: string, from: string, to: string, subject: string, html: string, unsubUrl: string) {
  const res = await fetch("https://api.elasticemail.com/v4/emails", {
    method: "POST", headers: { "X-ElasticEmail-ApiKey": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ Recipients: [{ Email: to }], Content: { Body: [{ ContentType: "HTML", Content: html, Charset: "utf-8" }], From: from, Subject: subject, ReplyTo: REPLY_TO, Headers: { "List-Unsubscribe": `<${unsubUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } } }),
  });
  const txt = await res.text();
  if (!res.ok) return { ok: false, error: `${res.status} ${txt.slice(0, 200)}` };
  let id: string | null = null;
  try { id = JSON.parse(txt)?.MessageID ?? null; } catch { /* ignore */ }
  return { ok: true, messageId: id };
}
async function sendEmail(env: Record<string, string>, from: string, to: string, subject: string, html: string, unsubUrl: string) {
  const provider = (env.EMAIL_PROVIDER || "elastic").toLowerCase();
  if (provider === "elastic") {
    const key = env.ELASTIC_EMAIL_API_KEY;
    if (!key) return { ok: false, error: "ELASTIC_EMAIL_API_KEY not set" };
    return await sendViaElastic(key, from, to, subject, html, unsubUrl);
  }
  return { ok: false, error: `Email provider '${provider}' not implemented yet (SES pending production access)` };
}

// Send a copy of the campaign to internal monitoring (seed) contacts.
async function sendToSeeds(admin: any, env: Record<string, string>, SUPA: string, from: string, subject: string, body: string) {
  const { data: seeds } = await admin.from("seed_contacts").select("email").eq("is_active", true);
  if (!seeds || !seeds.length) return 0;
  const unsub = `${SUPA}/functions/v1/campaign-unsubscribe?id=seed`;
  const html = renderHtml(body, SEED_SAMPLE, unsub);
  const subj = fill(subject, SEED_SAMPLE, unsub);
  let n = 0;
  for (const s of seeds) { const r = await sendEmail(env, from, s.email, subj, html, unsub); if (r.ok) n++; }
  return n;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const env = Deno.env.toObject();
  const SUPA = env.SUPABASE_URL;
  const admin = createClient(SUPA, env.SUPABASE_SERVICE_ROLE_KEY);

  try {
    const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
    const { data: { user }, error: authErr } = await admin.auth.getUser(token);
    if (authErr || !user) return json({ error: "Unauthorized" }, 401);

    const { campaign_id, limit = 500, test_email = null, test_emails = null } = await req.json();
    if (!campaign_id) return json({ error: "campaign_id required" }, 400);

    const { data: c, error: ce } = await admin.from("campaigns").select("*").eq("id", campaign_id).single();
    if (ce || !c) return json({ error: "Campaign not found" }, 404);

    let subject = c.email_subject as string | null;
    let body = c.email_body as string | null;
    if ((!subject || !body) && c.email_template_id) {
      const { data: tpl } = await admin.from("email_templates").select("subject,body_html").eq("id", c.email_template_id).single();
      subject = subject || tpl?.subject; body = body || tpl?.body_html;
    }
    if (!subject || !body) return json({ error: "Campaign has no subject/body — attach an email template." }, 400);
    const from = (c.email_from as string) || DEFAULT_FROM;

    const testRaw = test_emails ?? test_email;
    if (testRaw) {
      const { valid, invalid } = parseEmails(testRaw);
      if (valid.length === 0) return json({ error: "No valid test email addresses provided", invalid }, 400);
      const targets = valid.slice(0, MAX_TEST);
      const unsub = `${SUPA}/functions/v1/campaign-unsubscribe?id=test`;
      const html = renderHtml(body, SEED_SAMPLE, unsub);
      const subj = "[TEST] " + fill(subject, SEED_SAMPLE, unsub);
      let sent = 0; const failed: string[] = [];
      const CONC = 8;
      for (let i = 0; i < targets.length; i += CONC) {
        await Promise.all(targets.slice(i, i + CONC).map(async (to) => {
          const r = await sendEmail(env, from, to, subj, html, unsub);
          if (r.ok) sent++; else failed.push(`${to}: ${r.error}`);
        }));
      }
      const seeded = c.seed_enabled ? await sendToSeeds(admin, env, SUPA, from, subject, body) : 0;
      await admin.from("campaigns").update({ test_sent_at: new Date().toISOString(), test_sent_to: targets.join(", ") }).eq("id", campaign_id);
      return json({ success: true, test: true, sent, total: targets.length, skipped: valid.length - targets.length, invalid, failed, seeded });
    }

    const firstBatch = !c.started_at;
    const { count: existing } = await admin.from("campaign_schools").select("id", { count: "exact", head: true }).eq("campaign_id", campaign_id);
    if (!existing) {
      const { error: popErr } = await admin.rpc("populate_campaign_audience", { p_campaign_id: campaign_id });
      if (popErr) return json({ error: `populate_campaign_audience failed: ${popErr.message}` }, 500);
    }

    if (firstBatch) await admin.from("campaigns").update({ started_at: new Date().toISOString(), status: "sending" }).eq("id", campaign_id);
    else await admin.from("campaigns").update({ status: "sending" }).eq("id", campaign_id);

    let seeded = 0;
    if (firstBatch && c.seed_enabled) seeded = await sendToSeeds(admin, env, SUPA, from, subject, body);

    const { data: rows, error: re } = await admin
      .from("campaign_schools")
      .select("id, prospect_schools(id, email, school_name, district, state, board, ss_no)")
      .eq("campaign_id", campaign_id).eq("status", "pending").limit(limit);
    if (re) throw re;

    let sent = 0, failed = 0;
    const CONC = 8;
    for (let i = 0; i < (rows?.length ?? 0); i += CONC) {
      const chunk = (rows as any[]).slice(i, i + CONC);
      await Promise.all(chunk.map(async (row) => {
        const ps = row.prospect_schools;
        if (!ps?.email) {
          await admin.from("campaign_schools").update({ status: "failed", error_message: "no email" }).eq("id", row.id);
          failed++; return;
        }
        const unsub = `${SUPA}/functions/v1/campaign-unsubscribe?id=${ps.id}`;
        const html = renderHtml(body!, ps, unsub);
        const r = await sendEmail(env, from, ps.email, fill(subject!, ps, unsub), html, unsub);
        if (r.ok) {
          await admin.from("campaign_schools").update({ status: "sent", sent_at: new Date().toISOString(), message_id: r.messageId }).eq("id", row.id);
          sent++;
        } else {
          await admin.from("campaign_schools").update({ status: "failed", error_message: r.error?.slice(0, 300) }).eq("id", row.id);
          failed++;
        }
      }));
    }

    const { count: remaining } = await admin.from("campaign_schools").select("id", { count: "exact", head: true }).eq("campaign_id", campaign_id).eq("status", "pending");
    const { count: totalSent } = await admin.from("campaign_schools").select("id", { count: "exact", head: true }).eq("campaign_id", campaign_id).eq("status", "sent");
    const { count: totalFailed } = await admin.from("campaign_schools").select("id", { count: "exact", head: true }).eq("campaign_id", campaign_id).eq("status", "failed");
    const done = (remaining ?? 0) === 0;
    await admin.from("campaigns").update({
      sent_count: totalSent ?? 0, failed_count: totalFailed ?? 0,
      status: done ? "sent" : "sending", completed_at: done ? new Date().toISOString() : null,
    }).eq("id", campaign_id);

    return json({ success: true, sent, failed, remaining: remaining ?? 0, done, seeded });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
