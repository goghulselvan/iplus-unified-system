-- Registration/Payment/Namelist cross-tab for the Dashboard Overview section.
-- Ordered by "distance from done" (Confirmed + Received + Uploaded), furthest
-- first — the biggest actionable opportunity leads, the fully-done state
-- trails last. Overpaid/Partial (payment started but not clean Received)
-- land in the tier right before "done", per Goghul's ordering, 2026-09-21.
-- Same access-control as every other dashboard metric — can_access_school_data.
CREATE OR REPLACE FUNCTION public.get_registration_payment_namelist_crosstab(p_project_id uuid)
RETURNS TABLE(
  registration_status text,
  payment_status text,
  name_list_status text,
  school_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  WITH rows AS (
    SELECT
      COALESCE(w.registration_status::text, s.registration_status::text) AS reg,
      COALESCE(w.payment_status::text,      s.payment_status::text)      AS pay,
      COALESCE(w.name_list_status::text,    s.name_list_status::text)    AS list
    FROM schools s
    JOIN school_project_workflow w ON w.school_id = s.id AND w.project_id = p_project_id
    WHERE can_access_school_data(s.district)
  )
  SELECT reg, pay, list, COUNT(*)::bigint AS school_count
  FROM rows
  GROUP BY reg, pay, list
  ORDER BY
    -- Distance from "Confirmed + Received + Uploaded" — 0 is done, higher
    -- means more work remaining. Each field contributes 0/1/2 for its own
    -- distance from its best state.
    (CASE reg  WHEN 'Confirmed' THEN 0 WHEN 'In Progress' THEN 1 ELSE 2 END) +
    (CASE pay  WHEN 'Received'  THEN 0 WHEN 'Partial' THEN 1 WHEN 'Overpaid' THEN 1 ELSE 2 END) +
    (CASE list WHEN 'Uploaded'  THEN 0 WHEN 'Received' THEN 1 ELSE 2 END)
    DESC,
    school_count DESC;
END;
$function$;
