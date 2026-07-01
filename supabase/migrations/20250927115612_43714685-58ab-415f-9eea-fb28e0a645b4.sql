-- Update get_subject_code function to change Kids Plus Olympiad from 0 to 5
CREATE OR REPLACE FUNCTION public.get_subject_code(p_subject_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  subject_name text;
BEGIN
  SELECT UPPER(TRIM(os.subject_name)) INTO subject_name
  FROM public.olympiad_subjects os
  WHERE os.id = p_subject_id;
  
  IF subject_name IS NULL THEN
    RETURN NULL;
  END IF;
  
  CASE subject_name
    WHEN 'KIDS PLUS OLYMPIAD' THEN RETURN 5;  -- Changed from 0 to 5
    WHEN 'ENGLISH PLUS OLYMPIAD' THEN RETURN 1;
    WHEN 'MATHS PLUS OLYMPIAD' THEN RETURN 2;
    WHEN 'SCIENCE PLUS OLYMPIAD' THEN RETURN 3;
    WHEN 'GK PLUS OLYMPIAD' THEN RETURN 4;
    -- Keep the old mappings for backward compatibility
    WHEN 'KIDS' THEN RETURN 5;  -- Changed from 0 to 5
    WHEN 'ENGLISH' THEN RETURN 1;
    WHEN 'MATHS', 'MATHEMATICS' THEN RETURN 2;
    WHEN 'SCIENCE' THEN RETURN 3;
    WHEN 'GK', 'GENERAL KNOWLEDGE' THEN RETURN 4;
    ELSE RETURN NULL;
  END CASE;
END;
$function$;

-- Function to completely regenerate registration numbers
CREATE OR REPLACE FUNCTION public.regenerate_all_registration_numbers()
 RETURNS TABLE(
   status text,
   schools_processed integer,
   registrations_updated integer,
   message text
 )
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  school_record RECORD;
  reg_record RECORD;
  schools_count integer := 0;
  registrations_count integer := 0;
  new_registration_number text;
  subject_id_var uuid;
BEGIN
  -- Only superadmins can run this regeneration
  IF NOT is_superadmin(auth.uid()) THEN
    RETURN QUERY SELECT 'ERROR'::text, 0, 0, 'Only superadmins can regenerate registration numbers'::text;
    RETURN;
  END IF;
  
  -- Step 1: Clear all existing school codes and sequences
  DELETE FROM public.school_codes;
  DELETE FROM public.student_registration_sequences;
  
  -- Log the regeneration start
  PERFORM public.log_security_action(
    'REGISTRATION_NUMBER_REGENERATION_START',
    'student_registrations',
    NULL,
    NULL,
    jsonb_build_object('initiated_by', auth.uid(), 'timestamp', now())
  );
  
  -- Step 2: Process schools chronologically by first registration date
  FOR school_record IN
    SELECT 
      s.id as school_id,
      s.state,
      s.district,
      MIN(sr.created_at) as first_registration_date
    FROM public.schools s
    INNER JOIN public.student_registrations sr ON s.id = sr.school_id
    GROUP BY s.id, s.state, s.district
    ORDER BY s.state, s.district, MIN(sr.created_at)
  LOOP
    schools_count := schools_count + 1;
    
    -- Step 3: Process student registrations for this school in chronological order
    FOR reg_record IN
      SELECT 
        sr.id,
        sr.school_id,
        sr.project_id,
        sr.student_class,
        sr.created_at
      FROM public.student_registrations sr
      WHERE sr.school_id = school_record.school_id
      ORDER BY sr.created_at
    LOOP
      -- Get the first subject for this registration to generate the registration number
      SELECT ss.subject_id INTO subject_id_var
      FROM public.student_subjects ss
      WHERE ss.registration_id = reg_record.id
      LIMIT 1;
      
      IF subject_id_var IS NOT NULL THEN
        -- Generate new registration number using existing function
        new_registration_number := generate_registration_number(
          reg_record.school_id,
          reg_record.project_id,
          reg_record.student_class,
          subject_id_var
        );
        
        -- Update the registration with new number
        UPDATE public.student_registrations
        SET 
          registration_number_generated = new_registration_number,
          updated_at = now()
        WHERE id = reg_record.id;
        
        registrations_count := registrations_count + 1;
      END IF;
    END LOOP;
  END LOOP;
  
  -- Log the regeneration completion
  PERFORM public.log_security_action(
    'REGISTRATION_NUMBER_REGENERATION_COMPLETE',
    'student_registrations',
    NULL,
    NULL,
    jsonb_build_object(
      'schools_processed', schools_count,
      'registrations_updated', registrations_count,
      'completed_by', auth.uid(),
      'timestamp', now()
    )
  );
  
  RETURN QUERY SELECT 
    'SUCCESS'::text,
    schools_count,
    registrations_count,
    format('Regenerated registration numbers for %s registrations across %s schools', registrations_count, schools_count)::text;
END;
$function$;

-- Function to execute regeneration in batches (for safety)
CREATE OR REPLACE FUNCTION public.regenerate_registration_numbers_batch(batch_size integer DEFAULT 50)
 RETURNS TABLE(
   batch_number integer,
   schools_in_batch integer,
   registrations_updated integer,
   status text
 )
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  school_record RECORD;
  reg_record RECORD;
  batch_count integer := 0;
  current_batch integer := 1;
  schools_in_current_batch integer := 0;
  registrations_in_current_batch integer := 0;
  new_registration_number text;
  subject_id_var uuid;
BEGIN
  -- Only superadmins can run this regeneration
  IF NOT is_superadmin(auth.uid()) THEN
    RETURN QUERY SELECT 0, 0, 0, 'ERROR: Only superadmins can regenerate registration numbers'::text;
    RETURN;
  END IF;
  
  -- Clear existing codes and sequences on first run
  IF current_batch = 1 THEN
    DELETE FROM public.school_codes;
    DELETE FROM public.student_registration_sequences;
  END IF;
  
  -- Process schools in batches
  FOR school_record IN
    SELECT 
      s.id as school_id,
      s.state,
      s.district,
      MIN(sr.created_at) as first_registration_date
    FROM public.schools s
    INNER JOIN public.student_registrations sr ON s.id = sr.school_id
    GROUP BY s.id, s.state, s.district
    ORDER BY s.state, s.district, MIN(sr.created_at)
  LOOP
    schools_in_current_batch := schools_in_current_batch + 1;
    
    -- Process student registrations for this school
    FOR reg_record IN
      SELECT 
        sr.id,
        sr.school_id,
        sr.project_id,
        sr.student_class,
        sr.created_at
      FROM public.student_registrations sr
      WHERE sr.school_id = school_record.school_id
      ORDER BY sr.created_at
    LOOP
      -- Get the first subject for this registration
      SELECT ss.subject_id INTO subject_id_var
      FROM public.student_subjects ss
      WHERE ss.registration_id = reg_record.id
      LIMIT 1;
      
      IF subject_id_var IS NOT NULL THEN
        -- Generate new registration number
        new_registration_number := generate_registration_number(
          reg_record.school_id,
          reg_record.project_id,
          reg_record.student_class,
          subject_id_var
        );
        
        -- Update the registration
        UPDATE public.student_registrations
        SET 
          registration_number_generated = new_registration_number,
          updated_at = now()
        WHERE id = reg_record.id;
        
        registrations_in_current_batch := registrations_in_current_batch + 1;
      END IF;
    END LOOP;
    
    -- Check if we've reached batch size
    IF schools_in_current_batch >= batch_size THEN
      RETURN QUERY SELECT 
        current_batch,
        schools_in_current_batch,
        registrations_in_current_batch,
        'BATCH_COMPLETE'::text;
      
      current_batch := current_batch + 1;
      schools_in_current_batch := 0;
      registrations_in_current_batch := 0;
    END IF;
  END LOOP;
  
  -- Return final batch if there are remaining schools
  IF schools_in_current_batch > 0 THEN
    RETURN QUERY SELECT 
      current_batch,
      schools_in_current_batch,
      registrations_in_current_batch,
      'FINAL_BATCH_COMPLETE'::text;
  END IF;
END;
$function$;