# Call Center Phase 3 — Timeline + Reports (Design & Plan)

**Date:** 2026-07-16
**Status:** Approved (Goghul: "except the voicebot, do everything and finish it")
**Base:** docs/superpowers/specs/2026-07-16-call-center-design.md (Phase 1+2, built)

## Scope

Two new tabs on `/calls` (CallCenter.tsx) + one cosmetic addition. NOT included:
escalation alerts (needs threshold + channel decision — re-raise separately).

### 1. Timeline tab
One number → full interaction history. Input: 10-digit number (search box), or auto-filled
by clicking any phone number in the All Calls / Queue tabs (switches to Timeline).
- Resolve school/prospect via existing `match_phone_all(p_last10)` RPC.
- Events merged chronologically (desc): all `bonvoice_call_logs` rows for the number
  (`school_phone LIKE '%<last10>'`) + all `communications` rows for the linked school
  (any type: Phone/Email/WhatsApp/AI Call), deduped visually (calls show direction icon,
  status, duration, recording; comms show type icon, message snippet, delivery_status).
- Header card: school name + CRM/Prospect badge + Call button.

### 2. Reports tab
New RPC `get_call_reports(p_from date, p_to date) RETURNS jsonb` — STABLE SECURITY
DEFINER, is_crm_user() guard, returns:
- `totals`: total, inbound, outbound, connected (duration>0), missed (inbound no_answer),
  answer_rate_pct
- `daily[]`: {day, inbound, outbound, missed, connected}
- `staff[]`: {user_id, name, outbound, connected, talk_seconds} (created_by joined to profiles)
- `callback` : {numbers_missed, called_back, never_called_back, avg_callback_hours}
  (per number: first missed → first outbound AFTER it)
UI: date range (default last 30 days), pill stats (existing pill pattern), daily table,
staff table, CSV export (client-side) for both tables.

### 3. Raw Bonvoice status chips
All Calls rows show `bonvoice_status` (NOANSWER/BUSY/NOINPUT/NO_CHANNEL/ANSWERED) as a
small extra chip when present (data accumulates from webhook v21 onward).

## Files
- Create: `supabase/migrations/20260716_call_reports_rpc.sql` (applied via db query --file)
- Modify: `src/pages/CallCenter.tsx`

## Verification
RPC body validated as plain SQL (guard blocks CLI role); typecheck + build; Goghul
click-through after staging move.
