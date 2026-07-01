-- Create student_subjects junction table for many-to-many relationship
CREATE TABLE public.student_subjects (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  registration_id UUID NOT NULL,
  subject_id UUID NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(registration_id, subject_id)
);

-- Create indexes for performance
CREATE INDEX idx_student_subjects_registration_id ON public.student_subjects(registration_id);
CREATE INDEX idx_student_subjects_subject_id ON public.student_subjects(subject_id);

-- Enable RLS on student_subjects
ALTER TABLE public.student_subjects ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for student_subjects
CREATE POLICY "Managers can view student subjects"
ON public.student_subjects
FOR SELECT
USING (is_manager_or_superadmin());

CREATE POLICY "Managers can insert student subjects"
ON public.student_subjects
FOR INSERT
WITH CHECK (is_manager_or_superadmin());

CREATE POLICY "Managers can update student subjects"
ON public.student_subjects
FOR UPDATE
USING (is_manager_or_superadmin());

CREATE POLICY "Superadmins can delete student subjects"
ON public.student_subjects
FOR DELETE
USING (is_superadmin_with_ip_check());

-- Migrate existing data: group by student and create junction records
DO $$
DECLARE
  reg_record RECORD;
  new_registration_id UUID;
BEGIN
  -- For each unique student (same name, class, school, project), create one registration
  FOR reg_record IN 
    SELECT DISTINCT 
      project_id, 
      school_id, 
      student_name, 
      student_class,
      created_by,
      MIN(created_at) as created_at,
      MIN(registration_number_generated) as registration_number_generated,
      ARRAY_AGG(DISTINCT subject_id) as subject_ids,
      ARRAY_AGG(DISTINCT id) as old_ids
    FROM public.student_registrations 
    GROUP BY project_id, school_id, student_name, student_class, created_by
  LOOP
    -- Insert the main registration record (without subject_id)
    INSERT INTO public.student_registrations (
      project_id, school_id, student_name, student_class, 
      registration_number_generated, created_by, created_at, updated_at
    ) VALUES (
      reg_record.project_id, 
      reg_record.school_id, 
      reg_record.student_name, 
      reg_record.student_class,
      reg_record.registration_number_generated,
      reg_record.created_by,
      reg_record.created_at,
      reg_record.created_at
    ) RETURNING id INTO new_registration_id;
    
    -- Insert subject associations
    INSERT INTO public.student_subjects (registration_id, subject_id)
    SELECT new_registration_id, UNNEST(reg_record.subject_ids);
  END LOOP;
  
  -- Now safely delete old records
  DELETE FROM public.student_registrations WHERE subject_id IS NOT NULL;
END $$;

-- Remove subject_id column after migration
ALTER TABLE public.student_registrations DROP COLUMN subject_id;

-- Add triggers for student_subjects audit
CREATE TRIGGER audit_student_subjects_changes
  AFTER INSERT OR UPDATE OR DELETE ON public.student_subjects
  FOR EACH ROW EXECUTE FUNCTION public.audit_student_data_changes();

-- Add trigger for bulk operation detection
CREATE TRIGGER detect_bulk_student_subjects
  AFTER INSERT OR UPDATE OR DELETE ON public.student_subjects
  FOR EACH ROW EXECUTE FUNCTION public.detect_bulk_operations();