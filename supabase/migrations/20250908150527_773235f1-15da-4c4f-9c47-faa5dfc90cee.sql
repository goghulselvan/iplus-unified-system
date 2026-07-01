-- Fix board name inconsistencies and duplicates

-- First, update schools table to use standardized board names
UPDATE public.schools 
SET board = 'CBSE' 
WHERE LOWER(board) = 'cbse';

UPDATE public.schools 
SET board = 'TN-N&P' 
WHERE LOWER(board) IN ('tn-n&p', 'tn-n&p');

-- Update boards table to standardize names
UPDATE public.boards 
SET board_name = 'CBSE' 
WHERE LOWER(board_name) = 'cbse';

UPDATE public.boards 
SET board_name = 'TN-N&P' 
WHERE LOWER(board_name) IN ('tn-n&p', 'tn-n&p');

-- Remove duplicate TN-N&P boards (keep the one with lowest id)
DELETE FROM public.boards 
WHERE board_name = 'TN-N&P' 
AND id NOT IN (
  SELECT MIN(id) 
  FROM public.boards 
  WHERE board_name = 'TN-N&P'
);

-- Update board_code for consistency
UPDATE public.boards 
SET board_code = 'CBSE_001' 
WHERE board_name = 'CBSE';

UPDATE public.boards 
SET board_code = 'TN_NANDP_001' 
WHERE board_name = 'TN-N&P';

-- Add unique constraint to prevent future duplicates
ALTER TABLE public.boards 
ADD CONSTRAINT unique_board_name UNIQUE (board_name);