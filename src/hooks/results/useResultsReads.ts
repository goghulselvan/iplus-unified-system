import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { CLASS_ORDER, olympiadsForClass, type OlympiadCode } from "@/lib/results/paperRules";

type Fns = Database["public"]["Functions"];
export type RankRow = Fns["results_rank_list"]["Returns"][number];
export type SchoolSummaryRow = Fns["results_school_summary"]["Returns"][number];
export type ClassOlympiadRow = Fns["results_class_olympiad_summary"]["Returns"][number];
export type StudentListRow = Fns["results_student_list"]["Returns"][number];

/** Our result functions raise plain-English text; show it as written. */
export function plainError(error: { message?: string } | null, fallback: string): Error {
  const m = error?.message?.trim();
  return new Error(m && m.length < 300 && !/^(permission denied|JWT|Failed to fetch|TypeError)/i.test(m) ? m : fallback);
}

export const RANK_PAGE = 500;

export interface RankFilters {
  stateCode?: string | null;
  districtKey?: string | null;
  schoolId?: string | null;
}

export async function fetchRankPage(
  projectId: string, classCode: string, olympiad: string, filters: RankFilters, limit: number, offset: number,
): Promise<RankRow[]> {
  const { data, error } = await supabase.rpc("results_rank_list", {
    p_project_id: projectId,
    p_class_code: classCode,
    p_olympiad_code: olympiad,
    p_limit: limit,
    p_offset: offset,
    p_state_code: filters.stateCode || undefined,
    p_district_key: filters.districtKey || undefined,
    p_school_id: filters.schoolId || undefined,
  });
  if (error) throw plainError(error, "We could not load the rankings. Please try again.");
  return data ?? [];
}

/** Class x olympiad pairs that have at least one score. */
export function useRankCombos(projectId?: string) {
  return useQuery({
    queryKey: ["results", "rank-combos", projectId],
    enabled: !!projectId,
    queryFn: async () => {
      const pairs = CLASS_ORDER.flatMap((c) => olympiadsForClass(c).map((o) => [c, o] as [string, OlympiadCode]));
      const found = await Promise.all(
        pairs.map(async ([c, o]) => {
          const { count, error } = await supabase
            .from("result_scores")
            .select("enrollment_id", { count: "exact", head: true })
            .eq("project_id", projectId!)
            .eq("class_code", c)
            .eq("olympiad_code", o);
          if (error) throw plainError(error, "We could not check which results exist. Please refresh.");
          return (count ?? 0) > 0 ? [c, o] as [string, OlympiadCode] : null;
        }),
      );
      return found.filter((x): x is [string, OlympiadCode] => x !== null);
    },
  });
}

export function useRankList(
  projectId: string | undefined, classCode: string | null, olympiad: string | null,
  filters: RankFilters, page: number, pageSize: number,
) {
  return useQuery({
    queryKey: ["results", "rank-list", projectId, classCode, olympiad, filters, page, pageSize],
    enabled: !!projectId && !!classCode && !!olympiad,
    placeholderData: (prev) => prev,
    queryFn: () => fetchRankPage(projectId!, classCode!, olympiad!, filters, pageSize, page * pageSize),
  });
}

export function useStates() {
  return useQuery({
    queryKey: ["results", "states"],
    staleTime: 30 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.from("state_codes").select("state_code, state_name").eq("is_active", true).order("state_name");
      if (error) throw plainError(error, "We could not load the states.");
      return data ?? [];
    },
  });
}

export function useDistricts(stateCode?: string | null) {
  return useQuery({
    queryKey: ["results", "districts", stateCode],
    enabled: !!stateCode,
    staleTime: 30 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("district_codes").select("district_code, district_name").eq("state_code", stateCode!).order("district_name");
      if (error) throw plainError(error, "We could not load the districts.");
      // The rank list's district key is the state code plus the last two digits of the district code.
      return (data ?? []).map((d) => ({ key: `${stateCode}${d.district_code.slice(-2)}`, name: d.district_name }));
    },
  });
}

export function useSchoolSummary(projectId?: string) {
  return useQuery({
    queryKey: ["results", "school-summary", projectId],
    enabled: !!projectId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("results_school_summary", { p_project_id: projectId! });
      if (error) throw plainError(error, "We could not load the school results. Please refresh.");
      return data ?? [];
    },
  });
}

export async function fetchClassOlympiad(projectId: string, schoolId: string): Promise<ClassOlympiadRow[]> {
  const { data, error } = await supabase.rpc("results_class_olympiad_summary", { p_project_id: projectId, p_school_id: schoolId });
  if (error) throw plainError(error, "We could not load this school's results. Please refresh.");
  return data ?? [];
}

export function useClassOlympiadSummary(projectId?: string, schoolId?: string) {
  return useQuery({
    queryKey: ["results", "class-olympiad", projectId, schoolId],
    enabled: !!projectId && !!schoolId,
    queryFn: () => fetchClassOlympiad(projectId!, schoolId!),
  });
}

export function useSchoolStudents(projectId: string | undefined, schoolId: string | undefined, page: number, pageSize: number) {
  return useQuery({
    queryKey: ["results", "school-students", projectId, schoolId, page, pageSize],
    enabled: !!projectId && !!schoolId,
    placeholderData: (prev) => prev,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("results_student_list", {
        p_project_id: projectId!, p_school_id: schoolId!, p_class_code: null as unknown as string,
        p_olympiad_code: null as unknown as string, p_status: null as unknown as string, p_search: null as unknown as string,
        p_limit: pageSize, p_offset: page * pageSize,
      });
      if (error) throw plainError(error, "We could not load the students. Please refresh.");
      return data ?? [];
    },
  });
}

/** Evaluated students for each exam slot, from the papers in that slot. */
export function useEvaluatedPerSlot(projectId: string | undefined, slots: { id: string }[] | undefined, papers: { id: string; slot_template_id: string | null }[] | undefined) {
  const key = (slots ?? []).map((s) => s.id).join(",");
  return useQuery({
    queryKey: ["results", "evaluated-per-slot", projectId, key, papers?.length],
    enabled: !!projectId && !!slots && !!papers,
    queryFn: async () => {
      return Promise.all(
        slots!.map(async (s) => {
          const ids = papers!.filter((p) => p.slot_template_id === s.id).map((p) => p.id);
          if (ids.length === 0) return 0;
          const { count, error } = await supabase
            .from("result_evaluations")
            .select("id", { count: "exact", head: true })
            .in("paper_id", ids)
            .eq("status", "evaluated")
            .is("deleted_at", null);
          if (error) throw plainError(error, "We could not count evaluated students.");
          return count ?? 0;
        }),
      );
    },
  });
}
