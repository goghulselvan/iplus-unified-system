-- 1. Drop the legacy trigger that uses per-subject sequences and overwrites the student-centric numbering.
DROP TRIGGER IF EXISTS trigger_handle_new_student_subject ON public.student_subjects;

-- 2. Backfill: for the active project, recompute registration_number_generated for all existing
--    student_registrations rows that have a linked student_id, using students.student_sequence.
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
      LPAD(v_district_code, 3, '0'),
      LPAD(v_school_code, 3, '0'),
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