-- Add new workflow stage: consent_form_sent
ALTER TABLE public.schools ADD COLUMN consent_form_sent text CHECK (consent_form_sent IN ('Sent', 'Sent Digitally', 'Not Sent')) DEFAULT 'Not Sent';

-- Add new communication fields
ALTER TABLE public.communications ADD COLUMN contacted_person_name text;
ALTER TABLE public.communications ADD COLUMN contacted_mobile_no text;
ALTER TABLE public.communications ADD COLUMN designation text;