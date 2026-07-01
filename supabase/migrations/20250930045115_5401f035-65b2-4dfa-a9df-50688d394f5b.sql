-- Drop the triggers first, then the functions
DROP TRIGGER IF EXISTS validate_state_lookup_trigger ON state_codes;
DROP TRIGGER IF EXISTS validate_states_before_insert ON states;
DROP TRIGGER IF EXISTS validate_districts_before_insert ON districts;  
DROP TRIGGER IF EXISTS validate_olympiad_subjects_before_insert ON olympiad_subjects;

DROP FUNCTION IF EXISTS validate_state_lookup() CASCADE;
DROP FUNCTION IF EXISTS validate_district_lookup() CASCADE;
DROP FUNCTION IF EXISTS validate_olympiad_subject_lookup() CASCADE;