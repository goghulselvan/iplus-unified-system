-- Update the registration format config to include all 6 components
UPDATE registration_format_config 
SET component_order = '["subject", "state", "district", "school", "class", "student"]'
WHERE is_active = true;