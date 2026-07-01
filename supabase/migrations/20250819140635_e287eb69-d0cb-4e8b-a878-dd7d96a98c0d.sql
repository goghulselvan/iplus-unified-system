-- Clean up test data for production deployment
-- Remove all test schools (schools with names containing "Test School")
DELETE FROM workflow_history 
WHERE school_id IN (
  SELECT id FROM schools 
  WHERE school_name ILIKE '%Test School%'
);

DELETE FROM activity_logs 
WHERE school_id IN (
  SELECT id FROM schools 
  WHERE school_name ILIKE '%Test School%'
);

DELETE FROM communications 
WHERE school_id IN (
  SELECT id FROM schools 
  WHERE school_name ILIKE '%Test School%'
);

DELETE FROM consent_forms 
WHERE school_id IN (
  SELECT id FROM schools 
  WHERE school_name ILIKE '%Test School%'
);

DELETE FROM follow_ups 
WHERE school_id IN (
  SELECT id FROM schools 
  WHERE school_name ILIKE '%Test School%'
);

-- Finally delete the test schools themselves
DELETE FROM schools 
WHERE school_name ILIKE '%Test School%';

-- Reset sequences if needed (optional)
-- This ensures SS numbers start from a clean state