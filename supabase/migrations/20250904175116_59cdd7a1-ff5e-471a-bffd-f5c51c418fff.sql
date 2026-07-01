-- Add total_participants column to schools table
ALTER TABLE public.schools 
ADD COLUMN total_participants integer;