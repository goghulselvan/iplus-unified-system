-- First, let's update the existing schema to match the new requirements

-- Update the School table structure to match new workflow requirements
ALTER TABLE public.schools 
DROP COLUMN IF EXISTS follow_up_date,
DROP COLUMN IF EXISTS follow_up_time;

-- Add new columns for enhanced workflow tracking
ALTER TABLE public.schools 
ADD COLUMN payment_mode text,
ADD COLUMN payment_date date,
ADD COLUMN payment_amount decimal(10,2),
ADD COLUMN registration_interest_comment text,
ADD COLUMN consent_form_comment text;

-- Create follow_ups table for better tracking
CREATE TABLE public.follow_ups (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  follow_up_date date NOT NULL,
  follow_up_time time NOT NULL,
  status text DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'rescheduled')),
  created_by uuid NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

-- Create activity_logs table for tracking all changes
CREATE TABLE public.activity_logs (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  activity_type text NOT NULL CHECK (activity_type IN ('status_update', 'communication', 'consent_form', 'follow_up', 'payment')),
  field_name text,
  old_value text,
  new_value text,
  description text,
  created_at timestamp with time zone DEFAULT now()
);

-- Create workflow_history table for tracking status changes
CREATE TABLE public.workflow_history (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  workflow_stage text NOT NULL,
  old_status text,
  new_status text NOT NULL,
  changed_by uuid NOT NULL,
  changed_at timestamp with time zone DEFAULT now()
);

-- Enable RLS on new tables
ALTER TABLE public.follow_ups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workflow_history ENABLE ROW LEVEL SECURITY;

-- Create policies for follow_ups
CREATE POLICY "Authenticated users can view follow_ups" 
ON public.follow_ups FOR SELECT 
USING (true);

CREATE POLICY "Authenticated users can insert follow_ups" 
ON public.follow_ups FOR INSERT 
WITH CHECK (true);

CREATE POLICY "Authenticated users can update follow_ups" 
ON public.follow_ups FOR UPDATE 
USING (true);

CREATE POLICY "Only superadmins can delete follow_ups" 
ON public.follow_ups FOR DELETE 
USING (EXISTS (
  SELECT 1 FROM profiles 
  WHERE profiles.user_id = auth.uid() 
  AND profiles.role = 'superadmin'::user_role
));

-- Create policies for activity_logs
CREATE POLICY "Authenticated users can view activity_logs" 
ON public.activity_logs FOR SELECT 
USING (true);

CREATE POLICY "Authenticated users can insert activity_logs" 
ON public.activity_logs FOR INSERT 
WITH CHECK (true);

-- Create policies for workflow_history
CREATE POLICY "Authenticated users can view workflow_history" 
ON public.workflow_history FOR SELECT 
USING (true);

CREATE POLICY "Authenticated users can insert workflow_history" 
ON public.workflow_history FOR INSERT 
WITH CHECK (true);

-- Create triggers for updated_at columns
CREATE TRIGGER update_follow_ups_updated_at
  BEFORE UPDATE ON public.follow_ups
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Create indexes for better performance
CREATE INDEX idx_follow_ups_school_id ON public.follow_ups(school_id);
CREATE INDEX idx_follow_ups_date ON public.follow_ups(follow_up_date);
CREATE INDEX idx_follow_ups_status ON public.follow_ups(status);
CREATE INDEX idx_activity_logs_school_id ON public.activity_logs(school_id);
CREATE INDEX idx_activity_logs_type ON public.activity_logs(activity_type);
CREATE INDEX idx_workflow_history_school_id ON public.workflow_history(school_id);