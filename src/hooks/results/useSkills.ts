// All access to the Phase 4-7 database objects lives here. Their generated types do not exist
// yet, so calls go through ONE loose client; delete `loose` and use `supabase` once types are regenerated.
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { plainError } from "./useResultsReads";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const loose = supabase as any;

export interface SkillSummaryRow { skill: string; school_pct: number | null; state_pct: number | null; students: number }
export interface StudentSkillRow { skill: string; correct: number; total: number; percentage: number }
export interface BulkSkillRow { enrollment_id: string; class_code: string; olympiad_code: string; grade: string; skill: string; correct: number; total: number }
export interface FeedbackJson {
  overall: string;
  strengths: { skill: string; feedback: string }[];
  focus_areas: { skill: string; feedback: string }[];
  tips: string[];
  goals: string[];
}
export interface FeedbackRow { enrollment_id: string; feedback: FeedbackJson; outdated: boolean }
export interface SchoolAnalysisJson { overview: string; strengths: string[]; focus_areas: string[]; suggestions: string[] }
export interface SchoolAnalysisRow { analysis: SchoolAnalysisJson; outdated: boolean; created_at: string }
export interface AiBatchRow {
  id: string; project_id: string; school_id: string | null;
  status: "submitted" | "ended" | "collected" | "failed";
  total: number; succeeded: number; errored: number;
  errored_enrollment_ids: string[] | null; error: string | null;
  created_at: string; collected_at: string | null;
}
export interface SubmitResult { batches?: string[]; batchId?: string; total: number; remaining?: number; warning?: string; message?: string }
export interface StatusResult { status: string; total: number; succeeded: number; errored: number; percent: number }
export interface CollectResult { saved: number; failedEnrollmentIds: string[] }

const PAGE = 1000;

/** Calls results-feedback; fetch errors and `{error}` bodies both become plain-English Errors. */
export async function callFeedback<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("results-feedback", { body });
  if (error) {
    let msg: string | undefined;
    try { msg = (await (error as { context?: Response }).context?.json?.())?.error; } catch { /* ignore */ }
    throw new Error(msg || "We could not reach the feedback writer. Please try again.");
  }
  if (data?.error) throw new Error(String(data.error));
  return data as T;
}

/** `enrollmentIds` limits the job to exactly those students (the "Try again" path). */
export const submitFeedback = (projectId: string, schoolId?: string | null, enrollmentIds?: string[]) =>
  callFeedback<SubmitResult>({
    action: "submit", projectId, ...(schoolId ? { schoolId } : {}), ...(enrollmentIds && enrollmentIds.length > 0 ? { enrollmentIds } : {}),
  });
export const batchStatus = (batchId: string) => callFeedback<StatusResult>({ action: "status", batchId });
export const collectBatch = (batchId: string) => callFeedback<CollectResult>({ action: "collect", batchId });
export const writeSchoolAnalysis = (projectId: string, schoolId: string) =>
  callFeedback<{ analysis: SchoolAnalysisJson }>({ action: "school", projectId, schoolId });

export function useSkillSummary(projectId?: string, schoolId?: string | null, classCode?: string | null, olympiad?: string | null) {
  return useQuery({
    queryKey: ["results", "skill-summary", projectId, schoolId ?? null, classCode ?? null, olympiad ?? null],
    enabled: !!projectId,
    queryFn: async (): Promise<SkillSummaryRow[]> => {
      const { data, error } = await loose.rpc("results_skill_summary", {
        p_project_id: projectId, p_school_id: schoolId ?? null, p_class_code: classCode ?? null, p_olympiad_code: olympiad ?? null,
      });
      if (error) throw plainError(error, "We could not load the skill results. Please refresh.");
      return (data ?? []) as SkillSummaryRow[];
    },
  });
}

export async function fetchStudentSkills(enrollmentId: string): Promise<StudentSkillRow[]> {
  const { data, error } = await loose.rpc("results_student_skills", { p_enrollment_id: enrollmentId });
  if (error) throw plainError(error, "We could not load this student's skills.");
  return ((data ?? []) as StudentSkillRow[]).map((r) => ({ ...r, correct: Number(r.correct), total: Number(r.total), percentage: Number(r.percentage) }));
}

/** Every student's skills for one school in a few calls (pages of 1000 rows). */
export async function fetchSchoolSkills(projectId: string, schoolId: string): Promise<Map<string, StudentSkillRow[]>> {
  const out = new Map<string, StudentSkillRow[]>();
  for (let from = 0;; from += PAGE) {
    const { data, error } = await loose
      .rpc("results_bulk_student_skills", { p_project_id: projectId, p_school_id: schoolId, p_only_needing_feedback: false })
      .range(from, from + PAGE - 1);
    if (error) throw plainError(error, "We could not load the skills for this school.");
    const rows = (data ?? []) as BulkSkillRow[];
    for (const r of rows) {
      const total = Number(r.total);
      const correct = Number(r.correct);
      const list = out.get(r.enrollment_id) ?? [];
      list.push({ skill: r.skill, correct, total, percentage: total > 0 ? Math.round((correct * 100) / total) : 0 });
      out.set(r.enrollment_id, list);
    }
    if (rows.length < PAGE) break;
  }
  return out;
}

/** Which students have feedback and whether it is out of date (marked by a re-score OR its basis no longer matches). */
export async function fetchFeedbackStatus(projectId: string, schoolId?: string | null): Promise<Map<string, { has: boolean; outdated: boolean }>> {
  const out = new Map<string, { has: boolean; outdated: boolean }>();
  for (let from = 0;; from += PAGE) {
    const { data, error } = await loose
      .rpc("results_feedback_status", { p_project_id: projectId, p_school_id: schoolId ?? null })
      .range(from, from + PAGE - 1);
    if (error) throw plainError(error, "We could not check which feedback is out of date.");
    const rows = (data ?? []) as { enrollment_id: string; has_feedback: boolean; is_outdated: boolean }[];
    for (const r of rows) out.set(r.enrollment_id, { has: r.has_feedback, outdated: r.is_outdated });
    if (rows.length < PAGE) break;
  }
  return out;
}

/** With `scope`, each row's `outdated` comes from results_feedback_status (the source of truth for the Outdated badges). */
export async function fetchFeedback(enrollmentIds: string[], scope?: { projectId: string; schoolId?: string | null }): Promise<Map<string, FeedbackRow>> {
  const out = new Map<string, FeedbackRow>();
  for (let i = 0; i < enrollmentIds.length; i += 200) {
    const { data, error } = await loose.from("result_feedback").select("enrollment_id, feedback, outdated").in("enrollment_id", enrollmentIds.slice(i, i + 200));
    if (error) throw plainError(error, "We could not load the AI feedback.");
    for (const r of (data ?? []) as FeedbackRow[]) out.set(r.enrollment_id, r);
  }
  if (scope && out.size > 0) {
    const st = await fetchFeedbackStatus(scope.projectId, scope.schoolId);
    for (const [id, row] of out) row.outdated = st.get(id)?.outdated ?? row.outdated;
  }
  return out;
}

export function useStudentFeedback(enrollmentId?: string, projectId?: string, schoolId?: string | null) {
  return useQuery({
    queryKey: ["results", "feedback", enrollmentId, projectId ?? null],
    enabled: !!enrollmentId,
    queryFn: async () => (await fetchFeedback([enrollmentId!], projectId ? { projectId, schoolId } : undefined)).get(enrollmentId!) ?? null,
  });
}

export async function fetchSchoolAnalysis(projectId: string, schoolId: string): Promise<SchoolAnalysisRow | null> {
  const { data, error } = await loose.from("result_school_analysis").select("analysis, outdated, created_at")
    .eq("project_id", projectId).eq("school_id", schoolId).maybeSingle();
  if (error) throw plainError(error, "We could not load the school analysis.");
  return (data as SchoolAnalysisRow) ?? null;
}

export function useSchoolAnalysis(projectId?: string, schoolId?: string) {
  return useQuery({
    queryKey: ["results", "school-analysis", projectId, schoolId],
    enabled: !!projectId && !!schoolId,
    queryFn: () => fetchSchoolAnalysis(projectId!, schoolId!),
  });
}

export const BATCH_POLL_MS = 20_000;
export const isActiveBatch = (b: Pick<AiBatchRow, "status">) => b.status === "submitted" || b.status === "ended";

/** Recent AI jobs. While any is running, polls the writer every 20 s (and only while the page is open). */
export function useAiBatches(projectId?: string) {
  return useQuery({
    queryKey: ["results", "ai-batches", projectId],
    enabled: !!projectId,
    refetchIntervalInBackground: false,
    refetchInterval: (q) => ((q.state.data as AiBatchRow[] | undefined)?.some((b) => b.status === "submitted") ? BATCH_POLL_MS : false),
    queryFn: async (): Promise<AiBatchRow[]> => {
      const read = async () => {
        const { data, error } = await loose.from("result_ai_batches")
          .select("id, project_id, school_id, status, total, succeeded, errored, errored_enrollment_ids, error, created_at, collected_at")
          .eq("project_id", projectId).order("created_at", { ascending: false }).limit(30);
        if (error) throw plainError(error, "We could not load the AI jobs. Please refresh.");
        return (data ?? []) as AiBatchRow[];
      };
      let rows = await read();
      const running = rows.filter((b) => b.status === "submitted");
      if (running.length > 0) {
        await Promise.allSettled(running.map((b) => batchStatus(b.id)));
        rows = await read();
      }
      return rows;
    },
  });
}
