import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

export interface RegistrationFormatConfig {
  id: string;
  project_id: string | null;
  format_name: string;
  component_order: string[];
  separator: string;
  is_active: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface FormatComponentInfo {
  key: string;
  label: string;
  description: string;
  example: string;
}

export const FORMAT_COMPONENTS: FormatComponentInfo[] = [
  {
    key: "subject",
    label: "Subject Code",
    description: "1-digit code for the olympiad subject (EPO=1, MPO=2, SPO=3, GKSSPO=4, LRPO=5, KidsPO=9)",
    example: "2 (MPO)"
  },
  {
    key: "state",
    label: "State Code",
    description: "2-digit code for the state — part of the combined School Code",
    example: "33 (Tamil Nadu)"
  },
  {
    key: "district",
    label: "District Code",
    description: "2-digit code for the district within the state — part of the combined School Code",
    example: "38 (Kancheepuram)"
  },
  {
    key: "school",
    label: "School Sequence",
    description: "2-digit sequential number for the school within the district — part of the combined School Code",
    example: "01 (First school)"
  },
  {
    key: "class",
    label: "Class Code",
    description: "2-digit code for the student's class (01–08, LKG=14, UKG=15)",
    example: "05 (Class 5)"
  },
  {
    key: "student",
    label: "Roll Number",
    description: "3-digit sequential roll number for the student within the school+class",
    example: "001 (First student)"
  }
];

export const useRegistrationFormatConfig = (projectId?: string) => {
  return useQuery({
    queryKey: ["registrationFormatConfig", projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("registration_format_config")
        .select("*")
        .eq("project_id", projectId)
        .eq("is_active", true)
        .maybeSingle();

      if (error) throw error;
      return data as RegistrationFormatConfig | null;
    },
    enabled: !!projectId,
  });
};

export const useUpdateRegistrationFormat = () => {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({
      projectId,
      formatName,
      componentOrder,
      separator,
    }: {
      projectId: string;
      formatName: string;
      componentOrder: string[];
      separator: string;
    }) => {
      // First, deactivate existing configurations
      await supabase
        .from("registration_format_config")
        .update({ is_active: false })
        .eq("project_id", projectId);

      // Create new active configuration
      const { data, error } = await supabase
        .from("registration_format_config")
        .insert({
          project_id: projectId,
          format_name: formatName,
          component_order: componentOrder,
          separator: separator,
          is_active: true,
          created_by: (await supabase.auth.getUser()).data.user?.id!,
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["registrationFormatConfig", variables.projectId],
      });
      // Clear format cache when format changes
      import("@/utils/registrationNumberFormatter").then(({ clearFormatCache }) => {
        clearFormatCache();
      });
      toast({
        title: "Format Updated",
        description: "Registration number display format has been successfully updated.",
      });
    },
    onError: (error) => {
      toast({
        title: "Update Failed",
        description: "Failed to update registration format: " + error.message,
        variant: "destructive",
      });
    },
  });
};

// Re-export the optimized formatter
export { formatRegistrationNumberDisplay } from "@/utils/registrationNumberFormatter";