import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CRON_SECRET = "KDAZbn8_XVLSxw4h9UAT-0sTIae46BWZdmtHUqM6mKpBH1Du";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-key",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

const DEFAULT_FROM = "iPlus Olympiads <olympiads@news.iplusedu.in>";
const REPLY_TO = "contact@iplusedu.in";
const PROJECT = { name: "iPlus Olympiads", year: "2026" };
const SEED_SAMPLE = { id: "seed", school_name: "Sample School", principal_name: "the Principal", district: "Your District", state: "Your State", board: "State Board", ss_no: 0 };
const DEFAULT_RAMP: { days?: number; cap: number }[] = [
  { days: 2, cap: 200 }, { days: 4, cap: 1000 }, { days: 7, cap: 3000 }, { cap: 9000 },
];
const HARD_MAX_DAILY = 20000;
const WINDOW = { days: [1, 2, 3, 4, 5], startHour: 9, endHour: 18 };

function rampCap(ramp: { days?: number; cap: number }[], day: number): number {
  let d = day;
  for (const p of ramp) { if (p.days == null) return p.cap; if (d <= p.days) return p.cap; d -= p.days; }
  return ramp[ramp.length - 1].cap;
}
function istParts() {
  const ist = new Date(Date.now() + 5.5 * 3600 * 1000);
  return { y: ist.getUTCFullYear(), m: ist.getUTCMonth(), d: ist.getUTCDate(), dow: ist.getUTCDay(), hour: ist.getUTCHours(), dateStr: ist.toISOString().slice(0, 10) };
}
function istDayBoundsUtc(y: number, m: number, d: number) {
  const lower = new Date(Date.UTC(y, m, d) - 5.5 * 3600 * 1000);
  const upper = new Date(lower.getTime() + 24 * 3600 * 1000);
  return { lower: lower.toISOString(), upper: upper.toISOString() };
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
  return { ok: false, error: `provider '${provider}' not implemented` };
}
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

async function processCampaign(admin: any, env: Record<string, string>, SUPA: string, c: any, ist: any, force: boolean) {
  const firstRun = c.status === "scheduled";
  const { count: existing } = await admin.from("campaign_schools").select("id", { count: "exact", head: true }).eq("campaign_id", c.id);
  if (!existing) {
    const { error: popErr } = await admin.rpc("populate_campaign_audience", { p_campaign_id: c.id });
    if (popErr) return { id: c.id, name: c.name, error: `populate_campaign_audience failed: ${popErr.message}` };
  }
  if (firstRun) await admin.from("campaigns").update({ status: "sending", started_at: c.started_at || new Date().toISOString() }).eq("id", c.id);

  let subject = c.email_subject as string | null;
  let body = c.email_body as string | null;
  if ((!subject || !body) && c.email_template_id) {
    const { data: tpl } = await admin.from("email_templates").select("subject,body_html").eq("id", c.email_template_id).single();
    subject = subject || tpl?.subject; body = body || tpl?.body_html;
  }
  if (!subject || !body) return { id: c.id, error: "no subject/body" };
  const from = (c.email_from as string) || DEFAULT_FROM;

  let seeded = 0;
  if (firstRun && c.seed_enabled) seeded = await sendToSeeds(admin, env, SUPA, from, subject, body);

  const { count: total } = await admin.from("campaign_schools").select("id", { count: "exact", head: true }).eq("campaign_id", c.id);
  const startMs = Date.parse(c.send_start_date + "T00:00:00Z");
  const todayMs = Date.parse(ist.dateStr + "T00:00:00Z");
  const day = Math.floor((todayMs - startMs) / 86400000) + 1;

  const plan = (c.send_plan && typeof c.send_plan === "object") ? c.send_plan : { type: "warmup", ramp: DEFAULT_RAMP };
  let cap: number;
  if (plan.type === "even") cap = Math.ceil((total || 0) / Math.max(1, Number(plan.days) || 1));
  else cap = rampCap(Array.isArray(plan.ramp) && plan.ramp.length ? plan.ramp : DEFAULT_RAMP, day);
  cap = Math.min(cap, HARD_MAX_DAILY);

  const b = istDayBoundsUtc(ist.y, ist.m, ist.d);
  const { count: sentToday } = await admin.from("campaign_schools").select("id", { count: "exact", head: true }).eq("campaign_id", c.id).eq("status", "sent").gte("sent_at", b.lower).lt("sent_at", b.upper);
  const remainingToday = Math.max(0, cap - (sentToday || 0));
  if (remainingToday <= 0) return { id: c.id, name: c.name, planType: plan.type, day, cap, sentToday: sentToday || 0, sent: 0, seeded, note: "daily cap reached" };

  const hoursLeft = force ? 1 : Math.max(1, WINDOW.endHour - ist.hour);
  const slice = Math.min(remainingToday, Math.ceil(remainingToday / hoursLeft));

  const { data: rows } = await admin.from("campaign_schools").select("id, prospect_schools(id, email, school_name, district, state, board, ss_no)").eq("campaign_id", c.id).eq("status", "pending").limit(slice);
  let sent = 0, failed = 0;
  const CONC = 8;
  for (let i = 0; i < (rows?.length ?? 0); i += CONC) {
    await Promise.all((rows as any[]).slice(i, i + CONC).map(async (row) => {
      const ps = row.prospect_schools;
      if (!ps?.email) { await admin.from("campaign_schools").update({ status: "failed", error_message: "no email" }).eq("id", row.id); failed++; return; }
      const unsub = `${SUPA}/functions/v1/campaign-unsubscribe?id=${ps.id}`;
      const html = renderHtml(body!, ps, unsub);
      const rr = await sendEmail(env, from, ps.email, fill(subject!, ps, unsub), html, unsub);
      if (rr.ok) { await admin.from("campaign_schools").update({ status: "sent", sent_at: new Date().toISOString(), message_id: rr.messageId }).eq("id", row.id); sent++; }
      else { await admin.from("campaign_schools").update({ status: "failed", error_message: rr.error?.slice(0, 300) }).eq("id", row.id); failed++; }
    }));
  }

  const { count: remaining } = await admin.from("campaign_schools").select("id", { count: "exact", head: true }).eq("campaign_id", c.id).eq("status", "pending");
  const { count: totalSent } = await admin.from("campaign_schools").select("id", { count: "exact", head: true }).eq("campaign_id", c.id).eq("status", "sent");
  const { count: totalFailed } = await admin.from("campaign_schools").select("id", { count: "exact", head: true }).eq("campaign_id", c.id).eq("status", "failed");
  const done = (remaining ?? 0) === 0;
  await admin.from("campaigns").update({ sent_count: totalSent ?? 0, failed_count: totalFailed ?? 0, status: done ? "sent" : "sending", completed_at: done ? new Date().toISOString() : null }).eq("id", c.id);
  return { id: c.id, name: c.name, planType: plan.type, day, cap, sentToday: sentToday || 0, slice, sent, failed, remaining: remaining ?? 0, done, seeded };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  let body: any = {};
  try { body = await req.json(); } catch { /* ignore */ }
  const key = req.headers.get("x-cron-key") || body.cron_key || "";
  if (key !== CRON_SECRET) return json({ error: "Unauthorized" }, 401);

  const force = !!body.force;
  const onlyCampaign = body.campaign_id || null;
  const env = Deno.env.toObject();
  const SUPA = env.SUPABASE_URL;
  const admin = createClient(SUPA, env.SUPABASE_SERVICE_ROLE_KEY);

  const ist = istParts();
  const inWindow = WINDOW.days.includes(ist.dow) && ist.hour >= WINDOW.startHour && ist.hour < WINDOW.endHour;
  if (!inWindow && !force) return json({ skipped: "outside send window (Mon-Fri 09-18 IST)", ist });

  try {
    let q = admin.from("campaigns").select("*").eq("channel", "email").eq("send_mode", "auto").in("status", ["scheduled", "sending"]).lte("send_start_date", ist.dateStr);
    if (onlyCampaign) q = q.eq("id", onlyCampaign);
    const { data: camps, error } = await q;
    if (error) return json({ error: error.message }, 500);
    const results = [];
    for (const c of (camps || [])) results.push(await processCampaign(admin, env, SUPA, c, ist, force));
    return json({ ok: true, ist, window: inWindow, processed: results.length, results });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
