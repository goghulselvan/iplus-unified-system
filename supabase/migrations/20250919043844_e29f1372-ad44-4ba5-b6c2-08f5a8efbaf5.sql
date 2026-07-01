-- Fix duplicate districts and reallocate registration numbers for Tamil Nadu

-- First, let's standardize the district names and remove duplicates
-- Update all references to use the correct district names and codes

-- 1. Update schools table to use standardized district names
UPDATE public.schools 
SET district = 'KANNIYAKUMARI' 
WHERE UPPER(TRIM(district)) IN ('KANYAKUMARI', 'KANNIYAKUMARI');

UPDATE public.schools 
SET district = 'NILGIRIS' 
WHERE UPPER(TRIM(district)) IN ('NILGIRIS', 'THE NILGIRIS');

-- 2. Clean up district_codes table - remove incorrect entries and keep correct ones
DELETE FROM public.district_codes 
WHERE state_code = '19' AND district_code = '040' 
AND UPPER(TRIM(district_name)) IN ('KANYAKUMARI', 'KANNIYAKUMARI');

DELETE FROM public.district_codes 
WHERE state_code = '19' AND district_code = '039' 
AND UPPER(TRIM(district_name)) IN ('NILGIRIS', 'THE NILGIRIS');

-- Ensure we have the correct district entries
INSERT INTO public.district_codes (state_code, district_name, district_code, is_active)
VALUES ('19', 'KANNIYAKUMARI', '011', true)
ON CONFLICT (state_code, district_name) DO UPDATE SET 
  district_code = '011',
  is_active = true;

INSERT INTO public.district_codes (state_code, district_name, district_code, is_active)
VALUES ('19', 'NILGIRIS', '018', true)
ON CONFLICT (state_code, district_name) DO UPDATE SET 
  district_code = '018',
  is_active = true;

-- 3. Update school_codes table for KANNIYAKUMARI schools
-- First, get all schools in KANNIYAKUMARI and reassign school codes sequentially
WITH kanniyakumari_schools AS (
  SELECT s.id as school_id, 
         ROW_NUMBER() OVER (ORDER BY s.ss_no, s.created_at) as new_school_seq
  FROM public.schools s
  WHERE UPPER(TRIM(s.district)) = 'KANNIYAKUMARI'
    AND s.state = 'Tamil Nadu'
)
UPDATE public.school_codes sc
SET district_code = '011',
    school_code = LPAD(ks.new_school_seq::TEXT, 3, '0')
FROM kanniyakumari_schools ks
WHERE sc.school_id = ks.school_id;

-- 4. Update school_codes table for NILGIRIS schools
WITH nilgiris_schools AS (
  SELECT s.id as school_id, 
         ROW_NUMBER() OVER (ORDER BY s.ss_no, s.created_at) as new_school_seq
  FROM public.schools s
  WHERE UPPER(TRIM(s.district)) = 'NILGIRIS'
    AND s.state = 'Tamil Nadu'
)
UPDATE public.school_codes sc
SET district_code = '018',
    school_code = LPAD(ns.new_school_seq::TEXT, 3, '0')
FROM nilgiris_schools ns
WHERE sc.school_id = ns.school_id;

-- 5. Update student registration numbers for KANNIYAKUMARI
-- Get all student registrations from KANNIYAKUMARI schools
WITH kanniyakumari_registrations AS (
  SELECT 
    sr.id,
    sr.registration_number_generated,
    sc.school_code as new_school_code,
    sr.class_code,
    ROW_NUMBER() OVER (
      PARTITION BY sr.school_id, sr.class_code 
      ORDER BY sr.created_at
    ) as student_seq_in_class
  FROM public.student_registrations sr
  JOIN public.schools s ON sr.school_id = s.id
  JOIN public.school_codes sc ON sc.school_id = s.id
  WHERE UPPER(TRIM(s.district)) = 'KANNIYAKUMARI'
    AND s.state = 'Tamil Nadu'
    AND sr.registration_number_generated IS NOT NULL
)
UPDATE public.student_registrations sr
SET registration_number_generated = '0-19-011-' || kr.new_school_code || '-' || 
    sr.class_code::TEXT || LPAD(kr.student_seq_in_class::TEXT, 3, '0')
FROM kanniyakumari_registrations kr
WHERE sr.id = kr.id;

-- 6. Update student registration numbers for NILGIRIS
WITH nilgiris_registrations AS (
  SELECT 
    sr.id,
    sr.registration_number_generated,
    sc.school_code as new_school_code,
    sr.class_code,
    ROW_NUMBER() OVER (
      PARTITION BY sr.school_id, sr.class_code 
      ORDER BY sr.created_at
    ) as student_seq_in_class
  FROM public.student_registrations sr
  JOIN public.schools s ON sr.school_id = s.id
  JOIN public.school_codes sc ON sc.school_id = s.id
  WHERE UPPER(TRIM(s.district)) = 'NILGIRIS'
    AND s.state = 'Tamil Nadu'
    AND sr.registration_number_generated IS NOT NULL
)
UPDATE public.student_registrations sr
SET registration_number_generated = '0-19-018-' || nr.new_school_code || '-' || 
    sr.class_code::TEXT || LPAD(nr.student_seq_in_class::TEXT, 3, '0')
FROM nilgiris_registrations nr
WHERE sr.id = nr.id;

-- 7. Reset student registration sequences for both districts
-- Delete and recreate sequences for KANNIYAKUMARI schools
DELETE FROM public.student_registration_sequences 
WHERE school_id IN (
  SELECT s.id FROM public.schools s 
  WHERE UPPER(TRIM(s.district)) = 'KANNIYAKUMARI' AND s.state = 'Tamil Nadu'
);

-- Delete and recreate sequences for NILGIRIS schools
DELETE FROM public.student_registration_sequences 
WHERE school_id IN (
  SELECT s.id FROM public.schools s 
  WHERE UPPER(TRIM(s.district)) = 'NILGIRIS' AND s.state = 'Tamil Nadu'
);

-- 8. Log the district consolidation
INSERT INTO public.security_audit_logs (
  user_id, action, table_name, record_id, old_values, new_values, ip_address
) VALUES (
  '00000000-0000-0000-0000-000000000000'::uuid,
  'DISTRICT_CONSOLIDATION',
  'district_codes',
  NULL,
  jsonb_build_object(
    'removed_districts', jsonb_build_array(
      jsonb_build_object('name', 'KANYAKUMARI', 'code', '040'),
      jsonb_build_object('name', 'THE NILGIRIS', 'code', '039')
    )
  ),
  jsonb_build_object(
    'standardized_districts', jsonb_build_array(
      jsonb_build_object('name', 'KANNIYAKUMARI', 'code', '011'),
      jsonb_build_object('name', 'NILGIRIS', 'code', '018')
    ),
    'action', 'Consolidated duplicate districts and reallocated registration numbers'
  ),
  NULL
);