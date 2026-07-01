-- Debug: Check state and district data matching
SELECT 
  'State/District Debug' as check_type,
  s.state,
  s.district,
  sc.state_name as matched_state,
  sc.state_code,
  dc.district_name as matched_district,
  dc.district_code,
  COUNT(*) as student_count
FROM schools s
INNER JOIN student_registrations sr ON s.id = sr.school_id
LEFT JOIN state_codes sc ON UPPER(TRIM(sc.state_name)) = UPPER(TRIM(s.state))
LEFT JOIN district_codes dc ON dc.state_code = sc.state_code 
  AND UPPER(TRIM(dc.district_name)) = UPPER(TRIM(s.district))
GROUP BY s.state, s.district, sc.state_name, sc.state_code, dc.district_name, dc.district_code
ORDER BY s.state, s.district
LIMIT 10;