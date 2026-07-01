-- Create communication templates table for project-specific email/WhatsApp templates
CREATE TABLE IF NOT EXISTS public.communication_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES public.olympiad_projects(id) ON DELETE CASCADE,
  template_type TEXT NOT NULL CHECK (template_type IN (
    'registration_confirmation',
    'payment_confirmation',
    'courier_sent',
    'answer_sheet_received',
    'results_sent'
  )),
  template_name TEXT NOT NULL,
  subject TEXT NOT NULL,
  email_body TEXT NOT NULL,
  whatsapp_message TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  parent_template_id UUID REFERENCES public.communication_templates(id) ON DELETE SET NULL,
  created_by UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(project_id, template_type, is_active)
);

-- Create index for faster queries
CREATE INDEX idx_communication_templates_project_type ON public.communication_templates(project_id, template_type);
CREATE INDEX idx_communication_templates_active ON public.communication_templates(is_active) WHERE is_active = true;

-- Enable RLS
ALTER TABLE public.communication_templates ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Managers can view templates"
  ON public.communication_templates
  FOR SELECT
  USING (is_manager_or_superadmin());

CREATE POLICY "Managers can create templates"
  ON public.communication_templates
  FOR INSERT
  WITH CHECK (is_manager_or_superadmin() AND auth.uid() = created_by);

CREATE POLICY "Managers can update templates"
  ON public.communication_templates
  FOR UPDATE
  USING (is_manager_or_superadmin());

CREATE POLICY "Superadmins can delete templates"
  ON public.communication_templates
  FOR DELETE
  USING (is_superadmin(auth.uid()));

-- Add email_sent tracking to communications table
ALTER TABLE public.communications 
ADD COLUMN IF NOT EXISTS template_type TEXT,
ADD COLUMN IF NOT EXISTS email_status TEXT DEFAULT 'pending' CHECK (email_status IN ('pending', 'sent', 'failed', 'bounced'));

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_communication_templates_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Create trigger for updated_at
CREATE TRIGGER update_communication_templates_timestamp
  BEFORE UPDATE ON public.communication_templates
  FOR EACH ROW
  EXECUTE FUNCTION update_communication_templates_updated_at();