CREATE OR REPLACE FUNCTION public.delete_student_registrations_by_school(p_school_id uuid, p_specific_student_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  deleted_count integer := 0;
  affected_student_ids uuid[];
BEGIN
  -- Only managers and superadmins can delete registrations
  IF NOT is_manager_or_superadmin() THEN
    RAISE EXCEPTION 'Only managers and superadmins can delete student registrations';
  END IF;

  IF p_specific_student_ids IS NOT NULL THEN
    -- Capture affected students (the people) before deleting registrations
    SELECT array_agg(DISTINCT student_id) INTO affected_student_ids
    FROM public.student_registrations
    WHERE school_id = p_school_id
      AND id = ANY(p_specific_student_ids)
      AND student_id IS NOT NULL;

    DELETE FROM public.student_subjects
    WHERE registration_id IN (
      SELECT id FROM public.student_registrations
      WHERE school_id = p_school_id
        AND id = ANY(p_specific_student_ids)
    );

    DELETE FROM public.student_registrations
    WHERE school_id = p_school_id
      AND id = ANY(p_specific_student_ids);

    GET DIAGNOSTICS deleted_count = ROW_COUNT;

    -- Delete student rows that now have no remaining registrations.
    -- This preserves student_sequence gaps (roll number gaps) since we
    -- do not renumber survivors.
    IF affected_student_ids IS NOT NULL THEN
      DELETE FROM public.students s
      WHERE s.id = ANY(affected_student_ids)
        AND NOT EXISTS (
          SELECT 1 FROM public.student_registrations sr
          WHERE sr.student_id = s.id
        );
    END IF;
  ELSE
    -- Delete all registrations for the school
    DELETE FROM public.student_subjects
    WHERE registration_id IN (
      SELECT id FROM public.student_registrations
      WHERE school_id = p_school_id
    );

    DELETE FROM public.student_registrations
    WHERE school_id = p_school_id;

    GET DIAGNOSTICS deleted_count = ROW_COUNT;

    -- Remove all student records for this school as well
    DELETE FROM public.students WHERE school_id = p_school_id;

    -- Reset sequences for this school (restart student series)
    DELETE FROM public.student_registration_sequences
    WHERE school_id = p_school_id;
  END IF;

  PERFORM public.log_security_action(
    'DELETE_STUDENT_REGISTRATIONS',
    'student_registrations',
    p_school_id,
    NULL,
    jsonb_build_object(
      'deleted_count', deleted_count,
      'school_id', p_school_id,
      'specific_students', p_specific_student_ids,
      'action_type', CASE
        WHEN p_specific_student_ids IS NOT NULL THEN 'selective_delete'
        ELSE 'full_delete'
      END
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'message', format('Successfully deleted %s student registration(s)', deleted_count),
    'deleted_count', deleted_count
  );
END;
$function$;