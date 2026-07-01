-- Assign alphabetical school codes for all districts with students
DO $$
DECLARE
  district_record RECORD;
BEGIN
  FOR district_record IN
    SELECT DISTINCT 
      sc.state_code,
      dc.district_code
    FROM schools s
    INNER JOIN student_registrations sr ON s.id = sr.school_id
    INNER JOIN state_codes sc ON UPPER(TRIM(sc.state_name)) = UPPER(TRIM(s.state))
    INNER JOIN district_codes dc ON dc.state_code = sc.state_code 
      AND UPPER(TRIM(dc.district_name)) = UPPER(TRIM(s.district))
  LOOP
    PERFORM assign_alphabetical_school_codes_for_district(
      district_record.state_code, 
      district_record.district_code
    );
  END LOOP;
END $$;

-- Check the school code assignment results
SELECT 
  'School Codes Assigned' as status,
  COUNT(*) as total_schools_with_codes
FROM school_codes;