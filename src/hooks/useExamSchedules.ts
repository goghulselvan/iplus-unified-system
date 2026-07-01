import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface ExamSchedule {
  id: string;
  school_id: string;
  exam_date: string;
  subjects: string[];
  notes: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  project_id: string | null;
}

export interface ExamScheduleInput {
  school_id: string;
  exam_date: string;
  subjects: string[];
  notes?: string;
  project_id?: string;
}

export const useExamSchedules = (schoolId: string) => {
  const queryClient = useQueryClient();

  const { data: examSchedules = [], isLoading, refetch } = useQuery({
    queryKey: ["exam-schedules", schoolId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("exam_schedules")
        .select("*")
        .eq("school_id", schoolId)
        .order("exam_date", { ascending: true });

      if (error) throw error;
      
      // Sort by date in ascending order (earliest first)
      const sorted = (data as ExamSchedule[]).sort(
        (a, b) => new Date(a.exam_date).getTime() - new Date(b.exam_date).getTime()
      );
      
      return sorted;
    },
    enabled: !!schoolId,
  });

  const addExamDate = useMutation({
    mutationFn: async (input: ExamScheduleInput) => {
      // Check max 10 dates limit on client side
      if (examSchedules.length >= 10) {
        throw new Error("Maximum 10 exam dates allowed per school");
      }

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { data, error } = await supabase
        .from("exam_schedules")
        .insert({
          ...input,
          created_by: user.id,
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["exam-schedules", schoolId] });
      toast.success("Exam date added successfully");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to add exam date");
    },
  });

  const updateExamDate = useMutation({
    mutationFn: async ({ id, ...input }: ExamScheduleInput & { id: string }) => {
      const { data, error } = await supabase
        .from("exam_schedules")
        .update(input)
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["exam-schedules", schoolId] });
      toast.success("Exam date updated successfully");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to update exam date");
    },
  });

  const deleteExamDate = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("exam_schedules")
        .delete()
        .eq("id", id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["exam-schedules", schoolId] });
      toast.success("Exam date deleted successfully");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to delete exam date");
    },
  });

  return {
    examSchedules,
    isLoading,
    refetch,
    addExamDate,
    updateExamDate,
    deleteExamDate,
  };
};
