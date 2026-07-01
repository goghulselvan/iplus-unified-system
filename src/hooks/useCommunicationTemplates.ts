import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

export interface CommunicationTemplate {
  id: string;
  project_id: string;
  template_type: string;
  template_name: string;
  subject: string;
  email_body: string;
  whatsapp_message?: string;
  is_active: boolean;
  template_category: 'workflow' | 'marketing';
  created_at: string;
  updated_at: string;
}

export const useCommunicationTemplates = (projectId?: string, category?: 'workflow' | 'marketing') => {
  const [templates, setTemplates] = useState<CommunicationTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  const fetchTemplates = async () => {
    try {
      setLoading(true);
      let query = supabase
        .from("communication_templates")
        .select("*")
        .order("template_type", { ascending: true });

      if (projectId) query = query.eq("project_id", projectId);
      if (category)   query = query.eq("template_category", category);

      const { data, error } = await query;

      if (error) throw error;
      setTemplates((data || []) as CommunicationTemplate[]);
    } catch (error: any) {
      console.error("Error fetching templates:", error);
      toast({
        title: "Error",
        description: "Failed to fetch communication templates",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  // Always restricts to workflow category for automated sends
  const getActiveTemplate = async (projectId: string, templateType: string) => {
    try {
      const { data, error } = await supabase
        .from("communication_templates")
        .select("*")
        .eq("project_id", projectId)
        .eq("template_type", templateType)
        .eq("template_category", "workflow")
        .eq("is_active", true)
        .single();

      if (error) throw error;
      return data as CommunicationTemplate;
    } catch (error: any) {
      console.error("Error fetching active template:", error);
      return null;
    }
  };

  const sendTemplateEmail = async (schoolId: string, templateType: string, emailOverride?: string) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("User not authenticated");

      const { data, error } = await supabase.functions.invoke("send-template-email", {
        body: {
          schoolId,
          templateType,
          userId: user.id,
          emailOverride, // Pass the email override if provided
        },
      });

      if (error) throw error;

      toast({
        title: "Success",
        description: "Email sent successfully",
      });

      return data;
    } catch (error: any) {
      console.error("Error sending template email:", error);
      toast({
        title: "Error",
        description: error.message || "Failed to send email",
        variant: "destructive",
      });
      throw error;
    }
  };

  const createTemplate = async (template: Omit<CommunicationTemplate, 'id' | 'created_at' | 'updated_at' | 'created_by'>) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("User not authenticated");

      const { data, error } = await supabase
        .from("communication_templates")
        .insert([{ ...template, created_by: user.id }])
        .select()
        .single();

      if (error) throw error;

      toast({
        title: "Success",
        description: "Template created successfully",
      });

      await fetchTemplates();
      return data;
    } catch (error: any) {
      console.error("Error creating template:", error);
      toast({
        title: "Error",
        description: error.message || "Failed to create template",
        variant: "destructive",
      });
      throw error;
    }
  };

  const updateTemplate = async (id: string, updates: Partial<CommunicationTemplate>) => {
    try {
      const { data, error } = await supabase
        .from("communication_templates")
        .update(updates)
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;

      toast({
        title: "Success",
        description: "Template updated successfully",
      });

      await fetchTemplates();
      return data;
    } catch (error: any) {
      console.error("Error updating template:", error);
      toast({
        title: "Error",
        description: error.message || "Failed to update template",
        variant: "destructive",
      });
      throw error;
    }
  };

  const deleteTemplate = async (id: string) => {
    try {
      const { error } = await supabase
        .from("communication_templates")
        .delete()
        .eq("id", id);

      if (error) throw error;

      toast({
        title: "Success",
        description: "Template deleted successfully",
      });

      await fetchTemplates();
    } catch (error: any) {
      console.error("Error deleting template:", error);
      toast({
        title: "Error",
        description: error.message || "Failed to delete template",
        variant: "destructive",
      });
      throw error;
    }
  };

  useEffect(() => {
    fetchTemplates();
  }, [projectId, category]);

  return {
    templates,
    loading,
    fetchTemplates,
    getActiveTemplate,
    sendTemplateEmail,
    createTemplate,
    updateTemplate,
    deleteTemplate,
  };
};
