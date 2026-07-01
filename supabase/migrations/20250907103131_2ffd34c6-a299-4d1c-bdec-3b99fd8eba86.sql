-- Create Olympiad Management System with Enhanced Security

-- Create olympiad_projects table
CREATE TABLE public.olympiad_projects (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_name TEXT NOT NULL,
  project_year INTEGER NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT false,
  created_by UUID NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(project_year),
  UNIQUE(project_name)
);

-- Create olympiad_subjects table
CREATE TABLE public.olympiad_subjects (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.olympiad_projects(id) ON DELETE CASCADE,
  subject_name TEXT NOT NULL,
  subject_code TEXT NOT NULL,
  applicable_classes TEXT[] NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(project_id, subject_code)
);

-- Create student_registrations table with enhanced security
CREATE TABLE public.student_registrations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.olympiad_projects(id) ON DELETE CASCADE,
  school_id UUID NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  subject_id UUID NOT NULL REFERENCES public.olympiad_subjects(id) ON DELETE CASCADE,
  student_name TEXT NOT NULL,
  student_class TEXT NOT NULL,
  roll_number TEXT,
  registration_number TEXT,
  created_by UUID NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  -- Ensure unique registration per student per subject
  UNIQUE(project_id, school_id, subject_id, student_name, student_class)
);

-- Create olympiad_results table
CREATE TABLE public.olympiad_results (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  registration_id UUID NOT NULL REFERENCES public.student_registrations(id) ON DELETE CASCADE,
  marks_obtained INTEGER,
  total_marks INTEGER NOT NULL DEFAULT 100,
  percentage DECIMAL(5,2),
  grade TEXT,
  rank_in_school INTEGER,
  rank_in_district INTEGER,
  rank_overall INTEGER,
  certificate_number TEXT,
  result_status TEXT NOT NULL DEFAULT 'pending',
  created_by UUID NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(registration_id)
);

-- Create security audit log table
CREATE TABLE public.security_audit_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  action TEXT NOT NULL,
  table_name TEXT NOT NULL,
  record_id UUID,
  old_values JSONB,
  new_values JSONB,
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Add project context to existing tables
ALTER TABLE public.schools ADD COLUMN current_project_id UUID REFERENCES public.olympiad_projects(id);
ALTER TABLE public.communications ADD COLUMN project_id UUID REFERENCES public.olympiad_projects(id);
ALTER TABLE public.follow_ups ADD COLUMN project_id UUID REFERENCES public.olympiad_projects(id);
ALTER TABLE public.activity_logs ADD COLUMN project_id UUID REFERENCES public.olympiad_projects(id);
ALTER TABLE public.workflow_history ADD COLUMN project_id UUID REFERENCES public.olympiad_projects(id);

-- Enable RLS on all new tables
ALTER TABLE public.olympiad_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.olympiad_subjects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_registrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.olympiad_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.security_audit_logs ENABLE ROW LEVEL SECURITY;

-- Create enhanced security functions
CREATE OR REPLACE FUNCTION public.is_superadmin_with_ip_check()
RETURNS BOOLEAN AS $$
BEGIN
  -- Check if user is superadmin
  IF NOT is_superadmin(auth.uid()) THEN
    RETURN false;
  END IF;
  
  -- Add IP whitelisting logic here if needed
  -- For now, just return superadmin status
  RETURN true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public;

-- Create audit logging function
CREATE OR REPLACE FUNCTION public.log_security_action(
  p_action TEXT,
  p_table_name TEXT,
  p_record_id UUID DEFAULT NULL,
  p_old_values JSONB DEFAULT NULL,
  p_new_values JSONB DEFAULT NULL
)
RETURNS VOID AS $$
BEGIN
  INSERT INTO public.security_audit_logs (
    user_id, action, table_name, record_id, old_values, new_values, ip_address
  ) VALUES (
    auth.uid(), p_action, p_table_name, p_record_id, p_old_values, p_new_values, 
    inet_client_addr()
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- RLS Policies for olympiad_projects
CREATE POLICY "Managers can view olympiad projects" 
ON public.olympiad_projects FOR SELECT 
USING (is_manager_or_superadmin());

CREATE POLICY "Superadmins can manage olympiad projects" 
ON public.olympiad_projects FOR ALL 
USING (is_superadmin_with_ip_check())
WITH CHECK (is_superadmin_with_ip_check());

-- RLS Policies for olympiad_subjects
CREATE POLICY "Managers can view olympiad subjects" 
ON public.olympiad_subjects FOR SELECT 
USING (is_manager_or_superadmin());

CREATE POLICY "Superadmins can manage olympiad subjects" 
ON public.olympiad_subjects FOR ALL 
USING (is_superadmin_with_ip_check())
WITH CHECK (is_superadmin_with_ip_check());

-- RLS Policies for student_registrations with enhanced security
CREATE POLICY "Managers can view student registrations" 
ON public.student_registrations FOR SELECT 
USING (is_manager_or_superadmin());

CREATE POLICY "Managers can insert student registrations" 
ON public.student_registrations FOR INSERT 
WITH CHECK (is_manager_or_superadmin() AND auth.uid() = created_by);

CREATE POLICY "Managers can update student registrations" 
ON public.student_registrations FOR UPDATE 
USING (is_manager_or_superadmin());

CREATE POLICY "Superadmins can delete student registrations" 
ON public.student_registrations FOR DELETE 
USING (is_superadmin_with_ip_check());

-- RLS Policies for olympiad_results
CREATE POLICY "Managers can view olympiad results" 
ON public.olympiad_results FOR SELECT 
USING (is_manager_or_superadmin());

CREATE POLICY "Managers can manage olympiad results" 
ON public.olympiad_results FOR ALL 
USING (is_manager_or_superadmin())
WITH CHECK (is_manager_or_superadmin() AND auth.uid() = created_by);

-- RLS Policies for security audit logs
CREATE POLICY "Superadmins can view security audit logs" 
ON public.security_audit_logs FOR SELECT 
USING (is_superadmin(auth.uid()));

CREATE POLICY "System can insert security audit logs" 
ON public.security_audit_logs FOR INSERT 
WITH CHECK (true);

-- Create triggers for updated_at columns
CREATE TRIGGER update_olympiad_projects_updated_at
  BEFORE UPDATE ON public.olympiad_projects
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_olympiad_subjects_updated_at
  BEFORE UPDATE ON public.olympiad_subjects
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_student_registrations_updated_at
  BEFORE UPDATE ON public.student_registrations
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_olympiad_results_updated_at
  BEFORE UPDATE ON public.olympiad_results
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Create security audit triggers
CREATE OR REPLACE FUNCTION public.audit_student_data_changes()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.log_security_action('INSERT', TG_TABLE_NAME, NEW.id, NULL, to_jsonb(NEW));
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    PERFORM public.log_security_action('UPDATE', TG_TABLE_NAME, NEW.id, to_jsonb(OLD), to_jsonb(NEW));
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM public.log_security_action('DELETE', TG_TABLE_NAME, OLD.id, to_jsonb(OLD), NULL);
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Apply audit triggers to sensitive tables
CREATE TRIGGER audit_student_registrations
  AFTER INSERT OR UPDATE OR DELETE ON public.student_registrations
  FOR EACH ROW EXECUTE FUNCTION public.audit_student_data_changes();

CREATE TRIGGER audit_olympiad_results
  AFTER INSERT OR UPDATE OR DELETE ON public.olympiad_results
  FOR EACH ROW EXECUTE FUNCTION public.audit_student_data_changes();

-- Insert default project and subjects for 2025
INSERT INTO public.olympiad_projects (project_name, project_year, is_active, created_by)
VALUES ('iPlus Olympiad 2025', 2025, true, (SELECT id FROM public.profiles WHERE role = 'superadmin' LIMIT 1));

-- Get the project ID for inserting subjects
WITH project AS (
  SELECT id FROM public.olympiad_projects WHERE project_year = 2025
)
INSERT INTO public.olympiad_subjects (project_id, subject_name, subject_code, applicable_classes)
SELECT 
  project.id,
  subject.name,
  subject.code,
  subject.classes
FROM project,
(VALUES 
  ('Kids Plus Olympiad', 'KidsPO', ARRAY['LKG', 'UKG']),
  ('English Plus Olympiad', 'EPO', ARRAY['1', '2', '3', '4', '5', '6', '7', '8']),
  ('Maths Plus Olympiad', 'MPO', ARRAY['1', '2', '3', '4', '5', '6', '7', '8']),
  ('Science Plus Olympiad', 'SPO', ARRAY['1', '2', '3', '4', '5', '6', '7', '8']),
  ('GK Plus Olympiad', 'GKPO', ARRAY['1', '2', '3', '4', '5', '6', '7', '8'])
) AS subject(name, code, classes);

-- Update all existing schools to reference the default project
UPDATE public.schools 
SET current_project_id = (SELECT id FROM public.olympiad_projects WHERE project_year = 2025)
WHERE current_project_id IS NULL;