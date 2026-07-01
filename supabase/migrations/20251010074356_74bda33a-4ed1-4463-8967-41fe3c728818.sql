-- Part 1: Fix the 3 existing schools with missing project ID
UPDATE public.schools 
SET current_project_id = 'da46555a-76f0-4767-890e-647896d5ff90'
WHERE ss_no IN (7619, 7620, 7622)
AND current_project_id IS NULL;

-- Part 2: Create function to auto-assign active project
CREATE OR REPLACE FUNCTION public.auto_assign_active_project()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.current_project_id IS NULL THEN
    NEW.current_project_id := (
      SELECT id FROM public.olympiad_projects 
      WHERE is_active = true 
      LIMIT 1
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Create trigger to auto-assign active project on school creation
CREATE TRIGGER ensure_school_has_project
  BEFORE INSERT ON public.schools
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_assign_active_project();