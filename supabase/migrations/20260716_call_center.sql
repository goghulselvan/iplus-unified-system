-- Call Center phase 1+2: comments/dispositions on calls + self-maintaining follow-up queue
ALTER TABLE bonvoice_call_logs
  ADD COLUMN IF NOT EXISTS staff_comment text,
  ADD COLUMN IF NOT EXISTS disposition text,
  ADD COLUMN IF NOT EXISTS commented_by uuid,
  ADD COLUMN IF NOT EXISTS commented_at timestamptz;

CREATE TABLE IF NOT EXISTS call_followups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_last10 text UNIQUE NOT NULL,
  school_id uuid REFERENCES schools(id) ON DELETE SET NULL,
  prospect_school_id uuid REFERENCES prospect_schools(id) ON DELETE SET NULL,
  state text NOT NULL DEFAULT 'open' CHECK (state IN ('open','snoozed','done')),
  assigned_to uuid,
  snoozed_until timestamptz,
  resolved_at timestamptz,
  resolved_by uuid,
  resolution text,
  resolution_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE call_followups ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS crm_select_call_followups ON call_followups;
CREATE POLICY crm_select_call_followups ON call_followups FOR SELECT USING (is_crm_user());
DROP POLICY IF EXISTS crm_insert_call_followups ON call_followups;
CREATE POLICY crm_insert_call_followups ON call_followups FOR INSERT WITH CHECK (is_crm_user());
DROP POLICY IF EXISTS crm_update_call_followups ON call_followups;
CREATE POLICY crm_update_call_followups ON call_followups FOR UPDATE USING (is_crm_user());

CREATE INDEX IF NOT EXISTS idx_bonvoice_phone_last10
  ON bonvoice_call_logs (right(regexp_replace(coalesce(school_phone,''),'\D','','g'),10));

CREATE OR REPLACE FUNCTION handle_call_followup()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_last10 text;
BEGIN
  v_last10 := right(regexp_replace(coalesce(NEW.school_phone,''), '\D', '', 'g'), 10);
  IF length(v_last10) < 10 THEN
    RETURN NEW;
  END IF;

  IF NEW.direction = 'inbound' AND NEW.status = 'no_answer' THEN
    INSERT INTO call_followups (phone_last10, school_id, prospect_school_id)
    VALUES (v_last10, NEW.school_id, NEW.prospect_school_id)
    ON CONFLICT (phone_last10) DO UPDATE
      SET state           = CASE WHEN call_followups.state = 'done' THEN 'open' ELSE call_followups.state END,
          resolved_at     = CASE WHEN call_followups.state = 'done' THEN NULL ELSE call_followups.resolved_at END,
          resolved_by     = CASE WHEN call_followups.state = 'done' THEN NULL ELSE call_followups.resolved_by END,
          resolution      = CASE WHEN call_followups.state = 'done' THEN NULL ELSE call_followups.resolution END,
          resolution_note = CASE WHEN call_followups.state = 'done' THEN NULL ELSE call_followups.resolution_note END,
          school_id           = COALESCE(call_followups.school_id, EXCLUDED.school_id),
          prospect_school_id  = COALESCE(call_followups.prospect_school_id, EXCLUDED.prospect_school_id),
          updated_at = now();
  ELSIF NEW.status IN ('answered','completed') AND COALESCE(NEW.call_duration, 0) > 0 THEN
    UPDATE call_followups
      SET state = 'done', resolution = 'connected', resolved_at = now(), updated_at = now()
      WHERE phone_last10 = v_last10 AND state <> 'done';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_call_followups ON bonvoice_call_logs;
CREATE TRIGGER trg_call_followups
AFTER INSERT OR UPDATE ON bonvoice_call_logs
FOR EACH ROW EXECUTE FUNCTION handle_call_followup();

-- Backfill from existing history: open a followup for every number with a missed inbound
-- call, then resolve the ones that ever connected (matches the HTML tool's ever-connected rule).
INSERT INTO call_followups (phone_last10, school_id, prospect_school_id)
SELECT DISTINCT ON (t.last10) t.last10, t.school_id, t.prospect_school_id
FROM (
  SELECT right(regexp_replace(coalesce(school_phone,''),'\D','','g'),10) AS last10,
         school_id, prospect_school_id, created_at
  FROM bonvoice_call_logs
  WHERE direction = 'inbound' AND status = 'no_answer'
) t
WHERE length(t.last10) = 10
ORDER BY t.last10, t.created_at DESC
ON CONFLICT (phone_last10) DO NOTHING;

UPDATE call_followups f
SET state = 'done', resolution = 'connected', resolved_at = now(), updated_at = now()
WHERE f.state <> 'done' AND EXISTS (
  SELECT 1 FROM bonvoice_call_logs c
  WHERE right(regexp_replace(coalesce(c.school_phone,''),'\D','','g'),10) = f.phone_last10
    AND c.status IN ('answered','completed') AND COALESCE(c.call_duration,0) > 0
);
