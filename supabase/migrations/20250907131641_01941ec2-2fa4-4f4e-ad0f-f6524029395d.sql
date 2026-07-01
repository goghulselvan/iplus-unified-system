-- Fix Security Definer View Issue
-- The schools_masked view currently uses the can_access_school_data() function
-- which is SECURITY DEFINER. This bypasses user-level RLS policies.
-- 
-- Solution: Remove the problematic view and handle access control 
-- through proper RLS policies on the main schools table instead.

-- Drop the schools_masked view that causes the security issue
DROP VIEW IF EXISTS public.schools_masked;

-- Create a more secure approach using RLS policies
-- Users will access the schools table directly, and the existing RLS policies
-- will handle access control properly without bypassing user permissions

-- The existing RLS policy on schools table already handles access control:
-- "Complete schools access control" policy allows managers and superadmins

-- For limited access users who need masked data, we'll create a separate
-- SECURITY INVOKER function that respects the caller's permissions
CREATE OR REPLACE FUNCTION public.get_schools_with_masked_data()
RETURNS TABLE (
  id uuid,
  ss_no integer,
  school_name text,
  school_address text,
  district text,
  board text,
  pincode text,
  email text,
  mobile1 text,
  mobile2 text,
  contact_person_name text,
  courier_status courier_status,
  contacted contacted_status,
  registration_interest registration_interest_status,
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
  current_project_id uuid,
  created_at timestamp with time zone,
  updated_at timestamp with time zone
)
LANGUAGE SQL
SECURITY INVOKER  -- This respects the caller's permissions
STABLE
SET search_path = public
AS $$
  -- Get current user's access level directly from profiles
  WITH user_access AS (
    SELECT 
      COALESCE(p.data_access_level, 'limited') as access_level,
      COALESCE(p.role, 'manager') as user_role,
      p.assigned_districts
    FROM public.profiles p 
    WHERE p.user_id = auth.uid()
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
  -- Only show records the user has access to based on existing RLS policies
  WHERE (
    -- Superadmins and managers can see all schools (existing RLS handles this)
    ua.user_role IN ('superadmin', 'manager') OR
    -- Regional users can only see their assigned districts
    (ua.access_level = 'regional' AND (
      ua.assigned_districts IS NULL OR 
      'ALL' = ANY(ua.assigned_districts) OR 
      s.district = ANY(ua.assigned_districts)
    ))
  );
$$;