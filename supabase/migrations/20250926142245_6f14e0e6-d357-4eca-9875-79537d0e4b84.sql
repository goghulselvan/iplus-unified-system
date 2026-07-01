-- Performance optimization indexes for schools table (without CONCURRENTLY for migration)
CREATE INDEX IF NOT EXISTS idx_schools_ss_no ON public.schools(ss_no);
CREATE INDEX IF NOT EXISTS idx_schools_search ON public.schools USING gin(to_tsvector('english', school_name));
CREATE INDEX IF NOT EXISTS idx_schools_state_district ON public.schools(state, district);
CREATE INDEX IF NOT EXISTS idx_schools_status_filters ON public.schools(registration_status, payment_status, name_list_status);
CREATE INDEX IF NOT EXISTS idx_schools_updated_at ON public.schools(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_schools_project_id ON public.schools(current_project_id);

-- Student registrations performance indexes  
CREATE INDEX IF NOT EXISTS idx_student_registrations_project_school ON public.student_registrations(project_id, school_id);
CREATE INDEX IF NOT EXISTS idx_student_registrations_class ON public.student_registrations(student_class);
CREATE INDEX IF NOT EXISTS idx_student_registrations_created_at ON public.student_registrations(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_student_subjects_registration ON public.student_subjects(registration_id, subject_id);

-- Communications performance indexes
CREATE INDEX IF NOT EXISTS idx_communications_school_project ON public.communications(school_id, project_id);
CREATE INDEX IF NOT EXISTS idx_communications_created_at ON public.communications(created_at DESC);

-- Follow-ups performance indexes
CREATE INDEX IF NOT EXISTS idx_follow_ups_date_status ON public.follow_ups(follow_up_date, status);
CREATE INDEX IF NOT EXISTS idx_follow_ups_school_project ON public.follow_ups(school_id, project_id);

-- Function to get optimized dashboard metrics
CREATE OR REPLACE FUNCTION get_optimized_dashboard_metrics(p_project_id uuid DEFAULT NULL)
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
) AS $$
BEGIN
  -- If project_id is specified, calculate for that project only
  IF p_project_id IS NOT NULL THEN
    RETURN QUERY
    SELECT 
      COUNT(*)::bigint as total_schools,
      COUNT(*) FILTER (WHERE s.courier_status = 'Sent')::bigint as courier_sent,
      COUNT(*) FILTER (WHERE s.courier_status = 'Returned')::bigint as courier_returned,
      COUNT(*) FILTER (WHERE s.contacted = 'Yes')::bigint as contacted_yes,
      COUNT(*) FILTER (WHERE s.contacted = 'No')::bigint as contacted_no,
      COUNT(*) FILTER (WHERE s.registration_interest = 'Interested')::bigint as registration_interested,
      COUNT(*) FILTER (WHERE s.registration_interest = 'Not Interested')::bigint as registration_not_interested,
      COUNT(*) FILTER (WHERE s.consent_form_requested = 'Yes')::bigint as consent_requested,
      COUNT(*) FILTER (WHERE s.consent_form_sent IN ('Sent', 'Sent Digitally'))::bigint as consent_form_sent_total,
      COUNT(*) FILTER (WHERE s.consent_form_sent = 'Sent')::bigint as consent_form_sent_physical,
      COUNT(*) FILTER (WHERE s.consent_form_sent = 'Sent Digitally')::bigint as consent_form_sent_digital,
      COUNT(*) FILTER (WHERE s.registration_status = 'Confirmed')::bigint as registration_confirmed,
      COUNT(*) FILTER (WHERE s.registration_status = 'In Progress')::bigint as registration_in_progress,
      COUNT(*) FILTER (WHERE s.name_list_status = 'Received')::bigint as name_list_received,
      COUNT(*) FILTER (WHERE s.name_list_status = 'Uploaded')::bigint as name_list_uploaded,
      COUNT(*) FILTER (WHERE s.payment_status = 'Received')::bigint as payment_received,
      COUNT(*) FILTER (WHERE s.question_paper_sent = 'Sent')::bigint as question_paper_sent,
      COUNT(*) FILTER (WHERE s.answer_sheet_status = 'Received')::bigint as answer_sheet_received,
      COUNT(*) FILTER (WHERE s.result_status = 'Sent')::bigint as result_sent,
      COUNT(*) FILTER (WHERE s.brochure_delivery_status = 'Physical Only')::bigint as brochure_physical_only,
      COUNT(*) FILTER (WHERE s.brochure_delivery_status = 'Digital Sent')::bigint as brochure_digital_sent,
      COUNT(*) FILTER (WHERE s.brochure_delivery_status = 'Both Physical & Digital')::bigint as brochure_both_physical_digital
    FROM public.schools s
    WHERE s.current_project_id = p_project_id;
  ELSE
    -- Return all metrics without materialized view for now
    RETURN QUERY
    SELECT 
      COUNT(*)::bigint as total_schools,
      COUNT(*) FILTER (WHERE s.courier_status = 'Sent')::bigint as courier_sent,
      COUNT(*) FILTER (WHERE s.courier_status = 'Returned')::bigint as courier_returned,
      COUNT(*) FILTER (WHERE s.contacted = 'Yes')::bigint as contacted_yes,
      COUNT(*) FILTER (WHERE s.contacted = 'No')::bigint as contacted_no,
      COUNT(*) FILTER (WHERE s.registration_interest = 'Interested')::bigint as registration_interested,
      COUNT(*) FILTER (WHERE s.registration_interest = 'Not Interested')::bigint as registration_not_interested,
      COUNT(*) FILTER (WHERE s.consent_form_requested = 'Yes')::bigint as consent_requested,
      COUNT(*) FILTER (WHERE s.consent_form_sent IN ('Sent', 'Sent Digitally'))::bigint as consent_form_sent_total,
      COUNT(*) FILTER (WHERE s.consent_form_sent = 'Sent')::bigint as consent_form_sent_physical,
      COUNT(*) FILTER (WHERE s.consent_form_sent = 'Sent Digitally')::bigint as consent_form_sent_digital,
      COUNT(*) FILTER (WHERE s.registration_status = 'Confirmed')::bigint as registration_confirmed,
      COUNT(*) FILTER (WHERE s.registration_status = 'In Progress')::bigint as registration_in_progress,
      COUNT(*) FILTER (WHERE s.name_list_status = 'Received')::bigint as name_list_received,
      COUNT(*) FILTER (WHERE s.name_list_status = 'Uploaded')::bigint as name_list_uploaded,
      COUNT(*) FILTER (WHERE s.payment_status = 'Received')::bigint as payment_received,
      COUNT(*) FILTER (WHERE s.question_paper_sent = 'Sent')::bigint as question_paper_sent,
      COUNT(*) FILTER (WHERE s.answer_sheet_status = 'Received')::bigint as answer_sheet_received,
      COUNT(*) FILTER (WHERE s.result_status = 'Sent')::bigint as result_sent,
      COUNT(*) FILTER (WHERE s.brochure_delivery_status = 'Physical Only')::bigint as brochure_physical_only,
      COUNT(*) FILTER (WHERE s.brochure_delivery_status = 'Digital Sent')::bigint as brochure_digital_sent,
      COUNT(*) FILTER (WHERE s.brochure_delivery_status = 'Both Physical & Digital')::bigint as brochure_both_physical_digital
    FROM public.schools s;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function for optimized school search
CREATE OR REPLACE FUNCTION search_schools_optimized(
  p_search_term text DEFAULT NULL,
  p_state text DEFAULT NULL,
  p_district text DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS TABLE(
  id uuid,
  ss_no integer,
  school_name text,
  school_address text,
  district text,
  state text,
  board text,
  email text,
  mobile1 text,
  mobile2 text,
  contact_person_name text,
  registration_status registration_status,
  payment_status payment_status,
  name_list_status name_list_status,
  total_count bigint
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    s.id, s.ss_no, s.school_name, s.school_address, s.district, s.state, s.board,
    s.email, s.mobile1, s.mobile2, s.contact_person_name,
    s.registration_status, s.payment_status, s.name_list_status,
    COUNT(*) OVER() as total_count
  FROM public.schools s
  WHERE 
    (p_search_term IS NULL OR p_search_term = '' OR 
     s.school_name ILIKE '%' || p_search_term || '%' OR 
     s.ss_no::text = p_search_term)
    AND (p_state IS NULL OR p_state = '' OR s.state = p_state)
    AND (p_district IS NULL OR p_district = '' OR s.district = p_district)
    AND (p_status IS NULL OR p_status = '' OR s.registration_status::text = p_status)
  ORDER BY s.updated_at DESC
  LIMIT p_limit OFFSET p_offset;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;