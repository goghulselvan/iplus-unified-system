import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { readAiError } from "../analyze-paper/aiError.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.55.0";
import { OLYMPIAD_NAMES } from "../analyze-paper/prompt.ts";
import {
  ANTHROPIC_VERSION, batchPercent, BulkSkillRow, buildBatchRequest, buildSchoolRequest, classDisplayName,
  groupBulkRows, MAX_BATCH_REQUESTS, MODEL, parseResultLine, readLines, SchoolInputCombo,
  stripFeedbackName, unpackCustomId, validateFeedback,
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

const RUNNING_MSG = "Feedback is already being written for this school. Please wait for it to finish.";

async function submit(db: Db, projectId: string, schoolId: string | null, only: Set<string> | null) {
  const headers = apiHeaders();

  // ONE bulk call (paged because PostgREST caps rows per response): only students with no
  // fresh feedback, each row carrying the student's basis_hash.
  const rows: BulkSkillRow[] = [];
  for (let from = 0;; from += PAGE) {
    const { data, error } = await db
      .rpc("results_bulk_student_skills", { p_project_id: projectId, p_school_id: schoolId, p_only_needing_feedback: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Fail(502, "We could not work out the skills. Please try again.");
    rows.push(...(data ?? []));
    if ((data ?? []).length < PAGE) break;
  }
  const all = groupBulkRows(rows, only);
  if (all.length === 0) {
    return { batches: [], total: 0, message: "Everyone already has up-to-date feedback." };
  }
  // The database allows ONE running batch per project x school, so one call sends at most
  // 10,000 students; the rest are sent by clicking again once this batch is saved.
  const inputs = all.slice(0, MAX_BATCH_REQUESTS);
  const remaining = all.length - inputs.length;

  const admin = adminClient();
  // Reserve the slot first so a double click never pays for the same students twice.
  const { data: row, error: insErr } = await admin.from("result_ai_batches").insert({
    project_id: projectId, school_id: schoolId, kind: "student_feedback",
    status: "submitted", total: inputs.length, succeeded: 0, errored: 0,
  }).select("id").single();
  if (insErr) {
    if (insErr.code === "23505") throw new Fail(409, RUNNING_MSG);
    throw new Fail(502, "We could not start the AI job. Please try again.");
  }
  const markFailed = async (why: string) => {
    try {
      await admin.from("result_ai_batches").update({ status: "failed", error: why }).eq("id", row.id);
    } catch { /* best effort */ }
  };
  try {
    const res = await fetch(`${API}/messages/batches`, {
      method: "POST",
      headers,
      body: JSON.stringify({ requests: inputs.map(buildBatchRequest) }),
    });
    if (!res.ok) throw new Fail(502, await readAiError(res));
    const anthropicId = (await res.json()).id;
    const { error } = await admin.from("result_ai_batches").update({ anthropic_batch_id: anthropicId }).eq("id", row.id);
    if (error) throw new Error("save");
  } catch (e) {
    const why = e instanceof Fail ? e.message : "The AI could not be reached. Please try again in a minute.";
    await markFailed(why);
    throw e instanceof Fail ? e : new Fail(502, why);
  }
  return { batches: [row.id], batchId: row.id, total: inputs.length, ...(remaining > 0 ? { remaining } : {}),
    ...(remaining > 0 ? { warning: `${remaining} more students are waiting. Click again once this job has finished.` } : {}) };
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
  const failed = new Set<string>();
  let saved = 0;
  let pending: { enrollmentId: string; basisHash: string; text: string; model: string | null }[] = [];

  const flush = async () => {
    if (pending.length === 0) return;
    const batch = pending;
    pending = [];
    const names = await namesFor(db, batch.map((p) => p.enrollmentId));
    const rows = [];
    for (const p of batch) {
      let fb = null;
      try {
        fb = validateFeedback(JSON.parse(p.text));
      } catch { /* unusable */ }
      if (!fb) {
        failed.add(p.enrollmentId);
        continue;
      }
      rows.push({
        enrollment_id: p.enrollmentId,
        feedback: stripFeedbackName(fb, names.get(p.enrollmentId) ?? ""),
        basis_hash: p.basisHash,
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
    if (!r || r.kind === "invalid") continue;
    const id = unpackCustomId(r.customId);
    if (!id) continue;
    if (r.kind === "succeeded") {
      pending.push({ ...id, text: r.text, model: r.model });
      if (pending.length >= 200) await flush();
    } else {
      failed.add(id.enrollmentId);
    }
  }
  await flush();

  const { error } = await admin.from("result_ai_batches").update({
    status: "collected", collected_at: new Date().toISOString(), succeeded: saved, errored: failed.size,
    errored_enrollment_ids: [...failed],
  }).eq("id", row.id);
  if (error) throw new Fail(502, "The feedback was saved but the job could not be marked done. Please collect again (it is safe).");
  return { saved, failedEnrollmentIds: [...failed] };
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
    if (!r.ok) throw new Fail(502, await readAiError(r));
    msg = await r.json();
  } catch (e) {
    if (e instanceof Fail) throw e;
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

    let body: { action?: unknown; projectId?: unknown; schoolId?: unknown; batchId?: unknown; enrollmentIds?: unknown };
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
        let only: Set<string> | null = null;
        if (body.enrollmentIds != null) {
          if (!Array.isArray(body.enrollmentIds) || !body.enrollmentIds.every(uuid)) {
            return json({ error: "The list of students was not valid." }, 422);
          }
          only = new Set((body.enrollmentIds as string[]).map((x) => x.toLowerCase()));
        }
        return json(await submit(db, body.projectId as string, (body.schoolId as string | null | undefined) ?? null, only));
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
