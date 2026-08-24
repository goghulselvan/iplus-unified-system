# Issue Credit Immediately on Return Report Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split "Confirm Receipt" (mints credit + fixes stock, both at once) into two independent, sequential actions — Issue Credit (immediate, money only) and Mark Received (later, once the book physically returns, stock only) — so a school can get the correct replacement book right away instead of waiting for the wrong one's return journey to finish first.

**Architecture:** `product_returns.status` gains a middle state (`requested → credit_issued → received`). One new RPC (`issue_credit_for_return`) does what used to be the credit-minting half of `confirm_return_received`. `confirm_return_received` is renamed to `mark_return_received` (its behavior fundamentally changed — no longer mints anything — so the old name would be actively misleading) and now only does the stock half, gated on `status = 'credit_issued'`. Two UI touches: a new confirm-and-preview dialog for issuing credit, and a three-tab restructure of the Returns queue page.

**Tech Stack:** Supabase Postgres (SQL migration, `SECURITY DEFINER` RPCs), React + TypeScript, Supabase JS client, shadcn/ui.

**Spec:** `docs/superpowers/specs/2026-08-24-immediate-return-credit-design.md`

## Global Constraints

- This applies to every return, not just `wrong_item_shipped` — a general timing change to the whole feature.
- `mark_return_received` must reuse the exact stock-routing logic already live (`COALESCE(actual_product_id, invoiced product_id)`, resellable-only restock, NULL-product guard) — do not reimplement or alter it, only relocate it out of the credit-minting function.
- The credit amount calculation (`unit_price * quantity` from `invoice_line_items`) is unchanged, just relocated into `issue_credit_for_return`.
- Renaming a function (as opposed to `CREATE OR REPLACE` on an unchanged name/signature) creates a new function object with default ACLs — every renamed or brand-new function in this plan needs an explicit `REVOKE EXECUTE ... FROM PUBLIC, anon` + `GRANT EXECUTE ... TO authenticated, service_role`, exactly matching the pattern already established and verified this week in `20260824_wrong_item_shipped_returns.sql` (`report_return`'s grant lines) — do not skip this or improvise different wording.
- `mark_return_received` must reject a return still in `requested` status with a specific, plain-language error ("Issue credit before marking this return as received"), not a bare constraint violation.
- No automated test suite exists. Backend gets genuine TDD (rolled-back transaction, real RPC calls, real assertions). Frontend "tests" are `tsc --noEmit` plus a manual-verification checklist.
- Apply the migration via `supabase db query --linked --file supabase/migrations/<file>.sql`.

---

### Task 1: Backend — status split, issue_credit_for_return, mark_return_received

**Files:**
- Create: `supabase/migrations/20260824b_immediate_return_credit.sql`

**Interfaces:**
- Produces: `product_returns.status` now allows `'credit_issued'` in addition to `'requested'`/`'received'`; `issue_credit_for_return(p_return_id uuid) RETURNS uuid` (the new credit_note_id); `mark_return_received(p_return_id uuid, p_condition text) RETURNS void` (replaces `confirm_return_received`, which is dropped).
- Consumes: `product_returns.actual_product_id` (already live), `credit_note_fy_counters`, `invoice_line_items`, `invoices`, `products`.

- [ ] **Step 1: Write the verification script and confirm the old function is really gone after this change (not yet — baseline check)**

Create `/tmp/verify_immediate_credit_baseline.sql`:

```sql
-- Should succeed today (before this migration): confirm_return_received still exists.
SELECT proname FROM pg_proc WHERE proname = 'confirm_return_received';
-- Should fail today: issue_credit_for_return / mark_return_received don't exist yet.
SELECT proname FROM pg_proc WHERE proname IN ('issue_credit_for_return', 'mark_return_received');
```

Run: `supabase db query --linked --file /tmp/verify_immediate_credit_baseline.sql`
Expected: first query returns one row (`confirm_return_received`); second returns zero rows.

- [ ] **Step 2: Write the migration**

```sql
-- supabase/migrations/20260824b_immediate_return_credit.sql
--
-- Splits "Confirm Receipt" (mint credit + fix stock, both at once) into two
-- independent, sequential steps: Issue Credit (immediate — the school needs
-- the correct book now, doesn't need to wait for the wrong one's return
-- journey to finish) and Mark Received (later, stock only, once the wrong
-- book is actually back). Deliberate trade-off: credit exists before the
-- book is physically confirmed back — see the design spec for why.

ALTER TABLE public.product_returns DROP CONSTRAINT product_returns_status_check;
ALTER TABLE public.product_returns ADD CONSTRAINT product_returns_status_check
  CHECK (status IN ('requested', 'credit_issued', 'received'));

ALTER TABLE public.product_returns DROP CONSTRAINT product_returns_condition_set_on_receipt;
ALTER TABLE public.product_returns ADD CONSTRAINT product_returns_condition_set_on_receipt
  CHECK (
    (status IN ('requested', 'credit_issued') AND condition_on_receipt IS NULL) OR
    (status = 'received' AND condition_on_receipt IS NOT NULL)
  );

CREATE OR REPLACE FUNCTION public.issue_credit_for_return(p_return_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_status text;
  v_quantity integer;
  v_line_item_id uuid;
  v_unit_price numeric;
  v_invoice_id uuid;
  v_school_id uuid;
  v_credit_amount numeric;
  v_fy smallint;
  v_next integer;
  v_credit_note_id uuid;
  v_ist timestamp := (now() AT TIME ZONE 'Asia/Kolkata');
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM profiles WHERE user_id = auth.uid() AND role IN ('superadmin', 'accountant')
  ) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  -- Same advisory-lock domain mark_return_received will also use — serializes
  -- this against a concurrent second attempt to issue credit for the same return.
  PERFORM pg_advisory_xact_lock(hashtext(p_return_id::text));

  SELECT status, quantity, invoice_line_item_id INTO v_status, v_quantity, v_line_item_id
  FROM product_returns WHERE id = p_return_id;
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Return not found';
  END IF;
  IF v_status != 'requested' THEN
    RAISE EXCEPTION 'Credit has already been issued for this return';
  END IF;

  SELECT unit_price, invoice_id INTO v_unit_price, v_invoice_id
  FROM invoice_line_items WHERE id = v_line_item_id;

  SELECT school_id INTO v_school_id FROM invoices WHERE id = v_invoice_id;

  v_credit_amount := v_unit_price * v_quantity;

  v_fy := (EXTRACT(YEAR FROM v_ist)::int % 100);
  IF EXTRACT(MONTH FROM v_ist)::int < 4 THEN
    v_fy := v_fy - 1;
  END IF;
  INSERT INTO credit_note_fy_counters AS c (fy, last_no)
  VALUES (v_fy, 1)
  ON CONFLICT (fy) DO UPDATE SET last_no = c.last_no + 1
  RETURNING c.last_no INTO v_next;

  INSERT INTO credit_notes (credit_note_number, fy, school_id, source_return_id, amount, created_by)
  VALUES (v_next, v_fy, v_school_id, p_return_id, v_credit_amount, auth.uid())
  RETURNING id INTO v_credit_note_id;

  UPDATE product_returns SET status = 'credit_issued' WHERE id = p_return_id;

  RETURN v_credit_note_id;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.issue_credit_for_return(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_credit_for_return(uuid) TO authenticated, service_role;

-- confirm_return_received's behavior fundamentally changes (no longer mints
-- anything — that moved above), so this is a rename, not an in-place edit;
-- the old name would be actively misleading once it stops "confirming" a
-- receipt-and-credit event and only does the stock half.
DROP FUNCTION IF EXISTS public.confirm_return_received(uuid, text);

CREATE OR REPLACE FUNCTION public.mark_return_received(p_return_id uuid, p_condition text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_status text;
  v_quantity integer;
  v_line_item_id uuid;
  v_product_id uuid;
  v_actual_product_id uuid;
  v_restock_product_id uuid;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM profiles WHERE user_id = auth.uid() AND role IN ('superadmin', 'accountant')
  ) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF p_condition NOT IN ('resellable', 'damaged') THEN
    RAISE EXCEPTION 'Condition must be resellable or damaged';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(p_return_id::text));

  SELECT status, quantity, invoice_line_item_id, actual_product_id
  INTO v_status, v_quantity, v_line_item_id, v_actual_product_id
  FROM product_returns WHERE id = p_return_id;
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Return not found';
  END IF;
  IF v_status = 'requested' THEN
    RAISE EXCEPTION 'Issue credit before marking this return as received';
  END IF;
  IF v_status = 'received' THEN
    RAISE EXCEPTION 'This return has already been received';
  END IF;

  SELECT product_id INTO v_product_id FROM invoice_line_items WHERE id = v_line_item_id;

  -- Same routing already live for wrong-item-shipped returns: restock
  -- whichever product actually needs it, not always the invoiced one.
  v_restock_product_id := COALESCE(v_actual_product_id, v_product_id);

  IF p_condition = 'resellable' THEN
    IF v_restock_product_id IS NULL THEN
      RAISE EXCEPTION 'This line has no catalog product — it cannot be restocked; record it as damaged instead';
    END IF;
    UPDATE products SET stock_quantity = stock_quantity + v_quantity
    WHERE id = v_restock_product_id;
  END IF;

  UPDATE product_returns
  SET status = 'received', condition_on_receipt = p_condition, received_by = auth.uid(), received_at = now()
  WHERE id = p_return_id;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.mark_return_received(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_return_received(uuid, text) TO authenticated, service_role;
```

- [ ] **Step 3: Apply the migration**

Run: `supabase db query --linked --file supabase/migrations/20260824b_immediate_return_credit.sql`

- [ ] **Step 4: Confirm the function swap**

Re-run `/tmp/verify_immediate_credit_baseline.sql`. Expected: first query (confirm_return_received) now returns **zero** rows; second query (issue_credit_for_return, mark_return_received) now returns **two** rows.

- [ ] **Step 5: Full-loop TDD — inside a rolled-back transaction**

Create `/tmp/verify_immediate_credit_loop.sql`. Build a minimal real invoice + line item (real school_id from `SELECT id FROM schools LIMIT 1`) inside the transaction, same approach as the wrong-item-shipped plan's Task 1:

```sql
BEGIN;

-- ... minimal invoice + invoice_line_item setup, unit_price known (e.g. 150), quantity 2 ...

SELECT report_return('<line item id>'::uuid, 2, 'other', 'TDD test');
-- capture the return id

-- Assert BEFORE issuing credit: 0 rows in credit_notes for this return, status = 'requested'.
SELECT status FROM product_returns WHERE id = '<return id>'::uuid;
SELECT count(*) FROM credit_notes WHERE source_return_id = '<return id>'::uuid;

-- Issue credit:
SELECT issue_credit_for_return('<return id>'::uuid);

-- Assert: status now 'credit_issued', exactly 1 credit_notes row, amount = 150*2 = 300.
SELECT status FROM product_returns WHERE id = '<return id>'::uuid;
SELECT amount FROM credit_notes WHERE source_return_id = '<return id>'::uuid;

-- Assert the ordering guard: mark_return_received on a 'requested' return must fail.
-- (Use a SECOND freshly-reported return, still 'requested', to test this without
-- disturbing the first return's already-'credit_issued' state.)
SELECT report_return('<line item id>'::uuid, 1, 'other', 'TDD test 2');
-- Expect this to raise: 'Issue credit before marking this return as received'
SELECT mark_return_received('<second return id>'::uuid, 'resellable');

-- Back to the first return: mark it received.
SELECT mark_return_received('<return id>'::uuid, 'resellable');

-- Assert: status now 'received', condition_on_receipt = 'resellable', stock
-- increased by 2 on the invoiced product, and still exactly 1 credit_notes
-- row for this return (mark_return_received minted nothing new).
SELECT status, condition_on_receipt FROM product_returns WHERE id = '<return id>'::uuid;
SELECT count(*) FROM credit_notes WHERE source_return_id = '<return id>'::uuid;

ROLLBACK;
```

Run and report the actual numbers observed at every assertion, including the exact error text from the ordering-guard test.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260824b_immediate_return_credit.sql
git commit -m "Split return credit from receipt confirmation: issue_credit_for_return + mark_return_received"
```

---

### Task 2: Frontend — Issue Credit dialog, renamed Mark Received dialog, three-tab Returns page

**Files:**
- Create: `src/components/sales/IssueCreditDialog.tsx`
- Modify: `src/components/sales/ConfirmReturnReceiptDialog.tsx` → rename to `src/components/sales/MarkReturnReceivedDialog.tsx`
- Modify: `src/pages/Sales/ReturnsPage.tsx`

**Interfaces:**
- Consumes: `issue_credit_for_return(p_return_id uuid)` and `mark_return_received(p_return_id uuid, p_condition text)` (Task 1).

- [ ] **Step 1: Read the current files**

Read `src/components/sales/ConfirmReturnReceiptDialog.tsx` and `src/pages/Sales/ReturnsPage.tsx` in full before editing — confirm they match the state left by the wrong-item-shipped-returns plan (both already merged to main by the time this task runs).

- [ ] **Step 2: Create `IssueCreditDialog.tsx`**

Mirrors the existing `src/components/sales/IssueRefundDialog.tsx`'s structure/conventions (Dialog/Label/Button, `useToast`, same RPC-call pattern), but simpler — no user-entered fields, just a preview and a confirm:

```tsx
// src/components/sales/IssueCreditDialog.tsx
import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: { returnId: string; schoolName: string; itemName: string; quantity: number; amount: number } | null;
  onIssued: () => void;
}

export default function IssueCreditDialog({ open, onOpenChange, target, onIssued }: Props) {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);

  const handleConfirm = async () => {
    if (!target) return;
    setSaving(true);
    const { error } = await supabase.rpc('issue_credit_for_return' as any, {
      p_return_id: target.returnId,
    });
    setSaving(false);
    if (error) { toast({ title: 'Error', description: error.message, variant: 'destructive' }); return; }
    toast({ title: 'Credit issued' });
    onIssued();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Issue Credit{target ? ` — ${target.schoolName}` : ''}</DialogTitle>
          <DialogDescription>
            This mints a credit note immediately — the school doesn't need to wait for the
            returned book to physically arrive back.
          </DialogDescription>
        </DialogHeader>
        {target && (
          <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3 text-sm space-y-1">
            <p><span className="font-bold">Item:</span> {target.itemName} × {target.quantity}</p>
            <p><span className="font-bold">Credit Amount:</span> ₹{target.amount.toLocaleString('en-IN')}</p>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleConfirm} disabled={!target || saving}>{saving ? 'Issuing…' : 'Issue Credit'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 3: Rename `ConfirmReturnReceiptDialog.tsx` to `MarkReturnReceivedDialog.tsx`**

Same file content, three changes only:
1. RPC call: `supabase.rpc('mark_return_received' as any, { p_return_id: returnId, p_condition: condition })` (was `confirm_return_received`).
2. Success toast: `toast({ title: 'Return received, stock updated' });` (was `'Return received, credit note issued'` — no longer accurate, the credit already happened).
3. Component name/export: `MarkReturnReceivedDialog` (was `ConfirmReturnReceiptDialog`) — keep the dialog's visible title text ("Confirm Receipt — {itemName}") as-is, that's still accurate user-facing copy for this step.

Delete the old file after creating the new one (`git mv` is fine if your tooling supports it, otherwise create new + remove old).

- [ ] **Step 4: Restructure `ReturnsPage.tsx` — three tabs**

Replace the two-tab structure with three, add the Issue Credit action, rewire the existing action to `MarkReturnReceivedDialog`:

```tsx
// src/pages/Sales/ReturnsPage.tsx
import { useState, useEffect } from 'react';
import SalesLayout from '@/components/sales/SalesLayout';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import IssueCreditDialog from '@/components/sales/IssueCreditDialog';
import MarkReturnReceivedDialog from '@/components/sales/MarkReturnReceivedDialog';

type ReturnRow = {
  id: string;
  quantity: number;
  reason_category: string;
  reason_note: string | null;
  status: 'requested' | 'credit_issued' | 'received';
  condition_on_receipt: 'resellable' | 'damaged' | null;
  requested_at: string;
  actual_product: { name: string } | null;
  invoice_line_items: {
    item_name: string;
    unit_price: number;
    invoices: { invoice_number: number | null; fy: number | null; schools: { school_name: string; ss_no: number | null } | null } | null;
  } | null;
};

const REASON_LABELS: Record<string, string> = {
  wrong_item_shipped: 'Wrong item shipped',
  wrong_item_ordered_by_staff: 'Staff entered wrong item',
  damaged_in_transit: 'Damaged in transit',
  other: 'Other',
};

export default function ReturnsPage() {
  const { profile } = useAuth();
  const canManage = profile?.role === 'superadmin' || profile?.role === 'accountant';
  const [rows, setRows] = useState<ReturnRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [creditTarget, setCreditTarget] = useState<{ returnId: string; schoolName: string; itemName: string; quantity: number; amount: number } | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<{ id: string; itemName: string } | null>(null);

  const load = () => {
    setLoading(true);
    supabase
      .from('product_returns' as any)
      .select(`
        id, quantity, reason_category, reason_note, status, condition_on_receipt, requested_at,
        actual_product:products!product_returns_actual_product_id_fkey ( name ),
        invoice_line_items ( item_name, unit_price, invoices ( invoice_number, fy, schools ( school_name, ss_no ) ) )
      `)
      .order('requested_at', { ascending: false })
      .then(({ data }) => {
        setRows((data || []) as unknown as ReturnRow[]);
        setLoading(false);
      });
  };

  useEffect(() => { load(); }, []);

  const requested = rows.filter(r => r.status === 'requested');
  const awaitingReturn = rows.filter(r => r.status === 'credit_issued');
  const received = rows.filter(r => r.status === 'received');

  const invoiceLabel = (r: ReturnRow) => {
    const inv = r.invoice_line_items?.invoices;
    if (!inv?.invoice_number) return '—';
    return `INV/${inv.fy}-${(inv.fy ?? 0) + 1}/${inv.invoice_number}`;
  };
  const schoolLabel = (r: ReturnRow) => {
    const school = r.invoice_line_items?.invoices?.schools;
    return school ? `${school.school_name}${school.ss_no != null ? ` (SS #${school.ss_no})` : ''}` : '—';
  };

  const renderRows = (list: ReturnRow[], action: 'issue-credit' | 'mark-received' | 'none') => (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>School</TableHead>
          <TableHead>Item</TableHead>
          <TableHead>Qty</TableHead>
          <TableHead>Reason</TableHead>
          <TableHead>Invoice</TableHead>
          {action === 'none' && <TableHead>Condition</TableHead>}
          {action !== 'none' && <TableHead></TableHead>}
        </TableRow>
      </TableHeader>
      <TableBody>
        {loading ? (
          <TableRow><TableCell colSpan={6} className="text-center py-6 text-muted-foreground">Loading…</TableCell></TableRow>
        ) : list.length === 0 ? (
          <TableRow><TableCell colSpan={6} className="text-center py-6 text-muted-foreground">Nothing here.</TableCell></TableRow>
        ) : (
          list.map(r => (
            <TableRow key={r.id}>
              <TableCell>{schoolLabel(r)}</TableCell>
              <TableCell>
                {r.invoice_line_items?.item_name ?? '—'}
                {r.actual_product && (
                  <p className="text-xs text-amber-600 mt-0.5">Shipped instead: {r.actual_product.name}</p>
                )}
              </TableCell>
              <TableCell>{r.quantity}</TableCell>
              <TableCell><Badge variant="outline">{REASON_LABELS[r.reason_category] ?? r.reason_category}</Badge></TableCell>
              <TableCell>{invoiceLabel(r)}</TableCell>
              {action === 'none' && <TableCell className="capitalize">{r.condition_on_receipt}</TableCell>}
              {action === 'issue-credit' && (
                <TableCell>
                  {canManage && (
                    <Button size="sm" onClick={() => setCreditTarget({
                      returnId: r.id,
                      schoolName: schoolLabel(r),
                      itemName: r.invoice_line_items?.item_name ?? 'item',
                      quantity: r.quantity,
                      amount: (r.invoice_line_items?.unit_price ?? 0) * r.quantity,
                    })}>
                      Issue Credit
                    </Button>
                  )}
                </TableCell>
              )}
              {action === 'mark-received' && (
                <TableCell>
                  {canManage && (
                    <Button size="sm" onClick={() => setConfirmTarget({ id: r.id, itemName: r.invoice_line_items?.item_name ?? 'item' })}>
                      Mark Received
                    </Button>
                  )}
                </TableCell>
              )}
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  );

  return (
    <SalesLayout>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <h1 className="text-2xl font-bold text-neutral-900 mb-4">Returns</h1>
        <Tabs defaultValue="requested">
          <TabsList>
            <TabsTrigger value="requested">Requested ({requested.length})</TabsTrigger>
            <TabsTrigger value="awaiting">Awaiting Return ({awaitingReturn.length})</TabsTrigger>
            <TabsTrigger value="received">Received ({received.length})</TabsTrigger>
          </TabsList>
          <TabsContent value="requested">{renderRows(requested, 'issue-credit')}</TabsContent>
          <TabsContent value="awaiting">{renderRows(awaitingReturn, 'mark-received')}</TabsContent>
          <TabsContent value="received">{renderRows(received, 'none')}</TabsContent>
        </Tabs>
      </div>
      <IssueCreditDialog
        open={!!creditTarget}
        onOpenChange={(o) => { if (!o) setCreditTarget(null); }}
        target={creditTarget}
        onIssued={load}
      />
      <MarkReturnReceivedDialog
        open={!!confirmTarget}
        onOpenChange={(o) => { if (!o) setConfirmTarget(null); }}
        returnId={confirmTarget?.id ?? null}
        itemName={confirmTarget?.itemName ?? ''}
        onConfirmed={load}
      />
    </SalesLayout>
  );
}
```

- [ ] **Step 5: Run `tsc --noEmit` and confirm clean**

Run: `npx tsc --noEmit`
Expected: zero output.

- [ ] **Step 6: Manual verification checklist (document in report, cannot run in this environment)**

- Requested tab shows "Issue Credit" for superadmin/accountant, nothing for other roles.
- Clicking Issue Credit shows the correct preview amount (`unit_price * quantity`) before confirming.
- After issuing credit, the row disappears from Requested and appears in Awaiting Return.
- Awaiting Return tab shows "Mark Received" for superadmin/accountant.
- After marking received, the row disappears from Awaiting Return and appears in Received with its condition shown.
- A return still in Requested cannot be marked received (no button is even shown there — the DB-level guard from Task 1 is defense in depth, not the only line of defense).

- [ ] **Step 7: Commit**

```bash
git add src/components/sales/IssueCreditDialog.tsx src/components/sales/MarkReturnReceivedDialog.tsx src/pages/Sales/ReturnsPage.tsx
git rm src/components/sales/ConfirmReturnReceiptDialog.tsx
git commit -m "Returns: three-tab queue (Requested / Awaiting Return / Received), Issue Credit + Mark Received actions"
```

---

## Post-plan verification (controller does this after Task 2, not a task itself)

- Live click-through by Goghul still owed, same standing item as every Sales-module feature built this session.
