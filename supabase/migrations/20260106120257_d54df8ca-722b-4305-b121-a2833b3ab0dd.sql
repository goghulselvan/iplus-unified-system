-- Create index for fast lookups on registration_number_digits
CREATE INDEX IF NOT EXISTS idx_student_registrations_digits 
ON public.student_registrations(registration_number_digits)