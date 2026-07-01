-- Add pincode field to schools table
ALTER TABLE public.schools 
ADD COLUMN pincode text NOT NULL DEFAULT '';