-- Trigger to auto-create workflow record when a new school is added
CREATE OR REPLACE FUNCTION public.auto_create_school_workflow()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  active_project_id uuid;
BEGIN
  -- Get active project
  SELECT id INTO active_project_id
  FROM public.olympiad_projects
  WHERE is_active = true
  LIMIT 1;
  
  -- If there's an active project, create workflow record for new school
  IF active_project_id IS NOT NULL THEN
    INSERT INTO public.school_project_workflow (
      school_id,
      project_id,
      per_entry_rate,
      concession_per_entry
    )
    VALUES (
      NEW.id,
      active_project_id,
      COALESCE(NEW.per_entry_rate, 150),
      COALESCE(NEW.concession_per_entry, 0)
    )
    ON CONFLICT (school_id, project_id) DO NOTHING;
  END IF;
  
  RETURN NEW;
END;
$$;

-- Create trigger on schools table
DROP TRIGGER IF EXISTS trigger_auto_create_school_workflow ON public.schools;
CREATE TRIGGER trigger_auto_create_school_workflow
  AFTER INSERT ON public.schools
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_create_school_workflow();