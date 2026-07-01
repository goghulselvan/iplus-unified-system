-- Function to batch update school district names using the safe manual edit approach
-- This will update all schools with inconsistent district names

DO $$
DECLARE
  school_record RECORD;
  new_district_name TEXT;
BEGIN
  -- Loop through schools that need district name updates
  FOR school_record IN 
    SELECT id, district
    FROM public.schools 
    WHERE state = 'TAMIL NADU' 
      AND district IN ('The Nilgiris', 'THE NILGIRIS', 'Nilgiris', 'Kanniyakumari', 'KANYAKUMARI', 'Kanyakumari')
  LOOP
    -- Determine the correct standardized district name
    IF school_record.district IN ('The Nilgiris', 'THE NILGIRIS', 'Nilgiris') THEN
      new_district_name := 'NILGIRIS';
    ELSIF school_record.district IN ('Kanniyakumari', 'KANYAKUMARI', 'Kanyakumari') THEN
      new_district_name := 'KANNIYAKUMARI';
    ELSE
      new_district_name := school_record.district; -- Fallback, shouldn't happen
    END IF;
    
    -- Use the safe manual edit function to update each school
    PERFORM public.update_school_with_manual_edit(
      school_record.id,
      jsonb_build_object('district', new_district_name)
    );
  END LOOP;
  
  -- Log the completion
  RAISE NOTICE 'Completed standardizing district names for Tamil Nadu schools';
END $$;