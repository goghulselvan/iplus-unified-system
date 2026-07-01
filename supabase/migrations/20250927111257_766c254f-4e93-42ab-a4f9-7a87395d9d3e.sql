-- Create a simpler batch update function to avoid timeout
CREATE OR REPLACE FUNCTION public.update_registration_numbers_batch(batch_size integer DEFAULT 100)
 RETURNS TABLE(processed_count bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  total_processed bigint := 0;
  batch_processed integer;
BEGIN
  -- Process records in batches to avoid timeout
  LOOP
    WITH batch_records AS (
      SELECT id, registration_number_generated
      FROM student_registrations 
      WHERE registration_number_generated IS NOT NULL 
      AND registration_number_generated != ''
      AND (
        array_length(string_to_array(registration_number_generated, '-'), 1) = 7 OR
        array_length(string_to_array(registration_number_generated, '-'), 1) = 6
      )
      LIMIT batch_size
    )
    UPDATE student_registrations 
    SET registration_number_generated = CASE 
      -- Handle 7-part format
      WHEN array_length(string_to_array(batch_records.registration_number_generated, '-'), 1) = 7 THEN
        split_part(batch_records.registration_number_generated, '-', 1) || '-' ||  -- subject
        split_part(batch_records.registration_number_generated, '-', 3) || '-' ||  -- state  
        split_part(batch_records.registration_number_generated, '-', 4) || '-' ||  -- district
        split_part(batch_records.registration_number_generated, '-', 5) || '-' ||  -- school
        split_part(split_part(batch_records.registration_number_generated, '-', 6), '', -3) || '-' ||  -- class
        right(split_part(batch_records.registration_number_generated, '-', 6), 3)  -- student
      
      -- Handle 6-part format  
      WHEN array_length(string_to_array(batch_records.registration_number_generated, '-'), 1) = 6 THEN
        split_part(batch_records.registration_number_generated, '-', 6) || '-' ||  -- subject
        split_part(batch_records.registration_number_generated, '-', 2) || '-' ||  -- state
        split_part(batch_records.registration_number_generated, '-', 3) || '-' ||  -- district
        split_part(batch_records.registration_number_generated, '-', 4) || '-' ||  -- school
        left(split_part(batch_records.registration_number_generated, '-', 5), -3) || '-' ||  -- class
        right(split_part(batch_records.registration_number_generated, '-', 5), 3)  -- student
      
      ELSE batch_records.registration_number_generated
    END,
    updated_at = now()
    FROM batch_records
    WHERE student_registrations.id = batch_records.id;
    
    GET DIAGNOSTICS batch_processed = ROW_COUNT;
    total_processed := total_processed + batch_processed;
    
    -- Exit if no more records to process
    EXIT WHEN batch_processed = 0;
  END LOOP;
  
  RETURN QUERY SELECT total_processed;
END;
$function$;