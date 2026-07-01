import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

export interface WhatsAppTemplate {
  id: string;
  project_id: string;
  template_key: string;
  template_name: string;
  askeva_template_name: string;
  language_code: string;
  template_type: string;
  header_media_url: string | null;
  header_document_filename: string | null;
  body_variables: Array<{ index: number; source: string; customText?: string }>;
  raw_payload_template: any | null;
  is_active: boolean;
  template_category: 'workflow' | 'marketing';
  created_at: string;
  updated_at: string;
}

export const useWhatsAppTemplates = (projectId?: string, category?: 'workflow' | 'marketing') => {
  const [templates, setTemplates] = useState<WhatsAppTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  const fetchTemplates = useCallback(async () => {
    if (!projectId) {
      setTemplates([]);
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      let query = supabase
        .from("whatsapp_templates")
        .select("*")
        .eq("project_id", projectId)
        .order("template_name", { ascending: true });
      if (category) query = query.eq("template_category", category);
      const { data, error } = await query;
      if (error) throw error;
      setTemplates((data as any) || []);
    } catch (e: any) {
      console.error("Error fetching WhatsApp templates:", e);
      toast({ title: "Error", description: "Failed to load WhatsApp templates", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [projectId, category, toast]);

  const createTemplate = async (
    template: Omit<WhatsAppTemplate, "id" | "created_at" | "updated_at">
  ) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Not authenticated");
    const { error } = await supabase
      .from("whatsapp_templates")
      .insert([{ ...template, created_by: user.id } as any]);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
      throw error;
    }
    toast({ title: "Template created" });
    await fetchTemplates();
  };

  const updateTemplate = async (id: string, updates: Partial<WhatsAppTemplate>) => {
    const { error } = await supabase
      .from("whatsapp_templates")
      .update(updates as any)
      .eq("id", id);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
      throw error;
    }
    toast({ title: "Template updated" });
    await fetchTemplates();
  };

  const deleteTemplate = async (id: string) => {
    const { error } = await supabase.from("whatsapp_templates").delete().eq("id", id);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
      throw error;
    }
    toast({ title: "Template deleted" });
    await fetchTemplates();
  };

  useEffect(() => {
    fetchTemplates();
  }, [fetchTemplates]);

  return { templates, loading, fetchTemplates, createTemplate, updateTemplate, deleteTemplate };
};

export const useSendWhatsApp = () => {
  const { toast } = useToast();

  const send = async (params: { schoolId: string; templateKey: string; mobileOverride?: string }) => {
    const { data, error } = await supabase.functions.invoke("send-whatsapp-template", {
      body: params,
    });
    if (error) {
      // FunctionsHttpError discards the response body — pull it out manually.
      let detail = error.message || "Unknown error";
      try {
        const ctx: any = (error as any).context;
        if (ctx && typeof ctx.json === "function") {
          const body = await ctx.json();
          detail = body?.error || body?.message || JSON.stringify(body);
        } else if (ctx && typeof ctx.text === "function") {
          detail = (await ctx.text()) || detail;
        }
      } catch { /* keep detail */ }
      toast({ title: "WhatsApp send failed", description: String(detail).slice(0, 300), variant: "destructive" });
      throw new Error(detail);
    }
    if (data?.success === false) {
      const detail = data.error || data.askeva?.message || "Unknown error";
      toast({
        title: "WhatsApp send failed",
        description: `${String(detail).slice(0, 300)}${data.askevaStatus ? ` (HTTP ${data.askevaStatus})` : ""}`,
        variant: "destructive",
      });
      throw new Error(detail);
    }
    toast({ title: "WhatsApp message sent" });
    return data;
  };

  return { send };
};
