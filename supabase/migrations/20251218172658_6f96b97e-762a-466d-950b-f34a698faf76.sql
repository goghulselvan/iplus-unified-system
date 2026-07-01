-- =====================================================
-- SCHOOL PROJECT WORKFLOW TABLE
-- Stores project-specific workflow status for each school
-- This allows historical data preservation per project
-- =====================================================

-- Create the school_project_workflow table
CREATE TABLE public.school_project_workflow (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  school_id UUID NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.olympiad_projects(id) ON DELETE CASCADE,
  
  -- Workflow Status Fields (per project)
  contacted contacted_status DEFAULT 'No',
  registration_interest interest_status DEFAULT NULL,
  registration_interest_comment TEXT DEFAULT NULL,
  consent_form_requested consent_status DEFAULT 'No',
  consent_form_comment TEXT DEFAULT NULL,
  consent_form_sent TEXT DEFAULT 'Not Sent',
  registration_status registration_status DEFAULT 'Pending',
  name_list_status name_list_status DEFAULT 'Pending',
  brochure_delivery_status brochure_delivery_status DEFAULT 'Physical Only',
  courier_status courier_status DEFAULT 'Sent',
  question_paper_sent question_paper_status DEFAULT 'Not Sent',
  answer_sheet_status answer_sheet_status DEFAULT 'Waiting',
  result_status result_status DEFAULT 'Not Sent',
  
  -- Payment Fields (per project)
  payment_status payment_status DEFAULT 'Pending',
  payment_date DATE DEFAULT NULL,
  payment_amount NUMERIC DEFAULT NULL,
  payment_mode TEXT DEFAULT NULL,
  payment_received NUMERIC DEFAULT 0,
  expected_amount NUMERIC DEFAULT 0,
  outstanding_balance NUMERIC DEFAULT NULL,
  
  -- Rate configuration (per project, inherits from school initially)
  per_entry_rate NUMERIC DEFAULT 150,
  concession_per_entry NUMERIC DEFAULT 0,
  effective_rate_per_entry NUMERIC DEFAULT NULL,
  
  -- Participant count for this project
  total_participants INTEGER DEFAULT NULL,
  
  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  
  -- Ensure one workflow record per school per project
  UNIQUE(school_id, project_id)
);

-- Create indexes for performance
CREATE INDEX idx_school_project_workflow_school ON public.school_project_workflow(school_id);
CREATE INDEX idx_school_project_workflow_project ON public.school_project_workflow(project_id);
CREATE INDEX idx_school_project_workflow_composite ON public.school_project_workflow(school_id, project_id);

-- Enable RLS
ALTER TABLE public.school_project_workflow ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Managers can view school project workflow"
ON public.school_project_workflow
FOR SELECT
USING (is_manager_or_superadmin());

CREATE POLICY "Managers can update school project workflow"
ON public.school_project_workflow
FOR UPDATE
USING (is_manager_or_superadmin());

CREATE POLICY "System can insert school project workflow"
ON public.school_project_workflow
FOR INSERT
WITH CHECK (is_manager_or_superadmin());

CREATE POLICY "Superadmins can delete school project workflow"
ON public.school_project_workflow
FOR DELETE
USING (is_superadmin(auth.uid()));

-- Trigger for updated_at
CREATE TRIGGER update_school_project_workflow_updated_at
  BEFORE UPDATE ON public.school_project_workflow
  FOR EACH ROW
  EXECUTE FUNCTION public.update_communication_templates_updated_at();

-- =====================================================
-- FUNCTION: Initialize workflow for a new project
-- Creates fresh workflow records for ALL schools
-- =====================================================
CREATE OR REPLACE FUNCTION public.initialize_project_workflow(p_project_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  inserted_count INTEGER;
BEGIN
  -- Insert workflow records for all schools that don't have one for this project
  INSERT INTO public.school_project_workflow (
    school_id,
    project_id,
    per_entry_rate,
    concession_per_entry
  )
  SELECT 
    s.id,
    p_project_id,
    COALESCE(s.per_entry_rate, 150),
    COALESCE(s.concession_per_entry, 0)
  FROM public.schools s
  WHERE NOT EXISTS (
    SELECT 1 FROM public.school_project_workflow spw 
    WHERE spw.school_id = s.id AND spw.project_id = p_project_id
  );
  
  GET DIAGNOSTICS inserted_count = ROW_COUNT;
  
  -- Log the initialization
  PERFORM public.log_security_action(
    'PROJECT_WORKFLOW_INITIALIZED',
    'school_project_workflow',
    p_project_id,
    NULL,
    jsonb_build_object(
      'project_id', p_project_id,
      'schools_initialized', inserted_count
    )
  );
  
  RETURN inserted_count;
END;
$$;

-- =====================================================
-- FUNCTION: Migrate existing data to workflow table
-- Copies current schools workflow data to active project
-- =====================================================
CREATE OR REPLACE FUNCTION public.migrate_current_workflow_to_table()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  active_project_id UUID;
  migrated_count INTEGER;
BEGIN
  -- Get active project
  SELECT id INTO active_project_id
  FROM public.olympiad_projects
  WHERE is_active = true
  LIMIT 1;
  
  IF active_project_id IS NULL THEN
    RAISE NOTICE 'No active project found, skipping migration';
    RETURN 0;
  END IF;
  
  -- Insert/update workflow records with current school data
  INSERT INTO public.school_project_workflow (
    school_id,
    project_id,
    contacted,
    registration_interest,
    registration_interest_comment,
    consent_form_requested,
    consent_form_comment,
    consent_form_sent,
    registration_status,
    name_list_status,
    brochure_delivery_status,
    courier_status,
    question_paper_sent,
    answer_sheet_status,
    result_status,
    payment_status,
    payment_date,
    payment_amount,
    payment_mode,
    payment_received,
    expected_amount,
    outstanding_balance,
    per_entry_rate,
    concession_per_entry,
    effective_rate_per_entry,
    total_participants
  )
  SELECT 
    s.id,
    active_project_id,
    s.contacted,
    s.registration_interest,
    s.registration_interest_comment,
    s.consent_form_requested,
    s.consent_form_comment,
    s.consent_form_sent,
    s.registration_status,
    s.name_list_status,
    s.brochure_delivery_status,
    s.courier_status,
    s.question_paper_sent,
    s.answer_sheet_status,
    s.result_status,
    s.payment_status,
    s.payment_date,
    s.payment_amount,
    s.payment_mode,
    s.payment_received,
    s.expected_amount,
    s.outstanding_balance,
    s.per_entry_rate,
    s.concession_per_entry,
    s.effective_rate_per_entry,
    s.total_participants
  FROM public.schools s
  ON CONFLICT (school_id, project_id) 
  DO UPDATE SET
    contacted = EXCLUDED.contacted,
    registration_interest = EXCLUDED.registration_interest,
    registration_interest_comment = EXCLUDED.registration_interest_comment,
    consent_form_requested = EXCLUDED.consent_form_requested,
    consent_form_comment = EXCLUDED.consent_form_comment,
    consent_form_sent = EXCLUDED.consent_form_sent,
    registration_status = EXCLUDED.registration_status,
    name_list_status = EXCLUDED.name_list_status,
    brochure_delivery_status = EXCLUDED.brochure_delivery_status,
    courier_status = EXCLUDED.courier_status,
    question_paper_sent = EXCLUDED.question_paper_sent,
    answer_sheet_status = EXCLUDED.answer_sheet_status,
    result_status = EXCLUDED.result_status,
    payment_status = EXCLUDED.payment_status,
    payment_date = EXCLUDED.payment_date,
    payment_amount = EXCLUDED.payment_amount,
    payment_mode = EXCLUDED.payment_mode,
    payment_received = EXCLUDED.payment_received,
    expected_amount = EXCLUDED.expected_amount,
    outstanding_balance = EXCLUDED.outstanding_balance,
    per_entry_rate = EXCLUDED.per_entry_rate,
    concession_per_entry = EXCLUDED.concession_per_entry,
    effective_rate_per_entry = EXCLUDED.effective_rate_per_entry,
    total_participants = EXCLUDED.total_participants,
    updated_at = now();
  
  GET DIAGNOSTICS migrated_count = ROW_COUNT;
  
  RETURN migrated_count;
END;
$$;

-- Run migration for current active project
SELECT public.migrate_current_workflow_to_table();