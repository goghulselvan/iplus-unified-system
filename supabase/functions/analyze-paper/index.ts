import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { readAiError } from "./aiError.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.55.0";
import { encodeBase64 } from "jsr:@std/encoding@1/base64";
import { isAllowedKey, parseAnswerKeyKey } from "../results-files/keys.ts";
import { presign, R2Config } from "../results-files/sign.ts";
import { checkStatus, firstPassWrite } from "./keyCheck.ts";
import { validateChunk, validateKey, validateRecheck } from "./parse.ts";
import {
  buildReadKeyBody, buildRecheckBody, buildRequestBody, classDisplayName, classGroupOf, nextAnalysisState,
} from "./prompt.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const MAX_PDF_BYTES = 20 * 1024 * 1024;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // Claude API limit per image
const MAX_CHUNK = 20;
const MAX_RECHECK = 20;

class Fail extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function r2Config(): R2Config {
  const cfg: R2Config = {
    accountId: Deno.env.get("R2_ACCOUNT_ID") ?? "",
    accessKeyId: Deno.env.get("R2_ACCESS_KEY_ID") ?? "",
    secretAccessKey: Deno.env.get("R2_SECRET_ACCESS_KEY") ?? "",
    bucket: Deno.env.get("R2_BUCKET") ?? "",
  };
  if (!cfg.accountId || !cfg.accessKeyId || !cfg.secretAccessKey || !cfg.bucket) {
    throw new Fail(502, "File storage is not set up yet. Please contact the administrator.");
  }
  return cfg;
}

function anthropicKey(): string {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
  if (!apiKey) throw new Fail(502, "The AI reader is not set up yet. Please contact the administrator.");
  return apiKey;
}

/** Download one R2 object as base64, refusing anything over maxBytes. */
async function fetchBase64(cfg: R2Config, key: string, maxBytes: number, tooLargeMessage: string): Promise<string> {
  try {
    const url = await presign(cfg, "GET", key);
    const res = await fetch(url);
    if (res.status === 404) throw new Fail(422, "The file could not be found in storage. Please upload it again.");
    if (!res.ok) throw new Error(`R2 ${res.status}`);
    const len = Number(res.headers.get("content-length"));
    if (Number.isFinite(len) && len > maxBytes) throw new Fail(422, tooLargeMessage);
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.byteLength > maxBytes) throw new Fail(422, tooLargeMessage);
    return encodeBase64(bytes); // bytes goes out of scope here
  } catch (e) {
    if (e instanceof Fail) throw e;
    throw new Fail(502, "We could not fetch the file from storage. Please try again.");
  }
}

const PDF_TOO_LARGE =
  "This PDF is too large for the AI to read (over 20 MB). Please save a smaller PDF and upload it again.";

/** Call the Claude API and return the parsed structured output. All errors are plain English. */
async function callClaude(apiKey: string, body: Record<string, unknown>, log: Record<string, unknown>): Promise<unknown> {
  let aiJson: unknown;
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2026-10-21",
        "anthropic-beta": "server-side-fallback-2026-07-01",
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Fail(502, await readAiError(res));
    aiJson = await res.json();
  } catch (e) {
    if (e instanceof Fail) throw e;
    throw new Fail(502, "The AI could not be reached. Please try again in a minute.");
  }
  // deno-lint-ignore no-explicit-any
  const msg = aiJson as any;
  // Token usage per call, so cache hits and cost show in the function logs.
  console.log(JSON.stringify({ ...log, model: msg?.model, usage: msg?.usage }));
  if (msg?.stop_reason === "refusal") {
    throw new Fail(502, "The AI declined to read this part of the paper — please enter these questions by hand");
  }
  if (msg?.stop_reason === "max_tokens") {
    throw new Fail(502, "The AI's answer was cut off — please re-run this part");
  }
  // deno-lint-ignore no-explicit-any
  const textBlock = (msg?.content ?? []).find((b: any) => b?.type === "text");
  try {
    return JSON.parse(textBlock?.text ?? "");
  } catch {
    throw new Fail(502, "The AI's answer could not be understood — please re-run this part");
  }
}

interface PaperRow {
  id: string;
  project_id: string;
  class_code: string;
  olympiad_code: string;
  total_questions: number;
  pdf_r2_key: string | null;
  deleted_at: string | null;
}

// deno-lint-ignore no-explicit-any
async function loadPaper(supabase: any, paperId: string): Promise<PaperRow> {
  const { data: paper, error } = await supabase
    .from("question_papers")
    .select("id, project_id, class_code, olympiad_code, total_questions, pdf_r2_key, deleted_at")
    .eq("id", paperId)
    .maybeSingle();
  if (error) throw new Fail(502, "We could not open this paper. Please try again.");
  if (!paper || paper.deleted_at) throw new Fail(422, "This paper could not be found.");
  return paper as PaperRow;
}

const failResponse = (e: unknown, fallback: string) =>
  e instanceof Fail ? json({ error: e.message }, e.status) : json({ error: fallback }, 502);

// ---------------------------------------------------------------------------
// recheck: re-solve questions whose first answer disagreed with the key. The key is
// never sent to the AI. Stores recheck_* and check_status; never touches correct_answer.
// ---------------------------------------------------------------------------
// deno-lint-ignore no-explicit-any
async function handleRecheck(supabase: any, paperId: string, rawNumbers: unknown): Promise<Response> {
  try {
    if (!Array.isArray(rawNumbers) || rawNumbers.length === 0 || !rawNumbers.every((n) => Number.isInteger(n))) {
      throw new Fail(422, "Please choose the questions to recheck.");
    }
    const nums = [...new Set(rawNumbers as number[])].sort((a, b) => a - b);
    if (nums.length > MAX_RECHECK) throw new Fail(422, `Please recheck at most ${MAX_RECHECK} questions at a time.`);
    const paper = await loadPaper(supabase, paperId);
    if (nums[0] < 1 || nums[nums.length - 1] > paper.total_questions) {
      throw new Fail(422, `The questions must be within 1–${paper.total_questions}.`);
    }
    if (!paper.pdf_r2_key) throw new Fail(422, "This paper has no PDF yet. Please upload the PDF first.");
    if (!isAllowedKey(paper.pdf_r2_key)) throw new Fail(422, "This paper's PDF location is not valid. Please upload the PDF again.");

    const { data: existing, error: exErr } = await supabase
      .from("questions")
      .select("question_number, key_answer, ai_answer, check_status")
      .eq("paper_id", paperId).in("question_number", nums);
    if (exErr) throw new Fail(502, "We could not check the saved questions. Please try again.");
    const byNum = new Map<number, { key_answer: string | null; ai_answer: string | null; check_status: string }>(
      // deno-lint-ignore no-explicit-any
      (existing ?? []).map((r: any) => [r.question_number, r]),
    );
    const notSaved = nums.filter((n) => !byNum.has(n));
    if (notSaved.length) {
      throw new Fail(422, `Question${notSaved.length > 1 ? "s" : ""} ${notSaved.join(", ")} ${notSaved.length > 1 ? "are" : "is"} not saved yet. Please read the paper first.`);
    }

    const cfg = r2Config();
    const apiKey = anthropicKey();
    const pdfBase64 = await fetchBase64(cfg, paper.pdf_r2_key, MAX_PDF_BYTES, PDF_TOO_LARGE);
    const parsed = await callClaude(apiKey, buildRecheckBody({
      pdfBase64,
      className: classDisplayName(paper.class_code),
      olympiadCode: paper.olympiad_code,
      questionNumbers: nums,
    }), { paperId, action: "recheck", questions: nums });
    const v = validateRecheck(parsed, nums);
    if (!v.ok) throw new Fail(422, v.message);

    const rechecked_at = new Date().toISOString();
    const rows = v.rows.map((r) => {
      const q = byNum.get(r.question_number)!;
      const status = checkStatus({
        key_answer: q.key_answer,
        ai_answer: q.ai_answer,
        recheck_answer: r.answer,
        recheck_confidence: r.confidence,
        rechecked_at,
        check_status: q.check_status,
      });
      return { ...r, key_answer: q.key_answer, check_status: status };
    });
    const payload = rows.map((r) => ({
      paper_id: paperId,
      question_number: r.question_number,
      recheck_answer: r.answer,
      recheck_confidence: r.confidence,
      recheck_reason: r.reason,
      rechecked_at,
      check_status: r.check_status,
    }));
    const { error } = await supabase.from("questions").upsert(payload, { onConflict: "paper_id,question_number" });
    if (error) throw new Fail(502, "We could not save the recheck. Please try again.");
    return json({
      results: rows.map((r) => ({
        question_number: r.question_number,
        answer: r.answer,
        confidence: r.confidence,
        reason: r.reason,
        key_answer: r.key_answer,
        check_status: r.check_status,
      })),
      rechecked_at,
    });
  } catch (e) {
    return failResponse(e, "Something went wrong while rechecking. Please try again.");
  }
}

// ---------------------------------------------------------------------------
// read_key: read an uploaded official answer key (PDF or photo). Returns the answers
// for staff to confirm; saves nothing.
// ---------------------------------------------------------------------------
// deno-lint-ignore no-explicit-any
async function handleReadKey(supabase: any, paperId: string, fileKey: unknown): Promise<Response> {
  try {
    if (typeof fileKey !== "string" || !fileKey) throw new Fail(422, "Please upload the answer key file first.");
    const paper = await loadPaper(supabase, paperId);
    const k = parseAnswerKeyKey(fileKey);
    if (!k || k.projectId !== paper.project_id || k.paperId !== paper.id) {
      throw new Fail(422, "That answer key file does not belong to this paper. Please upload it again.");
    }
    const isPdf = k.mediaType === "application/pdf";
    const fileBase64 = await fetchBase64(
      r2Config(),
      fileKey,
      isPdf ? MAX_PDF_BYTES : MAX_IMAGE_BYTES,
      isPdf
        ? PDF_TOO_LARGE
        : "This photo is too large for the AI to read (over 5 MB). Please take a smaller photo or save it as a smaller JPG.",
    );
    const parsed = await callClaude(
      anthropicKey(),
      buildReadKeyBody({ fileBase64, mediaType: k.mediaType, totalQuestions: paper.total_questions }),
      { paperId, action: "read_key" },
    );
    const v = validateKey(parsed, paper.total_questions);
    if (!v.ok) throw new Fail(422, v.message);
    return json({ answers: v.answers, missing: v.missing, conflicts: v.conflicts, total: paper.total_questions });
  } catch (e) {
    return failResponse(e, "Something went wrong while reading the answer key. Please try again.");
  }
}

serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // deno-lint-ignore no-explicit-any
  let supabase: any = null;
  let paperId: string | null = null;
  try {
    if (req.method !== "POST") return json({ error: "Please send a POST request." }, 405);
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Please sign in to read question papers." }, 401);

    supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: allowed, error: roleError } = await supabase.rpc("is_manager_or_superadmin");
    if (roleError) return json({ error: "We could not check your permissions. Please sign in again." }, 401);
    if (allowed !== true) return json({ error: "You don't have permission to read question papers." }, 403);

    let body: {
      action?: unknown; paperId?: unknown; from?: unknown; to?: unknown; overwriteEdited?: unknown;
      questionNumbers?: unknown; fileKey?: unknown;
    };
    try {
      body = await req.json();
    } catch {
      return json({ error: "The request was not valid. Please try again." }, 400);
    }
    const from = body.from, to = body.to;
    const overwriteEdited = body.overwriteEdited === true;
    if (typeof body.paperId !== "string" || !body.paperId) {
      return json({ error: "Please choose a paper to read." }, 422);
    }
    paperId = body.paperId;
    const action = body.action ?? "read";
    if (action === "recheck") return await handleRecheck(supabase, paperId, body.questionNumbers);
    if (action === "read_key") return await handleReadKey(supabase, paperId, body.fileKey);
    if (action !== "read") return json({ error: "Unknown action. Use read, recheck or read_key." }, 400);
    if (!Number.isInteger(from) || !Number.isInteger(to)) {
      return json({ error: "The question range must be whole numbers." }, 422);
    }
    const f = from as number, t = to as number;

    // Load the paper.
    const { data: paper, error: paperErr } = await supabase
      .from("question_papers")
      .select("id, class_code, olympiad_code, total_questions, pdf_r2_key, deleted_at")
      .eq("id", paperId)
      .maybeSingle();
    if (paperErr) return json({ error: "We could not open this paper. Please try again." }, 502);
    if (!paper || paper.deleted_at) return json({ error: "This paper could not be found." }, 422);
    if (!paper.pdf_r2_key) return json({ error: "This paper has no PDF yet. Please upload the PDF first." }, 422);
    if (f < 1 || t < f || t > paper.total_questions) {
      return json({ error: `The question range must be within 1–${paper.total_questions}.` }, 422);
    }
    if (t - f + 1 > MAX_CHUNK) return json({ error: `Please read at most ${MAX_CHUNK} questions at a time.` }, 422);

    const total: number = paper.total_questions;

    // From here on, any failure is recorded on the paper.
    try {
      if (!isAllowedKey(paper.pdf_r2_key)) throw new Fail(422, "This paper's PDF location is not valid. Please upload the PDF again.");
      const group = classGroupOf(paper.class_code);
      if (!group) throw new Fail(422, "This paper's class is not recognised.");

      const { data: skillRows, error: skillErr } = await supabase
        .from("result_skill_lists")
        .select("skill, sort_order")
        .eq("olympiad_code", paper.olympiad_code)
        .eq("class_group", group)
        .order("sort_order");
      if (skillErr) throw new Fail(502, "We could not load the skill list. Please try again.");
      const allowedSkills: string[] = (skillRows ?? []).map((r: { skill: string }) => r.skill);
      if (allowedSkills.length === 0) throw new Fail(422, "No skills are set up for this class and subject yet.");

      if (f === 1) {
        const { error } = await supabase.from("question_papers")
          .update({ analysis_status: "running", analysis_error: null }).eq("id", paperId);
        if (error) throw new Fail(502, "We could not start reading this paper. Please try again.");
      }

      const cfg = r2Config();
      const apiKey = anthropicKey();
      const pdfBase64 = await fetchBase64(cfg, paper.pdf_r2_key, MAX_PDF_BYTES, PDF_TOO_LARGE);

      const reqBody = buildRequestBody({
        pdfBase64,
        className: classDisplayName(paper.class_code),
        olympiadCode: paper.olympiad_code,
        allowedSkills,
        from: f,
        to: t,
      });
      const parsed = await callClaude(apiKey, reqBody, { paperId, from: f, to: t });
      const v = validateChunk(parsed, f, t, allowedSkills);
      if (!v.ok) throw new Fail(422, v.message);

      // Existing rows in range.
      const { data: existing, error: exErr } = await supabase
        .from("questions")
        .select(
          "question_number, human_edited, is_grace, correct_answer, key_answer, check_status, recheck_answer, recheck_confidence, rechecked_at",
        )
        .eq("paper_id", paperId).gte("question_number", f).lte("question_number", t);
      if (exErr) throw new Fail(502, "We could not check the saved questions. Please try again.");
      interface Existing {
        question_number: number;
        human_edited: boolean;
        is_grace: boolean;
        correct_answer: string | null;
        key_answer: string | null;
        check_status: string;
        recheck_answer: string | null;
        recheck_confidence: number | null;
        rechecked_at: string | null;
      }
      const byNum = new Map<number, Existing>((existing ?? []).map((r: Existing) => [r.question_number, r]));
      const skippedEdited: number[] = [];
      const toSave = v.rows.filter((r) => {
        if (byNum.get(r.question_number)?.human_edited && !overwriteEdited) {
          skippedEdited.push(r.question_number);
          return false;
        }
        return true;
      });
      // Every row carries the same keys, so the upsert only writes these columns.
      // The key (or a staff decision) wins over the AI for correct_answer.
      const payload = toSave.map((r) => {
        const old = byNum.get(r.question_number) ?? null;
        const w = firstPassWrite(old, r.correct_answer);
        return {
          paper_id: paperId,
          question_number: r.question_number,
          question_text: r.question_text,
          option_a: r.option_a,
          option_b: r.option_b,
          option_c: r.option_c,
          option_d: r.option_d,
          has_figure: r.has_figure,
          correct_answer: w.correct_answer,
          ai_answer: r.correct_answer,
          ai_reason: r.ai_reason,
          figure_page: r.figure_page,
          figure_box: r.figure_box,
          check_status: w.check_status,
          skill_category: r.skill_category,
          skill_description: r.skill_description,
          cognitive_level: r.cognitive_level,
          ai_confidence: r.ai_confidence,
          human_edited: false,
          is_grace: old?.is_grace ?? false,
        };
      });
      if (payload.length > 0) {
        const { error } = await supabase.from("questions").upsert(payload, { onConflict: "paper_id,question_number" });
        if (error) throw new Fail(502, "We could not save the questions. Please try again.");
      }

      const { count, error: cntErr } = await supabase
        .from("questions").select("id", { count: "exact", head: true }).eq("paper_id", paperId);
      if (cntErr) throw new Fail(502, "The questions were saved but progress could not be checked. Please re-run this part.");
      const { status, progress } = nextAnalysisState(count ?? 0, total);
      const { error: progErr } = await supabase.from("question_papers")
        .update({ analysis_progress: progress, analysis_status: status, analysis_error: null })
        .eq("id", paperId);
      if (progErr) throw new Fail(502, "The questions were saved but progress could not be updated. Please re-run this part.");

      return json({ saved: payload.length, skippedEdited, progress });
    } catch (e) {
      const status = e instanceof Fail ? e.status : 502;
      const message = e instanceof Fail ? e.message : "Something went wrong while reading this paper. Please try again.";
      try {
        await supabase.from("question_papers")
          .update({ analysis_status: "failed", analysis_error: message }).eq("id", paperId);
      } catch { /* best effort */ }
      return json({ error: message }, status);
    }
  } catch (_e) {
    return json({ error: "Something went wrong while reading this paper. Please try again." }, 500);
  }
});
