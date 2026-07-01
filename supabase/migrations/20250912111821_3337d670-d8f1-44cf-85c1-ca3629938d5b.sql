-- Reset all registration number sequences to start from 1
UPDATE public.student_registration_sequences SET last_sequence = 0, updated_at = now();

-- Optional: Clean up and regenerate registration numbers for existing records
-- This will trigger the auto-generation function on next registration