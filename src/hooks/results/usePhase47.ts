import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { friendlyError } from "@/lib/results/friendlyError";

/**
 * Typed wrapper for the Phase 4-7 tables and functions (integrity flags, awards).
 * The generated Supabase types do not know them yet, so every cast to `never` / `any`
 * lives in the three helpers below. Once types are regenerated, delete the helpers and
 * call supabase.rpc / supabase.from directly.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
async function rpc<T>(name: keyof Database["public"]["Functions"], args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(name, args as never);
  if (error) throw friendlyError(error, "That did not work. Please try again.");
  return data as T;
}
function table(name: keyof Database["public"]["Tables"]): Loose {
  return supabase.from(name) as Loose;
}
const fail = (error: { message?: string; code?: string } | null, fallback: string): never => {
  throw friendlyError(error, fallback);
};

// ---------- shared ----------
const CHUNK = 150;
export async function inChunks<T>(
  ids: string[], run: (chunk: string[]) => Promise<T[]>, onChunk?: (done: number, total: number) => void,
): Promise<T[]> {
  const out: T[] = [];
  const uniq = [...new Set(ids)];
  for (let i = 0; i < uniq.length; i += CHUNK) {
    out.push(...(await run(uniq.slice(i, i + CHUNK))));
    onChunk?.(Math.min(i + CHUNK, uniq.length), uniq.length);
  }
  return out;
}

/** Read every row of a query, 1000 at a time. */
async function readAll<T>(page: (from: number, to: number) => Promise<{ data: T[] | null; error: { message?: string } | null }>, onPage?: (n: number) => void): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await page(from, from + 999);
    if (error) fail(error, "We could not load the list. Please refresh.");
    out.push(...(data ?? []));
    onPage?.(out.length);
    if (!data || data.length < 1000) break;
  }
  return out;
}

export interface StudentInfo {
  enrollmentId: string;
  name: string;
  regNumber: string;
  classCode: string;
  olympiad: string;
  schoolId: string | null;
}
export interface SchoolInfo {
  id: string;
  name: string;
  district: string | null;
  ssNo: number | null;
  principal: string | null;
}

export async function fetchStudents(enrollmentIds: string[], onProgress?: (fraction: number) => void): Promise<Map<string, StudentInfo>> {
  const enrs = await inChunks<Loose>(enrollmentIds, async (c) => {
    const { data, error } = await table("portal_student_enrollments")
      .select("id, registration_number, school_id, olympiad_code, student_id").in("id", c);
    if (error) fail(error, "We could not load the students.");
    return data ?? [];
  }, (d, t) => onProgress?.((d / t) / 2));
  const studs = await inChunks<Loose>(enrs.map((e: Loose) => e.student_id), async (c) => {
    const { data, error } = await table("portal_registered_students").select("id, student_name, class_code").in("id", c);
    if (error) fail(error, "We could not load the students.");
    return data ?? [];
  }, (d, t) => onProgress?.(0.5 + (d / t) / 2));
  const byStud = new Map<string, Loose>(studs.map((s: Loose) => [s.id, s]));
  return new Map(
    enrs.map((e: Loose) => {
      const s = byStud.get(e.student_id);
      return [e.id, {
        enrollmentId: e.id, name: s?.student_name ?? "", regNumber: e.registration_number ?? "",
        classCode: s?.class_code ?? "", olympiad: e.olympiad_code ?? "", schoolId: e.school_id ?? null,
      } as StudentInfo];
    }),
  );
}

export async function fetchSchools(ids: string[], onProgress?: (fraction: number) => void): Promise<Map<string, SchoolInfo>> {
  const rows = await inChunks<Loose>(ids.filter(Boolean), async (c) => {
    const { data, error } = await table("schools").select("id, school_name, district, ss_no, principal_name").in("id", c);
    if (error) fail(error, "We could not load the schools.");
    return data ?? [];
  }, (d, t) => onProgress?.(d / t));
  return new Map(rows.map((r: Loose) => [r.id, { id: r.id, name: r.school_name ?? "", district: r.district ?? null, ssNo: r.ss_no ?? null, principal: r.principal_name ?? null } as SchoolInfo]));
}

// ---------- integrity ----------
export type FlagType =
  | "identical_answers" | "same_wrong_answers" | "low_score_variance"
  | "far_above_state" | "adjacent_copying" | "answer_distribution_bias";
export type FlagSeverity = "medium" | "high" | "critical";
export type FlagStatus = "pending" | "investigating" | "verified" | "dismissed";

export interface IntegrityFlag {
  id: string;
  school_id: string;
  class_code: string | null;
  olympiad_code: string | null;
  flag_type: FlagType;
  severity: FlagSeverity;
  details: Record<string, unknown> & { enrollmentIds?: string[] };
  status: FlagStatus;
  notes: string | null;
  reviewed_at: string | null;
  created_at: string;
}

export interface ScanSummary {
  scanId: string;
  groupsScanned: number;
  flags: number;
  bySeverity: { critical: number; high: number; medium: number };
  byType: Record<string, number>;
  keptReviewed: number;
  alreadyReviewed: number;
}

const flagsKey = (p?: string) => ["results", "integrity-flags", p] as const;

export function useIntegrityFlags(projectId?: string) {
  return useQuery({
    queryKey: flagsKey(projectId),
    enabled: !!projectId,
    queryFn: async () => {
      const flags = await readAll<IntegrityFlag>((from, to) =>
        table("result_integrity_flags")
          .select("id, school_id, class_code, olympiad_code, flag_type, severity, details, status, notes, reviewed_at, created_at")
          .eq("project_id", projectId!).order("created_at", { ascending: false }).order("id").range(from, to));
      const schools = await fetchSchools(flags.map((f) => f.school_id));
      return { flags, schools };
    },
  });
}

export function useRunScan(projectId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => rpc<ScanSummary>("results_integrity_scan", { p_project_id: projectId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: flagsKey(projectId) }),
  });
}

export function useReviewFlag(projectId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { flagId: string; status: FlagStatus; notes: string }) =>
      rpc<void>("results_review_integrity_flag", { p_flag_id: v.flagId, p_status: v.status, p_notes: v.notes }),
    onSuccess: () => qc.invalidateQueries({ queryKey: flagsKey(projectId) }),
  });
}

export interface FlagStudent extends StudentInfo {
  answers: string[] | null;
  paperId: string | null;
}
export interface FlagDetail {
  students: FlagStudent[];
  key: Record<number, string>;
}

/** Students named by a flag, with their OMR answers and the paper's answer key. */
export function useFlagDetail(enrollmentIds: string[] | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ["results", "flag-detail", enrollmentIds],
    enabled: enabled && !!enrollmentIds?.length,
    queryFn: async (): Promise<FlagDetail> => {
      const ids = (enrollmentIds ?? []).slice(0, 200);
      const students = await fetchStudents(ids);
      const evs = await inChunks<Loose>(ids, async (c) => {
        const { data, error } = await table("result_evaluations")
          .select("enrollment_id, paper_id, answers").in("enrollment_id", c).is("deleted_at", null).eq("status", "evaluated");
        if (error) fail(error, "We could not load the answers.");
        return data ?? [];
      });
      const ev = new Map<string, Loose>(evs.map((e: Loose) => [e.enrollment_id, e]));
      // The answer key is only used when everyone listed sat the same paper; otherwise "wrong" marks could mislead.
      const paperIds = new Set(evs.filter((e: Loose) => e.answers).map((e: Loose) => e.paper_id as string));
      const paperId = paperIds.size === 1 ? [...paperIds][0] : undefined;
      const key: Record<number, string> = {};
      if (paperId) {
        const { data, error } = await table("questions").select("question_number, correct_answer, is_grace").eq("paper_id", paperId).order("question_number");
        if (error) fail(error, "We could not load the answer key.");
        for (const q of (data ?? []) as Loose[]) if (q.correct_answer && !q.is_grace) key[q.question_number] = q.correct_answer;
      }
      return {
        students: ids.map((id) => ({
          ...(students.get(id) ?? { enrollmentId: id, name: "Unknown student", regNumber: "", classCode: "", olympiad: "", schoolId: null }),
          answers: (ev.get(id)?.answers as string[] | null) ?? null,
          paperId: (ev.get(id)?.paper_id as string | undefined) ?? null,
        })),
        key,
      };
    },
  });
}

// ---------- awards ----------
export type AwardLevel = "national" | "state" | "district" | "school";
export type AwardRuleType = "top_n" | "min_percentage";

export interface AwardRule {
  id: string;
  award_name: string;
  level: AwardLevel;
  rule_type: AwardRuleType;
  value: number;
  class_code: string | null;
  olympiad_code: string | null;
  sort_order: number;
}
export interface AllotResult {
  awarded: number;
  removedKept: number;
  deleted: number;
  byAward: { award: string; students: number }[];
  manualReview: { schoolId: string; schoolName: string | null; verifiedFlags: number }[];
}
export interface AwardRow {
  id: string;
  enrollment_id: string;
  award_name: string;
  source: "rule" | "manual";
  removed: boolean;
  notes: string | null;
  removed_note: string | null;
}
export interface AwardWithStudent extends AwardRow {
  student: StudentInfo | null;
  school: SchoolInfo | null;
}

const rulesKey = (p?: string) => ["results", "award-rules", p] as const;
const awardsKey = (p?: string) => ["results", "awards", p] as const;

export function useAwardRules(projectId?: string) {
  return useQuery({
    queryKey: rulesKey(projectId),
    enabled: !!projectId,
    queryFn: async () => {
      const { data, error } = await table("result_award_rules")
        .select("id, award_name, level, rule_type, value, class_code, olympiad_code, sort_order")
        .eq("project_id", projectId!).order("sort_order").order("created_at");
      if (error) fail(error, "We could not load the award rules. Please refresh.");
      return ((data ?? []) as Loose[]).map((r) => ({ ...r, value: Number(r.value) })) as AwardRule[];
    },
  });
}

export type AwardRuleInput = Omit<AwardRule, "id"> & { id?: string };

export function useSaveAwardRule(projectId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (r: AwardRuleInput) => {
      const row = {
        award_name: r.award_name.trim(), level: r.level, rule_type: r.rule_type, value: r.value,
        class_code: r.class_code || null, olympiad_code: r.olympiad_code || null, sort_order: r.sort_order,
      };
      const q = r.id
        ? table("result_award_rules").update(row).eq("id", r.id)
        : table("result_award_rules").insert({ ...row, project_id: projectId });
      const { error } = await q;
      if (error) fail(error, "We could not save this rule. Check the values and try again.");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: rulesKey(projectId) }),
  });
}

export function useDeleteAwardRule(projectId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await table("result_award_rules").delete().eq("id", id);
      if (error) fail(error, "We could not delete this rule.");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: rulesKey(projectId) }),
  });
}

export function useAllotAwards(projectId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => rpc<AllotResult>("results_allot_awards", { p_project_id: projectId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: awardsKey(projectId) }),
  });
}

export async function fetchAwards(projectId: string): Promise<AwardWithStudent[]> {
  const rows = await readAll<AwardRow>((from, to) =>
    table("result_awards").select("id, enrollment_id, award_name, source, removed, notes, removed_note")
      .eq("project_id", projectId).order("award_name").order("id").range(from, to));
  const students = await fetchStudents(rows.map((r) => r.enrollment_id));
  const schools = await fetchSchools([...students.values()].map((s) => s.schoolId ?? ""));
  return rows.map((r) => {
    const st = students.get(r.enrollment_id) ?? null;
    return { ...r, student: st, school: st?.schoolId ? schools.get(st.schoolId) ?? null : null };
  });
}

export function useAwards(projectId?: string) {
  return useQuery({ queryKey: awardsKey(projectId), enabled: !!projectId, queryFn: () => fetchAwards(projectId!) });
}

export function useRemoveAward(projectId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; note: string }) => rpc<void>("results_remove_award", { p_award_id: v.id, p_note: v.note }),
    onSuccess: () => qc.invalidateQueries({ queryKey: awardsKey(projectId) }),
  });
}

export function useRestoreAward(projectId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => rpc<void>("results_restore_award", { p_award_id: id }),
    onSuccess: () => qc.invalidateQueries({ queryKey: awardsKey(projectId) }),
  });
}

export interface FoundStudent {
  enrollmentId: string;
  regNumber: string;
  name: string;
  schoolName: string | null;
  classCode: string;
  olympiad: string;
}

/** Find a registered student for a manual award. Hyphens and spaces in the number are fine; matching happens on the server by digits. */
export async function findEnrollmentByReg(projectId: string, reg: string): Promise<FoundStudent | null> {
  const digits = reg.replace(/\D/g, "");
  if (digits.length !== 12) return null;
  const rows = await rpc<Loose[] | null>("results_find_enrollment", { p_project_id: projectId, p_reg: digits });
  const r = rows?.[0];
  return r
    ? { enrollmentId: r.enrollment_id, regNumber: r.registration_number ?? "", name: r.student_name ?? "", schoolName: r.school_name ?? null, classCode: r.class_code ?? "", olympiad: r.olympiad_code ?? "" }
    : null;
}

export function useAddManualAward(projectId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { enrollmentId: string; awardName: string; notes: string }) =>
      rpc<string>("results_add_manual_award", {
        p_project_id: projectId, p_enrollment_id: v.enrollmentId, p_award_name: v.awardName.trim(), p_note: v.notes.trim(),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: awardsKey(projectId) }),
  });
}

/** Every student with a score (for the participation list), with their name, school and class. */
export async function fetchParticipants(projectId: string, onProgress?: (pct: number) => void): Promise<{ s: StudentInfo; school: SchoolInfo | null; classCode: string; olympiad: string }[]> {
  // Progress: reading the scores is 0-30%, looking up students 30-85%, schools 85-100%.
  const { count } = await table("result_scores").select("enrollment_id", { count: "exact", head: true }).eq("project_id", projectId);
  const scores = await readAll<Loose>((from, to) =>
    table("result_scores").select("enrollment_id, class_code, olympiad_code, school_id")
      .eq("project_id", projectId).order("enrollment_id").range(from, to),
    (n) => onProgress?.(Math.min(30, (n / Math.max(1, count ?? n)) * 30)));
  const students = await fetchStudents(scores.map((r) => r.enrollment_id), (f) => onProgress?.(30 + f * 55));
  const schools = await fetchSchools(scores.map((r) => r.school_id ?? ""), (f) => onProgress?.(85 + f * 15));
  return scores.flatMap((r) => {
    const s = students.get(r.enrollment_id);
    return s ? [{ s, school: r.school_id ? schools.get(r.school_id) ?? null : null, classCode: r.class_code as string, olympiad: r.olympiad_code as string }] : [];
  });
}
