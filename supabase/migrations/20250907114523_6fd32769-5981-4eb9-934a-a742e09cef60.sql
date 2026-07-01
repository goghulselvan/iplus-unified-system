-- Fix role management - prevent users from updating their own roles
-- First, let's create a secure function to check if a field is being changed
CREATE OR REPLACE FUNCTION public.is_role_unchanged()
RETURNS TRIGGER AS $$
BEGIN
  -- Only allow role changes if the user is a superadmin
  IF OLD.role != NEW.role AND NOT is_superadmin(auth.uid()) THEN
    RAISE EXCEPTION 'Role changes not permitted';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop existing policies to recreate them properly
DROP POLICY IF EXISTS "Users can update their own profile (non-role fields)" ON public.profiles;
DROP POLICY IF EXISTS "Superadmins can update any profile" ON public.profiles;

-- Create trigger to prevent unauthorized role changes
CREATE TRIGGER prevent_unauthorized_role_changes
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.is_role_unchanged();

-- Recreate profile update policies
CREATE POLICY "Users can update own profile except role" 
ON public.profiles 
FOR UPDATE 
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Superadmins can update any profile" 
ON public.profiles 
FOR UPDATE 
USING (is_superadmin(auth.uid()))
WITH CHECK (is_superadmin(auth.uid()));

-- Enhance security audit logs - only allow system functions to insert
DROP POLICY IF EXISTS "Only system functions can insert security audit logs" ON public.security_audit_logs;

CREATE POLICY "System functions can insert audit logs" 
ON public.security_audit_logs 
FOR INSERT 
WITH CHECK (auth.role() = 'service_role');

-- Add CSRF token table for form protection
CREATE TABLE public.csrf_tokens (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  token TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS on CSRF tokens
ALTER TABLE public.csrf_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their CSRF tokens" 
ON public.csrf_tokens 
FOR ALL 
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- Add index for CSRF token lookups
CREATE INDEX idx_csrf_tokens_user_token ON public.csrf_tokens(user_id, token);
CREATE INDEX idx_csrf_tokens_expires_at ON public.csrf_tokens(expires_at);

-- Create function to generate CSRF tokens
CREATE OR REPLACE FUNCTION public.generate_csrf_token()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_token TEXT;
BEGIN
  -- Generate a secure random token
  new_token := encode(gen_random_bytes(32), 'hex');
  
  -- Clean up old tokens for this user
  DELETE FROM public.csrf_tokens 
  WHERE user_id = auth.uid() AND expires_at < now();
  
  -- Insert new token
  INSERT INTO public.csrf_tokens (user_id, token, expires_at)
  VALUES (auth.uid(), new_token, now() + interval '1 hour');
  
  RETURN new_token;
END;
$$;

-- Create function to validate CSRF tokens
CREATE OR REPLACE FUNCTION public.validate_csrf_token(token_to_validate TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  token_exists BOOLEAN;
BEGIN
  -- Check if token exists and is not expired
  SELECT EXISTS(
    SELECT 1 FROM public.csrf_tokens 
    WHERE user_id = auth.uid() 
    AND token = token_to_validate 
    AND expires_at > now()
  ) INTO token_exists;
  
  -- If token is valid, mark it as used (delete it)
  IF token_exists THEN
    DELETE FROM public.csrf_tokens 
    WHERE user_id = auth.uid() AND token = token_to_validate;
  END IF;
  
  RETURN token_exists;
END;
$$;