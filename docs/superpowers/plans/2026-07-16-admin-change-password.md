# Superadmin Change Password Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the broken password-reset email button on the User Management page with a superadmin-driven Change Password dialog (new + confirm entry) backed by a new `update-user-password` edge function.

**Architecture:** One React page edit (`Users.tsx`: remove reset-email code, add a Key-icon button + dialog) and one new Supabase edge function that verifies the caller is a superadmin, then sets the target user's password via the service-role admin API. No DB schema changes.

**Tech Stack:** React 18 + TypeScript + shadcn/ui, Supabase edge functions (Deno), Supabase CLI (linked project `eucjeggfclztkbbupaav`).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-16-admin-change-password-design.md`
- NEVER `git add -A` in this repo — voicebot files are intentionally uncommitted. Stage explicit paths only.
- Do NOT display or store the current password anywhere (decision by Goghul 2026-07-16).
- New edge function uses default `verify_jwt = true` — do NOT add it to `supabase/config.toml`.
- Password minimum length: 6 (Supabase default).
- Repo has no test runner. Verify with `npx tsc --noEmit`, `npm run build`, and curl against the deployed function.
- Deploy consent gate: push to `unified main` only deploys to staging; Goghul moves to live himself. Never claim "live".

---

### Task 1: Remove password-reset email code from Users.tsx

**Files:**
- Modify: `src/pages/Users.tsx` (import line 17, handler lines ~209–222, button lines ~378–380)

**Interfaces:**
- Consumes: nothing.
- Produces: `Users.tsx` with no `handleResetPassword` and no reset button. Task 3 adds the replacement button in the same action group (between the Pencil edit button and the Trash2 delete button).

- [ ] **Step 1: Remove the `RefreshCw` import**

In `src/pages/Users.tsx` line 17, change:

```tsx
import { Plus, Trash2, RefreshCw, Shield, MapPin, MessageSquare, ChevronDown, ChevronUp, Pencil, UserPlus } from 'lucide-react';
```

to:

```tsx
import { Plus, Trash2, Shield, MapPin, MessageSquare, ChevronDown, ChevronUp, Pencil, UserPlus } from 'lucide-react';
```

- [ ] **Step 2: Delete the `handleResetPassword` function**

Delete this entire block (lines ~209–222), including its section comment:

```tsx
  // ── Reset password ─────────────────────────────────────────────────────────

  const handleResetPassword = async (user: Profile) => {
    const email = user.email || `${user.username}@iplusedu.in`;
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/auth`,
      });
      if (error) throw error;
      toast({ title: 'Reset email sent', description: `Sent to ${email}` });
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
  };
```

- [ ] **Step 3: Delete the reset button JSX**

In the user-row action group (between the Pencil edit button and the `{!isSelf && (` delete button), delete:

```tsx
                        <Button variant="outline" size="sm" onClick={() => handleResetPassword(user)} title="Send password reset email">
                          <RefreshCw className="h-4 w-4" />
                        </Button>
```

- [ ] **Step 4: Typecheck**

Run: `cd /Users/goghulselvan/Desktop/Claude-workspace/vg-iplus-crm-main && npx tsc --noEmit`
Expected: exits 0, no output. (If it errors on unrelated pre-existing files, confirm none of the errors mention `Users.tsx`.)

- [ ] **Step 5: Commit**

```bash
cd /Users/goghulselvan/Desktop/Claude-workspace/vg-iplus-crm-main
git add src/pages/Users.tsx
git commit -m "feat: remove broken password-reset email from user management"
```

---

### Task 2: Create and deploy the `update-user-password` edge function

**Files:**
- Create: `supabase/functions/update-user-password/index.ts`

**Interfaces:**
- Consumes: caller's Supabase session JWT (gateway-verified, `verify_jwt = true` default).
- Produces: HTTP endpoint `update-user-password` accepting POST `{ userId: string, password: string }`, returning `{ success: true }` or `{ success: false, error: string }` — Task 3's dialog invokes it via `supabase.functions.invoke('update-user-password', { body: { userId, password } })`.

- [ ] **Step 1: Write the function**

Create `supabase/functions/update-user-password/index.ts` with exactly:

```ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status,
  })

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

    const authHeader = req.headers.get('authorization') ?? req.headers.get('Authorization')
    const token = (authHeader?.match(/^Bearer\s+(.+)$/i)?.[1] ?? '').trim()
    if (!token) {
      return json(401, { success: false, error: 'Missing authorization header' })
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey)

    // The gateway (verify_jwt) has already verified the JWT signature. getUser()
    // can still 401 real browser logins, so fall back to the verified claims.
    let callerId: string | null = null
    const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token)
    if (user) {
      callerId = user.id
    } else {
      try {
        const b64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
        const payload = JSON.parse(atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4)))
        if (payload.role === 'authenticated' && payload.sub) callerId = payload.sub
        console.log('getUser failed, JWT-claims fallback used:', authErr?.message, 'role:', payload.role)
      } catch { /* fall through to 401 */ }
    }
    if (!callerId) {
      return json(401, { success: false, error: 'Invalid or expired authentication token' })
    }

    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('role')
      .eq('user_id', callerId)
      .single()

    if (profileError || !profile || profile.role !== 'superadmin') {
      return json(403, { success: false, error: 'Only superadmins can change passwords' })
    }

    const { userId, password } = await req.json()

    if (!userId || typeof password !== 'string') {
      return json(400, { success: false, error: 'userId and password are required' })
    }
    if (password.length < 6) {
      return json(400, { success: false, error: 'Password must be at least 6 characters' })
    }

    const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(userId, { password })
    if (updateError) {
      return json(500, { success: false, error: updateError.message })
    }

    return json(200, { success: true })
  } catch (error) {
    console.error('Update password failed:', error)
    return json(500, { success: false, error: error instanceof Error ? error.message : 'Unknown error' })
  }
})
```

- [ ] **Step 2: Deploy**

Run: `cd /Users/goghulselvan/Desktop/Claude-workspace/vg-iplus-crm-main && supabase functions deploy update-user-password`
Expected: "Deployed Function update-user-password" (version 1). If the CLI asks for `SUPABASE_ACCESS_TOKEN`, check `CREDENTIALS.md` at the workspace root before asking Goghul (see memory `reference_supabase_credentials_fallback`).

- [ ] **Step 3: Verify auth rejection via curl**

Run (no auth header — gateway should reject):

```bash
curl -s -o /dev/null -w "%{http_code}" -X POST \
  "https://eucjeggfclztkbbupaav.supabase.co/functions/v1/update-user-password" \
  -H "Content-Type: application/json" -d '{"userId":"x","password":"yyyyyy"}'
```

Expected: `401`

Run (anon key as bearer — passes gateway, fails role check because anon JWT has `role: "anon"`, and getUser has no session):

```bash
ANON="<anon key from src/integrations/supabase/client.ts>"
curl -s -X POST \
  "https://eucjeggfclztkbbupaav.supabase.co/functions/v1/update-user-password" \
  -H "Authorization: Bearer $ANON" -H "apikey: $ANON" \
  -H "Content-Type: application/json" -d '{"userId":"x","password":"yyyyyy"}'
```

Expected: `{"success":false,"error":"Invalid or expired authentication token"}` (HTTP 401). The superadmin happy path cannot be curl-tested (no staff login in this environment) — Goghul click-through covers it.

- [ ] **Step 4: Commit**

```bash
cd /Users/goghulselvan/Desktop/Claude-workspace/vg-iplus-crm-main
git add supabase/functions/update-user-password/index.ts
git commit -m "feat: update-user-password edge function (superadmin only)"
```

---

### Task 3: Change Password dialog in Users.tsx

**Files:**
- Modify: `src/pages/Users.tsx`

**Interfaces:**
- Consumes: `update-user-password` endpoint from Task 2 (`{ userId, password }` → `{ success, error? }`); the action-group slot freed by Task 1.
- Produces: user-visible Change Password feature. Nothing downstream.

- [ ] **Step 1: Add the `KeyRound` icon import**

Change the lucide-react import (as left by Task 1) to include `KeyRound`:

```tsx
import { Plus, Trash2, KeyRound, Shield, MapPin, MessageSquare, ChevronDown, ChevronUp, Pencil, UserPlus } from 'lucide-react';
```

- [ ] **Step 2: Add dialog state**

After the "Regional districts dialog" state block (`const [regionalDistricts, ...]`), add:

```tsx
  // Change password dialog
  const [pwdOpen, setPwdOpen] = useState(false);
  const [pwdUser, setPwdUser] = useState<Profile | null>(null);
  const [pwdForm, setPwdForm] = useState({ newPassword: '', confirmPassword: '' });
  const [changingPwd, setChangingPwd] = useState(false);
```

- [ ] **Step 3: Add open + submit handlers**

Where `handleResetPassword` used to be (after the Delete section), add:

```tsx
  // ── Change password ─────────────────────────────────────────────────────────

  const openChangePassword = (user: Profile) => {
    setPwdUser(user);
    setPwdForm({ newPassword: '', confirmPassword: '' });
    setPwdOpen(true);
  };

  const pwdMismatch = pwdForm.confirmPassword.length > 0 && pwdForm.newPassword !== pwdForm.confirmPassword;
  const pwdValid = pwdForm.newPassword.length >= 6 && pwdForm.newPassword === pwdForm.confirmPassword;

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pwdUser || !pwdValid) return;
    setChangingPwd(true);
    try {
      const { data, error } = await supabase.functions.invoke('update-user-password', {
        body: { userId: pwdUser.user_id, password: pwdForm.newPassword },
      });
      if (error) {
        const body = await (error as any).context?.json?.().catch(() => null);
        throw new Error(body?.error || data?.error || error.message);
      }
      if (!data?.success) throw new Error(data?.error || 'Failed to change password');
      setPwdOpen(false);
      toast({ title: 'Password changed', description: `New password set for ${pwdUser.full_name || pwdUser.username}.` });
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setChangingPwd(false);
    }
  };
```

- [ ] **Step 4: Add the Change Password button**

In the action group, in the slot Task 1 freed (between the Pencil edit button and `{!isSelf && (`), add:

```tsx
                        <Button variant="outline" size="sm" onClick={() => openChangePassword(user)} title="Change password">
                          <KeyRound className="h-4 w-4" />
                        </Button>
```

- [ ] **Step 5: Add the dialog JSX**

After the closing tag of the Edit User Dialog (`</Dialog>` before the Regional Districts Dialog comment), add:

```tsx
      {/* ── Change Password Dialog ─────────────────────────────────────────────── */}
      <Dialog open={pwdOpen} onOpenChange={open => { setPwdOpen(open); if (!open) { setPwdUser(null); setPwdForm({ newPassword: '', confirmPassword: '' }); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="h-4 w-4" />
              Change Password
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleChangePassword} className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {pwdUser?.full_name || pwdUser?.username} · {pwdUser?.email || `${pwdUser?.username}@iplusedu.in`}
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="p-new">New Password</Label>
              <Input id="p-new" type="password" autoComplete="new-password" value={pwdForm.newPassword} onChange={e => setPwdForm(f => ({ ...f, newPassword: e.target.value }))} required minLength={6} />
              {pwdForm.newPassword.length > 0 && pwdForm.newPassword.length < 6 && (
                <p className="text-xs text-destructive">Must be at least 6 characters</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p-confirm">Confirm Password</Label>
              <Input id="p-confirm" type="password" autoComplete="new-password" value={pwdForm.confirmPassword} onChange={e => setPwdForm(f => ({ ...f, confirmPassword: e.target.value }))} required />
              {pwdMismatch && <p className="text-xs text-destructive">Passwords do not match</p>}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setPwdOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={!pwdValid || changingPwd}>{changingPwd ? 'Changing…' : 'Change Password'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
```

- [ ] **Step 6: Typecheck and build**

Run: `cd /Users/goghulselvan/Desktop/Claude-workspace/vg-iplus-crm-main && npx tsc --noEmit && npm run build`
Expected: typecheck exits 0; vite build succeeds. Do NOT stage the regenerated `dist/` output — the working tree already has uncommitted voicebot-era dist churn, and GitHub Actions rebuilds from source anyway.

- [ ] **Step 7: Commit**

```bash
cd /Users/goghulselvan/Desktop/Claude-workspace/vg-iplus-crm-main
git add src/pages/Users.tsx
git commit -m "feat: superadmin change-password dialog in user management"
```

---

### Task 4: Push and verify deploy

**Files:** none (git/CI only)

**Interfaces:**
- Consumes: commits from Tasks 1–3.
- Produces: staging build at `cms.iplus.vaima.in/unified_deployment/`.

- [ ] **Step 1: Verify staging area is clean of voicebot files**

Run: `git -C /Users/goghulselvan/Desktop/Claude-workspace/vg-iplus-crm-main status --short`
Expected: voicebot files (`ProspectVoiceCampaigns.tsx`, `ai-voice-agent/`, `send-voice-campaign/`, `generate-*`, `register-inbound-route/`, `send-ai-call-whatsapp/`, `trigger-human-transfer/`, voice migrations) all still unstaged/untracked. Nothing staged.

- [ ] **Step 2: Push to the unified remote (NEVER origin)**

Run: `git -C /Users/goghulselvan/Desktop/Claude-workspace/vg-iplus-crm-main push unified main`
Expected: push accepted.

- [ ] **Step 3: Confirm GitHub Actions green**

Run: `gh run list --repo goghulselvan/iplus-unified-system --limit 1` (repeat until completed)
Expected: latest run `success`.

- [ ] **Step 4: Report to Goghul**

Tell him: files are in `cms.iplus.vaima.in/unified_deployment/` — move to `cms.iplus.vaima.in/` to go live; then click-through: open Users page, confirm reset-email button gone, change a test user's password via the new dialog, log in with the new password.
