# Call Center Module (Phase 1+2) — Design

**Date:** 2026-07-16
**Status:** Approved by Goghul (chat, 3 decisions answered + proceed)

## Problem

Outbound calls have no page (Incoming Calls exists for inbound only). Missed-call follow-up
lives outside the CRM in a browser-only PDF tool (`~/Downloads/Call_Tracking_Tool-2.html`)
that parses Bonvoice report PDFs and comments staff typed into the Bonvoice panel. Goal:
"not a single lead missed" — tracked live inside the CRM.

## Decisions (final — do not re-ask)

1. ONE unified **Call Center** page at `/calls` replacing Incoming Calls (old route redirects).
   Tabs now: **All Calls**, **Follow-up Queue**. Timeline + Reports = Phase 3 (not this build).
2. Call comments are entered **in the CRM** (no Bonvoice-panel dependency, no PDF import).
3. Phase 1+2 built together.

## Data model (one migration, applied via `supabase db query --linked` — NOT `db push`,
which would sweep in the intentionally-unapplied voicebot migration files)

### bonvoice_call_logs — new columns
- `staff_comment text`, `disposition text`, `commented_by uuid`, `commented_at timestamptz`
- `disposition` values (outbound rows): `connected_interested`, `connected_not_interested`,
  `no_answer`, `busy`, `wrong_number`, `call_later`

### call_followups — new table (one row per phone number needing attention)
- `id uuid PK`, `phone_last10 text UNIQUE NOT NULL`, `school_id uuid NULL`,
  `prospect_school_id uuid NULL`, `state text NOT NULL DEFAULT 'open'`
  (`open` | `snoozed` | `done`), `assigned_to uuid NULL`, `snoozed_until timestamptz NULL`,
  `resolved_at timestamptz`, `resolved_by uuid`, `resolution text`
  (`connected` | `manual`), `resolution_note text`, `created_at`, `updated_at`
- RLS: `is_crm_user()` for SELECT/INSERT/UPDATE. No DELETE policy.

### Trigger (SECURITY DEFINER, per db-trigger-over-client-sync rule)
`trg_call_followups` AFTER INSERT OR UPDATE ON bonvoice_call_logs:
- last10 = right 10 digits of `school_phone`; skip if < 10 digits.
- Inbound + status `no_answer` → upsert followup: insert `open` row (carrying
  school_id/prospect_school_id from the call); if a `done` row exists for the number, reopen it
  (state='open', clear resolution fields).
- Any direction, status IN ('answered','completed') AND call_duration > 0 → resolve any
  non-done followup for the number: state='done', resolution='connected', resolved_at=now().
- The queue therefore maintains itself with zero client code.

### RPC `get_followup_queue()` — STABLE SECURITY DEFINER, one-time `is_crm_user()` guard
(per prospect-search-perf lesson). Returns followups with state='open' OR
(state='snoozed' AND snoozed_until <= now()), each with computed fields from bonvoice_call_logs:
- `missed_count` (inbound no_answer), `last_missed_at`
- `outbound_attempts` (direction='outbound' count)
- `followup_status`: `never_tried` (no outbound attempt) | `attempted_not_connected`
  (connected rows never appear — the trigger resolves them)
- `burst`: 2+ inbound no_answer within 10 minutes of each other
- `after_hours`: last_missed_at outside 09:00–19:00 **Asia/Kolkata**
- `long_ring`: max(end_time − start_time) ≥ 120s over no_answer rows where both timestamps
  exist (KNOWN LIMIT: webhook may not populate these — burst/after-hours work regardless;
  richer webhook fields are on the pending Bonvoice support ticket)
- `priority`: `attempted_not_connected` → **Medium**; `never_tried` + (burst OR long_ring) →
  **Critical**; `never_tried` otherwise → **High** (exact port of the HTML tool's rules)
- `school_name` (from schools else prospect_schools), `assigned_name` (profiles),
  `latest_comment` (most recent staff_comment on any call of that number)
- Sorted Critical → High → Medium, then last_missed_at DESC.

## UI — `src/pages/CallCenter.tsx`, route `/calls`

Navbar item renamed **Calls** (`/calls`); `/incoming-calls` becomes a `<Navigate to="/calls" replace />`.
`IncomingCalls.tsx` is deleted (its link-caller dialog and call-back logic move into CallCenter).

### Tab: All Calls
- Query `bonvoice_call_logs` (both directions), newest first, limit 200 after filters.
- Filters: direction (All/Incoming/Outgoing), status (All/answered/completed/no_answer/
  ringing/initiated), staff (`created_by` from profiles list), date range (from/to),
  "New leads" toggle (no school_id AND no prospect_school_id), search box (number digits or
  school name, client-side on loaded rows).
- Row = existing IncomingCalls row + direction icon (PhoneIncoming green / PhoneOutgoing blue),
  disposition select (outbound rows only), comment affordance:
  - Comment dialog: textarea; save → update call row (staff_comment, commented_by, commented_at);
    if school_id linked → also INSERT communications (communication_type='Phone',
    direction=call direction, message=`Call note: <comment>`, bonvoice_call_id=call_id,
    user_id=current user). Existing comment shown under the row.
  - Disposition `call_later` prompts a date → upserts the number's followup to
    state='snoozed', snoozed_until=date (client-side upsert; only case not handled by trigger).
- "Link / Add lead" dialog + Call back button: carried over from IncomingCalls unchanged
  (link dialog offered on rows with no match, callback on inbound rows and followup rows).

### Tab: Follow-up Queue
- Data from `get_followup_queue()`.
- Header pills: Critical / High / Medium / Unassigned counts.
- Row: priority badge (red/rose/amber), number, school name or Unidentified badge,
  missed count, last missed (with After-hours / Burst / Long-ring flags), follow-up status
  badge (Never called back / Attempted, not connected), assigned staff, latest comment.
- Row actions: **Call back** (bonvoice-click2call), **Assign** (staff select →
  update assigned_to), **Comment** (same dialog, saved on the number's latest call row),
  **Snooze** (date → state='snoozed'), **Done** (note → state='done', resolution='manual',
  resolved_by, resolution_note).

## Not in this build (YAGNI / Phase 3)
Timeline tab, Reports tab, escalation alerts, PDF import, webhook status-mapping changes.

## Verification
- Trigger: synthetic insert into bonvoice_call_logs with fake number `1111111111`
  (inbound/no_answer → followup opens; answered/duration>0 → resolves) then delete test rows.
- RPC: call as SQL, check computed fields against the synthetic data.
- UI: `npx tsc --noEmit` + `npm run build`; Goghul click-through after staging move.

## Deploy
Migration SQL via `db query --linked` + file saved under `supabase/migrations/` for the
record. Code push `unified main` → staging → Goghul moves live. Explicit staging only —
voicebot files stay uncommitted.
