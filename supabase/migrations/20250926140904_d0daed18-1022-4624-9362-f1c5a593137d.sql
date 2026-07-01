-- Create function to get next available SS No
CREATE OR REPLACE FUNCTION public.get_next_ss_no()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  next_ss_no integer;
BEGIN
  -- Get the next available SS No
  SELECT COALESCE(MAX(ss_no), 0) + 1 INTO next_ss_no FROM public.schools;
  RETURN next_ss_no;
END;
$$;

-- Create trigger function to auto-assign SS No if not provided
CREATE OR REPLACE FUNCTION public.auto_assign_ss_no()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only assign SS No if it's not already provided
  IF NEW.ss_no IS NULL OR NEW.ss_no = 0 THEN
    NEW.ss_no := public.get_next_ss_no();
  END IF;
  
  RETURN NEW;
END;
$$;

-- Create trigger to auto-assign SS No on INSERT
CREATE TRIGGER auto_assign_ss_no_trigger
  BEFORE INSERT ON public.schools
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_assign_ss_no();