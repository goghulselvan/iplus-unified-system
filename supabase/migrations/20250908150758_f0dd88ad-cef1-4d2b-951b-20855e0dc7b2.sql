-- Fix board name inconsistencies and duplicates without adding constraint

-- First, update schools table to use standardized board names
UPDATE public.schools 
SET board = 'CBSE' 
WHERE LOWER(board) = 'cbse';

UPDATE public.schools 
SET board = 'TN-N&P' 
WHERE LOWER(board) IN ('tn-n&p', 'tn-n&p');

-- Update boards table to standardize names, but handle duplicates carefully
-- First update the one we want to keep
UPDATE public.boards 
SET board_name = 'CBSE', board_code = 'CBSE_001' 
WHERE board_name = 'Cbse';

-- For TN-N&P, update one record first
UPDATE public.boards 
SET board_name = 'TN-N&P', board_code = 'TN_NANDP_001' 
WHERE id = 'ec504eba-9e11-4189-9077-83f41f5358b9';

-- Delete the duplicate TN-N&P record
DELETE FROM public.boards 
WHERE id = '960ec4d4-d08e-42a2-832b-04150c14051d';