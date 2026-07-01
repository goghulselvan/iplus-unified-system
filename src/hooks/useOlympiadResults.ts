import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { olympiadProxy } from "@/lib/olympiadProxy";
import { toast } from "@/hooks/use-toast";

const STALE_5M = 5 * 60 * 1000;

// Types matching source schema (subset we need)
export interface SourceStudent {
  id: string;
  registration_number: string;
  student_name: string;
  ss_no?: string | null;
  school_id?: string | null;
  class_code?: string | null;
  subject_code?: number | null;
}

export interface SourceSchool {
  id: string;
  ss_no: string;
  name: string;
}

export interface SourceAward {
  id: string;
  student_id: string;
  class_code: string;
  subject_code: number;
  award_type: string;
  is_manual?: boolean;
  total_score?: number;
  max_score?: number;
  percentage?: number;
}

export interface SourceReport {
  id: string;
  student_id: string;
  question_paper_id: string;
  ai_feedback?: string;
  motivational_message?: string;
  strengths?: string;
  focus_areas?: string;
  short_term_goals?: string;
  quick_tips?: string;
  updated_at?: string;
}

export interface SchoolStat {
  school_id: string;
  school_name: string;
  ss_no: string;
  evaluated_count: number;
  avg_percentage: number;
}

// ---------- READ HOOKS ----------

/** Sanity-check: is the source reachable? */
export const useOlympiadHealth = () =>
  useQuery({
    queryKey: ["olympiad", "health"],
    queryFn: async () => {
      const res = await olympiadProxy.rpc<number>({
        fn: "get_evaluated_students_count",
        args: {},
      });
      return res.data;
    },
    staleTime: STALE_5M,
    retry: 1,
  });

/** All schools from source (paged) */
export const useSourceSchools = (limit = 1000) =>
  useQuery({
    queryKey: ["olympiad", "schools", limit],
    queryFn: async () => {
      const res = await olympiadProxy.select<SourceSchool>({
        table: "schools",
        columns: "id,ss_no,name",
        order: { column: "name", ascending: true },
        limit,
      });
      return res.data;
    },
    staleTime: STALE_5M,
  });

/** Per-school KPI rollup using source RPCs */
export const useSchoolStatistics = () =>
  useQuery({
    queryKey: ["olympiad", "school-statistics"],
    queryFn: async () => {
      const res = await olympiadProxy.rpc<SchoolStat[]>({
        fn: "get_school_statistics",
        args: {},
      });
      return res.data ?? [];
    },
    staleTime: STALE_5M,
  });

/** Per (class, subject) stats for one school */
export const useSchoolClassSubjectStats = (sourceSchoolId?: string) =>
  useQuery({
    queryKey: ["olympiad", "school-class-subject", sourceSchoolId],
    queryFn: async () => {
      const res = await olympiadProxy.rpc<unknown[]>({
        fn: "get_school_class_subject_stats",
        args: { p_school_id: sourceSchoolId },
      });
      return res.data ?? [];
    },
    enabled: !!sourceSchoolId,
    staleTime: STALE_5M,
  });

/** Resolve source school by ss_no (CRM ss_no === source ss_no) */
export const useSourceSchoolBySsNo = (ssNo?: string | number) =>
  useQuery({
    queryKey: ["olympiad", "school-by-ssno", ssNo],
    queryFn: async () => {
      if (ssNo === undefined || ssNo === null) return null;
      const res = await olympiadProxy.select<SourceSchool>({
        table: "schools",
        columns: "id,ss_no,name",
        filters: { ss_no: String(ssNo) },
        limit: 1,
      });
      return res.data?.[0] ?? null;
    },
    enabled: ssNo !== undefined && ssNo !== null,
    staleTime: STALE_5M,
  });

/** Students for a source school */
export const useSourceStudentsBySchool = (sourceSchoolId?: string) =>
  useQuery({
    queryKey: ["olympiad", "students-by-school", sourceSchoolId],
    queryFn: async () => {
      const res = await olympiadProxy.select<SourceStudent>({
        table: "students",
        columns:
          "id,registration_number,student_name,ss_no,school_id,class_code,subject_code",
        filters: { school_id: sourceSchoolId! },
        order: { column: "registration_number", ascending: true },
        limit: 1000,
      });
      return res.data ?? [];
    },
    enabled: !!sourceSchoolId,
    staleTime: STALE_5M,
  });

/** Lookup a student by 14-digit registration number */
export const useSourceStudentByRegNumber = (regNumber?: string) =>
  useQuery({
    queryKey: ["olympiad", "student-by-reg", regNumber],
    queryFn: async () => {
      if (!regNumber) return null;
      const res = await olympiadProxy.select<SourceStudent>({
        table: "students",
        columns:
          "id,registration_number,student_name,ss_no,school_id,class_code,subject_code",
        filters: { registration_number: regNumber },
        limit: 1,
      });
      return res.data?.[0] ?? null;
    },
    enabled: !!regNumber,
    staleTime: STALE_5M,
  });

/** Awards for a school (joins via student.school_id) */
export const useSchoolAwards = (sourceSchoolId?: string) =>
  useQuery({
    queryKey: ["olympiad", "awards", sourceSchoolId],
    queryFn: async () => {
      if (!sourceSchoolId) return [] as SourceAward[];
      // First get students, then their awards (no nested filter on source)
      const studentsRes = await olympiadProxy.select<{ id: string }>({
        table: "students",
        columns: "id",
        filters: { school_id: sourceSchoolId },
        limit: 1000,
      });
      const ids = (studentsRes.data ?? []).map((s) => s.id);
      if (ids.length === 0) return [];
      // Batch in 250s per source guidance
      const out: SourceAward[] = [];
      for (let i = 0; i < ids.length; i += 250) {
        const chunk = ids.slice(i, i + 250);
        const r = await olympiadProxy.select<SourceAward>({
          table: "awards",
          columns:
            "id,student_id,class_code,subject_code,award_type,is_manual,total_score,max_score,percentage",
          filters: { student_id: { op: "in", value: chunk } },
          limit: 1000,
        });
        out.push(...(r.data ?? []));
      }
      return out;
    },
    enabled: !!sourceSchoolId,
    staleTime: STALE_5M,
  });

/** Report for one student */
export const useStudentReport = (studentId?: string) =>
  useQuery({
    queryKey: ["olympiad", "report", studentId],
    queryFn: async () => {
      if (!studentId) return null;
      const res = await olympiadProxy.select<SourceReport>({
        table: "student_reports",
        columns: "*",
        filters: { student_id: studentId },
        limit: 1,
      });
      return res.data?.[0] ?? null;
    },
    enabled: !!studentId,
    staleTime: STALE_5M,
  });

/** Rankings for a (class, subject) */
export const useRankings = (classCode?: string, subjectCode?: number) =>
  useQuery({
    queryKey: ["olympiad", "rankings", classCode, subjectCode],
    queryFn: async () => {
      const res = await olympiadProxy.rpc<unknown[]>({
        fn: "get_rankings",
        args: { p_class_code: classCode, p_subject_code: subjectCode },
      });
      return res.data ?? [];
    },
    enabled: !!classCode && subjectCode !== undefined,
    staleTime: STALE_5M,
  });

// ---------- WRITE HOOKS (superadmin only) ----------

/** Update student name on the source */
export const useUpdateSourceStudent = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (
      input: { studentId: string; values: Partial<SourceStudent> },
    ) => {
      const res = await olympiadProxy.update({
        table: "students",
        filters: { id: input.studentId },
        values: input.values,
      });
      return res.data;
    },
    onSuccess: (_d, vars) => {
      toast({ title: "Student updated", description: "Source record saved." });
      qc.invalidateQueries({ queryKey: ["olympiad", "students-by-school"] });
      qc.invalidateQueries({
        queryKey: ["olympiad", "student-by-reg"],
      });
      qc.invalidateQueries({ queryKey: ["olympiad", "report", vars.studentId] });
    },
    onError: (e: Error) =>
      toast({
        title: "Update failed",
        description: e.message,
        variant: "destructive",
      }),
  });
};

/** Insert / upsert an award row */
export const useUpsertAward = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (row: Partial<SourceAward> & { student_id: string }) => {
      const res = await olympiadProxy.insert({
        table: "awards",
        rows: [{ ...row, is_manual: true }],
      });
      return res.data;
    },
    onSuccess: () => {
      toast({ title: "Award saved" });
      qc.invalidateQueries({ queryKey: ["olympiad", "awards"] });
    },
    onError: (e: Error) =>
      toast({
        title: "Award save failed",
        description: e.message,
        variant: "destructive",
      }),
  });
};

/** Delete an award row */
export const useDeleteAward = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (awardId: string) => {
      const res = await olympiadProxy.delete({
        table: "awards",
        filters: { id: awardId },
      });
      return res.data;
    },
    onSuccess: () => {
      toast({ title: "Award removed" });
      qc.invalidateQueries({ queryKey: ["olympiad", "awards"] });
    },
    onError: (e: Error) =>
      toast({
        title: "Delete failed",
        description: e.message,
        variant: "destructive",
      }),
  });
};

/** Trigger a fresh AI feedback batch for a school by inserting an analysis_jobs row */
export const useStartAnalysisJob = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { school_id?: string; class_code?: string; subject_code?: number }) => {
      const res = await olympiadProxy.insert({
        table: "analysis_jobs",
        rows: [{
          status: "pending",
          ...input,
        }],
      });
      return res.data;
    },
    onSuccess: () => {
      toast({
        title: "Analysis job queued",
        description: "Source system will process in background.",
      });
      qc.invalidateQueries({ queryKey: ["olympiad", "report"] });
    },
    onError: (e: Error) =>
      toast({
        title: "Failed to start job",
        description: e.message,
        variant: "destructive",
      }),
  });
};
