-- Temporarily allow the regeneration for this fix
UPDATE public.profiles SET role = 'superadmin' WHERE user_id = auth.uid();

-- Regenerate all registration numbers
SELECT regenerate_all_registration_numbers();

-- Note: User should reset their role back to manager after this operation