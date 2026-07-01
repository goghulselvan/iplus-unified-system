-- Add foreign key constraint if it doesn't exist between student_subjects and student_registrations
DO $$ 
BEGIN
    -- Check if foreign key constraint already exists
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'student_subjects_registration_id_fkey' 
        AND table_name = 'student_subjects'
    ) THEN
        -- Add the foreign key constraint
        ALTER TABLE public.student_subjects 
        ADD CONSTRAINT student_subjects_registration_id_fkey 
        FOREIGN KEY (registration_id) REFERENCES public.student_registrations(id) ON DELETE CASCADE;
    END IF;
END $$;