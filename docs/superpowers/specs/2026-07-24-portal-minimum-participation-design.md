# Minimum 30-Participation Gate on Portal Name-List Submission

## Problem

Schools can currently submit a student name list on the portal with any number
of olympiad participations, including very small ones. iPlus requires at
least 30 **participations** per school — where a participation is one
(student × subject) enrollment, not a student count. Example: 10 students
each enrolled in 3 subjects = 30 participations, and that satisfies the
minimum even though only 10 students registered.

There is no maximum — this is a floor only.

## Definition

"Participation count" = `count(*)` of rows in `portal_student_enrollments`
for a school+project (pending, i.e. `submitted_at IS NULL` at submit time).
This is exactly what the frontend already computes and displays as
`totalEnrollments` (`StudentRegistrationList.tsx`, `Dashboard.tsx`) and
`grandTotal` (`RegistrationSummaryTable.tsx`) — no new counting logic needed,
just a threshold check reusing the existing number.

## Changes

### 1. Server — `submit_student_list(p_school_id, p_project_id)` RPC (authoritative)

Add a guard before the existing UPDATE, in the same style as the existing
deadline/authorization checks in this function:

- Count pending enrollments for the school+project.
- If `< 30`, return `jsonb_build_object('error', 'Minimum participation is 30. You currently have N.')` and return immediately — no rows touched, no audit log entry, no fee/workflow row written.
- If `>= 30`, proceed exactly as today. No change to the success path.

This is the only place that must reject correctly; client-side is UX only
(a superadmin-run RPC replay or direct call must not be able to bypass this).

### 2. Dashboard — `RegistrationSummaryTable.tsx`

- Submit button `disabled` condition changes from `grandTotal === 0` to
  `grandTotal < 30`.
- Persistent note (visible whenever not yet submitted, regardless of count):
  *"Minimum 30 participations required to submit — no maximum, add as many
  students/subjects as you like."*
- While `grandTotal < 30`, an additional amber line: *"X more needed to reach
  the minimum of 30 (no upper limit)."* (X = `30 - grandTotal`)
- `handleSubmit`'s existing error-message branch (`deadline` /
  `Unauthorized` / generic fallback) gets one more case: if the server
  message includes `"Minimum"`, show it directly (already human-readable).

### 3. Student Registration List — `StudentRegistrationList.tsx`

- Next to the existing "Total Registrations" stat tile (`totalEnrollments`),
  add a small caption, always visible: *"Min. 30 · no maximum"*.
- While `totalEnrollments < 30`, replace/supplement with amber: *"X more to
  reach the minimum"*.

### 4. Constant

`30` is hardcoded in the SQL function and in both client files — consistent
with this codebase's existing style (the ₹150 default rate and the 20 Aug
2026 deadline are both inline constants, no config table for either).

## Error handling

- Server rejects cleanly with a jsonb `error` field on the existing response
  shape — no new error type, reuses the pattern `submit_student_list` already
  uses for deadline/authorization failures.
- Client already has a branching error handler in `handleSubmit`; this adds
  one more branch, doesn't restructure it.
- No destructive action occurs on rejection in either layer.

## Testing / verification

- Apply the migration (`ALTER FUNCTION`/`CREATE OR REPLACE FUNCTION`).
- Verify server logic directly via `supabase db query --linked`: simulate
  both a <30 pending count (expect `error` field, confirm zero rows mutated)
  and a >=30 count (expect unchanged success behavior) — read-only
  verification against real counts, no test-school mutation needed since the
  guard only ever short-circuits before any writes.
- Typecheck + production build of `iplus-olympiad-spark`.
- No live portal school is currently mid-submit, so no migration risk to
  in-flight data.

## Out of scope

- No config table / admin-editable threshold — 30 is fixed, matches how the
  deadline and default rate are handled.
- No change to how enrollments are added/removed before submission — only
  the submit gate and its two informational surfaces.
