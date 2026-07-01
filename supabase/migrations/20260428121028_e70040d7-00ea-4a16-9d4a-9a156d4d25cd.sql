CREATE TABLE public.whatsapp_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL,
  template_key text NOT NULL,
  template_name text NOT NULL,
  askeva_template_name text NOT NULL,
  language_code text NOT NULL DEFAULT 'en',
  template_type text NOT NULL,
  header_media_url text,
  header_document_filename text,
  body_variables jsonb NOT NULL DEFAULT '[]'::jsonb,
  raw_payload_template jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT whatsapp_templates_project_key_unique UNIQUE (project_id, template_key),
  CONSTRAINT whatsapp_templates_type_check CHECK (template_type IN (
    'text','text_with_vars','image','image_with_vars',
    'video','video_with_vars','document','document_with_vars',
    'authentication','carousel'
  ))
);

CREATE INDEX idx_whatsapp_templates_project ON public.whatsapp_templates(project_id);
CREATE INDEX idx_whatsapp_templates_active ON public.whatsapp_templates(project_id, is_active);

ALTER TABLE public.whatsapp_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Managers can view whatsapp_templates"
  ON public.whatsapp_templates FOR SELECT
  USING (is_manager_or_superadmin());

CREATE POLICY "Managers can create whatsapp_templates"
  ON public.whatsapp_templates FOR INSERT
  WITH CHECK (is_manager_or_superadmin() AND auth.uid() = created_by);

CREATE POLICY "Managers can update whatsapp_templates"
  ON public.whatsapp_templates FOR UPDATE
  USING (is_manager_or_superadmin());

CREATE POLICY "Superadmins can delete whatsapp_templates"
  ON public.whatsapp_templates FOR DELETE
  USING (is_superadmin(auth.uid()));

CREATE TRIGGER update_whatsapp_templates_updated_at
  BEFORE UPDATE ON public.whatsapp_templates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();