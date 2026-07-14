# E-Brochure Email Option Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an Email channel to the existing WhatsApp-only "Send E-Brochure" popup, letting staff send the brochure via WA, Email, or both — via one shared dialog component used from both the CRM School Detail page and the Prospect Schools panel.

**Architecture:** Extend the existing `send-ebrochure` Supabase Edge Function with a parallel Email branch (Resend, inline HTML — no new DB table). Extract the two duplicated frontend e-brochure dialogs into one shared `SendEbrochureDialog` component that adds an Email checkbox next to the existing WhatsApp checkboxes, and wire it into both pages.

**Tech Stack:** React + TypeScript + Vite, shadcn/ui components, Supabase (Postgres + Edge Functions, Deno), Resend for email.

**Full spec:** `docs/superpowers/specs/2026-07-14-ebrochure-email-option-design.md` — read it first for the "why" behind every decision below. This plan is the execution checklist; the spec has the reasoning.

## Global Constraints

- No new `communication_templates` DB row / migration — the e-brochure email HTML is a
  constant inside the edge function, mirroring how the WhatsApp Askeva template name
  already works (env var with a hardcoded fallback, no DB row).
- Brand colors/copy for the new email must match the existing `interest_acknowledged`
  template exactly: gradient header `linear-gradient(135deg,#7C3AED 0%,#4F46E5 100%)`,
  same footer block, same fonts.
- Register-Now CTA always links to `https://iplusedu.in/school/register` (same URL every
  other CRM email uses).
- `RESEND_API_KEY` is already configured as a Supabase project secret (used by
  `send-template-email`) — no new secret needed.
- No test framework exists in this repo (no vitest/jest, no `test` script in
  `package.json`). Verification = `npx tsc --noEmit` for every frontend change, and
  direct `curl`/Supabase-CLI checks for the edge function. Manual browser click-through
  requires a logged-in superadmin session — flag it in each task rather than skipping
  verification.
- **No automatic git commits.** Do not run `git commit` as part of any step. Stage
  nothing without being asked. When all four tasks are verified working, surface a
  commit as a suggestion and wait for explicit confirmation.

---

### Task 1: Extend `send-ebrochure` edge function with an Email branch

**Files:**
- Modify: `supabase/functions/send-ebrochure/index.ts` (full file, 199 lines today)

**Interfaces:**
- Consumes: nothing new — same Supabase service-role client, same `olympiad_projects.brochure_url`, same `communications` table, same `schools.brochure_delivery_status` column already used by the WhatsApp path.
- Produces: the function now accepts `email?: string` in the request body (alongside the existing `phone?: string`, now also optional — previously required). Response shape is unchanged: `{ success: true, message }` or `{ success: false, error }`. Callers (Task 2/3/4) send **exactly one** of `phone` or `email` per invocation — never both in the same call.

- [ ] **Step 1: Read the current file to confirm no drift**

Run: `cat supabase/functions/send-ebrochure/index.ts`

Confirm it still matches the structure described below (Askeva WA send, `normalizeMobile`, JWT-claims-fallback auth block, `effectiveSchoolId` resolution, `saveContact` block). If it has changed materially, stop and re-read this task before proceeding.

- [ ] **Step 2: Replace the full file contents**

Replace `supabase/functions/send-ebrochure/index.ts` entirely with:

```typescript
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "npm:resend@2.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ASKEVA_URL = "https://backend.askeva.io/v1/message/send-message";
const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

function normalizeMobile(raw: string): string | null {
  const digits = String(raw).replace(/\D/g, "");
  if (digits.length === 10) return `91${digits}`;
  if (digits.length >= 11 && digits.length <= 15) return digits;
  return null;
}

// Matches the exact brand system used by every other CRM email
// (see communication_templates.email_body for 'interest_acknowledged').
// {school_name}, {brochure_url}, {project_year} are substituted before sending.
const EBROCHURE_EMAIL_HTML = `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#f4f4f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background-color:#f4f4f7;">
  <tr><td align="center" style="padding:20px 10px;">
    <table width="600" cellpadding="0" cellspacing="0" role="presentation" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">

      <!-- Header -->
      <tr><td style="background:linear-gradient(135deg,#7C3AED 0%,#4F46E5 100%);padding:40px 32px 36px;text-align:center;">
        <div style="font-size:11px;font-weight:600;letter-spacing:3px;color:rgba(255,255,255,0.7);text-transform:uppercase;margin-bottom:16px;">iPlus Olympiads {project_year}</div>
        <div style="font-size:30px;font-weight:700;color:#ffffff;line-height:1.25;margin-bottom:12px;">iPlus Olympiads<br/>Brochure</div>
        <div style="font-size:13px;color:rgba(255,255,255,0.8);font-style:italic;">Ignite Genius. Inspire Excellence.</div>
      </td></tr>

      <!-- Status banner -->
      <tr><td style="background:#f5f3ff;border-bottom:1px solid #ede9fe;padding:12px 32px;text-align:center;">
        <span style="font-size:11px;font-weight:700;letter-spacing:2px;color:#4F46E5;text-transform:uppercase;">&#10003;&nbsp;&nbsp;E-BROCHURE</span>
      </td></tr>

      <!-- Body -->
      <tr><td style="padding:32px 32px 24px;">
        <p style="margin:0 0 16px;font-size:16px;font-weight:700;color:#1a1a2e;">Dear {school_name} Team,</p>
        <p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#374151;">Please find the iPlus Olympiads {project_year} brochure below, with complete details on olympiad subjects, exam schedule, fee structure, and how to register your school.</p>
      </td></tr>

      <!-- CTAs -->
      <tr><td style="padding:0 32px 16px;text-align:center;">
        <a href="{brochure_url}" style="display:inline-block;background:linear-gradient(135deg,#7C3AED 0%,#4F46E5 100%);color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;padding:14px 32px;border-radius:8px;">View Brochure &rarr;</a>
      </td></tr>
      <tr><td style="padding:0 32px 32px;text-align:center;">
        <a href="https://iplusedu.in/school/register" style="display:inline-block;background:transparent;border:2px solid #7C3AED;color:#7C3AED;text-decoration:none;font-size:14px;font-weight:600;padding:11px 28px;border-radius:8px;">Register Your School &rarr;</a>
      </td></tr>

      <!-- Footer -->
      <tr><td style="background:#f9fafb;border-top:1px solid #e5e7eb;padding:24px 32px;text-align:center;">
        <div style="font-size:14px;font-weight:600;color:#4F46E5;margin-bottom:6px;">iPlus Olympiads</div>
        <div style="font-size:12px;color:#6b7280;line-height:1.8;">
          Ivar Pro Learn for Universal Success Pvt. Ltd.<br/>
          115, GST Road, Guduvancheri, Chennai 603 202<br/>
          <a href="mailto:support@iplusedu.in" style="color:#4F46E5;text-decoration:none;">support@iplusedu.in</a>&nbsp;|&nbsp;<a href="tel:+918111066556" style="color:#4F46E5;text-decoration:none;">+91 81110 66556</a>
        </div>
        <div style="font-size:11px;color:#9ca3af;margin-top:10px;">&copy; 2026 iPlus Olympiads. All rights reserved.</div>
      </td></tr>

    </table>
  </td></tr>
</table>
</body>
</html>`;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const ASKEVA_API_TOKEN = Deno.env.get("ASKEVA_API_TOKEN");
    if (!ASKEVA_API_TOKEN) throw new Error("ASKEVA_API_TOKEN not configured");

    const TEMPLATE_NAME = Deno.env.get("EBROCHURE_TEMPLATE_NAME") ?? "iplus_ebrochure_2026";

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const authHeader = req.headers.get("authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    // The gateway (verify_jwt) has already verified the JWT signature. getUser()
    // additionally requires a live GoTrue session and can reject otherwise-valid
    // staff logins, so fall back to the verified JWT claims when it fails.
    let userId: string | null = null;
    const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token);
    if (user) {
      userId = user.id;
    } else {
      try {
        const b64 = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
        const payload = JSON.parse(atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4)));
        if (payload.role === "authenticated" && payload.sub) userId = payload.sub;
        console.log("getUser failed, JWT-claims fallback used:", authErr?.message, "role:", payload.role);
      } catch (_) { /* not a decodable JWT */ }
    }
    if (!userId) {
      return new Response(JSON.stringify({ success: false, error: `Unauthorized${authErr?.message ? `: ${authErr.message}` : ""}` }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { schoolId, prospectSchoolId, phone, email, schoolName, district, state, saveContact, contactName, contactRole } = await req.json() as {
      schoolId?: string;
      prospectSchoolId?: string;
      phone?: string;
      email?: string;
      schoolName: string;
      district?: string;
      state?: string;
      saveContact?: boolean;
      contactName?: string;
      contactRole?: string;
    };

    if ((!schoolId && !prospectSchoolId) || (!phone && !email) || !schoolName) {
      return new Response(JSON.stringify({ success: false, error: "schoolId or prospectSchoolId, schoolName, and phone or email are required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get active project's brochure URL — needed by both channels
    const { data: project } = await supabaseAdmin
      .from("olympiad_projects")
      .select("id, brochure_url, project_name, project_year")
      .eq("is_active", true)
      .maybeSingle();

    if (!project?.brochure_url) {
      return new Response(JSON.stringify({ success: false, error: "No brochure uploaded for the active project. Please upload one in Project Management." }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Resolve CRM school id up front — direct, or via the prospect link — used by
    // both channels below for delivery-status + communication logging.
    let effectiveSchoolId = schoolId ?? null;
    if (!effectiveSchoolId && prospectSchoolId) {
      const { data: linked } = await supabaseAdmin
        .from("schools").select("id").eq("prospect_school_id", prospectSchoolId).maybeSingle();
      effectiveSchoolId = linked?.id ?? null;
    }

    async function markDigitalSent() {
      if (!effectiveSchoolId) return;
      const { data: schoolStatus } = await supabaseAdmin
        .from("schools").select("brochure_delivery_status").eq("id", effectiveSchoolId).single();
      const current = schoolStatus?.brochure_delivery_status;
      const newStatus = current === "Physical Only" ? "Both Physical & Digital" : "Digital Sent";
      await supabaseAdmin.from("schools").update({ brochure_delivery_status: newStatus }).eq("id", effectiveSchoolId);
    }

    if (phone) {
      const mobile = normalizeMobile(phone);
      if (!mobile) {
        return new Response(JSON.stringify({ success: false, error: "Invalid phone number" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const payload = {
        messaging_product: "whatsapp",
        to: mobile,
        type: "template",
        template: {
          name: TEMPLATE_NAME,
          language: { code: "en" },
          components: [
            {
              type: "header",
              parameters: [
                {
                  type: "document",
                  document: {
                    link: project.brochure_url,
                    filename: `iPlus Olympiads ${project.project_year} Brochure.pdf`,
                  },
                },
              ],
            },
            {
              type: "body",
              parameters: [
                { type: "text", text: schoolName },
              ],
            },
          ],
        },
      };

      const res = await fetch(`${ASKEVA_URL}?token=${encodeURIComponent(ASKEVA_API_TOKEN)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const body = await res.json().catch(() => ({}));
      const wamid: string | null = body?.messages?.[0]?.id ?? null;

      if (!res.ok) {
        return new Response(JSON.stringify({ success: false, error: body?.error?.message ?? "WhatsApp send failed" }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (effectiveSchoolId) {
        await markDigitalSent();

        await supabaseAdmin.from("communications").insert({
          school_id: effectiveSchoolId,
          communication_type: "WhatsApp",
          message: `E-Brochure sent to ${phone}${contactName ? ` (${contactName})` : ""}`,
          contacted_person_name: contactName ?? null,
          contacted_mobile_no: phone,
          user_id: userId,
          project_id: project.id ?? null,
          wamid,
          delivery_status: wamid ? "sent" : null,
        }).then(({ error }) => { if (error) console.error("Failed to log communication:", error); });

        if (saveContact && contactName) {
          const { data: schoolData } = await supabaseAdmin
            .from("schools")
            .select("additional_contacts")
            .eq("id", effectiveSchoolId)
            .single();

          const existing: any[] = schoolData?.additional_contacts ?? [];
          const alreadyExists = existing.some((c: any) => c.mobile === phone);

          if (!alreadyExists && existing.length < 5) {
            const updated = [...existing, { name: contactName, mobile: phone, role: contactRole ?? "" }];
            await supabaseAdmin
              .from("schools")
              .update({ additional_contacts: updated })
              .eq("id", effectiveSchoolId);
          }
        }
      }
    }

    if (email) {
      if (!email.includes("@")) {
        return new Response(JSON.stringify({ success: false, error: "Invalid email address" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const html = EBROCHURE_EMAIL_HTML
        .replaceAll("{school_name}", schoolName)
        .replaceAll("{brochure_url}", project.brochure_url)
        .replaceAll("{project_year}", String(project.project_year ?? ""));
      const subject = `iPlus Olympiads ${project.project_year ?? ""} — Brochure for ${schoolName}`;

      try {
        await resend.emails.send({
          from: "iPlus Olympiads <noreply@iplusedu.in>",
          replyTo: "contact@iplusedu.in",
          to: [email],
          subject,
          html,
        });
      } catch (err: any) {
        return new Response(JSON.stringify({ success: false, error: err.message ?? "Email send failed" }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (effectiveSchoolId) {
        await markDigitalSent();

        await supabaseAdmin.from("communications").insert({
          school_id: effectiveSchoolId,
          communication_type: "Email",
          message: `E-Brochure emailed to ${email}`,
          user_id: userId,
          project_id: project.id ?? null,
          email_status: "sent",
        }).then(({ error }) => { if (error) console.error("Failed to log communication:", error); });
      }
    }

    return new Response(JSON.stringify({ success: true, message: "E-Brochure sent successfully" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err: any) {
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
```

- [ ] **Step 3: Deploy the function**

Run: `cd supabase/functions/.. && supabase functions deploy send-ebrochure --project-ref eucjeggfclztkbbupaav`

Expected: deploy succeeds with no TypeScript/Deno errors printed.

- [ ] **Step 4: Curl-test the email branch against a throwaway ID (no real data touched)**

The function only requires `schoolId`/`prospectSchoolId` to be present syntactically — it does not validate the row exists before sending. Passing a nonexistent UUID exercises the email path (template render + Resend send) without mutating any real school's `brochure_delivery_status` or `communications` log, because `effectiveSchoolId` resolves to `null` and the logging block is skipped entirely.

Run (replace `<ANON_KEY>` with the publishable key from `src/integrations/supabase/client.ts`, and use a real inbox you can check — e.g. the user's own address):

```bash
curl -s -X POST "https://eucjeggfclztkbbupaav.supabase.co/functions/v1/send-ebrochure" \
  -H "Content-Type: application/json" \
  -H "apikey: <ANON_KEY>" \
  -H "Authorization: Bearer <ANON_KEY>" \
  -d '{
    "prospectSchoolId": "00000000-0000-0000-0000-000000000000",
    "email": "ipluseducorp@gmail.com",
    "schoolName": "Test School Email QA"
  }'
```

Expected: `{"success":true,"message":"E-Brochure sent successfully"}`. Note: the edge function's own auth check requires a valid staff JWT (the anon key alone will 401 "Unauthorized") — get a real `access_token` first via the browser (Application tab → Local Storage → the Supabase auth token) or ask the user to run this curl from a logged-in session's dev console using `(await supabase.auth.getSession()).data.session.access_token`. Confirm the email arrives and renders correctly (gradient header, both CTA buttons work, footer intact).

- [ ] **Step 5: Curl-test that WhatsApp-only calls still work unchanged (regression check)**

Run the same curl shape but with `"phone": "<a real 10-digit test number>"` instead of `"email"`, omitting `email`. Expected: `{"success":true,...}`, same as before this change — confirms the WA branch wasn't broken by the refactor.

---

### Task 2: Create the shared `SendEbrochureDialog` component

**Files:**
- Create: `src/components/schools/SendEbrochureDialog.tsx`

**Interfaces:**
- Consumes: `supabase` client (`@/integrations/supabase/client`), `useToast` (`@/hooks/use-toast`), shadcn `Dialog`/`Button`/`Input`/`Label`/`Checkbox` components (same imports `SchoolDetail.tsx` already uses), `send-ebrochure` edge function (Task 1's contract: `{schoolId?, prospectSchoolId?, phone?, email?, schoolName, district?, state?, saveContact?, contactName?, contactRole?}` → `{success, message?, error?}`).
- Produces: exported `EbrochureContact` type (`{name:string; mobile:string; role?:string}`) and `SendEbrochureDialog` component with props `{open, onOpenChange, target, onSaveManualContact?, onSent?}` — consumed by Task 3 and Task 4.

- [ ] **Step 1: Write the component**

Create `src/components/schools/SendEbrochureDialog.tsx`:

```typescript
import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Send, Loader2 } from 'lucide-react';

export interface EbrochureContact { name: string; mobile: string; role?: string }

type Target =
  | {
      kind: 'school'; schoolId: string; schoolName: string; district?: string; state?: string;
      mobile1: string | null; mobile2: string | null; email: string | null; contacts: EbrochureContact[];
    }
  | {
      kind: 'prospect'; prospectSchoolId: string; schoolName: string; district?: string; state?: string;
      mobile: string | null; email: string | null; contacts: EbrochureContact[];
    };

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: Target;
  /** Fires after a successful manual-WhatsApp send with "save to contacts" checked.
   *  Only needed when the backend's own saveContact logic doesn't cover this target
   *  (it only ever writes to the `schools` table) — i.e. prospect-only targets. */
  onSaveManualContact?: (contact: EbrochureContact) => Promise<void>;
  /** Fires after any successful send (WhatsApp and/or Email). Use it to refresh
   *  whatever local state the parent shows (delivery status, saved contacts). */
  onSent?: () => void;
}

type Job =
  | { channel: 'whatsapp'; phone: string; contactName?: string; contactRole?: string; isManual?: boolean }
  | { channel: 'email'; email: string; isManual?: boolean };

export function SendEbrochureDialog({ open, onOpenChange, target, onSaveManualContact, onSent }: Props) {
  const { toast } = useToast();
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [manualPhone, setManualPhone] = useState('');
  const [manualContactName, setManualContactName] = useState('');
  const [manualContactRole, setManualContactRole] = useState('');
  const [saveContact, setSaveContact] = useState(false);
  const [manualEmail, setManualEmail] = useState('');
  const [sending, setSending] = useState(false);

  // Pre-check the primary WA number and email on file whenever the dialog opens
  useEffect(() => {
    if (!open) return;
    const initial = new Set<string>();
    if (target.kind === 'school' && target.mobile1) initial.add('mobile1');
    if (target.kind === 'prospect' && target.mobile) initial.add('mobile');
    if (target.email) initial.add('email');
    setChecked(initial);
  }, [open, target]);

  const toggle = (key: string) => {
    setChecked(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  const reset = () => {
    setManualPhone(''); setManualContactName(''); setManualContactRole(''); setSaveContact(false);
    setManualEmail('');
  };

  const handleSend = async () => {
    const jobs: Job[] = [];

    if (target.kind === 'school') {
      if (checked.has('mobile1') && target.mobile1) jobs.push({ channel: 'whatsapp', phone: target.mobile1 });
      if (checked.has('mobile2') && target.mobile2) jobs.push({ channel: 'whatsapp', phone: target.mobile2 });
    } else {
      if (checked.has('mobile') && target.mobile) jobs.push({ channel: 'whatsapp', phone: target.mobile });
    }
    target.contacts.forEach((c, i) => {
      if (checked.has(`contact_${i}`) && c.mobile) {
        jobs.push({ channel: 'whatsapp', phone: c.mobile, contactName: c.name, contactRole: c.role });
      }
    });
    if (checked.has('manual_wa')) {
      if (manualPhone.replace(/\D/g, '').length < 10) {
        toast({ title: 'Error', description: 'Please enter a valid 10-digit manual phone number', variant: 'destructive' });
        return;
      }
      jobs.push({ channel: 'whatsapp', phone: manualPhone, contactName: manualContactName || undefined, contactRole: manualContactRole || undefined, isManual: true });
    }
    if (checked.has('email') && target.email) {
      jobs.push({ channel: 'email', email: target.email });
    }
    if (checked.has('manual_email')) {
      if (!manualEmail.includes('@')) {
        toast({ title: 'Error', description: 'Please enter a valid email address', variant: 'destructive' });
        return;
      }
      jobs.push({ channel: 'email', email: manualEmail, isManual: true });
    }

    // Dedupe WA jobs by last-10-digits, email jobs by lowercased address
    const seenPhones = new Set<string>();
    const seenEmails = new Set<string>();
    const unique = jobs.filter(j => {
      if (j.channel === 'whatsapp') {
        const d = j.phone.replace(/\D/g, '').slice(-10);
        if (seenPhones.has(d)) return false;
        seenPhones.add(d);
        return true;
      }
      const e = j.email.toLowerCase();
      if (seenEmails.has(e)) return false;
      seenEmails.add(e);
      return true;
    });

    if (unique.length === 0) {
      toast({ title: 'Error', description: 'Select at least one WhatsApp number or email', variant: 'destructive' });
      return;
    }

    setSending(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Your login session has expired — please refresh the page and log in again.');

      let sentCount = 0;
      const failed: string[] = [];
      let firstError = '';

      for (const job of unique) {
        const label = job.channel === 'whatsapp' ? job.phone : job.email;
        try {
          const res = await supabase.functions.invoke('send-ebrochure', {
            headers: { Authorization: `Bearer ${session.access_token}` },
            body: {
              schoolId: target.kind === 'school' ? target.schoolId : undefined,
              prospectSchoolId: target.kind === 'prospect' ? target.prospectSchoolId : undefined,
              phone: job.channel === 'whatsapp' ? job.phone : undefined,
              email: job.channel === 'email' ? job.email : undefined,
              schoolName: target.schoolName,
              district: target.district,
              state: target.state,
              saveContact: job.channel === 'whatsapp' && saveContact && job.isManual,
              contactName: job.channel === 'whatsapp' ? job.contactName : undefined,
              contactRole: job.channel === 'whatsapp' ? job.contactRole : undefined,
            },
          });
          if (res.error) {
            const body = await (res.error as any).context?.json?.().catch(() => null);
            throw new Error(body?.error || res.error.message);
          }
          if (!res.data?.success) throw new Error(res.data?.error || 'Send failed');
          sentCount++;
        } catch (err: any) {
          failed.push(label);
          if (!firstError) firstError = err.message;
        }
      }

      if (failed.length === 0) {
        const first = unique[0];
        const firstLabel = first.channel === 'whatsapp' ? first.phone : first.email;
        toast({ title: 'E-Brochure sent!', description: sentCount === 1 ? `Sent to ${firstLabel}` : `Sent to ${sentCount} recipients` });
      } else {
        toast({
          title: sentCount > 0 ? 'Partially sent' : 'Send failed',
          description: `${sentCount} sent · failed for ${failed.join(', ')} — ${firstError}`,
          variant: 'destructive',
        });
      }

      if (sentCount > 0) {
        const manualWaSent = checked.has('manual_wa') && !failed.includes(manualPhone);
        if (manualWaSent && saveContact && onSaveManualContact) {
          await onSaveManualContact({
            name: manualContactName,
            mobile: manualPhone.replace(/\D/g, '').slice(-10),
            role: manualContactRole || undefined,
          });
        }
        onOpenChange(false);
        reset();
        onSent?.();
      }
    } catch (err: any) {
      toast({ title: 'Send failed', description: err.message, variant: 'destructive' });
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={o => { if (!sending) { onOpenChange(o); if (!o) reset(); } }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Send className="h-5 w-5 text-indigo-600" />
            Send E-Brochure
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div>
            <Label className="text-sm font-medium mb-2 block">WhatsApp numbers</Label>
            <div className="space-y-2">
              {target.kind === 'school' ? (
                <>
                  <div className="flex items-center gap-3 border rounded-md px-3 py-2">
                    <Checkbox checked={checked.has('mobile1')} onCheckedChange={() => toggle('mobile1')} id="eb_m1" disabled={!target.mobile1} />
                    <Label htmlFor="eb_m1" className="cursor-pointer flex-1">
                      <span className="text-xs text-muted-foreground">Mobile 1</span>
                      <p className="font-medium">{target.mobile1 || <span className="text-muted-foreground italic">Not set</span>}</p>
                    </Label>
                  </div>
                  <div className="flex items-center gap-3 border rounded-md px-3 py-2">
                    <Checkbox checked={checked.has('mobile2')} onCheckedChange={() => toggle('mobile2')} id="eb_m2" disabled={!target.mobile2} />
                    <Label htmlFor="eb_m2" className="cursor-pointer flex-1">
                      <span className="text-xs text-muted-foreground">Mobile 2</span>
                      <p className="font-medium">{target.mobile2 || <span className="text-muted-foreground italic">Not set</span>}</p>
                    </Label>
                  </div>
                </>
              ) : (
                <div className="flex items-center gap-3 border rounded-md px-3 py-2">
                  <Checkbox checked={checked.has('mobile')} onCheckedChange={() => toggle('mobile')} id="eb_mobile" disabled={!target.mobile} />
                  <Label htmlFor="eb_mobile" className="cursor-pointer flex-1">
                    <span className="text-xs text-muted-foreground">School Mobile</span>
                    <p className="font-medium">{target.mobile || <span className="text-muted-foreground italic">Not set</span>}</p>
                  </Label>
                </div>
              )}
              {target.contacts.map((c, i) => (
                <div key={i} className="flex items-center gap-3 border rounded-md px-3 py-2">
                  <Checkbox checked={checked.has(`contact_${i}`)} onCheckedChange={() => toggle(`contact_${i}`)} id={`eb_c${i}`} disabled={!c.mobile} />
                  <Label htmlFor={`eb_c${i}`} className="cursor-pointer flex-1">
                    <span className="text-xs text-muted-foreground">{[c.role || 'Contact', c.name].filter(Boolean).join(' — ')}</span>
                    <p className="font-medium">{c.mobile}</p>
                  </Label>
                </div>
              ))}
              <div className="flex items-center gap-3 border rounded-md px-3 py-2">
                <Checkbox checked={checked.has('manual_wa')} onCheckedChange={() => toggle('manual_wa')} id="eb_manual_wa" />
                <Label htmlFor="eb_manual_wa" className="cursor-pointer">Enter a different number</Label>
              </div>
            </div>
          </div>

          {checked.has('manual_wa') && (
            <div className="space-y-3 border-l-2 border-indigo-400 pl-3">
              <div>
                <Label htmlFor="eb_number" className="text-xs">Phone Number</Label>
                <Input id="eb_number" value={manualPhone} onChange={e => setManualPhone(e.target.value)} placeholder="10-digit mobile number" className="mt-1" />
              </div>
              <div>
                <Label htmlFor="eb_cname" className="text-xs">Contact Name (optional)</Label>
                <Input id="eb_cname" value={manualContactName} onChange={e => setManualContactName(e.target.value)} placeholder="e.g., Principal Ravi" className="mt-1" />
              </div>
              <div>
                <Label htmlFor="eb_crole" className="text-xs">Role (optional)</Label>
                <Input id="eb_crole" value={manualContactRole} onChange={e => setManualContactRole(e.target.value)} placeholder="e.g., Principal, Coordinator" className="mt-1" />
              </div>
              <div className="flex items-center gap-2">
                <input type="checkbox" id="eb_save" checked={saveContact} onChange={e => setSaveContact(e.target.checked)} className="rounded" />
                <Label htmlFor="eb_save" className="text-xs cursor-pointer">Save this number to contacts</Label>
              </div>
            </div>
          )}

          <div>
            <Label className="text-sm font-medium mb-2 block">Email</Label>
            <div className="space-y-2">
              <div className="flex items-center gap-3 border rounded-md px-3 py-2">
                <Checkbox checked={checked.has('email')} onCheckedChange={() => toggle('email')} id="eb_email" disabled={!target.email} />
                <Label htmlFor="eb_email" className="cursor-pointer flex-1">
                  <span className="text-xs text-muted-foreground">Email on file</span>
                  <p className="font-medium">{target.email || <span className="text-muted-foreground italic">Not set</span>}</p>
                </Label>
              </div>
              <div className="flex items-center gap-3 border rounded-md px-3 py-2">
                <Checkbox checked={checked.has('manual_email')} onCheckedChange={() => toggle('manual_email')} id="eb_manual_email" />
                <Label htmlFor="eb_manual_email" className="cursor-pointer">Enter a different email</Label>
              </div>
            </div>
          </div>

          {checked.has('manual_email') && (
            <div className="border-l-2 border-indigo-400 pl-3">
              <Label htmlFor="eb_email_manual" className="text-xs">Email Address</Label>
              <Input id="eb_email_manual" type="email" value={manualEmail} onChange={e => setManualEmail(e.target.value)} placeholder="school@example.com" className="mt-1" />
            </div>
          )}

          <div className="flex gap-2 pt-2">
            <Button variant="outline" className="flex-1" onClick={() => onOpenChange(false)} disabled={sending}>Cancel</Button>
            <Button className="flex-1" onClick={handleSend} disabled={sending}>
              {sending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              {sending ? 'Sending…' : 'Send E-Brochure'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`

Expected: no errors referencing `SendEbrochureDialog.tsx` (the file isn't imported anywhere yet, so this only confirms the new file itself is internally type-correct).

---

### Task 3: Wire `SendEbrochureDialog` into `SchoolDetail.tsx`

**Files:**
- Modify: `src/pages/SchoolDetail.tsx`

**Interfaces:**
- Consumes: `SendEbrochureDialog`, `EbrochureContact` from `@/components/schools/SendEbrochureDialog` (Task 2).
- Produces: nothing new for other tasks — this is a leaf integration.

- [ ] **Step 1: Add the import**

In `src/pages/SchoolDetail.tsx`, add near the other component imports (after the `PortalRegistrationView` import, before `useToast`):

```typescript
import { SendEbrochureDialog } from '@/components/schools/SendEbrochureDialog';
```

- [ ] **Step 2: Remove the old e-brochure state and handler**

Delete this block (currently lines 130-142):

```typescript
  // E-Brochure send dialog — checkbox multi-select, sends to every checked number
  const [ebrochureOpen, setEbrochureOpen] = useState(false);
  const [ebrochureChecked, setEbrochureChecked] = useState<Set<string>>(new Set());
  const [ebrochureManual, setEbrochureManual] = useState('');
  const [ebrochureContactName, setEbrochureContactName] = useState('');
  const [ebrochureContactRole, setEbrochureContactRole] = useState('');
  const [ebrochureSaveContact, setEbrochureSaveContact] = useState(false);
  const [ebrochureSending, setEbrochureSending] = useState(false);

  const toggleEbrochureNumber = (key: string) => {
    setEbrochureChecked(prev => {
```

Replace it with just:

```typescript
  const [ebrochureOpen, setEbrochureOpen] = useState(false);
```

(The `toggleEbrochureNumber` function body that continues past this point, and the entire `handleSendEbrochure` function at what is currently lines 408-504, must also be deleted — see next step.)

- [ ] **Step 3: Delete `toggleEbrochureNumber` and `handleSendEbrochure` entirely**

Find and delete the full `toggleEbrochureNumber` function (the 6 lines immediately following the block removed in Step 2) and the full `handleSendEbrochure` function (currently lines 408-504, from `const handleSendEbrochure = async () => {` through its closing `};`). Nothing else in the file calls `toggleEbrochureNumber` or `handleSendEbrochure` after Step 4, so removing them creates no dangling references.

- [ ] **Step 4: Replace the trigger button and the inline dialog**

Find this button (currently around line 688):

```typescript
              <Button variant="default" onClick={() => { setEbrochureChecked(new Set(school.mobile1 ? ['mobile1'] : [])); setEbrochureOpen(true); }}>
                <Send className="h-4 w-4 mr-2" />
                Send E-Brochure
              </Button>
```

Replace with:

```typescript
              <Button variant="default" onClick={() => setEbrochureOpen(true)}>
                <Send className="h-4 w-4 mr-2" />
                Send E-Brochure
              </Button>
```

Then find the entire `{/* E-Brochure Send Dialog */}` block (currently lines 699-768, the full `<Dialog open={ebrochureOpen} ...>...</Dialog>`) and replace it with:

```typescript
        <SendEbrochureDialog
          open={ebrochureOpen}
          onOpenChange={setEbrochureOpen}
          target={{
            kind: 'school',
            schoolId: id!,
            schoolName: school.school_name,
            district: school.district,
            state: school.state,
            mobile1: school.mobile1 ?? null,
            mobile2: school.mobile2 ?? null,
            email: school.email ?? null,
            contacts: school.additional_contacts ?? [],
          }}
          onSent={async () => {
            const { data } = await supabase.from('schools').select('*').eq('id', id).single();
            if (data) setSchool(data as any);
          }}
        />
```

Note: no `onSaveManualContact` is passed here — the edge function's `saveContact` branch already writes to `schools.additional_contacts` server-side when `schoolId` is present (Task 1, Step 2), and `onSent` refetches the row to reflect it. This matches the original behavior, which also refetched after a manual+save send.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`

Expected: no errors. In particular, confirm there are no leftover references to `ebrochureChecked`, `ebrochureManual`, `ebrochureContactName`, `ebrochureContactRole`, `ebrochureSaveContact`, `ebrochureSending`, `toggleEbrochureNumber`, or `handleSendEbrochure` anywhere in the file:

Run: `grep -n "ebrochureChecked\|ebrochureManual\|ebrochureContactName\|ebrochureContactRole\|ebrochureSaveContact\|ebrochureSending\|toggleEbrochureNumber\|handleSendEbrochure" src/pages/SchoolDetail.tsx`

Expected: no output.

- [ ] **Step 6: Manual verification (requires a logged-in superadmin session)**

Start the dev server (`npm run dev`) and open any School Detail page. Click "Send E-Brochure": confirm Mobile 1 / Mobile 2 checkboxes behave exactly as before, and a new "Email" section appears below with the school's email pre-checked (if set). Send to your own test email + a real WhatsApp number and confirm both arrive.

---

### Task 4: Wire `SendEbrochureDialog` into `ProspectSchoolsPage.tsx`

**Files:**
- Modify: `src/pages/ProspectSchoolsPage.tsx`

**Interfaces:**
- Consumes: `SendEbrochureDialog`, `EbrochureContact` from `@/components/schools/SendEbrochureDialog` (Task 2).
- Produces: nothing new for other tasks — leaf integration.

- [ ] **Step 1: Add the import**

Add near the other local imports (after `ProspectUploadSchools`):

```typescript
import { SendEbrochureDialog } from '@/components/schools/SendEbrochureDialog';
```

- [ ] **Step 2: Remove the old e-brochure state, handler, and `openEbrochureDialog`**

Delete this block (currently lines 77-91):

```typescript
  // E-Brochure state — checkbox multi-select, sends to every checked number
  const [ebrochureOpen, setEbrochureOpen] = useState(false);
  const [ebrochureChecked, setEbrochureChecked] = useState<Set<string>>(new Set());
  const [ebrochureManual, setEbrochureManual] = useState('');
  const [ebrochureManualName, setEbrochureManualName] = useState('');
  const [ebrochureManualRole, setEbrochureManualRole] = useState('');
  const [ebrochureSaveMobile, setEbrochureSaveMobile] = useState(false);
  const [ebrochureSending, setEbrochureSending] = useState(false);

  const toggleEbrochureNumber = (key: string) => {
    setEbrochureChecked(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };
```

Replace it with just:

```typescript
  const [ebrochureOpen, setEbrochureOpen] = useState(false);
```

Then delete the full `openEbrochureDialog` function (currently lines 339-347) and the full `handleSendEbrochure` function (currently lines 349-454, through its closing `};`). Nothing else calls them after Step 3.

- [ ] **Step 3: Replace the trigger button and the inline dialog**

Find this button (currently around line 963-969):

```typescript
                {/* Send E-Brochure — always fetches the active project's brochure */}
                <button
                  onClick={openEbrochureDialog}
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-indigo-200 bg-indigo-50 text-indigo-700 text-sm font-semibold hover:bg-indigo-100 transition-colors"
                >
                  <Send className="h-4 w-4" />
                  Send E-Brochure
                </button>
```

Replace with:

```typescript
                {/* Send E-Brochure — always fetches the active project's brochure */}
                <button
                  onClick={() => setEbrochureOpen(true)}
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-indigo-200 bg-indigo-50 text-indigo-700 text-sm font-semibold hover:bg-indigo-100 transition-colors"
                >
                  <Send className="h-4 w-4" />
                  Send E-Brochure
                </button>
```

Then find the entire `{/* E-Brochure send dialog */}` block (currently lines 1141-1226ish, the full `<Dialog open={ebrochureOpen} ...>...</Dialog>`) and replace it with:

```typescript
      {selected && (
        <SendEbrochureDialog
          open={ebrochureOpen}
          onOpenChange={setEbrochureOpen}
          target={{
            kind: 'prospect',
            prospectSchoolId: selected.id,
            schoolName: selected.school_name,
            district: selected.district,
            state: selected.state,
            mobile: selected.mobile,
            email: selected.email,
            contacts: selected.additional_contacts ?? [],
          }}
          onSaveManualContact={async (contact) => {
            const digits = contact.mobile.replace(/\D/g, '').slice(-10);
            if (!selected.mobile) {
              const { error } = await supabase.from('prospect_schools').update({ mobile: digits }).eq('id', selected.id);
              if (!error) {
                const updated = { ...selected, mobile: digits };
                setSelected(updated);
                setSchools(prev => prev.map(s => s.id === updated.id ? updated : s));
              }
            } else {
              const existing = selected.additional_contacts ?? [];
              const isDup = existing.some(c => c.mobile.replace(/\D/g, '').slice(-10) === digits) || selected.mobile.replace(/\D/g, '').slice(-10) === digits;
              if (!isDup && existing.length < MAX_CONTACTS) {
                const contacts = [...existing, { name: contact.name, role: contact.role ?? '', mobile: digits }];
                const { error } = await supabase.from('prospect_schools').update({ additional_contacts: contacts }).eq('id', selected.id);
                if (!error) {
                  const updated = { ...selected, additional_contacts: contacts };
                  setSelected(updated);
                  setSchools(prev => prev.map(s => s.id === updated.id ? updated : s));
                }
              }
            }
          }}
        />
      )}
```

Note: `selected` is guarded with `{selected && (...)}` because it can be `null` while the panel is closed, and `SendEbrochureDialog`'s `target` prop isn't nullable. `onSent` is omitted — the original code didn't refresh anything on a bare successful send either (only the save-contact path updated local state, which the callback above now handles directly).

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`

Expected: no errors. Confirm no leftover references:

Run: `grep -n "ebrochureChecked\|ebrochureManual\|ebrochureManualName\|ebrochureManualRole\|ebrochureSaveMobile\|ebrochureSending\|toggleEbrochureNumber\|openEbrochureDialog\|handleSendEbrochure" src/pages/ProspectSchoolsPage.tsx`

Expected: no output.

- [ ] **Step 5: Manual verification (requires a logged-in superadmin session)**

Open a prospect school's detail panel, click "Send E-Brochure": confirm the School Mobile checkbox and manual-entry flow behave exactly as before, plus the new Email section. Test the "save to contacts" path with a manual WA number on a prospect with no existing `mobile` to confirm it still writes to `prospect_schools.mobile`.

---

## Self-review notes (already applied above)

- Confirmed `School` type (`src/types/database.ts:28`) already includes
  `additional_contacts?: Array<{name,mobile,role?}> | null`, and `ProspectSchool` in
  `ProspectSchoolsPage.tsx` has an equivalent `additional_contacts: ProspectContact[] |
  null` — both structurally compatible with `EbrochureContact[]`.
- Confirmed the edge function's existing `saveContact` block only ever updates
  `schools.additional_contacts` (never `prospect_schools`), which is why Task 4 still
  needs its own `onSaveManualContact` implementation while Task 3 does not.
- Confirmed `SchoolDetail.tsx` guards its whole render behind `if (!school) return
  ...` (line 568) before the dialog is reached, so `school.mobile1` etc. can be read
  directly with no extra null-guard in the `target` object.
- Fixed a type-narrowing bug caught on review: `unique.find(j => j.channel ===
  'whatsapp' && j.isManual)` does not narrow `Job` to its WhatsApp variant (plain
  arrow predicates don't narrow `Array.prototype.find`'s return type), so
  `manualWaJob.phone` would fail to typecheck. Replaced with the same direct
  `checked.has('manual_wa') && !failed.includes(manualPhone)` check the original
  `SchoolDetail.tsx`/`ProspectSchoolsPage.tsx` code already used. Also replaced
  repeated `unique[0].channel === ... ? unique[0].phone : unique[0].email` with a
  `const first = unique[0]` local before narrowing, since narrowing on repeated
  indexed-access expressions is unreliable.
