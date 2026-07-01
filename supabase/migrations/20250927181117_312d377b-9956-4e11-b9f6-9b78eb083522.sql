-- Function to normalize text to title case for consistent display
CREATE OR REPLACE FUNCTION public.normalize_to_title_case(input_text text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  IF input_text IS NULL OR input_text = '' THEN
    RETURN input_text;
  END IF;
  
  -- Convert to title case: first letter uppercase, rest lowercase
  RETURN initcap(trim(input_text));
END;
$$;

-- Function for case-insensitive search across multiple text fields
CREATE OR REPLACE FUNCTION public.search_schools_case_insensitive(
  search_term text DEFAULT NULL,
  state_filter text DEFAULT NULL,
  district_filter text DEFAULT NULL,
  board_filter text DEFAULT NULL,
  status_filter text DEFAULT NULL,
  workflow_filter text DEFAULT NULL,
  payment_filter text DEFAULT NULL,
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
  registration_interest_comment text,
  consent_form_requested consent_status,
  consent_form_comment text,
  consent_form_sent text,
  registration_status registration_status,
  name_list_status name_list_status,
  payment_status payment_status,
  payment_date date,
  payment_amount numeric,
  payment_mode text,
  question_paper_sent question_paper_status,
  answer_sheet_status answer_sheet_status,
  result_status result_status,
  total_participants integer,
  brochure_delivery_status brochure_delivery_status,
  current_project_id uuid,
  created_at timestamp with time zone,
  updated_at timestamp with time zone,
  per_entry_rate numeric,
  concession_per_entry numeric,
  effective_rate_per_entry numeric,
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
    -- Return all text fields in normalized title case
    normalize_to_title_case(s.school_name) as school_name,
    normalize_to_title_case(s.school_address) as school_address,
    normalize_to_title_case(s.district) as district,
    normalize_to_title_case(s.state) as state,
    normalize_to_title_case(s.board) as board,
    s.pincode,
    normalize_to_title_case(s.contact_person_name) as contact_person_name,
    lower(s.email) as email, -- Email should be lowercase
    s.mobile1,
    s.mobile2,
    s.courier_status,
    s.contacted,
    s.registration_interest,
    s.registration_interest_comment,
    s.consent_form_requested,
    s.consent_form_comment,
    s.consent_form_sent,
    s.registration_status,
    s.name_list_status,
    s.payment_status,
    s.payment_date,
    s.payment_amount,
    s.payment_mode,
    s.question_paper_sent,
    s.answer_sheet_status,
    s.result_status,
    s.total_participants,
    s.brochure_delivery_status,
    s.current_project_id,
    s.created_at,
    s.updated_at,
    s.per_entry_rate,
    s.concession_per_entry,
    s.effective_rate_per_entry,
    s.expected_amount,
    s.payment_received,
    s.outstanding_balance,
    COUNT(*) OVER() as total_count
  FROM public.schools s
  WHERE 
    -- Case-insensitive search across multiple fields
    (search_term IS NULL OR 
     s.school_name ILIKE '%' || search_term || '%' OR
     s.district ILIKE '%' || search_term || '%' OR
     s.contact_person_name ILIKE '%' || search_term || '%' OR
     s.email ILIKE '%' || search_term || '%' OR
     s.mobile1 ILIKE '%' || search_term || '%' OR
     s.mobile2 ILIKE '%' || search_term || '%')
    AND (state_filter IS NULL OR s.state ILIKE state_filter)
    AND (district_filter IS NULL OR s.district ILIKE district_filter)
    AND (board_filter IS NULL OR s.board ILIKE board_filter)
    AND (status_filter IS NULL OR s.registration_status::text = status_filter)
    AND (workflow_filter IS NULL OR (
      (workflow_filter = 'courier_sent' AND s.courier_status = 'Sent') OR
      (workflow_filter = 'courier_returned' AND s.courier_status = 'Returned') OR
      (workflow_filter = 'contacted_yes' AND s.contacted = 'Yes') OR
      (workflow_filter = 'contacted_no' AND s.contacted = 'No') OR
      (workflow_filter = 'registration_interested' AND s.registration_interest = 'Interested') OR
      (workflow_filter = 'registration_not_interested' AND s.registration_interest = 'Not Interested') OR
      (workflow_filter = 'consent_requested' AND s.consent_form_requested = 'Yes') OR
      (workflow_filter = 'registration_confirmed' AND s.registration_status = 'Confirmed') OR
      (workflow_filter = 'registration_pending' AND s.registration_status = 'Pending') OR
      (workflow_filter = 'registration_in_progress' AND s.registration_status = 'In Progress') OR
      (workflow_filter = 'name_list_received' AND s.name_list_status = 'Received') OR
      (workflow_filter = 'name_list_uploaded' AND s.name_list_status = 'Uploaded') OR
      (workflow_filter = 'payment_received' AND s.payment_status = 'Received') OR
      (workflow_filter = 'question_paper_sent' AND s.question_paper_sent = 'Sent') OR
      (workflow_filter = 'answer_sheet_received' AND s.answer_sheet_status = 'Received') OR
      (workflow_filter = 'result_sent' AND s.result_status = 'Sent')
    ))
    AND (payment_filter IS NULL OR s.payment_status::text = payment_filter)
  ORDER BY s.updated_at DESC
  LIMIT limit_count
  OFFSET offset_count;
END;
$$;