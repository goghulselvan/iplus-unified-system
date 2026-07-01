-- Add registration_number_digits column for format-proof lookups
ALTER TABLE public.student_registrations 
ADD COLUMN IF NOT EXISTS registration_number_digits text;