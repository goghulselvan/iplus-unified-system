-- Fix board name inconsistencies and duplicates step by step

-- First, update schools table to use standardized board names
UPDATE public.schools 
SET board = 'CBSE' 
WHERE LOWER(board) = 'cbse';

UPDATE public.schools 
SET board = 'TN-N&P' 
WHERE LOWER(board) IN ('tn-n&p', 'tn-n&p');

-- Update the first TN-N&P board to standardized name
UPDATE public.boards 
SET board_name = 'TN-N&P' 
WHERE LOWER(board_name) IN ('tn-n&p') 
AND id = (
  SELECT MIN(id) 
  FROM public.boards 
  WHERE LOWER(board_name) IN ('tn-n&p')
);

-- Delete duplicate TN-N&P boards (keep the one we just updated)
DELETE FROM public.boards 
WHERE LOWER(board_name) IN ('tn-n&p') 
AND id != (
  SELECT MIN(id) 
  FROM public.boards 
  WHERE LOWER(board_name) IN ('tn-n&p')
);

-- Update CBSE board name
UPDATE public.boards 
SET board_name = 'CBSE' 
WHERE LOWER(board_name) = 'cbse';

-- Update board codes for consistency
UPDATE public.boards 
SET board_code = 'CBSE_001' 
WHERE board_name = 'CBSE';

UPDATE public.boards 
SET board_code = 'TN_NANDP_001' 
WHERE board_name = 'TN-N&P';

-- Add unique constraint to prevent future duplicates
ALTER TABLE public.boards 
ADD CONSTRAINT unique_board_name UNIQUE (board_name);