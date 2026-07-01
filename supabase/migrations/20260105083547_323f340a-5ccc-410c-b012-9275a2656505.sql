-- Create archive table for retired/deleted student registrations
CREATE TABLE public.archived_student_registrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  original_id uuid NOT NULL,
  project_id uuid NOT NULL,
  school_id uuid NOT NULL,
  student_name text NOT NULL,
  student_class text NOT NULL,
  class_code integer,
  roll_number text,
  registration_number text,
  registration_number_generated text,
  original_created_at timestamptz,
  original_created_by uuid,
  archive_type text NOT NULL CHECK (archive_type IN ('retired', 'deleted')),
  archive_reason text,
  archived_at timestamptz DEFAULT now(),
  archived_by uuid,
  replacement_registration_id uuid
);

-- Create archive table for student subjects
CREATE TABLE public.archived_student_subjects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  archived_registration_id uuid NOT NULL REFERENCES public.archived_student_registrations(id) ON DELETE CASCADE,
  original_subject_id uuid,
  subject_code text,
  subject_name text,
  created_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.archived_student_registrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.archived_student_subjects ENABLE ROW LEVEL SECURITY;

-- RLS policies for archived_student_registrations
CREATE POLICY "Managers can view archived registrations"
ON public.archived_student_registrations FOR SELECT
USING (is_manager_or_superadmin());

CREATE POLICY "System can insert archived registrations"
ON public.archived_student_registrations FOR INSERT
WITH CHECK (is_manager_or_superadmin());

CREATE POLICY "Only superadmins can delete archived registrations"
ON public.archived_student_registrations FOR DELETE
USING (is_superadmin(auth.uid()));

-- RLS policies for archived_student_subjects
CREATE POLICY "Managers can view archived subjects"
ON public.archived_student_subjects FOR SELECT
USING (is_manager_or_superadmin());

CREATE POLICY "System can insert archived subjects"
ON public.archived_student_subjects FOR INSERT
WITH CHECK (is_manager_or_superadmin());

CREATE POLICY "Only superadmins can delete archived subjects"
ON public.archived_student_subjects FOR DELETE
USING (is_superadmin(auth.uid()));

-- Create indexes for performance
CREATE INDEX idx_archived_registrations_project ON public.archived_student_registrations(project_id);
CREATE INDEX idx_archived_registrations_school ON public.archived_student_registrations(school_id);
CREATE INDEX idx_archived_registrations_type ON public.archived_student_registrations(archive_type);
CREATE INDEX idx_archived_subjects_registration ON public.archived_student_subjects(archived_registration_id);

-- Migrate existing retired registrations to archive table
INSERT INTO public.archived_student_registrations (
  original_id, project_id, school_id, student_name, student_class,
  class_code, roll_number, registration_number, registration_number_generated,
  original_created_at, original_created_by, archive_type, archive_reason, archived_by
)
SELECT 
  id, project_id, school_id, student_name, student_class,
  class_code, roll_number, registration_number,
  REPLACE(registration_number_generated, ' [RETIRED]', ''),
  created_at, created_by, 'retired', 'Legacy migration - class/subject correction',
  created_by
FROM public.student_registrations
WHERE registration_number_generated LIKE '%[RETIRED]%';

-- Archive corresponding subjects
INSERT INTO public.archived_student_subjects (
  archived_registration_id, original_subject_id, subject_code, subject_name
)
SELECT 
  ar.id, ss.subject_id, os.subject_code, os.subject_name
FROM public.archived_student_registrations ar
JOIN public.student_subjects ss ON ss.registration_id = ar.original_id
JOIN public.olympiad_subjects os ON os.id = ss.subject_id;

-- Delete retired subjects from main table
DELETE FROM public.student_subjects 
WHERE registration_id IN (
  SELECT id FROM public.student_registrations 
  WHERE registration_number_generated LIKE '%[RETIRED]%'
);

-- Delete retired registrations from main table
DELETE FROM public.student_registrations 
WHERE registration_number_generated LIKE '%[RETIRED]%';