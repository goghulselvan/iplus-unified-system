-- The dashboard's "Total Registrations" only ever counted entries the money
-- covers (is_confirmed), so it read 6,453 while the Registration Summary read
-- 7,400 and staff could not see where the 947 went. This returns all three
-- numbers from one place, plus what the unpaid ones are worth, so the tiles
-- add up: paid + unpaid = entered.
--
-- Same access rules as get_dashboard_metrics_by_project_with_access: regional
-- staff see their own districts, and a school counts only once it has a
-- workflow row for the project.
CREATE OR REPLACE FUNCTION public.get_registration_totals(p_project_id uuid)
 RETURNS TABLE(entered bigint, paid bigint, unpaid bigint, amount_unpaid numeric)
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    count(*)::bigint,
    count(*) FILTER (WHERE e.is_confirmed)::bigint,
    count(*) FILTER (WHERE NOT e.is_confirmed)::bigint,
    COALESCE(sum(GREATEST(COALESCE(w.per_entry_rate, 150) - COALESCE(w.concession_per_entry, 0), 0))
             FILTER (WHERE NOT e.is_confirmed), 0)::numeric
  FROM portal_student_enrollments e
  JOIN portal_registered_students r ON r.id = e.student_id
  JOIN schools s ON s.id = r.school_id
  JOIN school_project_workflow w ON w.school_id = s.id AND w.project_id = p_project_id
  WHERE p_project_id IS NOT NULL
    AND r.project_id = p_project_id
    AND can_access_school_data(s.district);
$function$;

REVOKE ALL ON FUNCTION public.get_registration_totals(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_registration_totals(uuid) TO authenticated;
