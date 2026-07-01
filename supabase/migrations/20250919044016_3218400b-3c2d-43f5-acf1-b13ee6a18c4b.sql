-- Fix duplicate districts and reallocate registration numbers for Tamil Nadu
-- Simplified approach to avoid conflicts

-- Step 1: Clean up district_codes table - remove incorrect entries
DELETE FROM public.district_codes 
WHERE state_code = '19' AND district_code = '040';

DELETE FROM public.district_codes 
WHERE state_code = '19' AND district_code = '039';

-- Step 2: Ensure we have the correct district entries (simple insert)
DELETE FROM public.district_codes 
WHERE state_code = '19' AND district_name = 'KANNIYAKUMARI' AND district_code != '011';

DELETE FROM public.district_codes 
WHERE state_code = '19' AND district_name = 'NILGIRIS' AND district_code != '018';

INSERT INTO public.district_codes (state_code, district_name, district_code, is_active)
SELECT '19', 'KANNIYAKUMARI', '011', true
WHERE NOT EXISTS (
  SELECT 1 FROM public.district_codes 
  WHERE state_code = '19' AND district_name = 'KANNIYAKUMARI' AND district_code = '011'
);

INSERT INTO public.district_codes (state_code, district_name, district_code, is_active)
SELECT '19', 'NILGIRIS', '018', true
WHERE NOT EXISTS (
  SELECT 1 FROM public.district_codes 
  WHERE state_code = '19' AND district_name = 'NILGIRIS' AND district_code = '018'
);

-- Step 3: Update schools using manual edit function for KANNIYAKUMARI
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

-- Step 4: Update schools using manual edit function for NILGIRIS
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

-- Step 5: Update school_codes table for KANNIYAKUMARI schools
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

-- Step 6: Update school_codes table for NILGIRIS schools
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

-- Step 7: Reset student registration sequences for both districts
DELETE FROM public.student_registration_sequences 
WHERE school_id IN (
  SELECT s.id FROM public.schools s 
  WHERE UPPER(TRIM(s.district)) IN ('KANNIYAKUMARI', 'NILGIRIS') 
  AND s.state = 'Tamil Nadu'
);

-- Step 8: Update student registration numbers for KANNIYAKUMARI
WITH kanniyakumari_registrations AS (
  SELECT 
    sr.id,
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

-- Step 9: Update student registration numbers for NILGIRIS
WITH nilgiris_registrations AS (
  SELECT 
    sr.id,
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