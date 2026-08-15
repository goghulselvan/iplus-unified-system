# Payment Verification / Declared-vs-Proof Mismatch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a staff-entered `verified_amount` to both payment review flows (registration payments, book order payments) so a wrong declared amount no longer silently flows into running totals and payment status — and give book orders a way to record a second/corrective transfer without discarding the first proof.

**Architecture:** Two new nullable `verified_amount numeric` columns (`portal_payment_submissions`, `product_orders`). Two existing RPCs (`acknowledge_portal_payment`, `confirm_product_order_payment`) gain a required `p_verified_amount` param and use it instead of the raw declared amount wherever it feeds a running total. One new RPC (`update_order_payment_details`) lets staff edit a pending order's payment fields in place. Three UI files gain a "Verified Amount" input on their existing review action, plus a small mismatch badge.

**Tech Stack:** Postgres (Supabase, project `eucjeggfclztkbbupaav`), React + TypeScript + Vite, shadcn/ui (`Dialog`, `Input`, `Label`).

## Global Constraints

- Design doc: `docs/superpowers/specs/2026-08-15-payment-verification-mismatch-design.md`.
- Never `supabase db push` — apply the migration with `supabase db query --linked --file <path>`, then register it in `supabase_migrations.schema_migrations` (`INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('20260815', 'payment_verification_amounts')`) so the CLI's own history stays accurate.
- Every RPC: `SECURITY DEFINER`, `SET search_path = public`, `is_crm_user()` first. The one new RPC in this plan needs explicit `REVOKE EXECUTE ... FROM PUBLIC, anon` + `GRANT EXECUTE ... TO authenticated, service_role` (confirmed via `information_schema.routine_privileges` that this is how every existing RPC here is locked down — `CREATE OR REPLACE` on an *existing* function keeps its current grants automatically, so the two modified RPCs don't need this repeated).
- Money formatting: `₹{amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`. Date formatting: `new Date(dateStr).toLocaleDateString('en-IN')`. Match every other Sales/payment page.
- No test framework in this repo — verify via `npx tsc --noEmit` after every file change, plus direct SQL smoke tests (before/after/cleanup discipline, using real existing rows, rolled back or cleaned up after) for the RPCs.
- `EnhancedPaymentTracker.tsx` (School Detail's Payments tab) has its own "Acknowledge" button that does a **raw client `.update()`** on `portal_payment_submissions` (`status='acknowledged'` only) — it does **not** call `acknowledge_portal_payment` and has no effect on `payment_transactions`/totals at all. Staff there separately use "Add Payment" (`AddPaymentDialog`) to manually record a transaction, which already means staff type a fresh amount rather than trusting a declared one. **Out of scope for this plan** — verified confirmed via reading the actual mutation code, not assumed.

---

### Task 1: Migration — verified_amount columns + RPC changes

**Files:**
- Create: `supabase/migrations/20260815_payment_verification_amounts.sql`

**Interfaces:**
- Produces: `portal_payment_submissions.verified_amount numeric`; `product_orders.verified_amount numeric`; `acknowledge_portal_payment(p_submission_id uuid, p_admin_user_id uuid, p_verified_amount numeric) RETURNS jsonb` (same return shape as before: `{success, payment_status, total_paid, expected, transaction_id, registration_confirmed}` or `{error}`); `confirm_product_order_payment(p_order_id uuid, p_verified_amount numeric) RETURNS void`; `update_order_payment_details(p_order_id uuid, p_payment_amount numeric, p_payment_mode text, p_payment_date date, p_payment_utr_reference text, p_payment_account_holder_name text, p_payment_screenshot_url text, p_note text) RETURNS void`.

- [ ] **Step 1: Write the migration**

```sql
-- Payment verification: staff records what they actually verified in the payment
-- proof screenshot, separate from (and no longer blindly trusting) the declared
-- amount. See docs/superpowers/specs/2026-08-15-payment-verification-mismatch-design.md.

ALTER TABLE public.portal_payment_submissions ADD COLUMN IF NOT EXISTS verified_amount numeric;
ALTER TABLE public.product_orders ADD COLUMN IF NOT EXISTS verified_amount numeric;

-- acknowledge_portal_payment: now requires the verified amount, and mirrors THAT
-- (not the raw declared amount_paid) into payment_transactions, which is what
-- actually drives total_paid / payment_status downstream.
CREATE OR REPLACE FUNCTION public.acknowledge_portal_payment(p_submission_id uuid, p_admin_user_id uuid, p_verified_amount numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_sub             portal_payment_submissions%ROWTYPE;
  v_expected        numeric;
  v_total_paid      numeric;
  v_new_status      payment_status;
  v_school_received numeric;
  v_list_submitted  boolean;
  v_tx_id           uuid;
  v_project_id CONSTANT uuid := 'dd5de83d-64f8-4113-a231-27024058396b';
BEGIN
  IF NOT is_crm_user() THEN
    RETURN jsonb_build_object('error', 'Unauthorized: CRM access required');
  END IF;

  IF p_verified_amount IS NULL OR p_verified_amount < 0 THEN
    RETURN jsonb_build_object('error', 'A valid verified amount is required');
  END IF;

  SELECT * INTO v_sub FROM portal_payment_submissions WHERE id = p_submission_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Submission not found');
  END IF;
  IF v_sub.status <> 'pending' THEN
    RETURN jsonb_build_object('error', 'Submission already processed');
  END IF;

  UPDATE portal_payment_submissions
  SET status = 'acknowledged', acknowledged_by = p_admin_user_id, acknowledged_at = now(),
      verified_amount = p_verified_amount
  WHERE id = p_submission_id;

  INSERT INTO payment_transactions (
    school_id, project_id, payment_date, payment_amount,
    payment_mode, transaction_reference, notes, created_by
  ) VALUES (
    v_sub.school_id, v_sub.project_id, v_sub.payment_date, p_verified_amount,
    v_sub.payment_mode, v_sub.utr_reference, v_sub.notes, p_admin_user_id
  )
  RETURNING id INTO v_tx_id;

  SELECT COALESCE(SUM(payment_amount), 0) INTO v_school_received
  FROM payment_transactions WHERE school_id = v_sub.school_id;

  SELECT GREATEST(0,
    (SELECT COUNT(pse.id)
       FROM portal_student_enrollments pse
       JOIN portal_registered_students prs ON prs.id = pse.student_id
      WHERE prs.school_id = v_sub.school_id AND prs.project_id = v_project_id
    )::numeric * (COALESCE(spw.rate_per_entry, 150) - COALESCE(spw.concession_amount, 0))
  )
  INTO v_expected
  FROM school_project_workflow spw
  WHERE spw.school_id = v_sub.school_id AND spw.project_id = v_project_id;

  v_expected := COALESCE(v_expected, 0);

  v_new_status := CASE
    WHEN v_school_received <= 0                                          THEN 'Pending'::payment_status
    WHEN v_expected = 0 AND v_school_received > 0                        THEN 'Overpaid'::payment_status
    WHEN v_school_received > v_expected                                  THEN 'Overpaid'::payment_status
    WHEN v_school_received = v_expected                                  THEN 'Received'::payment_status
    ELSE                                                                      'Partial'::payment_status
  END;

  SELECT (list_submitted_at IS NOT NULL) INTO v_list_submitted
  FROM school_project_workflow
  WHERE school_id = v_sub.school_id AND project_id = v_project_id;

  INSERT INTO school_project_workflow (school_id, project_id, payment_status)
  VALUES (v_sub.school_id, v_project_id, v_new_status)
  ON CONFLICT (school_id, project_id)
  DO UPDATE SET
    payment_status        = EXCLUDED.payment_status,
    registration_status   = CASE
                              WHEN v_new_status IN ('Received', 'Overpaid') AND v_list_submitted
                              THEN 'Confirmed'::registration_status
                              ELSE school_project_workflow.registration_status
                            END,
    updated_at            = now();

  UPDATE schools
  SET payment_received     = v_school_received,
      payment_status       = v_new_status,
      expected_amount      = v_expected,
      outstanding_balance  = GREATEST(0, v_expected - v_school_received),
      registration_status  = CASE
                               WHEN v_new_status IN ('Received', 'Overpaid') AND v_list_submitted
                               THEN 'Confirmed'
                               ELSE registration_status
                             END,
      updated_at           = now()
  WHERE id = v_sub.school_id;

  INSERT INTO security_audit_logs (user_id, action, table_name, record_id, new_values)
  VALUES (
    p_admin_user_id, 'PORTAL_PAYMENT_ACKNOWLEDGED', 'portal_payment_submissions', p_submission_id,
    jsonb_build_object(
      'school_id', v_sub.school_id, 'declared_amount', v_sub.amount_paid,
      'verified_amount', p_verified_amount, 'amount_mismatch', (p_verified_amount <> v_sub.amount_paid),
      'payment_mode', v_sub.payment_mode, 'new_status', v_new_status,
      'total_paid', v_school_received, 'expected', v_expected,
      'registration_confirmed', (v_new_status IN ('Received', 'Overpaid') AND v_list_submitted)
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'payment_status', v_new_status::text,
    'total_paid', v_school_received,
    'expected', v_expected,
    'transaction_id', v_tx_id,
    'registration_confirmed', (v_new_status IN ('Received', 'Overpaid') AND v_list_submitted)
  );
END;
$function$;

-- confirm_product_order_payment: now requires the verified amount, stored on the order.
CREATE OR REPLACE FUNCTION public.confirm_product_order_payment(p_order_id uuid, p_verified_amount numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_status text;
BEGIN
  IF NOT is_crm_user() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF p_verified_amount IS NULL OR p_verified_amount < 0 THEN
    RAISE EXCEPTION 'A valid verified amount is required';
  END IF;

  SELECT payment_status INTO v_status FROM product_orders WHERE id = p_order_id;
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Order not found';
  END IF;
  IF v_status = 'confirmed' THEN
    RAISE EXCEPTION 'Order already confirmed';
  END IF;

  UPDATE product_orders
  SET payment_status = 'confirmed',
      confirmed_at = now(),
      verified_amount = p_verified_amount,
      payment_reviewed_by = auth.uid(),
      payment_reviewed_at = now(),
      payment_review_note = NULL
  WHERE id = p_order_id;
END;
$function$;

-- update_order_payment_details: new. Lets staff edit a still-pending order's
-- payment fields in place (e.g. a second transfer's proof arrives) without a
-- reject/resubmit cycle. Appends a timestamped note rather than replacing it,
-- since confirm_product_order_payment clears payment_review_note anyway once
-- the order is actually confirmed — this note is scratch space for the pending window.
CREATE OR REPLACE FUNCTION public.update_order_payment_details(
  p_order_id uuid,
  p_payment_amount numeric,
  p_payment_mode text,
  p_payment_date date,
  p_payment_utr_reference text,
  p_payment_account_holder_name text,
  p_payment_screenshot_url text,
  p_note text
)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_status text;
  v_existing_note text;
BEGIN
  IF NOT is_crm_user() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF p_payment_amount IS NULL OR p_payment_amount < 0 THEN
    RAISE EXCEPTION 'A valid payment amount is required';
  END IF;

  SELECT payment_status, payment_review_note INTO v_status, v_existing_note
  FROM product_orders WHERE id = p_order_id;
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Order not found';
  END IF;
  IF v_status <> 'pending' THEN
    RAISE EXCEPTION 'Can only update payment details while the order is pending review';
  END IF;

  UPDATE product_orders
  SET payment_amount = p_payment_amount,
      payment_mode = p_payment_mode,
      payment_date = p_payment_date,
      payment_utr_reference = p_payment_utr_reference,
      payment_account_holder_name = p_payment_account_holder_name,
      payment_screenshot_url = p_payment_screenshot_url,
      payment_review_note = CASE
        WHEN p_note IS NULL OR trim(p_note) = '' THEN v_existing_note
        WHEN v_existing_note IS NULL OR trim(v_existing_note) = '' THEN to_char(now(), 'DD Mon HH24:MI') || ': ' || trim(p_note)
        ELSE v_existing_note || E'\n' || to_char(now(), 'DD Mon HH24:MI') || ': ' || trim(p_note)
      END
  WHERE id = p_order_id;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.update_order_payment_details(uuid, numeric, text, date, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_order_payment_details(uuid, numeric, text, date, text, text, text, text) TO authenticated, service_role;
```

- [ ] **Step 2: Apply the migration**

Run: `supabase db query --linked --file supabase/migrations/20260815_payment_verification_amounts.sql`
Expected: no errors.

- [ ] **Step 3: Register it in the CLI's migration history**

```sql
INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260815', 'payment_verification_amounts')
ON CONFLICT (version) DO NOTHING;
```

Run via: `echo "<sql above>" | supabase db query --linked -f /dev/stdin`

- [ ] **Step 4: Smoke-test `acknowledge_portal_payment` end to end**

Find one real `pending` submission (or note there may be none live — in that case skip to the dry-run variant below):

```sql
select id, school_id, amount_paid from public.portal_payment_submissions where status='pending' limit 1;
```

If a row exists, call it with a verified amount deliberately different from the declared one, then check the mismatch landed correctly, then manually revert every side effect (this hits real tables, not a transaction-wrapped test):

```sql
select acknowledge_portal_payment('<id>', (select id from auth.users where email='<a real CRM staff email>'), 1::numeric);
select verified_amount, amount_paid from portal_payment_submissions where id = '<id>';
-- expect verified_amount = 1, amount_paid unchanged
```

Given this mutates `payment_transactions`/`schools`/`school_project_workflow` for a real school, **do not run this against a real pending submission** unless one is expressly a test row. If none exists, instead just confirm the function signature changed and the old 2-arg call now fails:

```sql
select acknowledge_portal_payment(gen_random_uuid(), gen_random_uuid());
```

Expected: `ERROR: function acknowledge_portal_payment(uuid, uuid) does not exist` (confirms the 3-arg version replaced it, callers must update).

- [ ] **Step 5: Smoke-test `confirm_product_order_payment` and `update_order_payment_details`**

```sql
select id, payment_status, payment_amount from public.product_orders where payment_status='pending' limit 1;
```

If a pending manual test order exists, exercise both RPCs on it and verify the columns land correctly; otherwise confirm the signature change the same way as Step 4 (`select confirm_product_order_payment(gen_random_uuid())` should now error with a missing-argument message, since the old 1-arg signature no longer exists).

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260815_payment_verification_amounts.sql
git commit -m "Add verified_amount to payment review flows + update_order_payment_details RPC"
```

---

### Task 2: Registration payments — Verified Amount on Acknowledge (`PaymentQueue.tsx`)

**Files:**
- Modify: `src/components/portal/PaymentQueue.tsx`

**Interfaces:**
- Consumes: `acknowledge_portal_payment(p_submission_id uuid, p_admin_user_id uuid, p_verified_amount numeric)` from Task 1.
- Produces: nothing new consumed by later tasks (this task is a leaf UI change).

- [ ] **Step 1: Add `verified_amount` to the row type and select query**

In `src/components/portal/PaymentQueue.tsx`, update the interface (currently at the top of the file):

```typescript
interface PaymentSubmission {
  id: string;
  school_id: string;
  amount_paid: number;
  verified_amount: number | null;
  payment_date: string;
  payment_mode: string;
  utr_reference: string | null;
  notes: string | null;
  screenshot_url: string | null;
  status: 'pending' | 'acknowledged' | 'rejected';
  acknowledged_at: string | null;
  created_at: string;
  schools: { school_name: string; ss_no: number | null } | null;
}
```

And the query's `.select(...)` call — add `verified_amount` to the column list:

```typescript
      let q = supabase
        .from('portal_payment_submissions')
        .select('*, schools(school_name, ss_no)')
        .order('created_at', { ascending: false });
```

This one already uses `*`, so no change needed there — the new column comes through automatically. Only the TypeScript interface above needs the new field.

- [ ] **Step 2: Add dialog state and imports**

Add to the imports at the top of the file:

```typescript
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
```

Inside `PaymentQueue()`, alongside the existing `filter` state, add:

```typescript
  const [ackTarget, setAckTarget] = useState<PaymentSubmission | null>(null);
  const [verifiedAmountInput, setVerifiedAmountInput] = useState('');
```

- [ ] **Step 3: Change the mutation to take `{ submissionId, verifiedAmount }`**

Replace the existing `acknowledgeMutation` definition:

```typescript
  const acknowledgeMutation = useMutation({
    mutationFn: async ({ submissionId, verifiedAmount }: { submissionId: string; verifiedAmount: number }) => {
      const { data, error } = await supabase.rpc('acknowledge_portal_payment', {
        p_submission_id: submissionId,
        p_admin_user_id: user!.id,
        p_verified_amount: verifiedAmount,
      });
      if (error) throw error;
      return data as { success: boolean; payment_status: string; total_paid: number; expected: number; transaction_id?: string };
    },
    onSuccess: (result, { submissionId }) => {
      qc.invalidateQueries({ queryKey: ['admin-payment-queue'] });
      qc.invalidateQueries({ queryKey: ['nav-badge-counts'] });
      toast({
        title: 'Payment Acknowledged',
        description: `Status: ${result.payment_status === 'Received' ? '✓ Paid in full' : '⚠ Partial — awaiting balance'}`,
      });
      const submission = submissions.find(s => s.id === submissionId);
      if (submission && result.transaction_id) {
        const templateKey = result.payment_status === 'Partial' ? 'payment_partial' : 'payment_received';
        supabase.auth.getUser()
          .then(({ data: { user: u } }) =>
            sendPaymentReceiptComms({
              schoolId: submission.school_id,
              transactionId: result.transaction_id!,
              templateType: templateKey,
              userId: u?.id,
            }))
          .then(r => {
            if (r.errors.length) {
              toast({ title: 'Receipt comms incomplete', description: r.errors.join(' · '), variant: 'destructive' });
            } else {
              toast({
                title: `Receipt ${r.receiptNo ?? ''} sent`,
                description: r.waViaDocument
                  ? 'Email + WhatsApp sent with the receipt PDF.'
                  : 'Email sent with receipt PDF; WhatsApp sent as text (receipt template not active yet).',
              });
            }
          });
      }
      setAckTarget(null);
      setVerifiedAmountInput('');
    },
    onError: (err: Error) => {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    },
  });
```

(Only the `mutationFn` signature and the two lines at the end of `onSuccess` — `setAckTarget(null); setVerifiedAmountInput('');` — are new; the rest of the body is unchanged from what's already there, just reproduced in full so the diff is unambiguous.)

- [ ] **Step 4: Replace the one-click Acknowledge button with one that opens the dialog**

Find the existing button (in the row-rendering `<td>` near the end of the table):

```typescript
                    {s.status === 'pending' && (
                      <Button
                        size="sm"
                        onClick={() => acknowledgeMutation.mutate(s.id)}
                        disabled={acknowledgeMutation.isPending}
                        className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 h-8 text-xs"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        Acknowledge
                      </Button>
                    )}
```

Replace with:

```typescript
                    {s.status === 'pending' && (
                      <Button
                        size="sm"
                        onClick={() => { setAckTarget(s); setVerifiedAmountInput(String(s.amount_paid)); }}
                        className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 h-8 text-xs"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        Acknowledge
                      </Button>
                    )}
```

- [ ] **Step 5: Add a mismatch badge next to the Amount cell**

Find the Amount cell:

```typescript
                  <td className="px-4 py-3 font-semibold">
                    ₹{Number(s.amount_paid).toLocaleString('en-IN')}
                  </td>
```

Replace with:

```typescript
                  <td className="px-4 py-3 font-semibold">
                    ₹{Number(s.amount_paid).toLocaleString('en-IN')}
                    {s.verified_amount != null && Number(s.verified_amount) !== Number(s.amount_paid) && (
                      <div className="text-xs font-normal text-amber-600 mt-0.5">
                        ⚠ Verified: ₹{Number(s.verified_amount).toLocaleString('en-IN')}
                      </div>
                    )}
                  </td>
```

- [ ] **Step 6: Add the dialog**

Add this right before the closing `</div>` of the component's returned JSX (after the table's closing, at the same level as the outer wrapping `<div className="space-y-4">`):

```typescript
      <Dialog open={!!ackTarget} onOpenChange={(open) => { if (!open) { setAckTarget(null); setVerifiedAmountInput(''); } }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Acknowledge Payment</DialogTitle></DialogHeader>
          {ackTarget && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                {ackTarget.schools?.school_name} declared ₹{Number(ackTarget.amount_paid).toLocaleString('en-IN')}.
                Enter what the screenshot actually shows.
              </p>
              <div className="space-y-1.5">
                <Label htmlFor="verified-amount">Verified Amount (₹)</Label>
                <Input
                  id="verified-amount"
                  type="number"
                  min="0"
                  step="0.01"
                  value={verifiedAmountInput}
                  onChange={(e) => setVerifiedAmountInput(e.target.value)}
                />
              </div>
              {Number(verifiedAmountInput) !== Number(ackTarget.amount_paid) && verifiedAmountInput !== '' && (
                <p className="text-sm bg-amber-50 text-amber-700 rounded-lg p-3">
                  This differs from the declared amount (₹{Number(ackTarget.amount_paid).toLocaleString('en-IN')}) — the verified figure will be what counts toward this school's total.
                </p>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setAckTarget(null); setVerifiedAmountInput(''); }}>Cancel</Button>
            <Button
              onClick={() => ackTarget && acknowledgeMutation.mutate({ submissionId: ackTarget.id, verifiedAmount: Number(verifiedAmountInput) })}
              disabled={acknowledgeMutation.isPending || verifiedAmountInput === '' || Number(verifiedAmountInput) < 0}
            >
              Confirm & Acknowledge
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
```

- [ ] **Step 7: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors in `PaymentQueue.tsx`.

- [ ] **Step 8: Commit**

```bash
git add src/components/portal/PaymentQueue.tsx
git commit -m "Add Verified Amount step to registration payment acknowledge flow"
```

---

### Task 3: Book orders — Verified Amount on Confirm + in-place payment update (`OrderRequestDetail.tsx`, `SchoolBookOrders.tsx`)

**Files:**
- Modify: `src/pages/Sales/OrderRequestDetail.tsx`
- Modify: `src/components/schools/SchoolBookOrders.tsx`

**Interfaces:**
- Consumes: `confirm_product_order_payment(p_order_id uuid, p_verified_amount numeric)`, `update_order_payment_details(...)` from Task 1.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Add `verified_amount` to the `OrderDetail` type and select query**

In `src/pages/Sales/OrderRequestDetail.tsx`, update the type:

```typescript
type OrderDetail = {
  id: string;
  order_number: number | null;
  fy: number | null;
  source: 'portal' | 'manual';
  notes: string | null;
  payment_amount: number;
  verified_amount: number | null;
  payment_mode: string;
  payment_date: string;
  payment_utr_reference: string | null;
  payment_account_holder_name: string | null;
  payment_screenshot_url: string;
  payment_status: PaymentStatus;
  payment_review_note: string | null;
  schools: { school_name: string } | null;
};
```

And the `load()` function's select — add `verified_amount`:

```typescript
      supabase.from('product_orders' as any)
        .select('id, order_number, fy, source, notes, payment_amount, verified_amount, payment_mode, payment_date, payment_utr_reference, payment_account_holder_name, payment_screenshot_url, payment_status, payment_review_note, schools(school_name)')
        .eq('id', id).single(),
```

- [ ] **Step 2: Add imports and state**

Add to imports:

```typescript
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
```

Add alongside the existing `useState` declarations in `OrderRequestDetail()`:

```typescript
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmVerifiedAmount, setConfirmVerifiedAmount] = useState('');
  const [updatePaymentOpen, setUpdatePaymentOpen] = useState(false);
  const [updateAmount, setUpdateAmount] = useState('');
  const [updateMode, setUpdateMode] = useState('');
  const [updateDate, setUpdateDate] = useState('');
  const [updateUtr, setUpdateUtr] = useState('');
  const [updateHolder, setUpdateHolder] = useState('');
  const [updateScreenshotUrl, setUpdateScreenshotUrl] = useState('');
  const [updateNote, setUpdateNote] = useState('');
```

- [ ] **Step 3: Replace `handleConfirm` to open a dialog first, add the new update handler**

Replace the existing `handleConfirm`:

```typescript
  const openConfirmDialog = () => {
    setConfirmVerifiedAmount(String(order!.payment_amount));
    setConfirmOpen(true);
  };

  const handleConfirm = async () => {
    const { error } = await supabase.rpc('confirm_product_order_payment' as any, {
      p_order_id: id,
      p_verified_amount: Number(confirmVerifiedAmount),
    });
    if (error) { toast({ title: 'Error', description: error.message, variant: 'destructive' }); return; }
    toast({ title: 'Order confirmed' });
    setConfirmOpen(false);
    load();
  };
```

Add a new handler right after `handleRequestResubmit`:

```typescript
  const openUpdatePaymentDialog = () => {
    if (!order) return;
    setUpdateAmount(String(order.payment_amount));
    setUpdateMode(order.payment_mode);
    setUpdateDate(order.payment_date.slice(0, 10));
    setUpdateUtr(order.payment_utr_reference ?? '');
    setUpdateHolder(order.payment_account_holder_name ?? '');
    setUpdateScreenshotUrl(order.payment_screenshot_url);
    setUpdateNote('');
    setUpdatePaymentOpen(true);
  };

  const handleUpdatePayment = async () => {
    const { error } = await supabase.rpc('update_order_payment_details' as any, {
      p_order_id: id,
      p_payment_amount: Number(updateAmount),
      p_payment_mode: updateMode,
      p_payment_date: updateDate,
      p_payment_utr_reference: updateUtr || null,
      p_payment_account_holder_name: updateHolder || null,
      p_payment_screenshot_url: updateScreenshotUrl,
      p_note: updateNote.trim() || null,
    });
    if (error) { toast({ title: 'Error', description: error.message, variant: 'destructive' }); return; }
    toast({ title: 'Payment details updated' });
    setUpdatePaymentOpen(false);
    load();
  };
```

- [ ] **Step 4: Wire the new buttons into the pending-order action row**

Find:

```typescript
          {order.payment_status === 'pending' && (
            <div className="flex gap-2 mt-4">
              <Button onClick={handleConfirm}>Confirm Order</Button>
              <Button variant="outline" onClick={() => setResubmitOpen(true)}>Request Resubmit</Button>
            </div>
          )}
```

Replace with:

```typescript
          {order.payment_status === 'pending' && (
            <div className="flex gap-2 mt-4">
              <Button onClick={openConfirmDialog}>Confirm Order</Button>
              <Button variant="outline" onClick={openUpdatePaymentDialog}>Update Payment</Button>
              <Button variant="outline" onClick={() => setResubmitOpen(true)}>Request Resubmit</Button>
            </div>
          )}
```

- [ ] **Step 5: Show the verified amount / mismatch on the summary line**

Find:

```typescript
        <p className="text-sm text-muted-foreground mb-6">₹{order.payment_amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })} · {order.payment_mode} · {new Date(order.payment_date).toLocaleDateString('en-IN')}</p>
```

Replace with:

```typescript
        <p className="text-sm text-muted-foreground mb-6">
          ₹{order.payment_amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })} · {order.payment_mode} · {new Date(order.payment_date).toLocaleDateString('en-IN')}
          {order.verified_amount != null && Number(order.verified_amount) !== Number(order.payment_amount) && (
            <span className="ml-2 text-amber-600 font-medium">⚠ Verified: ₹{order.verified_amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
          )}
        </p>
```

- [ ] **Step 6: Add the two new dialogs**

Add right after the existing `resubmitOpen` Dialog block, before the `rejectOpen` Dialog:

```typescript
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Confirm Order</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Declared amount: ₹{order.payment_amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}. Enter what the screenshot actually shows.
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="confirm-verified-amount">Verified Amount (₹)</Label>
              <Input
                id="confirm-verified-amount"
                type="number"
                min="0"
                step="0.01"
                value={confirmVerifiedAmount}
                onChange={(e) => setConfirmVerifiedAmount(e.target.value)}
              />
            </div>
            {confirmVerifiedAmount !== '' && Number(confirmVerifiedAmount) !== Number(order.payment_amount) && (
              <p className="text-sm bg-amber-50 text-amber-700 rounded-lg p-3">
                This differs from the declared amount — the verified figure is what gets recorded against this order.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>Cancel</Button>
            <Button onClick={handleConfirm} disabled={confirmVerifiedAmount === '' || Number(confirmVerifiedAmount) < 0}>Confirm & Record</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={updatePaymentOpen} onOpenChange={setUpdatePaymentOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Update Payment Details</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Use this when more proof arrives (e.g. a second transfer covering a shortfall) before the order is confirmed.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="update-amount">Total Amount (₹)</Label>
                <Input id="update-amount" type="number" min="0" step="0.01" value={updateAmount} onChange={(e) => setUpdateAmount(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="update-mode">Payment Mode</Label>
                <Input id="update-mode" value={updateMode} onChange={(e) => setUpdateMode(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="update-date">Payment Date</Label>
                <Input id="update-date" type="date" value={updateDate} onChange={(e) => setUpdateDate(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="update-utr">UTR / Reference</Label>
                <Input id="update-utr" value={updateUtr} onChange={(e) => setUpdateUtr(e.target.value)} />
              </div>
              <div className="space-y-1.5 col-span-2">
                <Label htmlFor="update-holder">Account Holder</Label>
                <Input id="update-holder" value={updateHolder} onChange={(e) => setUpdateHolder(e.target.value)} />
              </div>
              <div className="space-y-1.5 col-span-2">
                <Label htmlFor="update-screenshot">Payment Screenshot URL</Label>
                <Input id="update-screenshot" value={updateScreenshotUrl} onChange={(e) => setUpdateScreenshotUrl(e.target.value)} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="update-note">Note (optional, appended to the review note)</Label>
              <Textarea id="update-note" value={updateNote} onChange={(e) => setUpdateNote(e.target.value)} placeholder="e.g. Second transfer of ₹2,000 confirmed via WhatsApp" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUpdatePaymentOpen(false)}>Cancel</Button>
            <Button onClick={handleUpdatePayment} disabled={updateAmount === '' || Number(updateAmount) < 0 || !updateScreenshotUrl}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
```

- [ ] **Step 7: Show `payment_review_note` as an informational note, not just a resubmit reason**

The existing block only labels it "Resubmit reason" — that's now misleading since `payment_review_note` can also hold Update Payment notes. Find:

```typescript
          {order.payment_review_note && (
            <div className="mt-3 text-sm bg-red-50 text-red-700 rounded-lg p-3">Resubmit reason: {order.payment_review_note}</div>
          )}
```

Replace with:

```typescript
          {order.payment_review_note && (
            <div className={`mt-3 text-sm rounded-lg p-3 whitespace-pre-line ${order.payment_status === 'resubmit_requested' ? 'bg-red-50 text-red-700' : 'bg-neutral-50 text-neutral-700'}`}>
              {order.payment_status === 'resubmit_requested' ? 'Resubmit reason: ' : 'Notes: '}{order.payment_review_note}
            </div>
          )}
```

- [ ] **Step 8: `SchoolBookOrders.tsx` — show the mismatch badge**

In `src/components/schools/SchoolBookOrders.tsx`, add `verified_amount` to the `Order` type:

```typescript
type Order = {
  id: string;
  order_number: number | null;
  fy: number | null;
  created_at: string;
  payment_amount: number | null;
  verified_amount: number | null;
  product_order_items: Item[];
};
```

And to the select in the `useEffect`:

```typescript
    supabase.from('product_orders' as any)
      .select('id, order_number, fy, created_at, payment_amount, verified_amount, product_order_items(id, quantity, products(name), invoices(dispatched_at))')
      .eq('school_id', schoolId)
      .order('created_at', { ascending: false })
      .then(({ data }) => { setOrders((data || []) as unknown as Order[]); setLoading(false); });
```

Find the existing payment badge block:

```typescript
                  {o.payment_amount != null && (
                    <span className="text-xs font-sans font-semibold text-emerald-700">
                      Payment Received: ₹{o.payment_amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </span>
                  )}
```

Replace with:

```typescript
                  {o.payment_amount != null && (
                    <span className="text-xs font-sans font-semibold text-emerald-700">
                      Payment Received: ₹{o.payment_amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      {o.verified_amount != null && Number(o.verified_amount) !== Number(o.payment_amount) && (
                        <span className="text-amber-600 ml-1.5">(⚠ Verified: ₹{o.verified_amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })})</span>
                      )}
                    </span>
                  )}
```

- [ ] **Step 9: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors in `OrderRequestDetail.tsx` or `SchoolBookOrders.tsx`.

- [ ] **Step 10: Commit**

```bash
git add src/pages/Sales/OrderRequestDetail.tsx src/components/schools/SchoolBookOrders.tsx
git commit -m "Add Verified Amount to book order confirm + Update Payment in-place edit action"
```

---

### Task 4: Build, verify live, push

**Files:** none new — verification only.

- [ ] **Step 1: Full build**

Run: `npm run build`
Expected: succeeds with no errors.

- [ ] **Step 2: Push**

```bash
git push unified main
```

- [ ] **Step 3: Confirm the GitHub Actions build goes green**

Run: `gh run list --repo goghulselvan/iplus-unified-system --limit 1`
Expected: `completed  success` for this push's run.

- [ ] **Step 4: Confirm it's actually live**

```bash
curl -s "https://cms.iplus.vaima.in/" -o /tmp/crm_live_check.html
JS=$(grep -o '/assets/index-[^"]*\.js' /tmp/crm_live_check.html | head -1)
curl -s "https://cms.iplus.vaima.in$JS" | grep -c "Verified Amount"
```

Expected: a non-zero count, confirming the new dialogs are in the live bundle (matches the verification approach already used earlier this session for the Book Orders payment-amount ship).
