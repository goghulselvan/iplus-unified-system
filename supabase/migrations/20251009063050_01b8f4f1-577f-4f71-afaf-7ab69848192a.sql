-- Create exam_schedules table
CREATE TABLE IF NOT EXISTS public.exam_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  exam_date DATE NOT NULL,
  subjects TEXT[] NOT NULL,
  notes TEXT,
  created_by UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  project_id UUID REFERENCES public.olympiad_projects(id),
  
  CONSTRAINT unique_school_exam_date UNIQUE(school_id, exam_date),
  CONSTRAINT valid_subjects CHECK (array_length(subjects, 1) > 0 AND array_length(subjects, 1) <= 5)
);

-- Create index for performance
CREATE INDEX IF NOT EXISTS idx_exam_schedules_school_id ON public.exam_schedules(school_id);
CREATE INDEX IF NOT EXISTS idx_exam_schedules_exam_date ON public.exam_schedules(exam_date);

-- Enable RLS
ALTER TABLE public.exam_schedules ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Managers can view exam schedules"
ON public.exam_schedules
FOR SELECT
USING (is_manager_or_superadmin());

CREATE POLICY "Managers can insert exam schedules"
ON public.exam_schedules
FOR INSERT
WITH CHECK (is_manager_or_superadmin() AND auth.uid() = created_by);

CREATE POLICY "Managers can update exam schedules"
ON public.exam_schedules
FOR UPDATE
USING (is_manager_or_superadmin());

CREATE POLICY "Superadmins can delete exam schedules"
ON public.exam_schedules
FOR DELETE
USING (is_superadmin(auth.uid()));

-- Function to check max 10 dates constraint
CREATE OR REPLACE FUNCTION public.check_max_exam_dates()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  date_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO date_count
  FROM public.exam_schedules
  WHERE school_id = NEW.school_id;
  
  IF date_count >= 10 THEN
    RAISE EXCEPTION 'Maximum 10 exam dates allowed per school';
  END IF;
  
  RETURN NEW;
END;
$$;

-- Trigger to enforce max 10 dates
CREATE TRIGGER enforce_max_exam_dates
BEFORE INSERT ON public.exam_schedules
FOR EACH ROW
EXECUTE FUNCTION public.check_max_exam_dates();

-- Trigger to update updated_at
CREATE TRIGGER update_exam_schedules_updated_at
BEFORE UPDATE ON public.exam_schedules
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();