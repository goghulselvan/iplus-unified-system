-- Delete district codes that have no associated schools
-- This will clean up empty districts like "Tirupattur", "Test District" etc.

-- First, let's see what we're working with - districts that have no schools
-- We'll delete district codes that don't have any schools associated with them

DELETE FROM public.district_codes 
WHERE district_code IN (
  SELECT dc.district_code 
  FROM public.district_codes dc
  LEFT JOIN public.schools s ON (
    dc.state_code = (
      SELECT sc.state_code 
      FROM public.state_codes sc 
      WHERE UPPER(TRIM(sc.state_name)) = UPPER(TRIM(s.state))
    )
    AND UPPER(TRIM(dc.district_name)) = UPPER(TRIM(s.district))
  )
  WHERE s.id IS NULL
  AND dc.is_active = true
);

-- Log the cleanup action
INSERT INTO public.security_audit_logs (
  user_id, action, table_name, record_id, 
  old_values, new_values, ip_address
) VALUES (
  COALESCE(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid),
  'CLEANUP_EMPTY_DISTRICTS',
  'district_codes',
  NULL,
  NULL,
  jsonb_build_object(
    'cleanup_reason', 'Removed district codes with zero associated schools',
    'cleanup_date', now()
  ),
  inet_client_addr()
);