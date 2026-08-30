# Registration-number system — remaining follow-ups (post 2026-08-31 deadline)

Context: the silent-loss-of-roll-number bug (481 enrolments, 13% on peak days) was
root-caused on 2026-08-30. See the analysis in the session notes. The fix landed in
two parts:

- **DONE 2026-08-30** — migration `20260830_registration_number_hardening.sql`
  (applied directly to `eucjeggfclztkbbupaav`):
  - Remediated all 481 stuck enrolments (`retry_registration_numbers`).
  - `assign_registration_number` / `ensure_school_code`: removed both
    transaction-length blocking advisory locks; roll counter now relies on the
    atomic `student_registration_sequences` upsert, school-code allocation on the
    existing unique constraints + bounded retry-on-conflict.
  - `ensure_school_code` is now `SECURITY DEFINER`.
  - Explicit non-numeric `class_code` guard in `assign_registration_number`.
  - `UNIQUE (project_id, registration_number)` on `portal_student_enrollments` —
    a duplicate number can no longer silently persist.
  - `cron.reg-number-auto-retry` (*/5) — sweeps any NULL-number enrolment on an
    active project through `retry_registration_numbers` (runs as `postgres`: no
    `lock_timeout`, so it waits instead of failing). Self-heals any residual
    failure within 5 minutes.
  - `cron.reg-number-health-log` (*/5, offset +2m) — snapshots the backlog into
    `registration_number_health`.
  - Corrected the stale `portal-auto-submit` cron (`29 18 30 8 *` → `29 18 31 8 *`).

The items below were deliberately NOT done on 2026-08-30 (deadline was next day,
too risky for the hot path). Do them once registration is closed and the system
is quiet.

---

## 1. Fail-loud trigger with durable per-row failure log  (Tier 1, full)

**Why deferred:** adding an `INSERT` to `trg_auto_assign_reg_number`'s
`EXCEPTION WHEN OTHERS` block is a hot-path change. If `statement_timeout` has
already elapsed when the handler runs, the log INSERT itself can be cancelled
(57014), which is not catchable there and would abort the enrolment INSERT.

**Plan:**
- New table `registration_number_failures(id, enrollment_id, project_id, sqlstate,
  err_message, failed_at, resolved_at)`. No FKs, no triggers, RLS enabled / no
  policy.
- Rewrite `trg_auto_assign_reg_number`:
  - Catch **only** the recoverable codes — `lock_not_available (55P03)`,
    `deadlock_detected (40P01)`, `serialization_failure (40001)`,
    `query_canceled (57014)` — log to `registration_number_failures`, do NOT
    re-raise (enrolment still commits; sweeper heals it).
  - **Re-raise everything else** (`unknown olympiad_code`, `non-numeric
    class_code`, `no district_codes entry`, `unique_violation`, …) so a genuine
    data bug fails the school's insert loudly instead of hiding.
  - Wrap the failure-log INSERT in its own `BEGIN … EXCEPTION WHEN OTHERS THEN
    NULL; END` so logging can never abort the enrolment.
- `reg-number-auto-retry` sweeper: on success, stamp
  `registration_number_failures.resolved_at`.

**Verify:** deterministic repro — session A holds
`pg_advisory_xact_lock(hashtext(<project||school||class>))` is no longer
relevant (lock removed), so instead force a `serialization_failure` via two
concurrent `assign_registration_number` calls on the same new (school,class) under
`SET default_transaction_isolation='serializable'`; confirm one row lands in
`registration_number_failures` and the sweeper clears it within one tick.

## 2. Assignment fully off the insert path  (Tier 3 — async queue)

**Why deferred:** largest architectural change; the sweeper already makes residual
failures self-heal within 5 min, so this is belt-and-suspenders, not urgent.

**Plan:**
- `registration_number_queue(enrollment_id PK, enqueued_at, attempts, last_error)`.
- `trg_auto_assign_reg_number` becomes: `INSERT INTO registration_number_queue
  (enrollment_id) VALUES (NEW.id) ON CONFLICT DO NOTHING;` — cannot fail on locks,
  ~microseconds, zero latency added to the school's insert.
- `cron.reg-number-queue-worker` (*/1) drains the queue as `postgres`: for each
  id, `assign_registration_number`, delete on success, bump `attempts` +
  `last_error` on failure. Alert if `attempts > 5` or queue depth > 50.
- Delete the client-side `verifyRegistrationNumbers` / `warnIfRegistrationNumbersFailed`
  dance in `usePortalStudentRegistration.ts` and `PortalRegistrationView.tsx` — the
  worker guarantees eventual assignment; the toast/email was only ever a weak
  inline retry.
- Keep `reg-number-auto-retry` as a slower backstop (*/15).

**Ordering note:** process the queue `ORDER BY enqueued_at` so roll numbers track
entry order for the common case. This does NOT fully guarantee entry-order rolls —
see item 4.

## 3. Monitoring — wire the alert  (Tier 4, finish)

`registration_number_health` is populated but nothing notifies. Options, pick one:
- Reuse `notify-staff-portal-event` with a new `event_type:
  'registration_number_backlog'` (needs an edge-fn change + deploy —
  third deploy path) and a `cron.reg-number-alert` (*/15) that POSTs via `pg_net`
  when `stuck_over_15min > 0` for two consecutive snapshots.
- Or a Supabase Log-based alert / external uptime check on a `/health` endpoint.
- **Requires Goghul's OK before enabling** — it sends real staff email
  (see the no-autonomous-sends rule).
- Add a small CRM Reports page over `registration_number_health` +
  `registration_number_failures` so staff can see it without SQL.

## 4. Strict entry-order roll numbers  (decision needed)

Today the roll is allocated when `assign_registration_number` **completes**, not
when the student is entered. Normally identical; diverges under concurrency or
after a failed-then-retried assignment (the 481 remediated on 08-30 got rolls
appended at the *end* of their class sequence).

**If roll number must match data-entry order** (e.g. a printed OMR sheet):
- Allocate the roll in a `BEFORE INSERT` trigger on `portal_registered_students`
  (entry moment), store it on the student row, and have
  `assign_registration_number` read it instead of touching
  `student_registration_sequences`.
- This is a larger change and re-numbers nothing retroactively.

**If "roll ≈ entry order" is acceptable:** document it and close this item.

## 5. Format head-room for 2027+  (not a 2026 problem)

Current 2026 usage: max 7 schools in any district (field is 2 digits → 99), max
roll 74 in any class (field is 3 digits → 999). The format is dash-delimited and
`LPAD` only pads (never truncates), so it *degrades gracefully* rather than
breaking — but the portal's `usePortalSchoolCode` assumes a 6-char state+district+
school block.

**Before the 2027 project opens:**
- Decide fixed widths: school `3` digits, roll `4` digits (subject stays 1, or pad
  to 2). Apply only to the new `project_id` — **do not re-issue 2026 numbers.**
- Update `usePortalSchoolCode` (both repos) to parse by delimiter, not fixed
  offsets.
- Add a `CHECK` / constraint-trigger enforcing the chosen format regex on
  non-null `registration_number`.

## 6. `portal-auto-submit` behaviour review  (before it fires)

The cron was date-corrected to `29 18 31 8 *` (Aug 31 23:59 IST) to mirror its
original intent. Confirm with Goghul:
- Is auto-submitting every not-yet-submitted school still wanted, given the
  reopen-for-more-students feature?
- Is 23:59 on the deadline day the right moment, or should it be ~00:30 the next
  day to catch last-minute adds?
- If not wanted at all: `SELECT cron.unschedule('portal-auto-submit');`

## 7. Dead code cleanup (low priority)

`generate_registration_number`, `get_or_create_school_code` (both overloads),
`get_next_school_code`, `get_next_student_sequence`,
`assign_alphabetical_school_codes_for_district`,
`migrate_current_workflow_to_table` — all confirmed orphaned (no `.rpc()` callers,
no triggers). Candidates for `DROP` once someone double-checks the Results app
doesn't call them via the shared DB.
