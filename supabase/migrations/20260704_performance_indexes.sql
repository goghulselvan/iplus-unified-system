-- Performance index hardening for 100k CRM schools, 500k prospect schools, 5M+ students
-- Target: all list/search/filter/dashboard queries must use index seeks, not seq scans

-- ============================================================
-- schools table — currently only has PK(id) + UNIQUE(ss_no)
-- ============================================================
-- Full-text school name search: ILIKE '%term%' uses this at >= 3 chars
CREATE INDEX IF NOT EXISTS idx_schools_name_trgm
  ON public.schools USING gin(school_name gin_trgm_ops);

-- District trgm for ILIKE district filter
CREATE INDEX IF NOT EXISTS idx_schools_district_trgm
  ON public.schools USING gin(district gin_trgm_ops);

-- State equality filter (RLS + search_schools join)
CREATE INDEX IF NOT EXISTS idx_schools_state
  ON public.schools(state);

-- ORDER BY updated_at DESC (school list default sort + date view)
CREATE INDEX IF NOT EXISTS idx_schools_updated_at
  ON public.schools(updated_at DESC);

-- current_project_id (scoping search to project)
CREATE INDEX IF NOT EXISTS idx_schools_current_project
  ON public.schools(current_project_id) WHERE current_project_id IS NOT NULL;

-- District + state composite (regional access + state+district dual filter)
CREATE INDEX IF NOT EXISTS idx_schools_state_district
  ON public.schools(state, district);

-- Mobile search (ILIKE on mobile1/mobile2)
CREATE INDEX IF NOT EXISTS idx_schools_mobile1_trgm
  ON public.schools USING gin(mobile1 gin_trgm_ops);

-- ============================================================
-- school_project_workflow — only had PK + UNIQUE(school_id, project_id)
-- ============================================================
-- Most dashboard metric queries: WHERE project_id = $1
CREATE INDEX IF NOT EXISTS idx_spw_project_id
  ON public.school_project_workflow(project_id);

-- Date view: WHERE project_id = $1 AND updated_at = target_date
CREATE INDEX IF NOT EXISTS idx_spw_project_updated
  ON public.school_project_workflow(project_id, updated_at DESC);

-- ============================================================
-- communications — only had PK(id)
-- ============================================================
-- Dashboard recent comms: ORDER BY created_at DESC LIMIT 6
CREATE INDEX IF NOT EXISTS idx_comm_created_at
  ON public.communications(created_at DESC);

-- School-level comms history
CREATE INDEX IF NOT EXISTS idx_comm_school_created
  ON public.communications(school_id, created_at DESC);

-- ============================================================
-- follow_ups — only had PK(id)
-- ============================================================
-- School-level follow-ups list
CREATE INDEX IF NOT EXISTS idx_fu_school_id
  ON public.follow_ups(school_id);

-- Date metrics: WHERE DATE(created_at) = target_date
CREATE INDEX IF NOT EXISTS idx_fu_created_at
  ON public.follow_ups(created_at DESC);

-- Follow-ups list sorted by follow_up_date
CREATE INDEX IF NOT EXISTS idx_fu_follow_up_date
  ON public.follow_ups(follow_up_date);

-- Follow-ups by status for filtering
CREATE INDEX IF NOT EXISTS idx_fu_status
  ON public.follow_ups(status) WHERE status != 'completed';

-- ============================================================
-- portal_registered_students — already has composite (project_id, school_id)
-- ============================================================
-- Name search across 5M rows
CREATE INDEX IF NOT EXISTS idx_prs_student_name_trgm
  ON public.portal_registered_students USING gin(student_name gin_trgm_ops);

-- School + project lookup (for school-detail student list)
CREATE INDEX IF NOT EXISTS idx_prs_school_project
  ON public.portal_registered_students(school_id, project_id);

-- ============================================================
-- portal_student_enrollments — has (student_id), (olympiad_code), unique
-- ============================================================
-- Project-level aggregation: enrollment → student → project_id
-- Join path: enrollments.student_id → students.id → students.project_id
-- The student_id index already covers this join.
-- Add olympiad_code + student_id composite for per-subject filtering
CREATE INDEX IF NOT EXISTS idx_pse_olympiad_student
  ON public.portal_student_enrollments(olympiad_code, student_id);

-- submitted_at for time-based reporting
CREATE INDEX IF NOT EXISTS idx_pse_submitted_at
  ON public.portal_student_enrollments(submitted_at DESC) WHERE submitted_at IS NOT NULL;

-- ============================================================
-- prospect_schools — already has many indexes, add composite for campaign filtering
-- ============================================================
-- Voice/email campaign: WHERE is_active = true AND mobile IS NOT NULL AND state = $1
CREATE INDEX IF NOT EXISTS idx_ps_active_mobile_state
  ON public.prospect_schools(state, district) WHERE mobile IS NOT NULL AND is_active = true;

-- Name + state composite for quick filtered search
CREATE INDEX IF NOT EXISTS idx_ps_name_state_trgm
  ON public.prospect_schools USING gin(school_name gin_trgm_ops);
-- (school_name gin_trgm_ops index idx_ps_school_name_trgm already exists — skip duplicate)
