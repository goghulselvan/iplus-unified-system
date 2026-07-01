-- One-time data normalization for existing schools
-- Normalize state, district, and board fields for consistency

-- Update state field to proper case and standardize variations
UPDATE public.schools 
SET state = CASE 
  WHEN UPPER(TRIM(state)) = 'KARNATAKA' THEN 'KARNATAKA'
  WHEN UPPER(TRIM(state)) = 'TAMIL NADU' THEN 'TAMIL NADU'
  WHEN UPPER(TRIM(state)) = 'PUDUCHERRY' THEN 'PUDUCHERRY'
  WHEN UPPER(TRIM(state)) = 'ANDHRA PRADESH' THEN 'ANDHRA PRADESH'
  WHEN UPPER(TRIM(state)) = 'TELANGANA' THEN 'TELANGANA'
  WHEN UPPER(TRIM(state)) = 'KERALA' THEN 'KERALA'
  WHEN UPPER(TRIM(state)) = 'MAHARASHTRA' THEN 'MAHARASHTRA'
  WHEN UPPER(TRIM(state)) = 'GUJARAT' THEN 'GUJARAT'
  WHEN UPPER(TRIM(state)) = 'RAJASTHAN' THEN 'RAJASTHAN'
  WHEN UPPER(TRIM(state)) = 'WEST BENGAL' THEN 'WEST BENGAL'
  WHEN UPPER(TRIM(state)) = 'ODISHA' THEN 'ODISHA'
  WHEN UPPER(TRIM(state)) = 'BIHAR' THEN 'BIHAR'
  WHEN UPPER(TRIM(state)) = 'JHARKHAND' THEN 'JHARKHAND'
  WHEN UPPER(TRIM(state)) = 'ASSAM' THEN 'ASSAM'
  WHEN UPPER(TRIM(state)) = 'UTTAR PRADESH' THEN 'UTTAR PRADESH'
  WHEN UPPER(TRIM(state)) = 'MADHYA PRADESH' THEN 'MADHYA PRADESH'
  WHEN UPPER(TRIM(state)) = 'CHHATTISGARH' THEN 'CHHATTISGARH'
  WHEN UPPER(TRIM(state)) = 'HARYANA' THEN 'HARYANA'
  WHEN UPPER(TRIM(state)) = 'PUNJAB' THEN 'PUNJAB'
  WHEN UPPER(TRIM(state)) = 'HIMACHAL PRADESH' THEN 'HIMACHAL PRADESH'
  WHEN UPPER(TRIM(state)) = 'UTTARAKHAND' THEN 'UTTARAKHAND'
  WHEN UPPER(TRIM(state)) = 'GOA' THEN 'GOA'
  WHEN UPPER(TRIM(state)) = 'DELHI' THEN 'DELHI'
  WHEN UPPER(TRIM(state)) = 'CHANDIGARH' THEN 'CHANDIGARH'
  WHEN UPPER(TRIM(state)) = 'JAMMU AND KASHMIR' THEN 'JAMMU AND KASHMIR'
  WHEN UPPER(TRIM(state)) = 'LADAKH' THEN 'LADAKH'
  ELSE UPPER(TRIM(state))
END
WHERE state IS NOT NULL AND state != '';

-- Normalize district names and handle common variations
UPDATE public.schools 
SET district = CASE 
  -- Karnataka districts
  WHEN UPPER(TRIM(district)) IN ('BANGALORE', 'BANGALORE URBAN', 'BENGALURU URBAN') THEN 'BENGALURU URBAN'
  WHEN UPPER(TRIM(district)) IN ('BANGALORE RURAL', 'BENGALURU RURAL') THEN 'BENGALURU RURAL'
  WHEN UPPER(TRIM(district)) = 'MYSORE' THEN 'MYSURU'
  WHEN UPPER(TRIM(district)) = 'BELGAUM' THEN 'BELAGAVI'
  WHEN UPPER(TRIM(district)) = 'GULBARGA' THEN 'KALABURAGI'
  WHEN UPPER(TRIM(district)) = 'BELLARY' THEN 'BALLARI'
  WHEN UPPER(TRIM(district)) = 'SHIMOGA' THEN 'SHIVAMOGGA'
  WHEN UPPER(TRIM(district)) = 'TUMKUR' THEN 'TUMAKURU'
  -- Tamil Nadu districts  
  WHEN UPPER(TRIM(district)) = 'MADRAS' THEN 'CHENNAI'
  WHEN UPPER(TRIM(district)) = 'TIRUCHIRAPALLI' THEN 'TIRUCHIRAPPALLI'
  -- Common variations
  ELSE TRIM(district)
END
WHERE district IS NOT NULL AND district != '';

-- Normalize board names
UPDATE public.schools 
SET board = CASE 
  WHEN UPPER(TRIM(board)) IN ('CBSE', 'C.B.S.E', 'C.B.S.E.', 'CENTRAL BOARD OF SECONDARY EDUCATION') THEN 'CBSE'
  WHEN UPPER(TRIM(board)) IN ('ICSE', 'I.C.S.E', 'I.C.S.E.', 'INDIAN CERTIFICATE OF SECONDARY EDUCATION') THEN 'ICSE'
  WHEN UPPER(TRIM(board)) IN ('ISC', 'I.S.C', 'I.S.C.', 'INDIAN SCHOOL CERTIFICATE') THEN 'ISC'
  WHEN UPPER(TRIM(board)) IN ('STATE BOARD', 'STATE', 'MATRICULATION', 'MATRIC') THEN 'STATE BOARD'
  WHEN UPPER(TRIM(board)) IN ('IGCSE', 'I.G.C.S.E') THEN 'IGCSE'
  WHEN UPPER(TRIM(board)) IN ('IB', 'INTERNATIONAL BACCALAUREATE') THEN 'IB'
  ELSE UPPER(TRIM(board))
END
WHERE board IS NOT NULL AND board != '';

-- Clean up email fields - convert to lowercase
UPDATE public.schools 
SET email = LOWER(TRIM(email))
WHERE email IS NOT NULL AND email != '';

-- Clean up phone numbers - remove non-numeric characters
UPDATE public.schools 
SET mobile1 = REGEXP_REPLACE(mobile1, '[^0-9]', '', 'g')
WHERE mobile1 IS NOT NULL AND mobile1 != '';

UPDATE public.schools 
SET mobile2 = REGEXP_REPLACE(mobile2, '[^0-9]', '', 'g')
WHERE mobile2 IS NOT NULL AND mobile2 != '';

-- Update any null or empty strings to proper defaults
UPDATE public.schools 
SET 
  pincode = COALESCE(NULLIF(TRIM(pincode), ''), ''),
  consent_form_sent = COALESCE(NULLIF(TRIM(consent_form_sent), ''), 'Not Sent')
WHERE TRUE;