ALTER FUNCTION public.get_dashboard_metrics_by_project(uuid)  SET search_path = public, pg_catalog;
ALTER FUNCTION public.get_optimized_dashboard_metrics(uuid)   SET search_path = public, pg_catalog;
ALTER FUNCTION public.search_schools_optimized(text, text, text, text, integer, integer) SET search_path = public, pg_catalog;

CREATE INDEX IF NOT EXISTS idx_workflow_history_project_changed
  ON public.workflow_history(project_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_workflow_history_project_school
  ON public.workflow_history(project_id, school_id);

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS idx_student_registrations_name_trgm
  ON public.student_registrations USING gin(student_name gin_trgm_ops);