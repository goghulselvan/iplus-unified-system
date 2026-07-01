-- Cache table mapping CRM entities to source olympiad system entities
CREATE TABLE public.olympiad_source_link (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  link_type TEXT NOT NULL CHECK (link_type IN ('school', 'student')),
  crm_school_id UUID REFERENCES public.schools(id) ON DELETE CASCADE,
  crm_registration_id UUID REFERENCES public.student_registrations(id) ON DELETE CASCADE,
  source_school_id UUID,
  source_student_id UUID,
  source_ss_no TEXT,
  source_registration_number TEXT,
  last_synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_olympiad_link_crm_school ON public.olympiad_source_link(crm_school_id) WHERE crm_school_id IS NOT NULL;
CREATE INDEX idx_olympiad_link_crm_reg ON public.olympiad_source_link(crm_registration_id) WHERE crm_registration_id IS NOT NULL;
CREATE INDEX idx_olympiad_link_src_reg ON public.olympiad_source_link(source_registration_number) WHERE source_registration_number IS NOT NULL;
CREATE INDEX idx_olympiad_link_src_ss ON public.olympiad_source_link(source_ss_no) WHERE source_ss_no IS NOT NULL;

ALTER TABLE public.olympiad_source_link ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Managers can view olympiad source links"
  ON public.olympiad_source_link FOR SELECT
  USING (is_manager_or_superadmin());

CREATE POLICY "Managers can insert olympiad source links"
  ON public.olympiad_source_link FOR INSERT
  WITH CHECK (is_manager_or_superadmin());

CREATE POLICY "Managers can update olympiad source links"
  ON public.olympiad_source_link FOR UPDATE
  USING (is_manager_or_superadmin());

CREATE POLICY "Superadmins can delete olympiad source links"
  ON public.olympiad_source_link FOR DELETE
  USING (is_superadmin(auth.uid()));

CREATE TRIGGER trg_olympiad_source_link_updated_at
  BEFORE UPDATE ON public.olympiad_source_link
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();