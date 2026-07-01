-- Add registration_in_progress field to schools table
ALTER TABLE public.schools 
ADD COLUMN registration_in_progress TEXT DEFAULT 'No' CHECK (registration_in_progress IN ('Yes', 'No'));