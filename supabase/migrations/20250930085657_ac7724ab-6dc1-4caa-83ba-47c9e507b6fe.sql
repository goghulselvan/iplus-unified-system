-- Fix 1: Create trigger to automatically set class_code when student is registered
CREATE OR REPLACE FUNCTION public.auto_set_class_code()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
  -- Set class_code based on student_class using the updated mapping
  NEW.class_code := public.map_student_class_to_code(NEW.student_class);
  RETURN NEW;
END;
$$;

-- Create trigger for student registrations
DROP TRIGGER IF EXISTS trigger_auto_set_class_code ON public.student_registrations;
CREATE TRIGGER trigger_auto_set_class_code
  BEFORE INSERT OR UPDATE ON public.student_registrations
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_set_class_code();

-- Fix 2: Create trigger for automatic registration number generation
DROP TRIGGER IF EXISTS trigger_auto_generate_registration_number ON public.student_subjects;
CREATE TRIGGER trigger_auto_generate_registration_number
  AFTER INSERT ON public.student_subjects
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_generate_registration_number();

-- Fix 3: Update existing student registrations to have class_code
UPDATE public.student_registrations 
SET class_code = public.map_student_class_to_code(student_class)
WHERE class_code IS NULL;