import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fail } from "@/hooks/results/usePapers";
import type { CsvRow } from "@/lib/results/evaluationCsv";

export interface UploadError { row: number; message: string }
export interface UploadFailure { ok: false; errors: UploadError[]; moreErrors: number }
export interface ReplaceItem { reg: string; name: string; was: "evaluated" | "absent" }
export interface UploadDryRun {
  ok: true;
  dryRun: true;
  count: number;
  replace: ReplaceItem[];
  otherSlot: { count: number; slotName: string | null };
  missingFromFile: number;
}
export interface UploadSaved { ok: true; saved: number; replaced: number; batchId: string }
export type UploadCheckResult = UploadFailure | UploadDryRun;

export interface UploadArgs {
  paperId: string;
  kind: "manual" | "omr";
  fileName: string;
  rows: CsvRow[];
}

const payload = (rows: CsvRow[]) => rows.map((r) => ({ row: r.row, reg: r.reg, values: r.values }));

/** Check a file (dry run) or save it. Paper-level problems throw with a plain-English message. */
export function useUploadRpc() {
  const qc = useQueryClient();
  const call = async (a: UploadArgs, dry: boolean) => {
    const { data, error } = await supabase.rpc("results_upload", {
      p_paper_id: a.paperId, p_kind: a.kind, p_file_name: a.fileName,
      p_rows: payload(a.rows) as never, p_dry_run: dry,
    });
    if (error) fail(error, dry ? "We could not check this file. Please try again." : "We could not save this file. Nothing was saved. Please try again.");
    return data as unknown;
  };
  return {
    check: async (a: UploadArgs) => (await call(a, true)) as UploadCheckResult,
    save: async (a: UploadArgs) => {
      const r = (await call(a, false)) as UploadSaved | UploadFailure;
      if (r.ok) qc.invalidateQueries({ queryKey: ["results"] });
      return r;
    },
  };
}

export interface StudentFilters {
  projectId?: string;
  schoolId?: string | null;
  classCode?: string | null;
  olympiadCode?: string | null;
  status?: string | null;
  search?: string;
}
export interface StudentListRow {
  enrollment_id: string; registration_number: string | null; student_name: string;
  school_id: string | null; school_name: string | null; class_code: string; olympiad_code: string;
  status: string; total: number | null; percentage: number | null; grade: string | null;
  evaluation_id: string | null; paper_id: string | null; deleted_at: string | null; total_count: number;
}

async function listStudents(f: StudentFilters, limit: number, offset: number) {
  const { data, error } = await supabase.rpc("results_student_list", {
    p_project_id: f.projectId!, p_school_id: (f.schoolId ?? null) as never,
    p_class_code: (f.classCode ?? null) as never, p_olympiad_code: (f.olympiadCode ?? null) as never,
    p_status: (f.status ?? null) as never, p_search: (f.search ?? "") as never,
    p_limit: limit, p_offset: offset,
  });
  if (error) fail(error, "We could not load the students. Please try again.");
  return (data ?? []) as unknown as StudentListRow[];
}

export const PAGE_SIZE = 50;

export function useStudentList(f: StudentFilters, page: number) {
  return useQuery({
    queryKey: ["results", "students", f, page],
    enabled: !!f.projectId,
    placeholderData: (prev) => prev,
    queryFn: async () => {
      const rows = await listStudents(f, PAGE_SIZE, page * PAGE_SIZE);
      return { rows, total: rows[0] ? Number(rows[0].total_count) : 0 };
    },
  });
}

/** Every enrolled student of a class x olympiad, for the CSV template. */
export async function fetchTemplateStudents(projectId: string, classCode: string, olympiad: string) {
  const out: { reg: string; name: string }[] = [];
  for (let offset = 0; ; offset += 1000) {
    const rows = await listStudents({ projectId, classCode, olympiadCode: olympiad }, 1000, offset);
    for (const r of rows) if (r.registration_number) out.push({ reg: r.registration_number, name: r.student_name });
    if (rows.length < 1000) break;
  }
  return out;
}

export interface SchoolOption { id: string; school_name: string }
export function useSchoolSearch(term: string) {
  return useQuery({
    queryKey: ["results", "school-search", term],
    enabled: term.trim().length >= 2,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("schools").select("id, school_name").ilike("school_name", `%${term.trim()}%`).limit(8);
      if (error) fail(error, "We could not search schools.");
      return (data ?? []) as SchoolOption[];
    },
  });
}

/** Papers a student's result can be marked against: same class x olympiad. */
export async function findPapersForStudents(projectId: string, classCode: string, olympiad: string) {
  const { data, error } = await supabase
    .from("question_papers").select("id, slot_template_id")
    .eq("project_id", projectId).eq("class_code", classCode).eq("olympiad_code", olympiad).is("deleted_at", null);
  if (error) fail(error);
  return data ?? [];
}

export async function bookedSlotFor(projectId: string, schoolId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("exam_slots").select("slot_template_id").eq("project_id", projectId).eq("school_id", schoolId)
    .not("slot_template_id", "is", null).order("updated_at", { ascending: false }).limit(1);
  if (error) fail(error);
  return data?.[0]?.slot_template_id ?? null;
}

function useResultMutation<T, V>(fn: (v: V) => Promise<T>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => qc.invalidateQueries({ queryKey: ["results"] }) });
}

export const useSetAbsent = () =>
  useResultMutation(async (v: { paperId: string; enrollmentIds: string[]; absent: boolean }) => {
    const { data, error } = await supabase.rpc("results_set_absent", {
      p_paper_id: v.paperId, p_enrollment_ids: v.enrollmentIds, p_absent: v.absent,
    });
    if (error) fail(error);
    return data as number;
  });

export const useDeleteResults = () =>
  useResultMutation(async (enrollmentIds: string[]) => {
    const { data, error } = await supabase.rpc("results_delete_evaluations", { p_enrollment_ids: enrollmentIds });
    if (error) fail(error);
    return data as number;
  });

export const useRestoreResult = () =>
  useResultMutation(async (evaluationId: string) => {
    const { error } = await supabase.rpc("results_restore_evaluation", { p_evaluation_id: evaluationId });
    if (error) fail(error);
  });

export const useCorrectAnswer = () =>
  useResultMutation(async (v: { evaluationId: string; question: number; value: string; reason: string }) => {
    const { error } = await supabase.rpc("results_correct_answer", {
      p_evaluation_id: v.evaluationId, p_question_number: v.question, p_value: v.value, p_reason: v.reason.trim(),
    });
    if (error) fail(error);
  });

export interface ScoreRow {
  total: number; max_marks: number; percentage: number; grade: string;
  rank_school: number | null; rank_district: number | null; rank_state: number | null; rank_national: number | null;
  school_id: string | null; class_code: string; olympiad_code: string; state_code: string | null; district_key: string | null;
}
export interface StudentResult {
  enrollmentId: string;
  registrationNumber: string | null;
  name: string;
  schoolName: string | null;
  schoolId: string | null;
  classCode: string;
  olympiadCode: string;
  evaluation: { id: string; status: "evaluated" | "absent"; answers: (string | null)[] | null; marks: (number | null)[] | null; paper_id: string } | null;
  score: ScoreRow | null;
  paper: { id: string; total_questions: number; project_id: string } | null;
  questions: { question_number: number; correct_answer: string | null; is_grace: boolean; skill_category: string | null }[];
  totals: { school: number; district: number; state: number; national: number } | null;
}

export function useStudentResult(enrollmentId?: string) {
  return useQuery({
    queryKey: ["results", "student-result", enrollmentId],
    enabled: !!enrollmentId,
    queryFn: async (): Promise<StudentResult | null> => {
      const { data: enr, error } = await supabase
        .from("portal_student_enrollments")
        .select("id, registration_number, olympiad_code, school_id, project_id, portal_registered_students(student_name, class_code), schools(school_name)")
        .eq("id", enrollmentId!).maybeSingle();
      if (error) fail(error, "We could not open this student. Please try again.");
      if (!enr) return null;
      const e = enr as unknown as {
        id: string; registration_number: string | null; olympiad_code: string; school_id: string | null; project_id: string;
        portal_registered_students: { student_name: string; class_code: string } | null;
        schools: { school_name: string } | null;
      };
      const { data: ev, error: evErr } = await supabase
        .from("result_evaluations").select("id, status, answers, marks, paper_id")
        .eq("enrollment_id", enrollmentId!).is("deleted_at", null).maybeSingle();
      if (evErr) fail(evErr);
      let score: ScoreRow | null = null;
      let paper: StudentResult["paper"] = null;
      let questions: StudentResult["questions"] = [];
      let totals: StudentResult["totals"] = null;
      if (ev && ev.status === "evaluated") {
        const { data: sc } = await supabase.from("result_scores").select("*").eq("enrollment_id", enrollmentId!).maybeSingle();
        score = (sc as unknown as ScoreRow) ?? null;
        const { data: p } = await supabase.from("question_papers").select("id, total_questions, project_id").eq("id", ev.paper_id).maybeSingle();
        paper = p as StudentResult["paper"];
        const { data: qs } = await supabase
          .from("questions").select("question_number, correct_answer, is_grace, skill_category")
          .eq("paper_id", ev.paper_id).order("question_number");
        questions = (qs ?? []) as StudentResult["questions"];
        if (score) {
          const base = () => supabase.from("result_scores").select("enrollment_id", { count: "exact", head: true })
            .eq("project_id", e.project_id).eq("class_code", score!.class_code).eq("olympiad_code", score!.olympiad_code);
          const n = async (q: ReturnType<typeof base>) => (await q).count ?? 0;
          const [school, district, state, national] = await Promise.all([
            score.school_id ? n(base().eq("school_id", score.school_id)) : Promise.resolve(0),
            score.district_key ? n(base().eq("district_key", score.district_key)) : Promise.resolve(0),
            score.state_code ? n(base().eq("state_code", score.state_code)) : Promise.resolve(0),
            n(base()),
          ]);
          totals = { school, district, state, national };
        }
      }
      return {
        enrollmentId: e.id, registrationNumber: e.registration_number,
        name: e.portal_registered_students?.student_name ?? "Student", schoolName: e.schools?.school_name ?? null,
        schoolId: e.school_id, classCode: e.portal_registered_students?.class_code ?? "", olympiadCode: e.olympiad_code,
        evaluation: ev as StudentResult["evaluation"], score, paper, questions, totals,
      };
    },
  });
}

export interface AuditEntry { id: number; action: string; before: Record<string, unknown> | null; after: Record<string, unknown> | null; changed_by: string | null; changed_at: string; who: string | null }

export function useResultHistory(evaluationId?: string) {
  return useQuery({
    queryKey: ["results", "history", evaluationId],
    enabled: !!evaluationId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("result_audit_log").select("id, action, before, after, changed_by, changed_at")
        .eq("table_name", "result_evaluations").eq("row_id", evaluationId!).order("changed_at", { ascending: false });
      if (error) fail(error, "We could not load the change history.");
      const rows = (data ?? []) as unknown as AuditEntry[];
      const ids = [...new Set(rows.map((r) => r.changed_by).filter(Boolean))] as string[];
      const names = new Map<string, string>();
      if (ids.length) {
        const { data: ps } = await supabase.from("profiles").select("user_id, full_name").in("user_id", ids);
        for (const p of ps ?? []) names.set(p.user_id as string, (p as { full_name: string | null }).full_name ?? "");
      }
      return rows.map((r) => ({ ...r, who: r.changed_by ? names.get(r.changed_by) || "A staff member" : "The system" }));
    },
  });
}
