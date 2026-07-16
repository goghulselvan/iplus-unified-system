# Call Center Module (Phase 1+2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One Call Center page (`/calls`) with All Calls (in+out, filters, comments, dispositions) and a self-maintaining Follow-up Queue (priority engine ported from Call_Tracking_Tool-2.html).

**Architecture:** DB does the lead-safety logic (trigger opens/resolves `call_followups`; RPC computes priority live). One React page with two tabs replaces IncomingCalls.tsx, reusing its link-caller dialog and callback logic.

**Tech Stack:** React 18 + TS + shadcn/ui, Supabase (Postgres trigger + plpgsql RPC), applied via `supabase db query --linked`.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-16-call-center-design.md`
- NEVER `git add -A`; NEVER `supabase db push` (would sweep voicebot migrations). Apply SQL via `db query --linked`; save migration file for the record only.
- Statuses in DB today: `completed`, `answered`, `no_answer`, `ringing`, `initiated`.
- `communications.communication_type` enum value for calls is `'Phone'` (capital P).
- Verify: typecheck + build; DB objects via synthetic rows (fake number `1111111111`, cleaned up after).
- Push `unified main` only; staging→live is Goghul's move.

---

### Task 1: Migration — columns, table, trigger, backfill

**Files:**
- Create: `supabase/migrations/20260716_call_center.sql`

**Interfaces:**
- Produces: `bonvoice_call_logs.staff_comment/disposition/commented_by/commented_at`;
  `call_followups` table; `handle_call_followup()` trigger. Task 2's RPC and Task 3/4's UI
  read/write these.

- [ ] **Step 1: Write the migration file** with exactly:

```sql
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
```

- [ ] **Step 2: Apply** — `supabase db query --linked "$(cat supabase/migrations/20260716_call_center.sql)"`. Expected: no error.

- [ ] **Step 3: Verify trigger with synthetic rows** (then clean up):

```sql
INSERT INTO bonvoice_call_logs (direction, status, school_phone, call_id) VALUES ('inbound','no_answer','1111111111','test-cc-1');
SELECT state, resolution FROM call_followups WHERE phone_last10 = '1111111111';  -- expect open, null
INSERT INTO bonvoice_call_logs (direction, status, school_phone, call_duration, call_id) VALUES ('outbound','completed','1111111111', 30, 'test-cc-2');
SELECT state, resolution FROM call_followups WHERE phone_last10 = '1111111111';  -- expect done, connected
DELETE FROM bonvoice_call_logs WHERE call_id IN ('test-cc-1','test-cc-2');
DELETE FROM call_followups WHERE phone_last10 = '1111111111';
```

- [ ] **Step 4: Sanity-check backfill counts** — `SELECT state, count(*) FROM call_followups GROUP BY state;` Expected: rows exist; done = numbers that ever connected.

- [ ] **Step 5: Commit** — `git add supabase/migrations/20260716_call_center.sql && git commit -m "feat: call_followups table + trigger + backfill (call center)"`

---

### Task 2: RPC get_followup_queue()

**Files:**
- Create: `supabase/migrations/20260716_followup_queue_rpc.sql`

**Interfaces:**
- Consumes: call_followups + bonvoice_call_logs from Task 1.
- Produces: `get_followup_queue()` returning (id, phone_last10, school_id, prospect_school_id, state, assigned_to, assigned_name, snoozed_until, school_name, missed_count, last_missed_at, outbound_attempts, followup_status, burst, after_hours, long_ring, priority, latest_comment) — Task 4's queue tab calls `supabase.rpc('get_followup_queue')`.

- [ ] **Step 1: Write** `supabase/migrations/20260716_followup_queue_rpc.sql`:

```sql
CREATE OR REPLACE FUNCTION get_followup_queue()
RETURNS TABLE (
  id uuid, phone_last10 text, school_id uuid, prospect_school_id uuid,
  state text, assigned_to uuid, assigned_name text, snoozed_until timestamptz,
  school_name text, missed_count bigint, last_missed_at timestamptz,
  outbound_attempts bigint, followup_status text, burst boolean,
  after_hours boolean, long_ring boolean, priority text, latest_comment text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
BEGIN
  IF NOT is_crm_user() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  RETURN QUERY
  WITH calls AS (
    SELECT right(regexp_replace(coalesce(c.school_phone,''),'\D','','g'),10) AS last10,
           c.direction, c.status, c.call_duration, c.start_time, c.end_time,
           c.created_at, c.staff_comment, c.commented_at
    FROM bonvoice_call_logs c
  ),
  agg AS (
    SELECT last10,
      COUNT(*) FILTER (WHERE direction='inbound' AND status='no_answer') AS n_missed,
      MAX(COALESCE(start_time, created_at)) FILTER (WHERE direction='inbound' AND status='no_answer') AS t_last_missed,
      COUNT(*) FILTER (WHERE direction='outbound') AS n_out,
      MAX(COALESCE(EXTRACT(EPOCH FROM (end_time - start_time)), 0)) FILTER (WHERE status='no_answer') AS max_ring
    FROM calls GROUP BY last10
  ),
  bursts AS (
    SELECT last10, bool_or(gap <= interval '10 minutes') AS is_burst
    FROM (
      SELECT last10,
             COALESCE(start_time, created_at)
               - lag(COALESCE(start_time, created_at)) OVER (PARTITION BY last10 ORDER BY COALESCE(start_time, created_at)) AS gap
      FROM calls WHERE direction='inbound' AND status='no_answer'
    ) g GROUP BY last10
  ),
  latest_comments AS (
    SELECT DISTINCT ON (last10) last10, staff_comment
    FROM calls WHERE staff_comment IS NOT NULL AND staff_comment <> ''
    ORDER BY last10, commented_at DESC NULLS LAST
  )
  SELECT f.id, f.phone_last10, f.school_id, f.prospect_school_id, f.state,
    f.assigned_to, p.full_name, f.snoozed_until,
    COALESCE(s.school_name, ps.school_name),
    COALESCE(a.n_missed, 0), a.t_last_missed, COALESCE(a.n_out, 0),
    CASE WHEN COALESCE(a.n_out,0) = 0 THEN 'never_tried' ELSE 'attempted_not_connected' END,
    COALESCE(b.is_burst, false),
    (a.t_last_missed IS NOT NULL AND (
      EXTRACT(HOUR FROM a.t_last_missed AT TIME ZONE 'Asia/Kolkata') < 9 OR
      EXTRACT(HOUR FROM a.t_last_missed AT TIME ZONE 'Asia/Kolkata') >= 19)),
    COALESCE(a.max_ring, 0) >= 120,
    CASE
      WHEN COALESCE(a.n_out,0) > 0 THEN 'Medium'
      WHEN COALESCE(b.is_burst,false) OR COALESCE(a.max_ring,0) >= 120 THEN 'Critical'
      ELSE 'High'
    END,
    lc.staff_comment
  FROM call_followups f
  LEFT JOIN agg a ON a.last10 = f.phone_last10
  LEFT JOIN bursts b ON b.last10 = f.phone_last10
  LEFT JOIN latest_comments lc ON lc.last10 = f.phone_last10
  LEFT JOIN schools s ON s.id = f.school_id
  LEFT JOIN prospect_schools ps ON ps.id = f.prospect_school_id
  LEFT JOIN profiles p ON p.user_id = f.assigned_to
  WHERE f.state = 'open' OR (f.state = 'snoozed' AND f.snoozed_until <= now())
  ORDER BY CASE
      WHEN COALESCE(a.n_out,0) > 0 THEN 2
      WHEN COALESCE(b.is_burst,false) OR COALESCE(a.max_ring,0) >= 120 THEN 0
      ELSE 1
    END,
    a.t_last_missed DESC NULLS LAST;
END;
$$;
```

- [ ] **Step 2: Apply** via `db query --linked` (same as Task 1).
- [ ] **Step 3: Verify** — `SELECT phone_last10, priority, followup_status, missed_count, burst, after_hours FROM get_followup_queue() LIMIT 10;` Expected: open followups with sensible values; Critical rows first. (Run as service role — the guard passes because SECURITY DEFINER + is_crm_user() checks auth.uid(); if it raises for the CLI role, wrap check: `SELECT count(*)` via a temporary `SET LOCAL role` is NOT needed — instead temporarily verify with the guard commented in a scratch copy. Simplest: trust the synthetic-data check — create one open followup as in Task 1 Step 3, call the function AS a query with the guard bypassed by `SELECT ... FROM get_followup_queue()` — if it raises 'Not authorized', validate the SQL body separately as a plain query.)
- [ ] **Step 4: Commit** the SQL file.

---

### Task 3: CallCenter.tsx — All Calls tab + routing

**Files:**
- Create: `src/pages/CallCenter.tsx`
- Modify: `src/App.tsx` (route swap), `src/components/layout/Navbar.tsx` (nav item)
- Delete: `src/pages/IncomingCalls.tsx`

**Interfaces:**
- Consumes: bonvoice_call_logs columns incl. new staff_comment/disposition; `search_callers_by_name` + `link_incoming_number` RPCs and `bonvoice-click2call` fn (as IncomingCalls did); profiles list for staff filter.
- Produces: `/calls` route; `CallCenter` component with `<Tabs>` shell Task 4 extends; shared `CommentDialog` + `callBack` + link-lead dialog reused by the queue tab.

- [ ] **Step 1:** Build CallCenter.tsx with the Tabs shell (`Tabs` from `@/components/ui/tabs`, defaultValue "calls"), porting from IncomingCalls.tsx: CallRow type (+ `direction`, `created_by`, `staff_comment`, `disposition`, `end_time`), fetch (no `.eq("direction",...)`, server-side filters: direction/status/created_by/date via query builder), link dialog, createNewLead, callBack. Add: filters toolbar, direction icons, disposition Select (outbound rows; values per spec; `call_later` → snooze date dialog → upsert call_followups), CommentDialog (textarea → update call row + mirror to communications with `communication_type: 'Phone'` when school_id present).
- [ ] **Step 2:** App.tsx: replace IncomingCalls import/route with CallCenter at `/calls`; `/incoming-calls` → `<Navigate to="/calls" replace />` (import Navigate from react-router-dom if not present).
- [ ] **Step 3:** Navbar: `{ name: 'Calls', href: '/calls' }`.
- [ ] **Step 4:** Delete IncomingCalls.tsx. `npx tsc --noEmit && npm run build`. Expected: clean. (call_followups/new columns aren't in generated types — try `supabase gen types typescript --linked > src/integrations/supabase/types.ts`; if CLI auth blocks it, use `(supabase as any)` casts at the call sites.)
- [ ] **Step 5:** Commit (explicit paths: CallCenter.tsx, App.tsx, Navbar.tsx, deleted IncomingCalls.tsx, types.ts if regenerated).

---

### Task 4: Follow-up Queue tab

**Files:**
- Modify: `src/pages/CallCenter.tsx`

**Interfaces:**
- Consumes: `get_followup_queue()` RPC; CommentDialog/callBack from Task 3; profiles list (assign).
- Produces: complete Phase 1+2 feature.

- [ ] **Step 1:** QueueRow type mirroring RPC columns. Fetch on tab open. Header pills (Critical/High/Medium/Unassigned). Rows: priority badge (red/rose/amber), number, school name or "Unidentified" badge, missed count, last missed + Burst/After-hours/Long-ring flags, followup_status badge ("Never called back" red / "Attempted, not connected" amber), assigned name, latest comment.
- [ ] **Step 2:** Row actions: Call back (existing); Assign (Select of profiles → update assigned_to); Comment (dialog, saved to the number's most recent call row); Snooze (date dialog → state='snoozed', snoozed_until); Done (dialog with note → state='done', resolution='manual', resolved_by, resolved_at, resolution_note).
- [ ] **Step 3:** `npx tsc --noEmit && npm run build` — clean. Commit.

---

### Task 5: Push and verify

- [ ] **Step 1:** `git status --short` — voicebot files untouched/unstaged.
- [ ] **Step 2:** `git push unified main`; watch Actions to `success`.
- [ ] **Step 3:** Report staging path + click-through checklist to Goghul.
