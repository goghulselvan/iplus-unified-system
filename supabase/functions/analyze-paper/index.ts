import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.55.0";
import { encodeBase64 } from "jsr:@std/encoding@1/base64";
import { isAllowedKey } from "../results-files/keys.ts";
import { presign, R2Config } from "../results-files/sign.ts";
import { validateChunk } from "./parse.ts";
import { buildRequestBody, classDisplayName, classGroupOf } from "./prompt.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const MAX_PDF_BYTES = 20 * 1024 * 1024;
const MAX_CHUNK = 20;

class Fail extends Error {
  constructor(public status: number, message: string) {
    super(message);
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

    let body: { paperId?: unknown; from?: unknown; to?: unknown; overwriteEdited?: unknown };
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
    if (paperErr) throw new Fail(502, "We could not open this paper. Please try again.");
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
          .update({ analysis_status: "running", analysis_progress: 0, analysis_error: null }).eq("id", paperId);
        if (error) throw new Fail(502, "We could not start reading this paper. Please try again.");
      }

      // R2 secrets resolved lazily.
      const cfg: R2Config = {
        accountId: Deno.env.get("R2_ACCOUNT_ID") ?? "",
        accessKeyId: Deno.env.get("R2_ACCESS_KEY_ID") ?? "",
        secretAccessKey: Deno.env.get("R2_SECRET_ACCESS_KEY") ?? "",
        bucket: Deno.env.get("R2_BUCKET") ?? "",
      };
      if (!cfg.accountId || !cfg.accessKeyId || !cfg.secretAccessKey || !cfg.bucket) {
        throw new Fail(502, "File storage is not set up yet. Please contact the administrator.");
      }
      const apiKey = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
      if (!apiKey) throw new Fail(502, "The AI reader is not set up yet. Please contact the administrator.");

      // Download the PDF.
      let pdfBytes: Uint8Array;
      try {
        const url = await presign(cfg, "GET", paper.pdf_r2_key);
        const res = await fetch(url);
        if (!res.ok) throw new Error(`R2 ${res.status}`);
        pdfBytes = new Uint8Array(await res.arrayBuffer());
      } catch {
        throw new Fail(502, "We could not fetch the PDF from storage. Please try again.");
      }
      if (pdfBytes.byteLength > MAX_PDF_BYTES) {
        throw new Fail(422, "This PDF is too large for the AI to read (over 20 MB). Please save a smaller PDF and upload it again.");
      }

      const reqBody = buildRequestBody({
        pdfBase64: encodeBase64(pdfBytes),
        className: classDisplayName(paper.class_code),
        olympiadCode: paper.olympiad_code,
        allowedSkills,
        from: f,
        to: t,
      });

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
          body: JSON.stringify(reqBody),
        });
        if (!res.ok) throw new Error(`AI ${res.status}`);
        aiJson = await res.json();
      } catch {
        throw new Fail(502, "The AI could not be reached. Please try again in a minute.");
      }
      // deno-lint-ignore no-explicit-any
      const msg = aiJson as any;
      if (msg?.stop_reason === "refusal") {
        throw new Fail(502, "The AI declined to read this part of the paper — please enter these questions by hand");
      }
      if (msg?.stop_reason === "max_tokens") {
        throw new Fail(502, "The AI's answer was cut off — please re-run this part");
      }
      // deno-lint-ignore no-explicit-any
      const textBlock = (msg?.content ?? []).find((b: any) => b?.type === "text");
      let parsed: unknown;
      try {
        parsed = JSON.parse(textBlock?.text ?? "");
      } catch {
        throw new Fail(502, "The AI's answer could not be understood — please re-run this part");
      }
      const v = validateChunk(parsed, f, t, allowedSkills);
      if (!v.ok) throw new Fail(422, v.message);

      // Existing rows in range.
      const { data: existing, error: exErr } = await supabase
        .from("questions")
        .select("question_number, human_edited, is_grace")
        .eq("paper_id", paperId).gte("question_number", f).lte("question_number", t);
      if (exErr) throw new Fail(502, "We could not check the saved questions. Please try again.");
      const byNum = new Map<number, { human_edited: boolean; is_grace: boolean }>(
        (existing ?? []).map((r: { question_number: number; human_edited: boolean; is_grace: boolean }) => [r.question_number, r]),
      );
      const skippedEdited: number[] = [];
      const toSave = v.rows.filter((r) => {
        if (byNum.get(r.question_number)?.human_edited && !overwriteEdited) {
          skippedEdited.push(r.question_number);
          return false;
        }
        return true;
      });
      const payload = toSave.map((r) => ({
        paper_id: paperId,
        question_number: r.question_number,
        question_text: r.question_text,
        has_figure: r.has_figure,
        correct_answer: r.correct_answer,
        skill_category: r.skill_category,
        skill_description: r.skill_description,
        cognitive_level: r.cognitive_level,
        ai_confidence: r.ai_confidence,
        human_edited: false,
        is_grace: byNum.get(r.question_number)?.is_grace ?? false,
      }));
      if (payload.length > 0) {
        const { error } = await supabase.from("questions").upsert(payload, { onConflict: "paper_id,question_number" });
        if (error) throw new Fail(502, "We could not save the questions. Please try again.");
      }

      const progress = Math.round((t / total) * 100);
      const { error: progErr } = await supabase.from("question_papers")
        .update({ analysis_progress: progress, ...(t === total ? { analysis_status: "done" } : {}) })
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
