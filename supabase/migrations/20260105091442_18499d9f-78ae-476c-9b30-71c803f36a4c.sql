-- Create API request logs table for audit trail
CREATE TABLE public.api_request_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  api_key_hash TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  registration_numbers_count INTEGER,
  ip_address TEXT,
  user_agent TEXT,
  response_status INTEGER,
  response_time_ms INTEGER,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Add index for querying by API key and time
CREATE INDEX idx_api_request_logs_api_key_hash ON public.api_request_logs(api_key_hash);
CREATE INDEX idx_api_request_logs_created_at ON public.api_request_logs(created_at DESC);

-- Enable RLS
ALTER TABLE public.api_request_logs ENABLE ROW LEVEL SECURITY;

-- Only superadmins can view API logs
CREATE POLICY "Superadmins can view API logs"
  ON public.api_request_logs
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'superadmin'
    )
  );

-- Add comment
COMMENT ON TABLE public.api_request_logs IS 'Audit log for external API requests to lookup-participant endpoint';