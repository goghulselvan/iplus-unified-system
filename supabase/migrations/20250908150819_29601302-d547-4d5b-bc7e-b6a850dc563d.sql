-- Fix board name inconsistencies and duplicates step by step

-- First, update schools table to use standardized board names
UPDATE public.schools 
SET board = 'CBSE' 
WHERE LOWER(board) = 'cbse';

UPDATE public.schools 
SET board = 'TN-N&P' 
WHERE LOWER(board) IN ('tn-n&p', 'tn-n&p');

-- Find and keep the first TN-N&P board, delete the rest
WITH first_tn_board AS (
  SELECT id
  FROM public.boards 
  WHERE LOWER(board_name) IN ('tn-n&p') 
  ORDER BY created_at ASC 
  LIMIT 1
)
DELETE FROM public.boards 
WHERE LOWER(board_name) IN ('tn-n&p') 
AND id NOT IN (SELECT id FROM first_tn_board);

-- Update the remaining TN-N&P board to correct case
UPDATE public.boards 
SET board_name = 'TN-N&P', board_code = 'TN_NANDP_001' 
WHERE LOWER(board_name) IN ('tn-n&p');

-- Update CBSE board name and code
UPDATE public.boards 
SET board_name = 'CBSE', board_code = 'CBSE_001' 
WHERE LOWER(board_name) = 'cbse';

-- Add unique constraint to prevent future duplicates
ALTER TABLE public.boards 
ADD CONSTRAINT unique_board_name UNIQUE (board_name);