-- Fix critical security vulnerability in accountant_payment_view
-- Since views don't support RLS directly, we'll create a secure function-based approach

-- 1. Drop the existing insecure view
DROP VIEW IF EXISTS public.accountant_payment_view;

-- 2. Create a secure function that replaces the view functionality
-- Only accountants and above can access this financial data
CREATE OR REPLACE FUNCTION public.get_accountant_payment_data()
RETURNS TABLE(
    id uuid,
    ss_no integer,
    district text,
    school_name text,
    payment_date date,
    state text,
    payment_mode text,
    payment_amount numeric,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    registration_count bigint
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = 'public'
AS $$
    -- Security check: Only accountants and above can access financial data
    SELECT 
        s.id,
        s.ss_no,
        s.district,
        s.school_name,
        s.payment_date,
        s.state,
        s.payment_mode,
        s.payment_amount,
        s.created_at,
        s.updated_at,
        COALESCE(reg_count.registration_count, 0)::bigint AS registration_count
    FROM schools s
    LEFT JOIN (
        SELECT 
            sr.school_id,
            count(*) AS registration_count
        FROM student_registrations sr
        GROUP BY sr.school_id
    ) reg_count ON (s.id = reg_count.school_id)
    WHERE s.payment_status = 'Received'::payment_status
    AND is_accountant_or_above(); -- Security enforcement
$$;

-- 3. Create a secure view that uses the function (for backward compatibility)
CREATE VIEW public.accountant_payment_view AS
SELECT * FROM public.get_accountant_payment_data();

-- 4. Grant appropriate permissions
GRANT SELECT ON public.accountant_payment_view TO authenticated;

-- 5. Log this security fix
PERFORM public.log_security_action(
    'FINANCIAL_DATA_SECURITY_FIX',
    'accountant_payment_view',
    NULL,
    jsonb_build_object('issue', 'Publicly readable financial data'),
    jsonb_build_object(
        'fix', 'Implemented function-based access control',
        'access_restriction', 'accountants_and_above_only',
        'timestamp', now()
    )
);