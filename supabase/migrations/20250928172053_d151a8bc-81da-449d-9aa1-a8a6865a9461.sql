-- Drop all registration regeneration database functions
DROP FUNCTION IF EXISTS public.regenerate_all_registration_numbers();
DROP FUNCTION IF EXISTS public.regenerate_registration_numbers_batch(integer);