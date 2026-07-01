-- Reset incorrectly bulk-updated schools from 2025-09-28 back to Pending
-- This will revert the mass update while preserving legitimate manual updates

UPDATE schools 
SET 
  name_list_status = 'Pending',
  updated_at = now()
WHERE 
  current_project_id = 'da46555a-76f0-4767-890e-647896d5ff90'
  AND name_list_status = 'Received'
  AND DATE(updated_at) = '2025-09-28'
  AND updated_at < '2025-09-29 00:00:00+00';

-- Log this bulk correction action
INSERT INTO security_audit_logs (
  user_id, action, table_name, record_id, old_values, new_values, ip_address
) VALUES (
  '6db65195-f608-46d7-8691-4af7b2a73d39',
  'BULK_STATUS_CORRECTION',
  'schools',
  NULL,
  jsonb_build_object(
    'corrected_date', '2025-09-28',
    'reason', 'Revert incorrect bulk update of name_list_status from Pending to Received',
    'affected_schools_count', (
      SELECT COUNT(*) 
      FROM schools 
      WHERE current_project_id = 'da46555a-76f0-4767-890e-647896d5ff90'
      AND name_list_status = 'Received'
      AND DATE(updated_at) = '2025-09-28'
    )
  ),
  jsonb_build_object(
    'new_status', 'Pending',
    'preserved_manual_updates', 'Updates after 2025-09-29 preserved',
    'correction_timestamp', now()
  ),
  inet_client_addr()
);