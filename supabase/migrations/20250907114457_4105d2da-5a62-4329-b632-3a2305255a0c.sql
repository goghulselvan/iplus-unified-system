-- Create table for secure OTP storage
CREATE TABLE public.export_otps (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  email TEXT NOT NULL,
  otp_code TEXT NOT NULL,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  used BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS on OTP table
ALTER TABLE public.export_otps ENABLE ROW LEVEL SECURITY;

-- Only allow system to insert OTPs and users to verify their own
CREATE POLICY "System can insert OTPs" 
ON public.export_otps 
FOR INSERT 
WITH CHECK (true);

CREATE POLICY "Users can verify their own OTPs" 
ON public.export_otps 
FOR SELECT 
USING (auth.uid() = user_id);

CREATE POLICY "System can update OTP status" 
ON public.export_otps 
FOR UPDATE 
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- Add index for performance
CREATE INDEX idx_export_otps_user_email ON public.export_otps(user_id, email);
CREATE INDEX idx_export_otps_expires_at ON public.export_otps(expires_at);

-- Add cleanup function for expired OTPs
CREATE OR REPLACE FUNCTION public.cleanup_expired_otps()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM public.export_otps 
  WHERE expires_at < now() OR used = true;
$$;