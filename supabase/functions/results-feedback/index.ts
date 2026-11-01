import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.55.0";
import { OLYMPIAD_NAMES } from "../analyze-paper/prompt.ts";
import {
  ANTHROPIC_VERSION, batchPercent, buildBatchRequest, buildSchoolRequest, chunk, classDisplayName,
  FeedbackInput, MAX_BATCH_REQUESTS, MODEL, parseResultLine, readLines, SchoolInputCombo,
  stripFeedbackName, validateFeedback,
} from "./prompt.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

class Fail extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const API = "https://api.anthropic.com/v1";
const PAGE = 1000;
const SKILL_RPC_CONCURRENCY = 25;

// deno-lint-ignore no-explicit-any
type Db = any;

const apiHeaders = () => {
  const key = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
  if (!key) throw new Fail(502, "The AI is not set up yet. Please contact the administrator.");
  return { "x-api-key": key, "anthropic-version": ANTHROPIC_VERSION, "content-type": "application/json" };
};

// result_* tables have no client write policies (every write is server-side), so writes
// use a service-role client, created lazily and only after the manager check has passed.
const adminClient = (): Db => {
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!key) throw new Fail(502, "The server is not set up to save results yet. Please contact the administrator.");
  return createClient(Deno.env.get("SUPABASE_URL")!, key, { auth: { persistSession: false } });
};

async function mapPool<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  }));
  return out;
}

async function pagedScores(db: Db, projectId: string, schoolId: string | null, cols: string) {
  // deno-lint-ignore no-explicit-any
  const rows: any[] = [];
  for (let from = 0;; from += PAGE) {
    let q = db.from("result_scores").select(cols).eq("project_id", projectId);
    if (schoolId) q = q.eq("school_id", schoolId);
    const { data, error } = await q.order("enrollment_id").range(from, from + PAGE - 1);
    if (error) throw new Fail(502, "We could not load the results. Please try again.");
    rows.push(...(data ?? []));
    if ((data ?? []).length < PAGE) break;
  }
  return rows;
}

// ---- submit ---------------------------------------------------------------

async function submit(db: Db, projectId: string, schoolId: string | null) {
  const headers = apiHeaders();
  const scores = await pagedScores(db, projectId, schoolId, "enrollment_id, class_code, olympiad_code, grade, school_id");

  // Skip students whose feedback is already fresh.
  const fresh = new Set<string>();
  for (const ids of chunk(scores.map((s) => s.enrollment_id as string), 200)) {
    const { data, error } = await db.from("result_feedback").select("enrollment_id, outdated").in("enrollment_id", ids);
    if (error) throw new Fail(502, "We could not check existing feedback. Please try again.");
    for (const r of data ?? []) if (r.outdated !== true) fresh.add(r.enrollment_id);
  }
  const todo = scores.filter((s) => !fresh.has(s.enrollment_id));
  if (todo.length === 0) return { batches: [], total: 0, skipped: scores.length, message: "Everyone already has up-to-date feedback." };

  // Per-student skills (correct/total only).
  let noSkills = 0;
  const inputs = (await mapPool(todo, SKILL_RPC_CONCURRENCY, async (s): Promise<FeedbackInput | null> => {
    const { data, error } = await db.rpc("results_student_skills", { p_enrollment_id: s.enrollment_id });
    if (error) throw new Fail(502, "We could not work out the skills. Please try again.");
    // deno-lint-ignore no-explicit-any
    const skills = (data ?? []).filter((r: any) => Number(r.total) > 0)
      // deno-lint-ignore no-explicit-any
      .map((r: any) => ({ skill: String(r.skill), correct: Number(r.correct), total: Number(r.total) }));
    if (skills.length === 0) {
      noSkills++;
      return null;
    }
    return { enrollmentId: s.enrollment_id, classCode: s.class_code, olympiadCode: s.olympiad_code, grade: s.grade, skills };
  })).filter((x): x is FeedbackInput => x !== null);
  if (inputs.length === 0) throw new Fail(422, "None of these students have skill results to write about yet.");

  const admin = adminClient();
  const batches: { id: string; total: number }[] = [];
  let failedAt: number | null = null;
  for (const part of chunk(inputs, MAX_BATCH_REQUESTS)) {
    let anthropicId: string;
    try {
      const res = await fetch(`${API}/messages/batches`, {
        method: "POST",
        headers,
        body: JSON.stringify({ requests: part.map(buildBatchRequest) }),
      });
      if (!res.ok) throw new Error(`AI ${res.status}`);
      anthropicId = (await res.json()).id;
    } catch {
      failedAt = batches.reduce((n, b) => n + b.total, 0);
      break;
    }
    const { data, error } = await admin.from("result_ai_batches").insert({
      project_id: projectId, school_id: schoolId, kind: "student_feedback",
      anthropic_batch_id: anthropicId, status: "submitted", total: part.length, succeeded: 0, errored: 0,
    }).select("id").single();
    if (error) throw new Fail(502, "The AI job was started but we could not record it. Please contact the administrator.");
    batches.push({ id: data.id, total: part.length });
  }
  if (batches.length === 0) throw new Fail(502, "The AI could not be reached. Please try again in a minute.");
  return {
    batches: batches.map((b) => b.id),
    batchId: batches[0].id,
    total: batches.reduce((n, b) => n + b.total, 0),
    skipped: scores.length - todo.length,
    withoutSkills: noSkills,
    ...(failedAt !== null ? { warning: `Only the first ${failedAt} students were sent. Please click again to send the rest.` } : {}),
  };
}

// ---- status / collect -----------------------------------------------------

async function loadBatchRow(db: Db, batchId: unknown) {
  if (typeof batchId !== "string" || !batchId) throw new Fail(422, "Please choose an AI job.");
  const { data, error } = await db.from("result_ai_batches").select("*").eq("id", batchId).maybeSingle();
  if (error) throw new Fail(502, "We could not open this AI job. Please try again.");
  if (!data) throw new Fail(422, "This AI job could not be found.");
  return data;
}

async function fetchBatch(anthropicId: string) {
  try {
    const res = await fetch(`${API}/messages/batches/${encodeURIComponent(anthropicId)}`, { headers: apiHeaders() });
    if (!res.ok) throw new Error(`AI ${res.status}`);
    return await res.json();
  } catch (e) {
    if (e instanceof Fail) throw e;
    throw new Fail(502, "We could not check on the AI job. Please try again in a minute.");
  }
}

function counts(b: Db, total: number) {
  const rc = b?.request_counts ?? {};
  const processing = Number(rc.processing ?? 0);
  const succeeded = Number(rc.succeeded ?? 0);
  const errored = Number(rc.errored ?? 0) + Number(rc.canceled ?? 0) + Number(rc.expired ?? 0);
  return { processing, succeeded, errored, percent: batchPercent(total, processing) };
}

async function status(db: Db, batchId: unknown) {
  const row = await loadBatchRow(db, batchId);
  const b = await fetchBatch(row.anthropic_batch_id);
  const c = counts(b, row.total);
  const ended = b.processing_status === "ended";
  const next = row.status === "collected" ? "collected" : ended ? "ended" : "submitted";
  const { error } = await adminClient().from("result_ai_batches")
    .update({ status: next, succeeded: c.succeeded, errored: c.errored }).eq("id", row.id);
  if (error) throw new Fail(502, "We could not save the progress. Please try again.");
  return { status: next, total: row.total, succeeded: c.succeeded, errored: c.errored, percent: next === "submitted" ? c.percent : 100 };
}

async function namesFor(db: Db, enrollmentIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const { data: enr, error } = await db.from("portal_student_enrollments").select("id, student_id").in("id", enrollmentIds);
  if (error) throw new Fail(502, "We could not check the students. Please try again.");
  // deno-lint-ignore no-explicit-any
  const studentIds = [...new Set((enr ?? []).map((e: any) => e.student_id))];
  const { data: sts, error: e2 } = await db.from("portal_registered_students").select("id, student_name").in("id", studentIds);
  if (e2) throw new Fail(502, "We could not check the students. Please try again.");
  // deno-lint-ignore no-explicit-any
  const byStudent = new Map<string, string>((sts ?? []).map((s: any) => [s.id, s.student_name ?? ""]));
  for (const e of enr ?? []) out.set(e.id, byStudent.get(e.student_id) ?? "");
  return out;
}

async function collect(db: Db, batchId: unknown) {
  const row = await loadBatchRow(db, batchId);
  const b = await fetchBatch(row.anthropic_batch_id);
  if (b.processing_status !== "ended") throw new Fail(409, "Claude is still writing. Please wait until it is finished.");
  if (typeof b.results_url !== "string" || !b.results_url) throw new Fail(502, "The AI results are not available yet. Please try again in a minute.");
  const res = await fetch(b.results_url, { headers: apiHeaders() });
  if (!res.ok || !res.body) throw new Fail(502, "We could not download the AI results. Please try again in a minute.");

  const admin = adminClient();
  const failed: string[] = [];
  let saved = 0;
  // deno-lint-ignore no-explicit-any
  let pending: { customId: string; text: string; model: string | null }[] = [];

  const flush = async () => {
    if (pending.length === 0) return;
    const batch = pending;
    pending = [];
    const names = await namesFor(db, batch.map((p) => p.customId));
    const rows = [];
    for (const p of batch) {
      let fb = null;
      try {
        fb = validateFeedback(JSON.parse(p.text));
      } catch { /* unusable */ }
      if (!fb) {
        failed.push(p.customId);
        continue;
      }
      rows.push({
        enrollment_id: p.customId,
        feedback: stripFeedbackName(fb, names.get(p.customId) ?? ""),
        model: p.model ?? MODEL,
        batch_id: row.id,
        outdated: false,
        created_at: new Date().toISOString(),
      });
    }
    if (rows.length > 0) {
      const { error } = await admin.from("result_feedback").upsert(rows, { onConflict: "enrollment_id" });
      if (error) throw new Fail(502, "We could not save the feedback. Please try collecting again.");
      saved += rows.length;
    }
  };

  for await (const line of readLines(res.body)) {
    const r = parseResultLine(line);
    if (!r) continue;
    if (r.kind === "succeeded") {
      pending.push(r);
      if (pending.length >= 200) await flush();
    } else if (r.kind === "failed") {
      failed.push(r.customId);
    }
  }
  await flush();

  const { error } = await admin.from("result_ai_batches").update({
    status: "collected", collected_at: new Date().toISOString(), succeeded: saved, errored: failed.length,
  }).eq("id", row.id);
  if (error) throw new Fail(502, "The feedback was saved but the job could not be marked done. Please collect again (it is safe).");
  return { saved, failedEnrollmentIds: failed };
}

// ---- school analysis ------------------------------------------------------

async function school(db: Db, projectId: string, schoolId: string) {
  const headers = apiHeaders();
  const mine = await pagedScores(db, projectId, schoolId, "enrollment_id, class_code, olympiad_code, percentage, state_code");
  if (mine.length === 0) throw new Fail(422, "This school has no results to analyse yet.");
  const stateCode = mine.find((m) => m.state_code)?.state_code ?? null;

  const groups = new Map<string, { class_code: string; olympiad_code: string; pcts: number[] }>();
  for (const m of mine) {
    const k = `${m.class_code}|${m.olympiad_code}`;
    if (!groups.has(k)) groups.set(k, { class_code: m.class_code, olympiad_code: m.olympiad_code, pcts: [] });
    groups.get(k)!.pcts.push(Number(m.percentage));
  }
  const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;

  const combos: SchoolInputCombo[] = [];
  for (const g of [...groups.values()].sort((a, b) => (a.class_code + a.olympiad_code).localeCompare(b.class_code + b.olympiad_code))) {
    let stateAvg: number | null = null;
    if (stateCode) {
      const pcts: number[] = [];
      for (let from = 0;; from += PAGE) {
        const { data, error } = await db.from("result_scores").select("percentage, enrollment_id")
          .eq("project_id", projectId).eq("state_code", stateCode)
          .eq("class_code", g.class_code).eq("olympiad_code", g.olympiad_code)
          .order("enrollment_id").range(from, from + PAGE - 1);
        if (error) throw new Fail(502, "We could not load the state results. Please try again.");
        pcts.push(...(data ?? []).map((r: { percentage: number }) => Number(r.percentage)));
        if ((data ?? []).length < PAGE) break;
      }
      if (pcts.length > 0) stateAvg = Math.round(avg(pcts));
    }
    const { data: sk, error } = await db.rpc("results_skill_summary", {
      p_project_id: projectId, p_school_id: schoolId, p_class_code: g.class_code, p_olympiad_code: g.olympiad_code,
    });
    if (error) throw new Fail(502, "We could not load the skill summary. Please try again.");
    combos.push({
      className: classDisplayName(g.class_code),
      olympiad: OLYMPIAD_NAMES[g.olympiad_code] ?? g.olympiad_code,
      students: g.pcts.length,
      schoolAvg: Math.round(avg(g.pcts)),
      stateAvg,
      // deno-lint-ignore no-explicit-any
      skills: (sk ?? []).map((s: any) => ({ skill: String(s.skill), school_pct: Number(s.school_pct), state_pct: Number(s.state_pct) })),
    });
  }

  let msg: Db;
  try {
    const r = await fetch(`${API}/messages`, { method: "POST", headers, body: JSON.stringify(buildSchoolRequest(combos)) });
    if (!r.ok) throw new Error(`AI ${r.status}`);
    msg = await r.json();
  } catch {
    throw new Fail(502, "The AI could not be reached. Please try again in a minute.");
  }
  console.log(JSON.stringify({ schoolId, model: msg?.model, usage: msg?.usage }));
  if (msg?.stop_reason === "refusal") throw new Fail(502, "The AI declined to write this analysis.");
  if (msg?.stop_reason === "max_tokens") throw new Fail(502, "The AI's answer was cut off. Please try again.");
  // deno-lint-ignore no-explicit-any
  const block = (msg?.content ?? []).find((x: any) => x?.type === "text");
  let analysis: Db;
  try {
    analysis = JSON.parse(block?.text ?? "");
  } catch {
    throw new Fail(502, "The AI's answer could not be understood. Please try again.");
  }
  if (typeof analysis?.overview !== "string" || !Array.isArray(analysis?.strengths) ||
    !Array.isArray(analysis?.focus_areas) || !Array.isArray(analysis?.suggestions)) {
    throw new Fail(502, "The AI's answer could not be understood. Please try again.");
  }
  const { error } = await adminClient().from("result_school_analysis").upsert({
    school_id: schoolId, project_id: projectId, analysis, model: msg?.model ?? MODEL, outdated: false,
    created_at: new Date().toISOString(),
  }, { onConflict: "school_id,project_id" });
  if (error) throw new Fail(502, "We could not save the analysis. Please try again.");
  return { analysis };
}

// ---- entry ----------------------------------------------------------------

serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    if (req.method !== "POST") return json({ error: "Please send a POST request." }, 405);
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Please sign in to write feedback." }, 401);

    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: allowed, error: roleError } = await db.rpc("is_manager_or_superadmin");
    if (roleError) return json({ error: "We could not check your permissions. Please sign in again." }, 401);
    if (allowed !== true) return json({ error: "You don't have permission to write feedback." }, 403);

    let body: { action?: unknown; projectId?: unknown; schoolId?: unknown; batchId?: unknown };
    try {
      body = await req.json();
    } catch {
      return json({ error: "The request was not valid. Please try again." }, 400);
    }
    const uuid = (v: unknown) => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

    switch (body.action) {
      case "submit": {
        if (!uuid(body.projectId)) return json({ error: "Please choose a project." }, 422);
        if (body.schoolId != null && !uuid(body.schoolId)) return json({ error: "Please choose a valid school." }, 422);
        return json(await submit(db, body.projectId as string, (body.schoolId as string | null | undefined) ?? null));
      }
      case "status":
        return json(await status(db, body.batchId));
      case "collect":
        return json(await collect(db, body.batchId));
      case "school": {
        if (!uuid(body.projectId) || !uuid(body.schoolId)) return json({ error: "Please choose a project and a school." }, 422);
        return json(await school(db, body.projectId as string, body.schoolId as string));
      }
      default:
        return json({ error: "That action is not recognised." }, 422);
    }
  } catch (e) {
    if (e instanceof Fail) return json({ error: e.message }, e.status);
    return json({ error: "Something went wrong while writing feedback. Please try again." }, 500);
  }
});
