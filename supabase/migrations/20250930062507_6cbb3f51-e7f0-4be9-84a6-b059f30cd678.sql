-- Drop existing triggers first
DROP TRIGGER IF EXISTS trigger_generate_registration_number_on_subject ON public.student_subjects;
DROP TRIGGER IF EXISTS trigger_auto_generate_registration_number ON public.student_registrations;

-- Now recreate the fixed trigger
CREATE TRIGGER trigger_generate_registration_number_on_subject
    AFTER INSERT ON public.student_subjects
    FOR EACH ROW
    EXECUTE FUNCTION public.auto_generate_registration_number();