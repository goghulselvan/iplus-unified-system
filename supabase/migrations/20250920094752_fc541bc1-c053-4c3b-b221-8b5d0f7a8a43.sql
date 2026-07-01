-- First, let's check and fix any existing schools that should have 'Uploaded' status
-- Update schools that have student registrations but are still marked as 'Received'
UPDATE public.schools 
SET name_list_status = 'Uploaded', updated_at = now()
WHERE name_list_status = 'Received' 
AND id IN (
  SELECT DISTINCT school_id 
  FROM public.student_registrations
);

-- Log this bulk update for audit purposes
INSERT INTO public.security_audit_logs (
  user_id, action, table_name, record_id, old_values, new_values, ip_address
) 
SELECT 
  '00000000-0000-0000-0000-000000000000'::uuid,
  'BULK_NAMELIST_STATUS_CORRECTION',
  'schools',
  id,
  jsonb_build_object('old_status', 'Received'),
  jsonb_build_object('new_status', 'Uploaded', 'correction_reason', 'Existing schools with registrations updated to correct status'),
  '127.0.0.1'::inet
FROM public.schools 
WHERE name_list_status = 'Uploaded' 
AND id IN (
  SELECT DISTINCT school_id 
  FROM public.student_registrations
);