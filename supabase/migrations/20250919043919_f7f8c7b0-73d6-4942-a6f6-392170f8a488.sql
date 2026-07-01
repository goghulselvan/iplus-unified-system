-- Fix duplicate districts and reallocate registration numbers for Tamil Nadu
-- Using manual edit mode to bypass protection

-- First, clean up district_codes table - remove incorrect entries
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

-- Update schools using manual edit function for KANNIYAKUMARI
DO $$
DECLARE
  school_record RECORD;
BEGIN
  FOR school_record IN 
    SELECT id FROM public.schools 
    WHERE UPPER(TRIM(district)) IN ('KANYAKUMARI', 'KANNIYAKUMARI') 
    AND state = 'Tamil Nadu'
  LOOP
    PERFORM update_school_with_manual_edit(
      school_record.id,
      jsonb_build_object('district', 'KANNIYAKUMARI')
    );
  END LOOP;
END $$;

-- Update schools using manual edit function for NILGIRIS
DO $$
DECLARE
  school_record RECORD;
BEGIN
  FOR school_record IN 
    SELECT id FROM public.schools 
    WHERE UPPER(TRIM(district)) IN ('NILGIRIS', 'THE NILGIRIS') 
    AND state = 'Tamil Nadu'
  LOOP
    PERFORM update_school_with_manual_edit(
      school_record.id,
      jsonb_build_object('district', 'NILGIRIS')
    );
  END LOOP;
END $$;

-- Update school_codes table for KANNIYAKUMARI schools
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

-- Update school_codes table for NILGIRIS schools
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

-- Update student registration numbers for KANNIYAKUMARI
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

-- Update student registration numbers for NILGIRIS
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

-- Reset student registration sequences for both districts
DELETE FROM public.student_registration_sequences 
WHERE school_id IN (
  SELECT s.id FROM public.schools s 
  WHERE UPPER(TRIM(s.district)) IN ('KANNIYAKUMARI', 'NILGIRIS') 
  AND s.state = 'Tamil Nadu'
);