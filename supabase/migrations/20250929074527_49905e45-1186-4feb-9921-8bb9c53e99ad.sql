-- Update existing registration numbers to use two-digit class codes
-- This will convert formats like "1-12-001-001-1-001" to "1-12-001-001-01-001"

UPDATE student_registrations 
SET registration_number_generated = 
  CASE 
    WHEN registration_number_generated IS NOT NULL AND LENGTH(registration_number_generated) > 0 THEN
      -- Split the registration number by dashes and rebuild with padded class code
      CASE 
        WHEN array_length(string_to_array(registration_number_generated, '-'), 1) = 6 THEN
          (string_to_array(registration_number_generated, '-'))[1] || '-' ||  -- subject
          (string_to_array(registration_number_generated, '-'))[2] || '-' ||  -- state  
          (string_to_array(registration_number_generated, '-'))[3] || '-' ||  -- district
          (string_to_array(registration_number_generated, '-'))[4] || '-' ||  -- school
          LPAD((string_to_array(registration_number_generated, '-'))[5], 2, '0') || '-' ||  -- class (padded)
          (string_to_array(registration_number_generated, '-'))[6]  -- student
        ELSE registration_number_generated  -- Keep unchanged if format doesn't match
      END
    ELSE registration_number_generated
  END
WHERE registration_number_generated IS NOT NULL 
  AND registration_number_generated != ''
  AND array_length(string_to_array(registration_number_generated, '-'), 1) = 6
  -- Only update single-digit class codes (positions 5 in the array)
  AND LENGTH((string_to_array(registration_number_generated, '-'))[5]) = 1
  AND (string_to_array(registration_number_generated, '-'))[5] ~ '^[0-9]$';

-- Also update the registration_number field if it exists and follows the same pattern
UPDATE student_registrations 
SET registration_number = 
  CASE 
    WHEN registration_number IS NOT NULL AND LENGTH(registration_number) > 0 THEN
      -- Split the registration number by dashes and rebuild with padded class code
      CASE 
        WHEN array_length(string_to_array(registration_number, '-'), 1) = 6 THEN
          (string_to_array(registration_number, '-'))[1] || '-' ||  -- subject
          (string_to_array(registration_number, '-'))[2] || '-' ||  -- state  
          (string_to_array(registration_number, '-'))[3] || '-' ||  -- district
          (string_to_array(registration_number, '-'))[4] || '-' ||  -- school
          LPAD((string_to_array(registration_number, '-'))[5], 2, '0') || '-' ||  -- class (padded)
          (string_to_array(registration_number, '-'))[6]  -- student
        ELSE registration_number  -- Keep unchanged if format doesn't match
      END
    ELSE registration_number
  END
WHERE registration_number IS NOT NULL 
  AND registration_number != ''
  AND array_length(string_to_array(registration_number, '-'), 1) = 6
  -- Only update single-digit class codes (positions 5 in the array)
  AND LENGTH((string_to_array(registration_number, '-'))[5]) = 1
  AND (string_to_array(registration_number, '-'))[5] ~ '^[0-9]$';