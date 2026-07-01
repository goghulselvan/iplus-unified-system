-- Standardize district names using the safe manual edit function
-- This bypasses the protection mechanism for bulk district standardization

-- Set manual edit mode and update district names to merge variations
DO $$
DECLARE
  school_record RECORD;
BEGIN
  -- Update CHENGALPATTU (1 school) to Chengalpattu
  FOR school_record IN 
    SELECT id FROM public.schools 
    WHERE UPPER(TRIM(state)) = 'TAMIL NADU' AND district = 'CHENGALPATTU'
  LOOP
    PERFORM public.update_school_with_manual_edit(
      school_record.id,
      jsonb_build_object('district', 'Chengalpattu')
    );
  END LOOP;

  -- Update CHENNAI (1 school) to Chennai
  FOR school_record IN 
    SELECT id FROM public.schools 
    WHERE UPPER(TRIM(state)) = 'TAMIL NADU' AND district = 'CHENNAI'
  LOOP
    PERFORM public.update_school_with_manual_edit(
      school_record.id,
      jsonb_build_object('district', 'Chennai')
    );
  END LOOP;

  -- Update COIMBATORE (11 schools) to Coimbatore
  FOR school_record IN 
    SELECT id FROM public.schools 
    WHERE UPPER(TRIM(state)) = 'TAMIL NADU' AND district = 'COIMBATORE'
  LOOP
    PERFORM public.update_school_with_manual_edit(
      school_record.id,
      jsonb_build_object('district', 'Coimbatore')
    );
  END LOOP;

  -- Update THOOTHUKUDI (3 schools) to Thoothukudi
  FOR school_record IN 
    SELECT id FROM public.schools 
    WHERE UPPER(TRIM(state)) = 'TAMIL NADU' AND district = 'THOOTHUKUDI'
  LOOP
    PERFORM public.update_school_with_manual_edit(
      school_record.id,
      jsonb_build_object('district', 'Thoothukudi')
    );
  END LOOP;

  -- Update TIRUNELVELI (2 schools) to Tirunelveli
  FOR school_record IN 
    SELECT id FROM public.schools 
    WHERE UPPER(TRIM(state)) = 'TAMIL NADU' AND district = 'TIRUNELVELI'
  LOOP
    PERFORM public.update_school_with_manual_edit(
      school_record.id,
      jsonb_build_object('district', 'Tirunelveli')
    );
  END LOOP;

  -- Update VIRUDHUNAGAR (3 schools) to Virudhunagar
  FOR school_record IN 
    SELECT id FROM public.schools 
    WHERE UPPER(TRIM(state)) = 'TAMIL NADU' AND district = 'VIRUDHUNAGAR'
  LOOP
    PERFORM public.update_school_with_manual_edit(
      school_record.id,
      jsonb_build_object('district', 'Virudhunagar')
    );
  END LOOP;

END $$;