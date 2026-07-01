-- Fix security vulnerability: Restrict access to student_registration_sequences table
-- Remove overly permissive policy that allows public access
DROP POLICY IF EXISTS "System can manage sequences" ON public.student_registration_sequences;

-- Create more restrictive policies for student_registration_sequences
-- Allow managers and superadmins to view sequences for legitimate purposes
CREATE POLICY "Managers can view registration sequences" 
ON public.student_registration_sequences 
FOR SELECT 
USING (is_manager_or_superadmin());

-- Allow system functions to manage sequences (for registration number generation)
-- This policy is more specific and only allows system operations, not public access
CREATE POLICY "System functions can manage registration sequences" 
ON public.student_registration_sequences 
FOR ALL 
USING (auth.role() = 'service_role'::text)
WITH CHECK (auth.role() = 'service_role'::text);

-- Allow authenticated users to insert new sequences when creating registrations
CREATE POLICY "Authenticated users can create registration sequences" 
ON public.student_registration_sequences 
FOR INSERT 
WITH CHECK (is_manager_or_superadmin());

-- Allow authenticated users to update sequences when generating registration numbers
CREATE POLICY "Authenticated users can update registration sequences" 
ON public.student_registration_sequences 
FOR UPDATE 
USING (is_manager_or_superadmin())
WITH CHECK (is_manager_or_superadmin());

-- Log the security fix
SELECT public.log_security_action(
  'SECURITY_FIX_REGISTRATION_SEQUENCES',
  'student_registration_sequences',
  NULL,
  NULL,
  jsonb_build_object(
    'issue', 'PUBLIC_REGISTRATION_SEQUENCES',
    'fix_applied', 'Restricted access to authenticated users only',
    'timestamp', now()
  )
);