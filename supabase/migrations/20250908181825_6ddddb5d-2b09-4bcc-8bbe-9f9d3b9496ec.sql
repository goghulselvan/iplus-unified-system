-- Fix the inconsistency in district codes - update Tamil Nadu districts to use correct state code 33
UPDATE public.district_codes 
SET state_code = '33' 
WHERE state_code = '31';

-- Verify we don't have orphaned state code 31 in state_codes table
DELETE FROM public.state_codes WHERE state_code = '31';