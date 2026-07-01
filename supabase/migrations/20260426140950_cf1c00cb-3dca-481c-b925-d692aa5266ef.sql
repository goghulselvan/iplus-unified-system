-- Stage 1: Make consent_forms project-scoped

-- 1. Add project_id column (nullable for now)
ALTER TABLE public.consent_forms
  ADD COLUMN IF NOT EXISTS project_id uuid;

-- 2. Backfill existing rows with the currently active olympiad project
UPDATE public.consent_forms cf
SET project_id = op.id
FROM public.olympiad_projects op
WHERE op.is_active = true
  AND cf.project_id IS NULL;

-- 3. If no active project exists, fall back to the most recent one (safety)
UPDATE public.consent_forms cf
SET project_id = (
  SELECT id FROM public.olympiad_projects
  ORDER BY created_at DESC
  LIMIT 1
)
WHERE cf.project_id IS NULL;

-- 4. Make project_id NOT NULL going forward
ALTER TABLE public.consent_forms
  ALTER COLUMN project_id SET NOT NULL;

-- 5. Drop any old unique constraint on (school_id, class) and replace with (school_id, class, project_id)
DO $$
DECLARE
  conname text;
BEGIN
  SELECT c.conname INTO conname
  FROM pg_constraint c
  JOIN pg_class t ON t.oid = c.conrelid
  WHERE t.relname = 'consent_forms'
    AND c.contype = 'u';
  IF conname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.consent_forms DROP CONSTRAINT %I', conname);
  END IF;
END$$;

ALTER TABLE public.consent_forms
  ADD CONSTRAINT consent_forms_school_class_project_unique
  UNIQUE (school_id, class, project_id);

-- 6. Index for fast project-scoped lookups
CREATE INDEX IF NOT EXISTS idx_consent_forms_project_school
  ON public.consent_forms (project_id, school_id);
