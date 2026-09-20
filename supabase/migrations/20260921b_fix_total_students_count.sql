-- get_total_students_count has been erroring on every single call since it
-- was written — it calls is_superadmin(v_user_id), but the real function
-- takes zero arguments (reads auth.uid() internally). The frontend's
-- supabase.rpc() destructures only { data: ts }, never checks { error }, so
-- the hard SQL error was silently swallowed and totalStudents fell through
-- to `(ts as number) || 0` — a genuine 100%-reproducible bug, not a data gap.
CREATE OR REPLACE FUNCTION public.get_total_students_count(p_project_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_count integer;
  v_user_id uuid := auth.uid();
  v_access_level text;
  v_districts text[];
BEGIN
  SELECT data_access_level, assigned_districts
  INTO v_access_level, v_districts
  FROM public.profiles WHERE user_id = v_user_id;

  SELECT COUNT(DISTINCT r.id) INTO v_count
  FROM public.portal_registered_students r
  JOIN public.schools sc ON sc.id = r.school_id
  WHERE r.project_id = p_project_id
    AND (
      public.is_superadmin()
      OR v_access_level = 'full'
      OR v_access_level IS NULL
      OR (v_access_level = 'regional' AND (
        v_districts IS NULL OR 'ALL' = ANY(v_districts) OR sc.district = ANY(v_districts)
      ))
    );

  RETURN COALESCE(v_count, 0);
END;
$function$;
