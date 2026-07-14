# E-Brochure: Add Email Option Alongside WhatsApp

Date: 2026-07-14
Status: Approved

## Problem

The "Send E-Brochure" popup exists in two places — `SchoolDetail.tsx` (CRM schools) and
`ProspectSchoolsPage.tsx` (prospect schools) — and only sends via WhatsApp. Both are
separate, near-duplicated implementations calling the same `send-ebrochure` edge
function, which is WhatsApp-only (Askeva template `iplus_ebrochure_2026`, no email
branch at all). There is no e-brochure email template anywhere in `communication_templates`
(confirmed via DB query — zero rows match `template_type ilike '%broch%'`).

User wants: one popup with independent WhatsApp / Email checkboxes so staff can send
either or both. Also needs the missing email template created.

## Decisions from brainstorming

1. **PDF delivery in email**: prominent "View Brochure" button linking to the same
   `brochure_url` already used for WhatsApp — not an attachment. (WA already sends a
   compressed PDF; email doesn't need its own copy, just a link to view it.)
2. **Code structure**: extract one shared `SendEbrochureDialog` component used by both
   `SchoolDetail.tsx` and `ProspectSchoolsPage.tsx`, replacing their two duplicated inline
   dialogs.
3. **Email recipient model**: single "Email" checkbox showing the school's/prospect's
   `email` on file (mirrors how WA's `mobile1`/`mobile2` checkboxes work), plus an
   "Enter a different email" manual-override checkbox+input — same UI pattern as WA's
   existing "Enter manually" row, just for email.
4. **Email content**: brochure button PLUS a secondary "Register Your School →" button
   (same URL every other CRM email uses: `https://iplusedu.in/school/register`).

## Current implementation (being replaced/extended)

- `supabase/functions/send-ebrochure/index.ts` — takes `{schoolId|prospectSchoolId, phone,
  schoolName, district?, state?, saveContact?, contactName?, contactRole?}`. Sends one
  Askeva WA template message, updates `schools.brochure_delivery_status`, logs to
  `communications` (WhatsApp type, `wamid`), optionally saves the manual number to
  `additional_contacts`.
- `SchoolDetail.tsx` (~line 130-137, 408-504, 699-768): dialog state + `handleSendEbrochure`
  loops over checked numbers (`mobile1`, `mobile2`, each `additional_contacts[i]`, manual),
  dedupes by last-10-digits, calls the edge function once per number sequentially,
  aggregates a partial-failure toast. Save-contact-after-send writes to
  `schools.additional_contacts` via a full school refetch.
- `ProspectSchoolsPage.tsx` (~line 78-86, 339-454, 1142-1225): identical shape, but reads
  `selected.mobile` (not `mobile1`/`mobile2`) and on save-contact writes to
  `prospect_schools.mobile` (if empty) or `prospect_schools.additional_contacts`,
  updating local `selected`/`schools` state directly (no refetch).

These two "save contact after manual send" behaviors differ because they write to
different tables — the shared dialog will not own that logic; it stays in each parent
via a callback prop.

## Design

### `send-ebrochure` edge function — add an email branch

Add optional `email?: string` to the request body. Existing `phone` branch is untouched.
Require `(schoolId || prospectSchoolId) && schoolName && (phone || email)`.

New branch, when `email` is present:
- Validate it's a plausible email (contains `@`); 400 if not.
- Active project + `brochure_url` lookup already happens for the WA path — reuse the
  same lookup (hoist above the phone/email branching).
- Build the branded HTML **inline in the function** (a template literal constant), the
  same way the WA branch already hardcodes its Askeva template name via
  `EBROCHURE_TEMPLATE_NAME` env var with a fallback default — no new DB table row, no
  per-project-year migration to maintain. Substitute `{school_name}`, `{brochure_url}`,
  `{project_year}` directly into the literal (simple string replace, not a full
  templating engine — matches the scope of this one email).
- Send via Resend (`RESEND_API_KEY`, already configured — same secret
  `send-template-email` uses), `from: "iPlus Olympiads <noreply@iplusedu.in>"`.
- Resolve `effectiveSchoolId` using the exact existing logic (already shared, just move
  above the branch split so both phone and email paths can log against it).
- Update `schools.brochure_delivery_status` the same way the WA path does (NULL/Digital
  Sent → Digital Sent; Physical Only → Both Physical & Digital) — email counts as a
  digital send too. Idempotent, so no issue if both channels are sent as two separate
  calls.
- Log to `communications`: `{school_id, communication_type:'Email', message:'E-Brochure
  emailed to {email}', user_id, project_id, email_status:'sent'}` — parallel to the WA
  log line but using `email_status` instead of `wamid`/`delivery_status`.
- Return the same `{success, message}` / `{success:false, error}` shape as the WA path,
  so the frontend's existing per-job try/catch loop needs no special-casing for the
  email job.

Email template copy (inline HTML, matches the exact brand system already used in
`interest_acknowledged` — gradient header, status banner, footer):

- Subject: `iPlus Olympiads {project_year} — Brochure for {school_name}`
- Header title: "iPlus Olympiads {project_year}<br/>Brochure"
- Status banner: `✓ E-BROCHURE`
- Body: "Dear {school_name} Team," then one short paragraph: "Please find the iPlus
  Olympiads {project_year} brochure below, with complete details on olympiad subjects,
  exam schedule, fee structure, and how to register."
- No details card (keep it lean — this is a lightweight brochure delivery, not a status
  update).
- Primary CTA button: "View Brochure →" → `{brochure_url}`
- Secondary CTA (smaller/outlined, directly below): "Register Your School →" →
  `https://iplusedu.in/school/register`
- Footer: identical to every other CRM email (iPlus Olympiads / Ivar Pro Learn for
  Universal Success Pvt. Ltd. / 115 GST Road address / support@iplusedu.in / phone /
  © 2026).

### Shared `SendEbrochureDialog` component

New file: `src/components/schools/SendEbrochureDialog.tsx`.

```
interface Contact { name: string; mobile: string; role?: string }

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target:
    | { kind: 'school'; schoolId: string; schoolName: string; district?: string; state?: string;
        mobile1: string | null; mobile2: string | null; email: string | null; contacts: Contact[] }
    | { kind: 'prospect'; prospectSchoolId: string; schoolName: string; district?: string; state?: string;
        mobile: string | null; email: string | null; contacts: Contact[] };
  onSaveManualContact?: (contact: Contact) => Promise<void>; // WA "save to contacts" — parent persists
  onSent?: () => void; // called after any successful send, so parent can refresh its row
}
```

Internal behavior:
- WhatsApp section: unchanged UI/logic from today, just parameterized off `target` (school
  shows Mobile 1 + Mobile 2 rows; prospect shows one School Mobile row), plus
  `target.contacts` rows, plus the existing "Enter manually" row with save-to-contacts
  checkbox (wired to `onSaveManualContact`).
- Email section (new), directly below WhatsApp, same visual style:
  - Row: checkbox "Email" + `target.email` displayed, disabled if null.
  - Row: checkbox "Enter a different email" + reveals a text input when checked.
- Send button builds one job list mixing both channels: one job per checked WA number
  (`{phone}`) plus, if either email checkbox is checked, one job (`{email}`) using
  whichever address applies (checkbox value or manual override). Loops sequentially over
  all jobs calling `send-ebrochure`, same aggregation/toast logic as today (now counts
  channels, e.g. "Sent to 2 numbers + email").
- On any success, calls `onSent?.()`.

### Parent changes

- `SchoolDetail.tsx`: replace the inline dialog + `handleSendEbrochure` with
  `<SendEbrochureDialog target={{kind:'school', ...}} onSaveManualContact={...persists to
  schools.additional_contacts via refetch, same as today...} onSent={() =>
  refetch school} />`. Remove now-dead local state/handler.
- `ProspectSchoolsPage.tsx`: same shape, `target={{kind:'prospect', ...}}`,
  `onSaveManualContact` persists to `prospect_schools.mobile`/`additional_contacts`
  exactly as today, `onSent` no-ops (page already refreshes via its own realtime/list
  refresh elsewhere) — verify against current code during implementation.

## Out of scope (flagged, not building)

- Making the e-brochure email editable via Template Management UI. It isn't a
  status-triggered workflow email like the ones listed there (`WORKFLOW_KEYS`); it's an
  on-demand send. Copy lives as a constant in the edge function, matching how the WA
  Askeva template name already works. Easy follow-up if staff want to edit copy without
  a code deploy.
- Multiple email addresses per school (schools only have one `email` column — no
  `email2`, unlike `mobile1`/`mobile2`).

## Testing

- `npx tsc --noEmit` after each file change.
- Manual click-through in the running dev server (WA-only regression check + new email
  checkbox, both school and prospect flows) — needs a logged-in superadmin session.
- One real send to a test address to confirm the Resend email renders correctly and the
  `communications` row logs as expected.
