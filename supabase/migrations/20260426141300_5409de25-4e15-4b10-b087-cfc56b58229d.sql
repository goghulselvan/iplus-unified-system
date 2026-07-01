-- Stage 2: Make communications and follow_ups strictly project-scoped

-- Pick the oldest project to attribute legacy rows to
WITH oldest_project AS (
  SELECT id FROM public.olympiad_projects ORDER BY created_at ASC LIMIT 1
)
UPDATE public.communications c
SET project_id = (SELECT id FROM oldest_project)
WHERE c.project_id IS NULL;

WITH oldest_project AS (
  SELECT id FROM public.olympiad_projects ORDER BY created_at ASC LIMIT 1
)
UPDATE public.follow_ups f
SET project_id = (SELECT id FROM oldest_project)
WHERE f.project_id IS NULL;

-- Enforce NOT NULL going forward
ALTER TABLE public.communications
  ALTER COLUMN project_id SET NOT NULL;

ALTER TABLE public.follow_ups
  ALTER COLUMN project_id SET NOT NULL;

-- Indexes for fast per-project lookups
CREATE INDEX IF NOT EXISTS idx_communications_project_school
  ON public.communications (project_id, school_id);

CREATE INDEX IF NOT EXISTS idx_follow_ups_project_school
  ON public.follow_ups (project_id, school_id);
