# Superadmin Change Password — Design

**Date:** 2026-07-16
**Status:** Approved by Goghul (chat)

## Problem

On the User Management page (`/users`, superadmin only), the per-user "reset password"
button sends a Supabase recovery email via `supabase.auth.resetPasswordForEmail()`.
It does not work and is no longer wanted. Goghul wants the superadmin to change any
staff user's password directly in the CRM instead.

**Decision (Goghul, 2026-07-16):** Do NOT display the current password. Supabase Auth
stores only hashes, so showing it would require keeping a plaintext copy in the DB —
rejected. The dialog is New Password + Confirm Password only.

## Changes

### 1. Remove password-reset email code (`src/pages/Users.tsx`)

- Delete `handleResetPassword` (the only password-recovery code in the CRM).
- Delete the RefreshCw reset button in the user-row actions.
- Remove the now-unused `RefreshCw` import.
- The school portal's OTP reset flow (separate repo) is unrelated and untouched.

### 2. New edge function: `update-user-password`

`supabase/functions/update-user-password/index.ts`, default `verify_jwt = true`
(no config.toml entry). Follows the `create-user` auth pattern with the
`send-ebrochure` JWT-claims fallback (getUser() can 401 real browser logins even
though the gateway already verified the JWT signature):

1. CORS: OPTIONS handler + `Access-Control-Allow-Origin: *` on every response.
2. Extract bearer token. Resolve caller: `supabaseAdmin.auth.getUser(token)`;
   on failure, decode the gateway-verified JWT payload and accept
   `role === "authenticated"` + `sub` as the caller id.
3. Caller's `profiles.role` must be `superadmin`, else 403.
4. Body: `{ userId, password }`. Validate both present and password length ≥ 6
   (Supabase minimum), else 400.
5. `supabaseAdmin.auth.admin.updateUserById(userId, { password })`.
6. Respond `{ success: true }` / `{ success: false, error }` (same shape as
   create-user/delete-user).

### 3. Change Password dialog (`src/pages/Users.tsx`)

- Key icon button ("Change password") in every user row's action group, where the
  reset button was. Available for all users including the superadmin's own account.
- Dialog shows the target user's name + email, then two fields:
  **New Password** and **Confirm Password** (both `type="password"`).
- Submit disabled until: both filled, values match, length ≥ 6.
  Live hint "Passwords do not match" when both are filled and differ.
- Submit invokes `update-user-password`; success → toast
  `Password changed for {name}`, dialog closes and clears; failure → destructive
  toast with the error.
- The target user's existing session stays valid; the new password applies from
  their next login. No forced logout, no notification email.

## Not doing (YAGNI)

- No plaintext password storage/vault, no "view current password".
- No password generator, no strength meter, no show/hide toggle.
- No forced logout of the target user, no email notification.

## Deploy

- Edge function deployed to `eucjeggfclztkbbupaav` via Supabase CLI.
- Code committed (explicit paths only — voicebot files stay unstaged) →
  push `unified main` → GitHub Actions → staging → Goghul moves to live.
