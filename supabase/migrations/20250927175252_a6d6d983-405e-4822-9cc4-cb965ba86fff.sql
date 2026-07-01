-- Use the manual edit function to standardize district names in Tamil Nadu
-- This bypasses the protected field validation

-- Update CHENGALPATTU (1 school) to Chengalpattu (171 schools)
DO $$
DECLARE
    school_record RECORD;
BEGIN
    FOR school_record IN 
        SELECT id FROM public.schools 
        WHERE UPPER(TRIM(state)) = 'TAMIL NADU' 
          AND district = 'CHENGALPATTU'
    LOOP
        PERFORM public.update_school_with_manual_edit(
            school_record.id,
            jsonb_build_object('district', 'Chengalpattu')
        );
    END LOOP;
END $$;

-- Update CHENNAI (1 school) to Chennai (485 schools)
DO $$
DECLARE
    school_record RECORD;
BEGIN
    FOR school_record IN 
        SELECT id FROM public.schools 
        WHERE UPPER(TRIM(state)) = 'TAMIL NADU' 
          AND district = 'CHENNAI'
    LOOP
        PERFORM public.update_school_with_manual_edit(
            school_record.id,
            jsonb_build_object('district', 'Chennai')
        );
    END LOOP;
END $$;

-- Update COIMBATORE (11 schools) to Coimbatore (500 schools)
DO $$
DECLARE
    school_record RECORD;
BEGIN
    FOR school_record IN 
        SELECT id FROM public.schools 
        WHERE UPPER(TRIM(state)) = 'TAMIL NADU' 
          AND district = 'COIMBATORE'
    LOOP
        PERFORM public.update_school_with_manual_edit(
            school_record.id,
            jsonb_build_object('district', 'Coimbatore')
        );
    END LOOP;
END $$;

-- Update THOOTHUKUDI (3 schools) to Thoothukudi (174 schools)
DO $$
DECLARE
    school_record RECORD;
BEGIN
    FOR school_record IN 
        SELECT id FROM public.schools 
        WHERE UPPER(TRIM(state)) = 'TAMIL NADU' 
          AND district = 'THOOTHUKUDI'
    LOOP
        PERFORM public.update_school_with_manual_edit(
            school_record.id,
            jsonb_build_object('district', 'Thoothukudi')
        );
    END LOOP;
END $$;

-- Update TIRUNELVELI (2 schools) to Tirunelveli (239 schools)
DO $$
DECLARE
    school_record RECORD;
BEGIN
    FOR school_record IN 
        SELECT id FROM public.schools 
        WHERE UPPER(TRIM(state)) = 'TAMIL NADU' 
          AND district = 'TIRUNELVELI'
    LOOP
        PERFORM public.update_school_with_manual_edit(
            school_record.id,
            jsonb_build_object('district', 'Tirunelveli')
        );
    END LOOP;
END $$;

-- Update VIRUDHUNAGAR (3 schools) to Virudhunagar (220 schools)
DO $$
DECLARE
    school_record RECORD;
BEGIN
    FOR school_record IN 
        SELECT id FROM public.schools 
        WHERE UPPER(TRIM(state)) = 'TAMIL NADU' 
          AND district = 'VIRUDHUNAGAR'
    LOOP
        PERFORM public.update_school_with_manual_edit(
            school_record.id,
            jsonb_build_object('district', 'Virudhunagar')
        );
    END LOOP;
END $$;