-- Emergency data recovery with manual edit mode enabled
-- Set manual edit mode to bypass protection triggers
SELECT set_config('app.manual_edit_mode', 'true', true);

-- Restore the school data that was accidentally wiped during manual edit
UPDATE schools 
SET 
  school_name = 'Vaima Kids',
  school_address = 'thiruvalluvar nagar, rajapalayam',
  district = 'Virudhunagar',
  state = 'TAMIL NADU',
  board = 'TN-N&P',
  contact_person_name = 'Yamuna - Principal',
  mobile1 = '9150405529',
  pincode = '626117',
  mobile2 = '0000',  -- Keep the mobile2 update that was intended
  updated_at = now()
WHERE id = 'f539c62a-c844-44ff-80fa-e98b12714433';

-- Reset manual edit mode
SELECT set_config('app.manual_edit_mode', 'false', true);

-- Log this recovery action
INSERT INTO security_audit_logs (user_id, action, table_name, record_id, old_values, new_values)
VALUES (
  '00000000-0000-0000-0000-000000000000',  -- System recovery
  'EMERGENCY_DATA_RECOVERY',
  'schools',
  'f539c62a-c844-44ff-80fa-e98b12714433',
  jsonb_build_object(
    'reason', 'Manual edit accidentally wiped essential school data - SS No 7618',
    'recovered_from', 'security_audit_logs at 2025-09-11 07:19:57'
  ),
  jsonb_build_object(
    'school_name', 'Vaima Kids',
    'district', 'Virudhunagar',
    'state', 'TAMIL NADU',
    'board', 'TN-N&P'
  )
);