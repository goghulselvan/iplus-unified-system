-- High-scale performance optimization indexes for 60K schools and 300K registrations
-- Using standard CREATE INDEX for transaction compatibility

-- Enable pg_trgm extension for fuzzy text search if not already enabled
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Critical indexes for schools table (60K records)
CREATE INDEX IF NOT EXISTS idx_schools_registration_status ON schools(registration_status) WHERE registration_status IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_schools_payment_status ON schools(payment_status) WHERE payment_status IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_schools_name_list_status ON schools(name_list_status) WHERE name_list_status IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_schools_state_district ON schools(state, district);
CREATE INDEX IF NOT EXISTS idx_schools_board ON schools(board);
CREATE INDEX IF NOT EXISTS idx_schools_courier_status ON schools(courier_status) WHERE courier_status IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_schools_contacted ON schools(contacted) WHERE contacted IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_schools_updated_at_desc ON schools(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_schools_ss_no ON schools(ss_no);
CREATE INDEX IF NOT EXISTS idx_schools_current_project_id ON schools(current_project_id) WHERE current_project_id IS NOT NULL;

-- Full-text search optimization for school name (60K schools)
CREATE INDEX IF NOT EXISTS idx_schools_school_name_trgm ON schools USING gin(school_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_schools_district_trgm ON schools USING gin(district gin_trgm_ops);

-- Critical indexes for student_registrations table (300K records)
CREATE INDEX IF NOT EXISTS idx_student_registrations_project_school ON student_registrations(project_id, school_id);
CREATE INDEX IF NOT EXISTS idx_student_registrations_school_id ON student_registrations(school_id);
CREATE INDEX IF NOT EXISTS idx_student_registrations_project_id ON student_registrations(project_id);
CREATE INDEX IF NOT EXISTS idx_student_registrations_student_class ON student_registrations(student_class);
CREATE INDEX IF NOT EXISTS idx_student_registrations_created_at_desc ON student_registrations(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_student_registrations_reg_num ON student_registrations(registration_number_generated) WHERE registration_number_generated IS NOT NULL;

-- Partial index to exclude retired registrations (massive performance boost)
CREATE INDEX IF NOT EXISTS idx_student_registrations_active ON student_registrations(project_id, school_id) 
WHERE registration_number_generated NOT LIKE '%[RETIRED]%';

-- Indexes for student_subjects (linking table for 300K+ records)
CREATE INDEX IF NOT EXISTS idx_student_subjects_registration_id ON student_subjects(registration_id);
CREATE INDEX IF NOT EXISTS idx_student_subjects_subject_id ON student_subjects(subject_id);
CREATE INDEX IF NOT EXISTS idx_student_subjects_composite ON student_subjects(registration_id, subject_id);

-- Indexes for communications table
CREATE INDEX IF NOT EXISTS idx_communications_school_project ON communications(school_id, project_id);
CREATE INDEX IF NOT EXISTS idx_communications_created_at_desc ON communications(created_at DESC);

-- Indexes for payment_transactions
CREATE INDEX IF NOT EXISTS idx_payment_transactions_school_date ON payment_transactions(school_id, payment_date DESC);
CREATE INDEX IF NOT EXISTS idx_payment_transactions_school_id ON payment_transactions(school_id);

-- Indexes for exam_schedules
CREATE INDEX IF NOT EXISTS idx_exam_schedules_school_project ON exam_schedules(school_id, project_id);
CREATE INDEX IF NOT EXISTS idx_exam_schedules_exam_date ON exam_schedules(exam_date);

-- Indexes for follow_ups
CREATE INDEX IF NOT EXISTS idx_follow_ups_school_date ON follow_ups(school_id, follow_up_date);
CREATE INDEX IF NOT EXISTS idx_follow_ups_status ON follow_ups(status) WHERE status IS NOT NULL;

-- Composite indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_schools_project_status ON schools(current_project_id, registration_status) 
WHERE current_project_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_schools_state_status ON schools(state, registration_status) 
WHERE state IS NOT NULL;

-- Analyze tables to update statistics for query planner (critical for 100 concurrent users)
ANALYZE schools;
ANALYZE student_registrations;
ANALYZE student_subjects;
ANALYZE communications;
ANALYZE payment_transactions;
ANALYZE exam_schedules;
ANALYZE follow_ups;

-- Add comments for documentation
COMMENT ON INDEX idx_schools_registration_status IS 'Optimized for 100 concurrent users filtering by registration status - 60K schools';
COMMENT ON INDEX idx_student_registrations_project_school IS 'Optimized for 300K registrations queries by project and school';
COMMENT ON INDEX idx_schools_school_name_trgm IS 'Full-text search optimization using trigrams for 60K schools';
COMMENT ON INDEX idx_student_registrations_active IS 'Partial index excluding retired registrations - massive performance boost for active data';