-- Phase 1: Critical Database Optimization for 200k Schools & 200 Concurrent Users
-- This migration adds composite indexes and optimized RPC functions

-- ============================================================================
-- PART 1: COMPOSITE INDEXES FOR COMMON QUERY PATTERNS
-- ============================================================================

-- Schools table composite indexes for filtering (most critical)
CREATE INDEX IF NOT EXISTS idx_schools_project_status_composite 
ON schools(current_project_id, registration_status, payment_status) 
WHERE current_project_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_schools_location_composite 
ON schools(state, district, board);

CREATE INDEX IF NOT EXISTS idx_schools_workflow_composite 
ON schools(courier_status, contacted, registration_interest);

CREATE INDEX IF NOT EXISTS idx_schools_consent_composite 
ON schools(consent_form_requested, consent_form_sent);

CREATE INDEX IF NOT EXISTS idx_schools_namelist_payment 
ON schools(name_list_status, payment_status, current_project_id);

-- Search optimization indexes
CREATE INDEX IF NOT EXISTS idx_schools_ss_no_search 
ON schools(ss_no) WHERE ss_no IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_schools_name_trgm 
ON schools USING gin(school_name gin_trgm_ops);

-- Payment transactions optimization
CREATE INDEX IF NOT EXISTS idx_payment_transactions_school_date 
ON payment_transactions(school_id, payment_date DESC) 
WHERE school_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_payment_transactions_created 
ON payment_transactions(school_id, created_at DESC);

-- Student registrations composite optimization  
CREATE INDEX IF NOT EXISTS idx_student_registrations_composite 
ON student_registrations(project_id, school_id, student_class) 
WHERE project_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_student_subjects_composite 
ON student_subjects(subject_id, registration_id);

CREATE INDEX IF NOT EXISTS idx_student_registrations_school 
ON student_registrations(school_id, created_at DESC);

-- Activity logs performance
CREATE INDEX IF NOT EXISTS idx_activity_logs_created_at 
ON activity_logs(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_activity_logs_composite 
ON activity_logs(school_id, activity_type, created_at DESC);

-- ============================================================================
-- PART 2: OPTIMIZED RPC FUNCTIONS
-- ============================================================================

-- Function: Get paginated payment transactions for a school
CREATE OR REPLACE FUNCTION get_payment_transactions_paginated(
  p_school_id uuid,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS TABLE(
  id uuid,
  school_id uuid,
  payment_date date,
  payment_amount numeric,
  payment_mode text,
  payment_reference text,
  notes text,
  created_at timestamptz,
  receipt_number integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    pt.id,
    pt.school_id,
    pt.payment_date,
    pt.payment_amount,
    pt.payment_mode,
    pt.payment_reference,
    pt.notes,
    pt.created_at,
    rn.receipt_number
  FROM payment_transactions pt
  LEFT JOIN receipt_numbers rn ON rn.payment_transaction_id = pt.id
  WHERE pt.school_id = p_school_id
  ORDER BY pt.payment_date DESC, pt.created_at DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$;

-- Function: Get student registrations with server-side filtering
CREATE OR REPLACE FUNCTION get_student_registrations_filtered(
  p_project_id uuid,
  p_school_id uuid DEFAULT NULL,
  p_subject_id uuid DEFAULT NULL,
  p_student_class text DEFAULT NULL,
  p_limit integer DEFAULT 100,
  p_offset integer DEFAULT 0
)
RETURNS TABLE(
  id uuid,
  project_id uuid,
  school_id uuid,
  student_name text,
  student_class text,
  registration_number text,
  created_at timestamptz,
  school_name text,
  school_ss_no integer,
  subject_id uuid,
  subject_name text,
  subject_class text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    sr.id,
    sr.project_id,
    sr.school_id,
    sr.student_name,
    sr.student_class,
    sr.registration_number,
    sr.created_at,
    s.school_name,
    s.ss_no as school_ss_no,
    ss.subject_id,
    sub.subject_name,
    sub.class as subject_class
  FROM student_registrations sr
  INNER JOIN schools s ON s.id = sr.school_id
  INNER JOIN student_subjects ss ON ss.registration_id = sr.id
  INNER JOIN olympiad_subjects sub ON sub.id = ss.subject_id
  WHERE sr.project_id = p_project_id
    AND (p_school_id IS NULL OR sr.school_id = p_school_id)
    AND (p_subject_id IS NULL OR ss.subject_id = p_subject_id)
    AND (p_student_class IS NULL OR sr.student_class = p_student_class)
  ORDER BY sr.created_at DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$;

-- Function: Get optimized dashboard metrics with caching hint
CREATE OR REPLACE FUNCTION get_dashboard_metrics_optimized(
  p_project_id uuid DEFAULT NULL
)
RETURNS TABLE(
  total_schools bigint,
  courier_sent bigint,
  courier_returned bigint,
  contacted_yes bigint,
  contacted_no bigint,
  registration_interested bigint,
  registration_not_interested bigint,
  consent_requested bigint,
  consent_form_sent_total bigint,
  consent_form_sent_physical bigint,
  consent_form_sent_digital bigint,
  registration_confirmed bigint,
  registration_pending bigint,
  registration_in_progress bigint,
  name_list_received bigint,
  name_list_uploaded bigint,
  payment_received bigint,
  question_paper_sent bigint,
  answer_sheet_received bigint,
  result_sent bigint,
  brochure_physical_only bigint,
  brochure_digital_sent bigint,
  brochure_both_physical_digital bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    COUNT(*) as total_schools,
    COUNT(*) FILTER (WHERE courier_status = 'Sent') as courier_sent,
    COUNT(*) FILTER (WHERE courier_status = 'Returned') as courier_returned,
    COUNT(*) FILTER (WHERE contacted = 'Yes') as contacted_yes,
    COUNT(*) FILTER (WHERE contacted = 'No') as contacted_no,
    COUNT(*) FILTER (WHERE registration_interest = 'Interested') as registration_interested,
    COUNT(*) FILTER (WHERE registration_interest = 'Not Interested') as registration_not_interested,
    COUNT(*) FILTER (WHERE consent_form_requested = 'Yes') as consent_requested,
    COUNT(*) FILTER (WHERE consent_form_sent IN ('Sent', 'Sent Digitally')) as consent_form_sent_total,
    COUNT(*) FILTER (WHERE consent_form_sent = 'Sent') as consent_form_sent_physical,
    COUNT(*) FILTER (WHERE consent_form_sent = 'Sent Digitally') as consent_form_sent_digital,
    COUNT(*) FILTER (WHERE registration_status = 'Confirmed') as registration_confirmed,
    COUNT(*) FILTER (WHERE registration_status = 'Pending') as registration_pending,
    COUNT(*) FILTER (WHERE registration_status = 'In Progress') as registration_in_progress,
    COUNT(*) FILTER (WHERE name_list_status = 'Received') as name_list_received,
    COUNT(*) FILTER (WHERE name_list_status = 'Uploaded') as name_list_uploaded,
    COUNT(*) FILTER (WHERE payment_status = 'Received') as payment_received,
    COUNT(*) FILTER (WHERE question_paper_sent = 'Sent') as question_paper_sent,
    COUNT(*) FILTER (WHERE answer_sheet_status = 'Received') as answer_sheet_received,
    COUNT(*) FILTER (WHERE result_status = 'Sent') as result_sent,
    COUNT(*) FILTER (WHERE brochure_delivery_status = 'Physical Only') as brochure_physical_only,
    COUNT(*) FILTER (WHERE brochure_delivery_status = 'Digital Sent') as brochure_digital_sent,
    COUNT(*) FILTER (WHERE brochure_delivery_status = 'Both Physical & Digital') as brochure_both_physical_digital
  FROM schools
  WHERE (p_project_id IS NULL OR current_project_id = p_project_id);
END;
$$;

-- ============================================================================
-- PART 3: ENHANCED search_schools_case_insensitive FOR BETTER PERFORMANCE
-- ============================================================================

CREATE OR REPLACE FUNCTION search_schools_case_insensitive_v2(
  search_term text DEFAULT NULL,
  state_filter text DEFAULT NULL,
  district_filter text DEFAULT NULL,
  board_filter text DEFAULT NULL,
  status_filter text DEFAULT NULL,
  workflow_filter text DEFAULT NULL,
  payment_filter text DEFAULT NULL,
  project_filter uuid DEFAULT NULL,
  limit_count integer DEFAULT 50,
  offset_count integer DEFAULT 0
)
RETURNS TABLE(
  id uuid,
  ss_no integer,
  school_name text,
  school_address text,
  district text,
  state text,
  board text,
  pincode text,
  contact_person_name text,
  email text,
  mobile1 text,
  mobile2 text,
  courier_status courier_status,
  contacted contacted_status,
  registration_interest interest_status,
  registration_status registration_status,
  name_list_status name_list_status,
  payment_status payment_status,
  payment_date date,
  payment_amount numeric,
  current_project_id uuid,
  created_at timestamptz,
  updated_at timestamptz,
  per_entry_rate numeric,
  expected_amount numeric,
  payment_received numeric,
  outstanding_balance numeric,
  total_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    s.id,
    s.ss_no,
    s.school_name,
    s.school_address,
    s.district,
    s.state,
    s.board,
    s.pincode,
    s.contact_person_name,
    s.email,
    s.mobile1,
    s.mobile2,
    s.courier_status,
    s.contacted,
    s.registration_interest,
    s.registration_status,
    s.name_list_status,
    s.payment_status,
    s.payment_date,
    s.payment_amount,
    s.current_project_id,
    s.created_at,
    s.updated_at,
    s.per_entry_rate,
    s.expected_amount,
    s.payment_received,
    s.outstanding_balance,
    COUNT(*) OVER() as total_count
  FROM schools s
  WHERE 
    (project_filter IS NULL OR s.current_project_id = project_filter)
    AND (search_term IS NULL OR 
         s.ss_no::text = search_term OR
         s.school_name ILIKE '%' || search_term || '%' OR
         s.ss_no::text ILIKE '%' || search_term || '%' OR
         s.district ILIKE '%' || search_term || '%' OR
         s.contact_person_name ILIKE '%' || search_term || '%')
    AND (state_filter IS NULL OR s.state ILIKE state_filter)
    AND (district_filter IS NULL OR s.district ILIKE district_filter)
    AND (board_filter IS NULL OR s.board ILIKE board_filter)
    AND (status_filter IS NULL OR s.registration_status::text = status_filter)
    AND (payment_filter IS NULL OR s.payment_status::text = payment_filter)
    AND (workflow_filter IS NULL OR (
      (workflow_filter = 'courier_sent' AND s.courier_status = 'Sent') OR
      (workflow_filter = 'contacted_yes' AND s.contacted = 'Yes') OR
      (workflow_filter = 'registration_interested' AND s.registration_interest = 'Interested') OR
      (workflow_filter = 'consent_requested' AND s.consent_form_requested = 'Yes') OR
      (workflow_filter = 'registration_confirmed' AND s.registration_status = 'Confirmed') OR
      (workflow_filter = 'name_list_uploaded' AND s.name_list_status = 'Uploaded') OR
      (workflow_filter = 'payment_received' AND s.payment_status = 'Received')
    ))
  ORDER BY 
    CASE 
      WHEN search_term IS NOT NULL AND s.ss_no::text = search_term THEN 1
      WHEN search_term IS NOT NULL AND s.school_name ILIKE search_term || '%' THEN 2
      WHEN search_term IS NOT NULL AND s.school_name ILIKE '%' || search_term || '%' THEN 3
      ELSE 4
    END,
    s.ss_no ASC
  LIMIT limit_count
  OFFSET offset_count;
END;
$$;

-- Enable pg_trgm extension for fuzzy text search (if not already enabled)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION get_payment_transactions_paginated TO authenticated;
GRANT EXECUTE ON FUNCTION get_student_registrations_filtered TO authenticated;
GRANT EXECUTE ON FUNCTION get_dashboard_metrics_optimized TO authenticated;
GRANT EXECUTE ON FUNCTION search_schools_case_insensitive_v2 TO authenticated;