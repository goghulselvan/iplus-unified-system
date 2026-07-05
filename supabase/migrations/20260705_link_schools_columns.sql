-- Add tracking columns to school_portal_registrations for the Link Schools workflow
ALTER TABLE public.school_portal_registrations
  ADD COLUMN IF NOT EXISTS rejection_reason  text,
  ADD COLUMN IF NOT EXISTS matched_school_id uuid REFERENCES public.schools(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approved_at       timestamptz;
