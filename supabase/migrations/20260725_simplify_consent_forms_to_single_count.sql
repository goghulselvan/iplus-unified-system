-- Consent forms used to be tracked per-class (LKG..8), matching last year's
-- class-specific form+syllabus bundle. This year there is only ONE consent
-- form for all classes, so per-class tracking is a mismatch with reality —
-- collapse to a single count per (school, project).
--
-- Also fixes a real reported bug: staff had to flip "Consent Form Requested"
-- to Yes to unlock the entry screen, enter counts, and it later got flipped
-- back to No (undocumented) — which then hid the already-entered count
-- entirely (e.g. Angels Babyland, SS 7759, has 800 forms entered but showed
-- "not available" because consent_form_requested reverted to No). The new
-- UI no longer gates on that flag at all.

CREATE TEMP TABLE consent_forms_consolidated AS
SELECT school_id, project_id, SUM(forms_requested) AS forms_requested, MIN(created_at) AS created_at
FROM public.consent_forms
GROUP BY school_id, project_id;

TRUNCATE public.consent_forms;

ALTER TABLE public.consent_forms DROP CONSTRAINT IF EXISTS consent_forms_school_id_class_project_id_key;
ALTER TABLE public.consent_forms DROP COLUMN IF EXISTS class;
ALTER TABLE public.consent_forms ADD CONSTRAINT consent_forms_school_id_project_id_key UNIQUE (school_id, project_id);

INSERT INTO public.consent_forms (school_id, project_id, forms_requested, created_at, updated_at)
SELECT school_id, project_id, forms_requested, created_at, now()
FROM consent_forms_consolidated;
