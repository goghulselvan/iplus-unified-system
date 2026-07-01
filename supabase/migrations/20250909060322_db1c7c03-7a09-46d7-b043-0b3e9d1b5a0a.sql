-- Update all "State Board" entries to "Matriculation" for consistency
UPDATE schools 
SET board = 'Matriculation'
WHERE board ILIKE '%State Board%' OR board ILIKE '%State%';

-- Also update any variations that might exist
UPDATE schools 
SET board = 'Matriculation'
WHERE board IN ('STATE BOARD', 'State Board', 'state board', 'STATE', 'State', 'state');