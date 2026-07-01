-- Fix the critical security vulnerability in get_schools_with_masked_data function
-- The main issues:
-- 1. Function doesn't require authentication
-- 2. Unauthenticated users could still access basic school information
-- 3. No proper RLS enforcement for the function itself

-- First, let's make the function SECURITY DEFINER and add authentication checks
CREATE OR REPLACE FUNCTION public.get_schools_with_masked_data()
 RETURNS TABLE(id uuid, ss_no integer, school_name text, school_address text, district text, board text, pincode text, email text, mobile1 text, mobile2 text, contact_person_name text, courier_status courier_status, contacted contacted_status, registration_interest interest_status, registration_interest_comment text, consent_form_requested consent_status, consent_form_comment text, consent_form_sent text, registration_status registration_status, name_list_status name_list_status, payment_status payment_status, payment_date date, payment_amount numeric, payment_mode text, question_paper_sent question_paper_status, answer_sheet_status answer_sheet_status, result_status result_status, total_participants integer, current_project_id uuid, created_at timestamp with time zone, updated_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- CRITICAL: First check if user is authenticated
  -- If not authenticated, return empty result set
  WITH auth_check AS (
    SELECT 
      CASE 
        WHEN auth.uid() IS NULL THEN false
        ELSE true
      END as is_authenticated
  ),
  -- Get current user's access level directly from profiles (only if authenticated)
  user_access AS (
    SELECT 
      COALESCE(p.data_access_level, 'limited') as access_level,
      COALESCE(p.role, 'manager') as user_role,
      p.assigned_districts,
      ac.is_authenticated
    FROM auth_check ac
    LEFT JOIN public.profiles p ON (p.user_id = auth.uid() AND ac.is_authenticated = true)
  )
  SELECT 
    s.id,
    s.ss_no,
    s.school_name,
    s.school_address,
    s.district,
    s.board,
    s.pincode,
    -- Mask sensitive data based on user's access level
    CASE 
      WHEN NOT ua.is_authenticated THEN NULL
      WHEN ua.user_role = 'superadmin' OR ua.access_level = 'full' THEN s.email
      WHEN ua.access_level = 'regional' AND (
        ua.assigned_districts IS NULL OR 
        'ALL' = ANY(ua.assigned_districts) OR 
        s.district = ANY(ua.assigned_districts)
      ) THEN s.email
      WHEN s.email IS NOT NULL THEN '***@*****.com'
      ELSE NULL
    END as email,
    CASE 
      WHEN NOT ua.is_authenticated THEN NULL
      WHEN ua.user_role = 'superadmin' OR ua.access_level = 'full' THEN s.mobile1
      WHEN ua.access_level = 'regional' AND (
        ua.assigned_districts IS NULL OR 
        'ALL' = ANY(ua.assigned_districts) OR 
        s.district = ANY(ua.assigned_districts)
      ) THEN s.mobile1
      WHEN s.mobile1 IS NOT NULL THEN '***-***-****'
      ELSE NULL
    END as mobile1,
    CASE 
      WHEN NOT ua.is_authenticated THEN NULL
      WHEN ua.user_role = 'superadmin' OR ua.access_level = 'full' THEN s.mobile2
      WHEN ua.access_level = 'regional' AND (
        ua.assigned_districts IS NULL OR 
        'ALL' = ANY(ua.assigned_districts) OR 
        s.district = ANY(ua.assigned_districts)
      ) THEN s.mobile2
      WHEN s.mobile2 IS NOT NULL THEN '***-***-****'
      ELSE NULL
    END as mobile2,
    CASE 
      WHEN NOT ua.is_authenticated THEN NULL
      WHEN ua.user_role = 'superadmin' OR ua.access_level = 'full' THEN s.contact_person_name
      WHEN ua.access_level = 'regional' AND (
        ua.assigned_districts IS NULL OR 
        'ALL' = ANY(ua.assigned_districts) OR 
        s.district = ANY(ua.assigned_districts)
      ) THEN s.contact_person_name
      WHEN s.contact_person_name IS NOT NULL THEN '*** *** ***'
      ELSE NULL
    END as contact_person_name,
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
    s.current_project_id,
    s.created_at,
    s.updated_at
  FROM public.schools s
  CROSS JOIN user_access ua
  -- CRITICAL: Only return data if user is authenticated AND has proper access
  WHERE ua.is_authenticated = true
    AND (
      -- Managers and superadmins can see schools (but with data masking applied above)
      ua.user_role IN ('superadmin', 'manager') OR
      -- Regional users can only see their assigned districts
      (ua.access_level = 'regional' AND (
        ua.assigned_districts IS NULL OR 
        'ALL' = ANY(ua.assigned_districts) OR 
        s.district = ANY(ua.assigned_districts)
      ))
    );
$function$;

-- Add an additional RLS policy to prevent any direct access to schools table by anonymous users
-- This ensures even if someone bypasses the function, they can't access the table directly
CREATE POLICY "Deny anonymous access to schools" 
ON public.schools 
FOR ALL 
TO anon
USING (false);

-- Log this security fix
PERFORM public.log_security_action(
  'SECURITY_FIX_SCHOOLS_DATA_PROTECTION',
  'schools',
  NULL,
  NULL,
  jsonb_build_object(
    'action', 'Enhanced protection against data harvesting',
    'changes', 'Added authentication requirement and anonymous access block',
    'timestamp', now()
  )
);