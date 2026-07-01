
-- =====================================================
-- 1. STUDENTS TABLE (one row per real student)
-- =====================================================
CREATE TABLE IF NOT EXISTS public.students (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL,
  school_id uuid NOT NULL,
  student_class text NOT NULL,
  class_code integer,
  student_name text NOT NULL,
  student_name_normalized text GENERATED ALWAYS AS (lower(btrim(student_name))) STORED,
  student_sequence integer NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Unique student per (school, project, class, normalized name)
CREATE UNIQUE INDEX IF NOT EXISTS uniq_students_school_project_class_name
  ON public.students (school_id, project_id, class_code, student_name_normalized);

-- Unique sequence per (school, project, class)
CREATE UNIQUE INDEX IF NOT EXISTS uniq_students_sequence
  ON public.students (school_id, project_id, class_code, student_sequence);

CREATE INDEX IF NOT EXISTS idx_students_project ON public.students (project_id);
CREATE INDEX IF NOT EXISTS idx_students_school ON public.students (school_id);

ALTER TABLE public.students ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Managers can view students"
  ON public.students FOR SELECT
  USING (public.is_manager_or_superadmin());

CREATE POLICY "Managers can insert students"
  ON public.students FOR INSERT
  WITH CHECK (public.is_manager_or_superadmin() AND auth.uid() = created_by);

CREATE POLICY "Managers can update students"
  ON public.students FOR UPDATE
  USING (public.is_manager_or_superadmin());

CREATE POLICY "Superadmins can delete students"
  ON public.students FOR DELETE
  USING (public.is_superadmin(auth.uid()));

-- updated_at trigger
DROP TRIGGER IF EXISTS trg_students_updated_at ON public.students;
CREATE TRIGGER trg_students_updated_at
  BEFORE UPDATE ON public.students
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- =====================================================
-- 2. LINK student_registrations -> students
-- =====================================================
ALTER TABLE public.student_registrations
  ADD COLUMN IF NOT EXISTS student_id uuid REFERENCES public.students(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_student_registrations_student_id
  ON public.student_registrations (student_id);

-- =====================================================
-- 3. NEW REG NUMBER BUILDER (uses students.student_sequence
--    when linked; falls back to LEGACY per-row sequence otherwise)
-- =====================================================
CREATE OR REPLACE FUNCTION public.build_student_registration_number(
  school_uuid uuid,
  project_uuid uuid,
  class_name text,
  subject_uuid uuid
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_subject_code text;
  v_state_code text;
  v_district_code text;
  v_school_code text;
  v_class_code integer;
  v_student_sequence integer;
  v_final_number text;
  v_school_state text;
  v_school_district text;
BEGIN
  SELECT olympiad_subjects.subject_code INTO v_subject_code
  FROM public.olympiad_subjects WHERE olympiad_subjects.id = subject_uuid;

  SELECT schools.state, schools.district INTO v_school_state, v_school_district
  FROM public.schools WHERE schools.id = school_uuid;

  SELECT state_codes.state_code INTO v_state_code
  FROM public.state_codes WHERE state_codes.state_name ILIKE v_school_state;

  SELECT district_codes.district_code INTO v_district_code
  FROM public.district_codes
  WHERE district_codes.district_name ILIKE v_school_district
    AND district_codes.state_code = v_state_code;

  v_school_code := public.get_or_create_school_code(school_uuid);
  v_class_code := public.map_student_class_to_code(class_name);

  -- Legacy per-row sequence (used when student_id is NULL)
  INSERT INTO public.student_registration_sequences (school_id, project_id, class_code, last_sequence)
  VALUES (school_uuid, project_uuid, v_class_code, 1)
  ON CONFLICT (school_id, project_id, class_code)
  DO UPDATE SET last_sequence = student_registration_sequences.last_sequence + 1
  RETURNING last_sequence INTO v_student_sequence;

  v_final_number := format(
    '%s-%s-%s-%s-%s-%s',
    v_subject_code,
    LPAD(v_state_code, 2, '0'),
    LPAD(v_district_code, 3, '0'),
    LPAD(v_school_code, 3, '0'),
    LPAD(v_class_code::text, 2, '0'),
    LPAD(v_student_sequence::text, 3, '0')
  );

  RETURN v_final_number;
END;
$function$;

-- New trigger function: prefers student-centric sequence when linked
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

    -- Student-centric path: shared sequence from students.student_sequence
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
            LPAD(v_district_code, 3, '0'),
            LPAD(v_school_code, 3, '0'),
            LPAD(v_class_code::text, 2, '0'),
            LPAD(v_student_sequence::text, 3, '0')
          ),
          class_code = v_class_code,
          updated_at = now()
      WHERE id = NEW.registration_id;
    ELSE
      -- Legacy path: untouched original behavior via build_student_registration_number
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

-- =====================================================
-- 4. RPC: get_school_students  (student-centric view)
-- =====================================================
CREATE OR REPLACE FUNCTION public.get_school_students(
  p_school_id uuid,
  p_project_id uuid
)
RETURNS TABLE(
  student_id uuid,
  student_name text,
  student_class text,
  class_code integer,
  student_sequence integer,
  created_at timestamptz,
  participations jsonb
)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
STABLE
AS $$
  WITH base AS (
    -- Students linked via students table
    SELECT
      s.id AS student_id,
      s.student_name,
      s.student_class,
      s.class_code,
      s.student_sequence,
      s.created_at,
      sr.id AS registration_id,
      sr.registration_number_generated,
      ss.subject_id,
      os.subject_name,
      os.subject_code
    FROM public.students s
    LEFT JOIN public.student_registrations sr
      ON sr.student_id = s.id AND sr.project_id = s.project_id
    LEFT JOIN public.student_subjects ss ON ss.registration_id = sr.id
    LEFT JOIN public.olympiad_subjects os ON os.id = ss.subject_id
    WHERE s.school_id = p_school_id AND s.project_id = p_project_id

    UNION ALL

    -- Legacy registrations (no student_id) — synthesize a pseudo-student per row
    SELECT
      sr.id AS student_id,
      sr.student_name,
      sr.student_class,
      sr.class_code,
      NULL::integer AS student_sequence,
      sr.created_at,
      sr.id AS registration_id,
      sr.registration_number_generated,
      ss.subject_id,
      os.subject_name,
      os.subject_code
    FROM public.student_registrations sr
    LEFT JOIN public.student_subjects ss ON ss.registration_id = sr.id
    LEFT JOIN public.olympiad_subjects os ON os.id = ss.subject_id
    WHERE sr.school_id = p_school_id
      AND sr.project_id = p_project_id
      AND sr.student_id IS NULL
  )
  SELECT
    student_id,
    MAX(student_name) AS student_name,
    MAX(student_class) AS student_class,
    MAX(class_code) AS class_code,
    MAX(student_sequence) AS student_sequence,
    MIN(created_at) AS created_at,
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'registration_id', registration_id,
          'subject_id', subject_id,
          'subject_name', subject_name,
          'subject_code', subject_code,
          'registration_number', registration_number_generated
        )
      ) FILTER (WHERE registration_id IS NOT NULL),
      '[]'::jsonb
    ) AS participations
  FROM base
  GROUP BY student_id
  ORDER BY MIN(created_at) DESC;
$$;

GRANT EXECUTE ON FUNCTION public.get_school_students(uuid, uuid) TO authenticated;

-- =====================================================
-- 5. RPC: total_students for dashboard tile
-- =====================================================
CREATE OR REPLACE FUNCTION public.get_total_students_count(p_project_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
STABLE
AS $$
DECLARE
  v_count integer;
  v_user_id uuid := auth.uid();
  v_access_level text;
  v_districts text[];
  v_distinct_legacy integer;
  v_students integer;
BEGIN
  SELECT data_access_level, assigned_districts
  INTO v_access_level, v_districts
  FROM public.profiles WHERE user_id = v_user_id;

  -- Students table (new path)
  SELECT COUNT(*) INTO v_students
  FROM public.students s
  JOIN public.schools sc ON sc.id = s.school_id
  WHERE s.project_id = p_project_id
    AND (
      public.is_superadmin(v_user_id)
      OR v_access_level = 'full'
      OR v_access_level IS NULL
      OR (v_access_level = 'regional' AND (
        v_districts IS NULL OR 'ALL' = ANY(v_districts) OR sc.district = ANY(v_districts)
      ))
    );

  -- Legacy registrations not linked to a student row — count distinct (school, class, name)
  SELECT COUNT(*) INTO v_distinct_legacy
  FROM (
    SELECT DISTINCT sr.school_id, sr.student_class, lower(btrim(sr.student_name)) AS nm
    FROM public.student_registrations sr
    JOIN public.schools sc ON sc.id = sr.school_id
    WHERE sr.project_id = p_project_id
      AND sr.student_id IS NULL
      AND (
        public.is_superadmin(v_user_id)
        OR v_access_level = 'full'
        OR v_access_level IS NULL
        OR (v_access_level = 'regional' AND (
          v_districts IS NULL OR 'ALL' = ANY(v_districts) OR sc.district = ANY(v_districts)
        ))
      )
  ) x;

  v_count := COALESCE(v_students, 0) + COALESCE(v_distinct_legacy, 0);
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_total_students_count(uuid) TO authenticated;
