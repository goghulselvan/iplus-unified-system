-- Fix security definer view issue and complete the secure implementation

-- Drop the problematic security definer view
DROP VIEW IF EXISTS public.schools_masked;

-- Create a standard view without security definer (users will access via RLS)
CREATE VIEW public.schools_secure AS
SELECT 
  id,
  ss_no,
  school_name,
  school_address,
  district,
  board,
  pincode,
  -- Mask sensitive contact information conditionally
  CASE 
    WHEN can_access_school_data(district) THEN email
    ELSE CASE 
      WHEN email IS NOT NULL THEN regexp_replace(email, '^(.{1,2}).*(@.*)$', '\1***\2')
      ELSE NULL
    END
  END as email,
  CASE 
    WHEN can_access_school_data(district) THEN mobile1
    ELSE CASE 
      WHEN mobile1 IS NOT NULL THEN regexp_replace(mobile1, '^(.{3}).*(.{2})$', '\1***\2')
      ELSE NULL
    END
  END as mobile1,
  CASE 
    WHEN can_access_school_data(district) THEN mobile2
    ELSE CASE 
      WHEN mobile2 IS NOT NULL THEN regexp_replace(mobile2, '^(.{3}).*(.{2})$', '\1***\2')
      ELSE NULL
    END
  END as mobile2,
  CASE 
    WHEN can_access_school_data(district) THEN contact_person_name
    ELSE CASE 
      WHEN contact_person_name IS NOT NULL THEN regexp_replace(contact_person_name, '^(\S+).*$', '\1 ***')
      ELSE NULL
    END
  END as contact_person_name,
  -- Non-sensitive operational fields remain fully visible
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
FROM public.schools
WHERE (
  -- Apply the same access controls as the schools table
  is_superadmin(auth.uid()) OR
  (is_manager_or_superadmin() AND can_access_school_data()) OR
  (is_manager_or_superadmin() AND can_access_school_data(district))
);

-- Add RLS policy for the secure view
ALTER TABLE public.schools_secure ENABLE ROW LEVEL SECURITY;

-- Create policy for secure view access
CREATE POLICY "Allow authenticated users to view masked schools data"
ON public.schools_secure FOR SELECT
USING (is_manager_or_superadmin());

-- Create function to require explicit approval for sensitive data export
CREATE OR REPLACE FUNCTION public.approve_sensitive_data_export(
  user_email text,
  export_reason text,
  data_sensitivity_level text DEFAULT 'high'
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  approval_id uuid;
BEGIN
  -- Only superadmins can approve sensitive data exports
  IF NOT is_superadmin(auth.uid()) THEN
    RAISE EXCEPTION 'Only superadmins can approve sensitive data exports';
  END IF;
  
  -- Create approval record
  INSERT INTO public.sensitive_data_access_log (
    user_id, table_name, operation, 
    sensitive_columns, access_reason
  ) VALUES (
    auth.uid(), 'schools', 'EXPORT_APPROVAL',
    ARRAY['email', 'mobile1', 'mobile2', 'contact_person_name'],
    format('Export approved for %s: %s (Level: %s)', user_email, export_reason, data_sensitivity_level)
  ) RETURNING id INTO approval_id;
  
  RETURN approval_id;
END;
$function$;