import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useActiveProject } from "./useOlympiadProjects";

export interface ExamDateSummary {
  school_id: string;
  ss_no: number;
  school_name: string;
  exam_dates: Array<{
    date: string;
    subjects: string[];
  }>;
  earliest_date: string;
}

export const useExamDatesSummary = () => {
  const { data: activeProject } = useActiveProject();

  return useQuery({
    queryKey: ["exam-dates-summary", activeProject?.id],
    queryFn: async () => {
      if (!activeProject?.id) return [];

      const { data, error } = await supabase
        .from("exam_schedules")
        .select(`
          id,
          school_id,
          exam_date,
          subjects,
          schools!inner (
            id,
            ss_no,
            school_name
          )
        `)
        .eq("project_id", activeProject.id)
        .order("exam_date", { ascending: true });

      if (error) throw error;

      // Group exam schedules by school
      const schoolsMap = new Map<string, ExamDateSummary>();

      data?.forEach((schedule) => {
        const school = schedule.schools as any;
        const schoolId = schedule.school_id;

        if (!schoolsMap.has(schoolId)) {
          schoolsMap.set(schoolId, {
            school_id: schoolId,
            ss_no: school.ss_no,
            school_name: school.school_name,
            exam_dates: [],
            earliest_date: schedule.exam_date,
          });
        }

        const schoolData = schoolsMap.get(schoolId)!;
        schoolData.exam_dates.push({
          date: schedule.exam_date,
          subjects: schedule.subjects,
        });

        // Update earliest date if needed
        if (new Date(schedule.exam_date) < new Date(schoolData.earliest_date)) {
          schoolData.earliest_date = schedule.exam_date;
        }
      });

      return Array.from(schoolsMap.values()).sort(
        (a, b) => new Date(a.earliest_date).getTime() - new Date(b.earliest_date).getTime()
      );
    },
    enabled: !!activeProject?.id,
  });
};
