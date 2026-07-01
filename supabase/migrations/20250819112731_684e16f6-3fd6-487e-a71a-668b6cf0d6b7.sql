-- Fix critical security vulnerabilities - restrict all sensitive data to authenticated users
-- Option 3: Hybrid Approach - Secure data with role-based access

-- Fix schools table policies
DROP POLICY IF EXISTS "Authenticated users can view schools" ON public.schools;
DROP POLICY IF EXISTS "Authenticated users can insert schools" ON public.schools;
DROP POLICY IF EXISTS "Authenticated users can update schools" ON public.schools;

CREATE POLICY "Authenticated users can view schools"
ON public.schools
FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Authenticated users can insert schools"
ON public.schools
FOR INSERT
TO authenticated
WITH CHECK (true);

CREATE POLICY "Managers and superadmins can update schools"
ON public.schools
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE user_id = auth.uid() 
    AND role IN ('manager', 'superadmin')
  )
);

-- Fix communications table policies  
DROP POLICY IF EXISTS "Authenticated users can view communications" ON public.communications;
DROP POLICY IF EXISTS "Authenticated users can insert communications" ON public.communications;

CREATE POLICY "Authenticated users can view communications"
ON public.communications
FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Authenticated users can insert communications"
ON public.communications
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

-- Fix follow_ups table policies
DROP POLICY IF EXISTS "Authenticated users can view follow_ups" ON public.follow_ups;
DROP POLICY IF EXISTS "Authenticated users can insert follow_ups" ON public.follow_ups;
DROP POLICY IF EXISTS "Authenticated users can update follow_ups" ON public.follow_ups;

CREATE POLICY "Authenticated users can view follow_ups"
ON public.follow_ups
FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Authenticated users can insert follow_ups"
ON public.follow_ups
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = created_by);

CREATE POLICY "Authenticated users can update follow_ups"
ON public.follow_ups
FOR UPDATE
TO authenticated
USING (true);

-- Fix activity_logs table policies (audit-only - insert/select)
DROP POLICY IF EXISTS "Authenticated users can view activity_logs" ON public.activity_logs;
DROP POLICY IF EXISTS "Authenticated users can insert activity_logs" ON public.activity_logs;

CREATE POLICY "Authenticated users can view activity_logs"
ON public.activity_logs
FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Authenticated users can insert activity_logs"
ON public.activity_logs
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

-- Fix workflow_history table policies (audit-only - insert/select)
DROP POLICY IF EXISTS "Authenticated users can view workflow_history" ON public.workflow_history;
DROP POLICY IF EXISTS "Authenticated users can insert workflow_history" ON public.workflow_history;

CREATE POLICY "Authenticated users can view workflow_history"
ON public.workflow_history
FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Authenticated users can insert workflow_history"
ON public.workflow_history
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = changed_by);

-- Fix consent_forms table policies
DROP POLICY IF EXISTS "Authenticated users can view consent forms" ON public.consent_forms;
DROP POLICY IF EXISTS "Authenticated users can manage consent forms" ON public.consent_forms;

CREATE POLICY "Authenticated users can view consent forms"
ON public.consent_forms
FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Authenticated users can manage consent forms"
ON public.consent_forms
FOR ALL
TO authenticated
USING (true);