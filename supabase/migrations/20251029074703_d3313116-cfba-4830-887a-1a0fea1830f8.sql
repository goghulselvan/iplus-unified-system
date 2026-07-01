-- Add 'registration_corrected' to the activity_logs activity_type check constraint
ALTER TABLE public.activity_logs 
DROP CONSTRAINT IF EXISTS activity_logs_activity_type_check;

ALTER TABLE public.activity_logs 
ADD CONSTRAINT activity_logs_activity_type_check 
CHECK (activity_type IN ('status_update', 'communication', 'consent_form', 'follow_up', 'payment', 'registration_corrected'));