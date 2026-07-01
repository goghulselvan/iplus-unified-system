-- Remove the duplicate registration_in_progress column since we're using registration_status enum
ALTER TABLE public.schools DROP COLUMN registration_in_progress;