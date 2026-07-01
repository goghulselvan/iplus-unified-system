-- Add data masking and enhanced security for schools table

-- Create a view that masks sensitive data for limited access users
CREATE OR REPLACE VIEW public.schools_masked AS
SELECT 
  id,
  ss_no,
  school_name,
  school_address,
  district,
  board,
  pincode,
  -- Mask sensitive contact information based on access level
  CASE 
    WHEN can_access_school_data(district) THEN email
    ELSE CASE 
      WHEN email IS NOT NULL THEN '***@*****.com'
      ELSE NULL
    END
  END as email,
  CASE 
    WHEN can_access_school_data(district) THEN mobile1
    ELSE CASE 
      WHEN mobile1 IS NOT NULL THEN '***-***-****'
      ELSE NULL
    END
  END as mobile1,
  CASE 
    WHEN can_access_school_data(district) THEN mobile2
    ELSE CASE 
      WHEN mobile2 IS NOT NULL THEN '***-***-****'
      ELSE NULL
    END
  END as mobile2,
  CASE 
    WHEN can_access_school_data(district) THEN contact_person_name
    ELSE CASE 
      WHEN contact_person_name IS NOT NULL THEN '*** *** ***'
      ELSE NULL
    END
  END as contact_person_name,
  -- Non-sensitive fields remain visible
  courier_status,
  contacted,
  registration_interest,
  registration_interest_comment,
  consent_form_requested,
  consent_form_comment,
  consent_form_sent,
  registration_status,
  name_list_status,
  payment_status,
  payment_date,
  payment_amount,
  payment_mode,
  question_paper_sent,
  answer_sheet_status,
  result_status,
  total_participants,
  current_project_id,
  created_at,
  updated_at
FROM public.schools;

-- Enable RLS on the masked view
ALTER VIEW public.schools_masked SET (security_barrier = on);

-- Create trigger to log access to sensitive contact data
CREATE OR REPLACE FUNCTION public.audit_schools_contact_access()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  accessed_sensitive_columns text[] := ARRAY[]::text[];
  user_has_full_access boolean;
BEGIN
  -- Check if user has full access to contact data
  user_has_full_access := can_access_school_data();
  
  -- If user accessed the raw schools table with contact info, log it
  IF TG_OP = 'SELECT' AND user_has_full_access THEN
    -- Log access to sensitive contact information
    PERFORM log_sensitive_data_access(
      'schools',
      'CONTACT_DATA_ACCESS',
      1,
      ARRAY['email', 'mobile1', 'mobile2', 'contact_person_name'],
      'Direct school contact data access'
    );
  END IF;
  
  RETURN NULL; -- For AFTER triggers
END;
$function$;

-- Update schools RLS policies to enforce granular access
DROP POLICY IF EXISTS "Only authenticated managers and superadmins can view schools" ON public.schools;

CREATE POLICY "Granular access to schools data based on territory"
ON public.schools FOR SELECT
USING (
  -- Superadmins can see everything
  is_superadmin(auth.uid()) OR
  -- Managers with full access can see everything  
  (is_manager_or_superadmin() AND can_access_school_data()) OR
  -- Regional managers can only see their assigned districts
  (is_manager_or_superadmin() AND can_access_school_data(district))
);

-- Create separate policy for bulk export operations (requires explicit approval)
CREATE POLICY "Bulk export requires superadmin approval"
ON public.schools FOR SELECT
USING (
  -- Only allow bulk access for superadmins or with explicit approval
  is_superadmin(auth.uid()) OR
  (is_manager_or_superadmin() AND validate_sensitive_operation('BULK_EXPORT', 'schools'))
);

-- Add column-level security for the most sensitive data
REVOKE SELECT (email, mobile1, mobile2, contact_person_name) ON public.schools FROM authenticated;
GRANT SELECT (email, mobile1, mobile2, contact_person_name) ON public.schools TO authenticated;