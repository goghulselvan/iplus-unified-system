-- 1. Update the trigger function to use 2-digit district and school codes.
CREATE OR REPLACE FUNCTION public.auto_generate_registration_number()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_existing text;
  v_school_id uuid;
  v_project_id uuid;
  v_student_class text;
  v_student_id uuid;
  v_student_sequence integer;
  v_subject_code text;
  v_state_code text;
  v_district_code text;
  v_school_code text;
  v_class_code integer;
  v_school_state text;
  v_school_district text;
BEGIN
  IF TG_TABLE_NAME = 'student_registrations' THEN
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'student_subjects' THEN
    SELECT sr.registration_number_generated, sr.school_id, sr.project_id, sr.student_class, sr.student_id
    INTO v_existing, v_school_id, v_project_id, v_student_class, v_student_id
    FROM public.student_registrations sr
    WHERE sr.id = NEW.registration_id;

    IF v_existing IS NOT NULL THEN
      RETURN NEW;
    END IF;

    IF v_student_id IS NOT NULL THEN
      SELECT s.student_sequence INTO v_student_sequence
      FROM public.students s WHERE s.id = v_student_id;

      SELECT subject_code INTO v_subject_code
      FROM public.olympiad_subjects WHERE id = NEW.subject_id;

      SELECT state, district INTO v_school_state, v_school_district
      FROM public.schools WHERE id = v_school_id;

      SELECT state_code INTO v_state_code
      FROM public.state_codes WHERE state_name ILIKE v_school_state;

      SELECT district_code INTO v_district_code
      FROM public.district_codes
      WHERE district_name ILIKE v_school_district AND state_code = v_state_code;

      v_school_code := public.get_or_create_school_code(v_school_id);
      v_class_code := public.map_student_class_to_code(v_student_class);

      UPDATE public.student_registrations
      SET registration_number_generated = format(
            '%s-%s-%s-%s-%s-%s',
            v_subject_code,
            LPAD(v_state_code, 2, '0'),
            LPAD(LTRIM(v_district_code, '0'), 2, '0'),  -- 2 digits now
            LPAD(LTRIM(v_school_code, '0'), 2, '0'),    -- 2 digits now
            LPAD(v_class_code::text, 2, '0'),
            LPAD(v_student_sequence::text, 3, '0')
          ),
          class_code = v_class_code,
          updated_at = now()
      WHERE id = NEW.registration_id;
    ELSE
      UPDATE public.student_registrations
      SET registration_number_generated = public.build_student_registration_number(
            v_school_id, v_project_id, v_student_class, NEW.subject_id
          ),
          class_code = public.map_student_class_to_code(v_student_class),
          updated_at = now()
      WHERE id = NEW.registration_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

-- 2. Backfill all rows in the active project with the new 2-digit format.
DO $$
DECLARE
  v_active_project uuid;
  r RECORD;
  v_subject_code text;
  v_state_code text;
  v_district_code text;
  v_school_code text;
  v_class_code integer;
  v_school_state text;
  v_school_district text;
  v_new_reg text;
BEGIN
  SELECT id INTO v_active_project FROM public.olympiad_projects WHERE is_active = true LIMIT 1;
  IF v_active_project IS NULL THEN RETURN; END IF;

  FOR r IN
    SELECT sr.id AS reg_id, sr.school_id, sr.student_class, sr.student_id,
           ss.subject_id, s.student_sequence
    FROM public.student_registrations sr
    JOIN public.student_subjects ss ON ss.registration_id = sr.id
    JOIN public.students s ON s.id = sr.student_id
    WHERE sr.project_id = v_active_project
      AND sr.student_id IS NOT NULL
      AND COALESCE(sr.registration_number_generated, '') NOT LIKE '%[RETIRED]%'
  LOOP
    SELECT subject_code INTO v_subject_code
    FROM public.olympiad_subjects WHERE id = r.subject_id;

    SELECT state, district INTO v_school_state, v_school_district
    FROM public.schools WHERE id = r.school_id;

    SELECT state_code INTO v_state_code
    FROM public.state_codes WHERE state_name ILIKE v_school_state;

    SELECT district_code INTO v_district_code
    FROM public.district_codes
    WHERE district_name ILIKE v_school_district AND state_code = v_state_code;

    v_school_code := public.get_or_create_school_code(r.school_id);
    v_class_code := public.map_student_class_to_code(r.student_class);

    v_new_reg := format(
      '%s-%s-%s-%s-%s-%s',
      v_subject_code,
      LPAD(v_state_code, 2, '0'),
      LPAD(LTRIM(v_district_code, '0'), 2, '0'),
      LPAD(LTRIM(v_school_code, '0'), 2, '0'),
      LPAD(v_class_code::text, 2, '0'),
      LPAD(r.student_sequence::text, 3, '0')
    );

    UPDATE public.student_registrations
    SET registration_number_generated = v_new_reg,
        class_code = v_class_code,
        updated_at = now()
    WHERE id = r.reg_id;
  END LOOP;
END $$;