# Accounts Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the `accountant` role (and superadmin) a real home: one unified view of every payment coming in (registrations + book orders), every payment going out (suppliers), outstanding balances, and the deleted-payments audit trail — replacing today's single-page registration-only dashboard.

**Architecture:** One new read-only view (`accounts_payments_in`, a `UNION ALL` normalizing `payment_transactions` and confirmed `product_orders`) plus five new pages under a new `/accounts/*` area with its own layout/nav, gated by the existing `ProtectedRoute accountantOnly`. No new RPCs — nothing in this module writes. Credit Notes & Refunds is not rebuilt here; the nav links out to the existing (separately merged) `/sales/credit-notes` page.

**Tech Stack:** Supabase Postgres (one SQL migration), React + TypeScript, Supabase JS client, shadcn/ui components, `@tanstack/react-query` is NOT used elsewhere in this codebase's Sales/Accountant pages (they use plain `useState`/`useEffect` + direct `supabase` calls) — match that existing convention, don't introduce react-query here.

**Spec:** `docs/superpowers/specs/2026-08-23-accounts-module-design.md`

## Global Constraints

- This plan depends on the Returns & Exchanges feature (`docs/superpowers/specs/2026-08-21-returns-exchanges-design.md`) already being merged into `main` — `credit_notes_with_balance` must exist for Task 2's Dashboard KPI. Verify this before starting Task 1 (`SELECT 1 FROM credit_notes_with_balance LIMIT 1;` via `supabase db query --linked` must not error).
- No new DB-level role-restriction function. `accounts_payments_in` is declared `WITH (security_invoker = true)` and inherits the base tables' existing RLS (already staff-wide/accountant-or-above) — the accountant+superadmin-only boundary is the **existing** `ProtectedRoute accountantOnly` prop (in `src/components/layout/ProtectedRoute.tsx`, already does exactly `role === 'accountant' || role === 'superadmin'`), wrapping every new route. Do not add a new SQL role-check function for this plan — see the spec's "Where the accountant+superadmin-only restriction actually lives" section for why one would be non-functional here.
- Apply the migration via `supabase db query --linked --file supabase/migrations/<file>.sql` against the linked project (this codebase's established convention — confirmed working throughout the Returns & Exchanges plan).
- This codebase has no automated frontend test suite. Frontend task "tests" are `tsc --noEmit` (a real, runnable gate) — not fabricated unit tests. The one backend task gets a genuine before/after SQL check (fails before the view exists, succeeds and cross-checks a real total after).
- Match existing conventions exactly: plain `useState`/`useEffect` + `supabase.from(...)` (no react-query in these pages, matching `AccountantDashboard.tsx`/Sales pages); shadcn/ui `Card`/`Table`/`Input`/`Button`/`Label` components (already used throughout `src/pages/Sales/*` and `AccountantDashboard.tsx`); CSV export via the existing `downloadCSV` from `src/utils/csvExport.ts` (do not write a new CSV serializer).
- `profile.role` is typed `'superadmin' | 'manager' | 'accountant'` in `src/types/database.ts` — use that exact type, no new role type.

---

### Task 1: Migration — unified Payments-In view

**Files:**
- Create: `supabase/migrations/20260823_accounts_payments_in_view.sql`

**Interfaces:**
- Produces: view `public.accounts_payments_in(id uuid, category text, transaction_date date, school_id uuid, school_name text, ss_no integer, amount numeric, payment_mode text, reference text, created_by uuid, created_at timestamptz)`. Later tasks query this directly via `supabase.from('accounts_payments_in' as any)` (the `as any` cast matches the existing pattern already used for other views not yet in the generated Supabase types, e.g. `ManualOrderDialog.tsx`'s `credit_notes_with_balance` query).

- [ ] **Step 1: Write the verification script and confirm it fails**

Create `/tmp/verify_accounts_payments_in.sql`:

```sql
-- Should fail today: the view doesn't exist yet.
SELECT count(*) FROM accounts_payments_in;
```

Run: `supabase db query --linked --file /tmp/verify_accounts_payments_in.sql`
Expected: error, `relation "accounts_payments_in" does not exist`.

- [ ] **Step 2: Write the migration**

```sql
-- supabase/migrations/20260823_accounts_payments_in_view.sql
--
-- Normalizes every money-IN transaction (registration fee payments + confirmed
-- book-order payments) into one shape for the Accounts module's Payments page.
-- security_invoker = true is mandatory (a prior feature in this codebase shipped
-- a summary view without it and it silently bypassed RLS) — this means the view
-- runs under the querying user's own rights on payment_transactions/
-- product_orders/schools, so it cannot be more restrictive than those tables
-- already are (they're already accountant-or-above / staff-wide). The
-- accountant+superadmin-only boundary for this module is enforced at the route
-- level (ProtectedRoute accountantOnly), not here — see the spec for why a
-- view-level role policy would be non-functional (views don't carry policies;
-- only tables do).
--
-- Dedup: a portal-submitted registration payment only reaches payment_transactions
-- once staff acknowledges it (acknowledge_portal_payment() inserts the row itself
-- at acknowledgment time) — reading only payment_transactions here cannot
-- double-count against portal_payment_submissions. Book-order payments have no
-- separate installment table — one product_orders row is one payment event, so
-- filtering to payment_status = 'confirmed' is the complete set.
CREATE VIEW public.accounts_payments_in
WITH (security_invoker = true) AS
SELECT
  pt.id,
  'registration'::text AS category,
  pt.payment_date AS transaction_date,
  pt.school_id,
  s.school_name,
  s.ss_no,
  pt.payment_amount AS amount,
  pt.payment_mode,
  pt.transaction_reference AS reference,
  pt.created_by,
  pt.created_at
FROM payment_transactions pt
JOIN schools s ON s.id = pt.school_id
UNION ALL
SELECT
  po.id,
  'book_order'::text AS category,
  po.payment_date AS transaction_date,
  po.school_id,
  s.school_name,
  s.ss_no,
  po.payment_amount AS amount,
  po.payment_mode,
  po.payment_utr_reference AS reference,
  po.created_by,
  po.created_at
FROM product_orders po
JOIN schools s ON s.id = po.school_id
WHERE po.payment_status = 'confirmed';
```

- [ ] **Step 3: Apply the migration and verify the view now exists**

Run: `supabase db query --linked --file supabase/migrations/20260823_accounts_payments_in_view.sql`
Then re-run: `supabase db query --linked --file /tmp/verify_accounts_payments_in.sql`
Expected: succeeds, returns one row with a `count`.

- [ ] **Step 4: Cross-check the totals are actually correct, not just non-erroring**

Create `/tmp/verify_accounts_payments_in_totals.sql`:

```sql
-- The view's total must equal the sum of its two real sources, independently computed.
SELECT
  (SELECT COALESCE(SUM(amount), 0) FROM accounts_payments_in) AS view_total,
  (SELECT COALESCE(SUM(payment_amount), 0) FROM payment_transactions) AS registration_total,
  (SELECT COALESCE(SUM(payment_amount), 0) FROM product_orders WHERE payment_status = 'confirmed') AS book_order_total,
  (SELECT COALESCE(SUM(payment_amount), 0) FROM payment_transactions) +
  (SELECT COALESCE(SUM(payment_amount), 0) FROM product_orders WHERE payment_status = 'confirmed') AS expected_total;
```

Run: `supabase db query --linked --file /tmp/verify_accounts_payments_in_totals.sql`
Expected: `view_total` exactly equals `expected_total`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260823_accounts_payments_in_view.sql
git commit -m "Add accounts_payments_in view: unified registration + book-order payments ledger"
```

---

### Task 2: Accounts shell — layout, Dashboard, ModuleSelect tile, routing

**Files:**
- Create: `src/pages/Accounts/AccountsLayout.tsx`
- Create: `src/pages/Accounts/AccountsDashboardPage.tsx`
- Modify: `src/pages/ModuleSelect.tsx`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `accounts_payments_in` (Task 1); `credit_notes_with_balance` (from the merged Returns & Exchanges feature — has `remaining_balance numeric`); `useAuth()` from `@/hooks/useAuth` (returns `{ profile, signOut }`, `profile.role: 'superadmin'|'manager'|'accountant'`, `profile.username`).
- Produces: `AccountsLayout` component (`{ children: React.ReactNode }` prop, exported default from `src/pages/Accounts/AccountsLayout.tsx`) — later tasks (3-6) import this and add their own nav entry to its `navItems` array plus their own route in `App.tsx`. Routes `/accounts` (redirects to `/accounts/dashboard`) and `/accounts/dashboard`.

- [ ] **Step 1: Create `AccountsLayout.tsx`**

Mirrors `src/components/sales/SalesLayout.tsx`'s structure (top nav bar, Back-to-Modules button, sign-out) but with a flat nav list (no dropdown groups needed at this size — 5 internal pages + 1 external link) and a distinct color (`emerald`, not Sales' `orange`, so the two modules are visually distinguishable):

```tsx
// src/pages/Accounts/AccountsLayout.tsx
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import {
  LogOut, ArrowLeft, LayoutDashboard, Wallet, Truck, AlertCircle, Trash2, FileText, ExternalLink,
} from 'lucide-react';

const navItems = [
  { label: 'Dashboard', href: '/accounts/dashboard', icon: LayoutDashboard },
  { label: 'Payments', href: '/accounts/payments', icon: Wallet },
  { label: 'Supplier Payments', href: '/accounts/supplier-payments', icon: Truck },
  { label: 'Outstanding', href: '/accounts/outstanding', icon: AlertCircle },
  { label: 'Deleted Payments', href: '/accounts/deleted-payments', icon: Trash2 },
];

const AccountsLayout = ({ children }: { children: React.ReactNode }) => {
  const { profile, signOut } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  const linkClass = (active: boolean) =>
    `flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors whitespace-nowrap ${
      active
        ? 'bg-white text-emerald-700'
        : 'text-emerald-100 hover:bg-emerald-700 hover:text-white'
    }`;

  return (
    <div className="min-h-screen bg-neutral-50 flex flex-col">
      <nav className="bg-emerald-600 text-white shadow-lg">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-14">
            <div className="flex items-center gap-6">
              <button
                onClick={() => navigate('/module-select')}
                className="flex items-center gap-1.5 text-emerald-100 hover:text-white text-sm transition-colors"
              >
                <ArrowLeft className="h-4 w-4" />
                Back
              </button>
              <div className="h-5 w-px bg-emerald-400" />
              <span className="font-semibold text-sm tracking-wide text-white">Accounts</span>
              <div className="flex items-center gap-1 overflow-x-auto">
                {navItems.map(({ label, href, icon: Icon }) => (
                  <Link key={href} to={href} className={linkClass(location.pathname === href)}>
                    <Icon className="h-3.5 w-3.5" />
                    {label}
                  </Link>
                ))}
                <a
                  href="/sales/credit-notes"
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium whitespace-nowrap text-emerald-100 hover:bg-emerald-700 hover:text-white transition-colors"
                >
                  <FileText className="h-3.5 w-3.5" />
                  Credit Notes & Refunds
                  <ExternalLink className="h-3 w-3 opacity-70" />
                </a>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-emerald-100 text-sm">{profile?.username}</span>
              <Button
                variant="ghost"
                size="sm"
                onClick={signOut}
                className="text-emerald-100 hover:text-white hover:bg-emerald-700 h-8 w-8 p-0"
              >
                <LogOut className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </nav>
      <main className="flex-1">{children}</main>
    </div>
  );
};

export default AccountsLayout;
```

Note: "Credit Notes & Refunds" is a plain `<a href>` (full page navigation), not a `<Link>` — deliberate, since `/sales/credit-notes` lives in a completely different layout (`SalesLayout`, not `AccountsLayout`); a client-side `<Link>` would leave this nav bar mounted around Sales content, which is wrong. A real navigation (or a `window.location` swap) is the correct way to move between two sibling module layouts, matching how the "Back to Modules" button above also does a full navigate to a route outside this layout's own tree.

- [ ] **Step 2: Create `AccountsDashboardPage.tsx`**

```tsx
// src/pages/Accounts/AccountsDashboardPage.tsx
import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Wallet, TrendingDown, TrendingUp, AlertCircle, FileText, Clock } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import AccountsLayout from './AccountsLayout';

interface DashboardMetrics {
  totalCollected: number;
  totalPaidToSuppliers: number;
  outstandingFromSchools: number;
  openCreditBalance: number;
  pendingReviews: number;
}

export default function AccountsDashboardPage() {
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);
      const [
        { data: paymentsIn, error: paymentsInErr },
        { data: supplierPayments, error: supplierErr },
        { data: schools, error: schoolsErr },
        { data: creditNotes, error: creditErr },
        { count: pendingRegPayments, error: pendingRegErr },
        { count: pendingOrderPayments, error: pendingOrderErr },
      ] = await Promise.all([
        supabase.from('accounts_payments_in' as any).select('amount'),
        supabase.from('inventory_supplier_payments').select('amount'),
        supabase.from('schools').select('outstanding_balance').in('payment_status', ['Pending', 'Partial']),
        supabase.from('credit_notes_with_balance' as any).select('remaining_balance'),
        supabase.from('portal_payment_submissions').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
        supabase.from('product_orders').select('*', { count: 'exact', head: true }).eq('payment_status', 'pending'),
      ]);

      if (paymentsInErr || supplierErr || schoolsErr || creditErr || pendingRegErr || pendingOrderErr) {
        setError('Could not load dashboard metrics. Please try again.');
        setLoading(false);
        return;
      }

      const totalCollected = (paymentsIn ?? []).reduce((sum: number, r: any) => sum + Number(r.amount ?? 0), 0);
      const totalPaidToSuppliers = (supplierPayments ?? []).reduce((sum: number, r: any) => sum + Number(r.amount ?? 0), 0);
      const outstandingFromSchools = (schools ?? []).reduce((sum: number, r: any) => sum + Number(r.outstanding_balance ?? 0), 0);
      const openCreditBalance = (creditNotes ?? []).reduce((sum: number, r: any) => sum + Number(r.remaining_balance ?? 0), 0);

      setMetrics({
        totalCollected,
        totalPaidToSuppliers,
        outstandingFromSchools,
        openCreditBalance,
        pendingReviews: (pendingRegPayments ?? 0) + (pendingOrderPayments ?? 0),
      });
      setLoading(false);
    }
    load();
  }, []);

  const cards = metrics ? [
    { title: 'Total Collected', value: metrics.totalCollected, icon: Wallet, tone: 'text-emerald-600' },
    { title: 'Total Paid to Suppliers', value: metrics.totalPaidToSuppliers, icon: TrendingDown, tone: 'text-red-600' },
    { title: 'Net Position', value: metrics.totalCollected - metrics.totalPaidToSuppliers, icon: TrendingUp, tone: 'text-blue-600' },
    { title: 'Outstanding from Schools', value: metrics.outstandingFromSchools, icon: AlertCircle, tone: 'text-orange-600' },
    { title: 'Open Credit Note Balance', value: metrics.openCreditBalance, icon: FileText, tone: 'text-purple-600' },
  ] : [];

  return (
    <AccountsLayout>
      <div className="max-w-7xl mx-auto p-6 space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Accounts Dashboard</h1>
          <p className="text-muted-foreground">Every payment in, every payment out, and everything in between.</p>
        </div>

        {loading ? (
          <p className="text-muted-foreground">Loading…</p>
        ) : error ? (
          <div className="rounded-md border border-red-200 bg-red-50 p-4 text-red-700 text-sm">{error}</div>
        ) : (
          <>
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {cards.map(({ title, value, icon: Icon, tone }) => (
                <Card key={title}>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">{title}</CardTitle>
                    <Icon className={`h-4 w-4 ${tone}`} />
                  </CardHeader>
                  <CardContent>
                    <div className={`text-2xl font-bold ${tone}`}>₹{value.toLocaleString('en-IN')}</div>
                  </CardContent>
                </Card>
              ))}
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Pending Payment Reviews</CardTitle>
                  <Clock className="h-4 w-4 text-amber-600" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-amber-600">{metrics?.pendingReviews ?? 0}</div>
                  <p className="text-xs text-muted-foreground">Registration + book-order payments awaiting review</p>
                </CardContent>
              </Card>
            </div>
          </>
        )}
      </div>
    </AccountsLayout>
  );
}
```

- [ ] **Step 3: Run `tsc --noEmit` and confirm it's clean**

Run: `npx tsc --noEmit`
Expected: no errors referencing `AccountsLayout.tsx` or `AccountsDashboardPage.tsx`.

- [ ] **Step 4: Add the routes to `App.tsx`**

Add the import near the other page imports (alongside `import AccountantDashboard from "./pages/AccountantDashboard";`):

```tsx
import AccountsDashboardPage from "./pages/Accounts/AccountsDashboardPage";
```

Add the routes near the `/accountant` route (`path="/accountant"` block around line 301):

```tsx
<Route path="/accounts" element={<ProtectedRoute accountantOnly><Navigate to="/accounts/dashboard" replace /></ProtectedRoute>} />
<Route path="/accounts/dashboard" element={<ProtectedRoute accountantOnly><AccountsDashboardPage /></ProtectedRoute>} />
```

- [ ] **Step 5: Add the ModuleSelect tile**

In `src/pages/ModuleSelect.tsx`, change the grid container class from `grid-cols-1 md:grid-cols-3 gap-6 w-full max-w-4xl` to `grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 w-full max-w-5xl` (so it lays out cleanly whether 3 or 4 tiles are visible), add the `Landmark` icon to the existing lucide-react import line, and add a 4th, role-conditional tile right after the Sales tile's closing `</button>`:

```tsx
{(profile?.role === 'accountant' || profile?.role === 'superadmin') && (
  <button
    onClick={() => navigate('/accounts')}
    className="group rounded-2xl p-8 text-left text-white shadow-md hover:shadow-2xl hover:scale-[1.02] transition-all duration-200 bg-gradient-to-br from-emerald-600 via-teal-500 to-cyan-400"
  >
    <div className="flex items-center justify-between mb-6">
      <div className="p-3 bg-white/15 backdrop-blur-sm rounded-xl ring-1 ring-white/20">
        <Landmark className="h-7 w-7 text-white" />
      </div>
      <ArrowRight className="h-5 w-5 text-white/60 group-hover:text-white group-hover:translate-x-1 transition-all" />
    </div>
    <h2 className="text-xl font-bold mb-1">Accounts</h2>
    <p className="text-sm text-white/80">Payments · Refunds · Credit Notes · Outstanding</p>
  </button>
)}
```

- [ ] **Step 6: Run `tsc --noEmit` again and confirm the whole project is clean**

Run: `npx tsc --noEmit`
Expected: zero output.

- [ ] **Step 7: Commit**

```bash
git add src/pages/Accounts/AccountsLayout.tsx src/pages/Accounts/AccountsDashboardPage.tsx src/pages/ModuleSelect.tsx src/App.tsx
git commit -m "Add Accounts module shell: layout, Dashboard, ModuleSelect tile, routing"
```

---

### Task 3: Payments page (the unified ledger)

**Files:**
- Create: `src/pages/Accounts/AccountsPaymentsPage.tsx`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `accounts_payments_in` view (Task 1); `AccountsLayout` (Task 2); `downloadCSV` from `src/utils/csvExport.ts` (signature: `(data: (string | number | null | undefined)[][], filename: string) => void`).

- [ ] **Step 1: Create `AccountsPaymentsPage.tsx`**

```tsx
// src/pages/Accounts/AccountsPaymentsPage.tsx
import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Download } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { downloadCSV } from '@/utils/csvExport';
import AccountsLayout from './AccountsLayout';

interface PaymentRow {
  id: string;
  category: 'registration' | 'book_order';
  transaction_date: string;
  school_id: string;
  school_name: string;
  ss_no: number | null;
  amount: number;
  payment_mode: string | null;
  reference: string | null;
}

export default function AccountsPaymentsPage() {
  const [rows, setRows] = useState<PaymentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [category, setCategory] = useState<'all' | 'registration' | 'book_order'>('all');

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);
      const { data, error: queryError } = await supabase
        .from('accounts_payments_in' as any)
        .select('id, category, transaction_date, school_id, school_name, ss_no, amount, payment_mode, reference')
        .order('transaction_date', { ascending: false });
      if (queryError) {
        setError('Could not load payments. Please try again.');
        setLoading(false);
        return;
      }
      setRows((data ?? []) as unknown as PaymentRow[]);
      setLoading(false);
    }
    load();
  }, []);

  const filtered = rows.filter(r => {
    if (startDate && r.transaction_date < startDate) return false;
    if (endDate && r.transaction_date > endDate) return false;
    if (category !== 'all' && r.category !== category) return false;
    return true;
  });

  const totalAmount = filtered.reduce((sum, r) => sum + Number(r.amount), 0);

  function exportCSV() {
    const headers = ['Date', 'Category', 'SS No', 'School Name', 'Amount', 'Payment Mode', 'Reference'];
    const data = [
      headers,
      ...filtered.map(r => [
        r.transaction_date, r.category === 'registration' ? 'Registration' : 'Book Order',
        r.ss_no, r.school_name, r.amount, r.payment_mode ?? '', r.reference ?? '',
      ]),
    ];
    downloadCSV(data, `payments_${startDate || 'all'}_to_${endDate || 'all'}.csv`);
  }

  return (
    <AccountsLayout>
      <div className="max-w-7xl mx-auto p-6 space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Payments</h1>
          <p className="text-muted-foreground">Every payment received — registration fees and book orders, in one place.</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Filter & Export</CardTitle>
            <CardDescription>{filtered.length} record(s) · ₹{totalAmount.toLocaleString('en-IN')} total</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-4 items-end mb-4">
              <div>
                <Label htmlFor="startDate">Start Date</Label>
                <Input id="startDate" type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="endDate">End Date</Label>
                <Input id="endDate" type="date" value={endDate} onChange={e => setEndDate(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="category">Category</Label>
                <select
                  id="category"
                  value={category}
                  onChange={e => setCategory(e.target.value as typeof category)}
                  className="flex h-10 rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="all">All</option>
                  <option value="registration">Registration</option>
                  <option value="book_order">Book Order</option>
                </select>
              </div>
              <Button variant="outline" onClick={exportCSV}>
                <Download className="h-4 w-4 mr-2" />
                Export CSV
              </Button>
            </div>

            {loading ? (
              <p className="text-muted-foreground">Loading…</p>
            ) : error ? (
              <div className="rounded-md border border-red-200 bg-red-50 p-4 text-red-700 text-sm">{error}</div>
            ) : (
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead>SS No</TableHead>
                      <TableHead>School Name</TableHead>
                      <TableHead>Amount</TableHead>
                      <TableHead>Payment Mode</TableHead>
                      <TableHead>Reference</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center text-muted-foreground py-8">No payments found</TableCell>
                      </TableRow>
                    ) : (
                      filtered.map(r => (
                        <TableRow key={r.id}>
                          <TableCell>{new Date(r.transaction_date).toLocaleDateString('en-IN')}</TableCell>
                          <TableCell>{r.category === 'registration' ? 'Registration' : 'Book Order'}</TableCell>
                          <TableCell>{r.ss_no ?? '—'}</TableCell>
                          <TableCell className="max-w-xs truncate" title={r.school_name}>{r.school_name}</TableCell>
                          <TableCell>₹{Number(r.amount).toLocaleString('en-IN')}</TableCell>
                          <TableCell>{r.payment_mode ?? '—'}</TableCell>
                          <TableCell>{r.reference ?? '—'}</TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AccountsLayout>
  );
}
```

- [ ] **Step 2: Add the nav entry**

In `src/pages/Accounts/AccountsLayout.tsx`, the `Payments` entry already exists in `navItems` from Task 2 — no change needed here (Task 2 pre-declared the full nav list so each page task just needs to make the href resolve). Confirm this by reading the file — no edit expected.

- [ ] **Step 3: Add the route**

In `src/App.tsx`, add the import next to `AccountsDashboardPage`:

```tsx
import AccountsPaymentsPage from "./pages/Accounts/AccountsPaymentsPage";
```

Add the route next to `/accounts/dashboard`:

```tsx
<Route path="/accounts/payments" element={<ProtectedRoute accountantOnly><AccountsPaymentsPage /></ProtectedRoute>} />
```

- [ ] **Step 4: Run `tsc --noEmit` and confirm clean**

Run: `npx tsc --noEmit`
Expected: zero output.

- [ ] **Step 5: Commit**

```bash
git add src/pages/Accounts/AccountsPaymentsPage.tsx src/App.tsx
git commit -m "Add Accounts Payments page: unified registration + book-order ledger"
```

---

### Task 4: Supplier Payments page

**Files:**
- Create: `src/pages/Accounts/AccountsSupplierPaymentsPage.tsx`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `inventory_supplier_payments` (id, supplier_id, amount, payment_date, payment_mode, reference, notes, created_at) joined to `inventory_suppliers` (id, name); `AccountsLayout` (Task 2); `downloadCSV`.

- [ ] **Step 1: Create `AccountsSupplierPaymentsPage.tsx`**

```tsx
// src/pages/Accounts/AccountsSupplierPaymentsPage.tsx
import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Download } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { downloadCSV } from '@/utils/csvExport';
import AccountsLayout from './AccountsLayout';

interface SupplierPaymentRow {
  id: string;
  payment_date: string;
  amount: number;
  payment_mode: string | null;
  reference: string | null;
  notes: string | null;
  inventory_suppliers: { name: string } | null;
}

export default function AccountsSupplierPaymentsPage() {
  const [rows, setRows] = useState<SupplierPaymentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);
      const { data, error: queryError } = await supabase
        .from('inventory_supplier_payments')
        .select('id, payment_date, amount, payment_mode, reference, notes, inventory_suppliers(name)')
        .order('payment_date', { ascending: false });
      if (queryError) {
        setError('Could not load supplier payments. Please try again.');
        setLoading(false);
        return;
      }
      setRows((data ?? []) as unknown as SupplierPaymentRow[]);
      setLoading(false);
    }
    load();
  }, []);

  const filtered = rows.filter(r => {
    if (startDate && r.payment_date < startDate) return false;
    if (endDate && r.payment_date > endDate) return false;
    return true;
  });

  const totalAmount = filtered.reduce((sum, r) => sum + Number(r.amount), 0);

  function exportCSV() {
    const headers = ['Date', 'Supplier', 'Amount', 'Payment Mode', 'Reference', 'Notes'];
    const data = [
      headers,
      ...filtered.map(r => [
        r.payment_date, r.inventory_suppliers?.name ?? '—', r.amount, r.payment_mode ?? '', r.reference ?? '', r.notes ?? '',
      ]),
    ];
    downloadCSV(data, `supplier_payments_${startDate || 'all'}_to_${endDate || 'all'}.csv`);
  }

  return (
    <AccountsLayout>
      <div className="max-w-7xl mx-auto p-6 space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Supplier Payments</h1>
          <p className="text-muted-foreground">Every payment made to book suppliers, across all purchase orders.</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Filter & Export</CardTitle>
            <CardDescription>{filtered.length} record(s) · ₹{totalAmount.toLocaleString('en-IN')} total</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-4 items-end mb-4">
              <div>
                <Label htmlFor="startDate">Start Date</Label>
                <Input id="startDate" type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="endDate">End Date</Label>
                <Input id="endDate" type="date" value={endDate} onChange={e => setEndDate(e.target.value)} />
              </div>
              <Button variant="outline" onClick={exportCSV}>
                <Download className="h-4 w-4 mr-2" />
                Export CSV
              </Button>
            </div>

            {loading ? (
              <p className="text-muted-foreground">Loading…</p>
            ) : error ? (
              <div className="rounded-md border border-red-200 bg-red-50 p-4 text-red-700 text-sm">{error}</div>
            ) : (
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Supplier</TableHead>
                      <TableHead>Amount</TableHead>
                      <TableHead>Payment Mode</TableHead>
                      <TableHead>Reference</TableHead>
                      <TableHead>Notes</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center text-muted-foreground py-8">No supplier payments found</TableCell>
                      </TableRow>
                    ) : (
                      filtered.map(r => (
                        <TableRow key={r.id}>
                          <TableCell>{new Date(r.payment_date).toLocaleDateString('en-IN')}</TableCell>
                          <TableCell>{r.inventory_suppliers?.name ?? '—'}</TableCell>
                          <TableCell>₹{Number(r.amount).toLocaleString('en-IN')}</TableCell>
                          <TableCell>{r.payment_mode ?? '—'}</TableCell>
                          <TableCell>{r.reference ?? '—'}</TableCell>
                          <TableCell className="max-w-xs truncate" title={r.notes ?? ''}>{r.notes ?? '—'}</TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AccountsLayout>
  );
}
```

- [ ] **Step 2: Add the route**

In `src/App.tsx`:

```tsx
import AccountsSupplierPaymentsPage from "./pages/Accounts/AccountsSupplierPaymentsPage";
```

```tsx
<Route path="/accounts/supplier-payments" element={<ProtectedRoute accountantOnly><AccountsSupplierPaymentsPage /></ProtectedRoute>} />
```

- [ ] **Step 3: Run `tsc --noEmit` and confirm clean**

Run: `npx tsc --noEmit`
Expected: zero output.

- [ ] **Step 4: Commit**

```bash
git add src/pages/Accounts/AccountsSupplierPaymentsPage.tsx src/App.tsx
git commit -m "Add Accounts Supplier Payments page"
```

---

### Task 5: Outstanding page

**Files:**
- Create: `src/pages/Accounts/AccountsOutstandingPage.tsx`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `schools` (id, ss_no, school_name, district, state, outstanding_balance, payment_status), `invoices` (id, invoice_number, fy, status, grand_total, school_id, schools(school_name, ss_no)); `AccountsLayout` (Task 2).

- [ ] **Step 1: Create `AccountsOutstandingPage.tsx`**

```tsx
// src/pages/Accounts/AccountsOutstandingPage.tsx
import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { supabase } from '@/integrations/supabase/client';
import AccountsLayout from './AccountsLayout';

interface SchoolOutstandingRow {
  id: string;
  ss_no: number | null;
  school_name: string;
  district: string | null;
  state: string | null;
  outstanding_balance: number;
  payment_status: string;
}

interface InvoiceOutstandingRow {
  id: string;
  invoice_number: number | null;
  fy: number | null;
  grand_total: number;
  status: string;
  schools: { school_name: string; ss_no: number | null } | null;
}

export default function AccountsOutstandingPage() {
  const [schoolRows, setSchoolRows] = useState<SchoolOutstandingRow[]>([]);
  const [invoiceRows, setInvoiceRows] = useState<InvoiceOutstandingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);
      const [{ data: schools, error: schoolsErr }, { data: invoices, error: invoicesErr }] = await Promise.all([
        supabase
          .from('schools')
          .select('id, ss_no, school_name, district, state, outstanding_balance, payment_status')
          .in('payment_status', ['Pending', 'Partial'])
          .gt('outstanding_balance', 0)
          .order('outstanding_balance', { ascending: false }),
        supabase
          .from('invoices')
          .select('id, invoice_number, fy, grand_total, status, schools(school_name, ss_no)')
          .eq('status', 'unpaid'),
      ]);
      if (schoolsErr || invoicesErr) {
        setError('Could not load outstanding balances. Please try again.');
        setLoading(false);
        return;
      }
      setSchoolRows((schools ?? []) as unknown as SchoolOutstandingRow[]);
      setInvoiceRows((invoices ?? []) as unknown as InvoiceOutstandingRow[]);
      setLoading(false);
    }
    load();
  }, []);

  const schoolTotal = schoolRows.reduce((sum, r) => sum + Number(r.outstanding_balance), 0);
  const invoiceTotal = invoiceRows.reduce((sum, r) => sum + Number(r.grand_total), 0);

  return (
    <AccountsLayout>
      <div className="max-w-7xl mx-auto p-6 space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Outstanding</h1>
          <p className="text-muted-foreground">Who owes iPlus money — registration balances and unpaid book-order invoices.</p>
        </div>

        {loading ? (
          <p className="text-muted-foreground">Loading…</p>
        ) : error ? (
          <div className="rounded-md border border-red-200 bg-red-50 p-4 text-red-700 text-sm">{error}</div>
        ) : (
          <>
            <Card>
              <CardHeader>
                <CardTitle>Registration Outstanding</CardTitle>
                <CardDescription>{schoolRows.length} school(s) · ₹{schoolTotal.toLocaleString('en-IN')} total</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>SS No</TableHead>
                        <TableHead>School Name</TableHead>
                        <TableHead>District</TableHead>
                        <TableHead>State</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Outstanding</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {schoolRows.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={6} className="text-center text-muted-foreground py-8">No registration balances outstanding</TableCell>
                        </TableRow>
                      ) : (
                        schoolRows.map(r => (
                          <TableRow key={r.id}>
                            <TableCell>{r.ss_no ?? '—'}</TableCell>
                            <TableCell className="max-w-xs truncate" title={r.school_name}>{r.school_name}</TableCell>
                            <TableCell>{r.district ?? '—'}</TableCell>
                            <TableCell>{r.state ?? '—'}</TableCell>
                            <TableCell>{r.payment_status}</TableCell>
                            <TableCell>₹{Number(r.outstanding_balance).toLocaleString('en-IN')}</TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Book-Order Outstanding</CardTitle>
                <CardDescription>{invoiceRows.length} invoice(s) · ₹{invoiceTotal.toLocaleString('en-IN')} total</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Invoice</TableHead>
                        <TableHead>SS No</TableHead>
                        <TableHead>School Name</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Amount</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {invoiceRows.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={5} className="text-center text-muted-foreground py-8">No unpaid book-order invoices</TableCell>
                        </TableRow>
                      ) : (
                        invoiceRows.map(r => (
                          <TableRow key={r.id}>
                            <TableCell>{r.invoice_number != null && r.fy != null ? `INV/${r.fy}-${r.fy + 1}/${r.invoice_number}` : '—'}</TableCell>
                            <TableCell>{r.schools?.ss_no ?? '—'}</TableCell>
                            <TableCell className="max-w-xs truncate" title={r.schools?.school_name ?? ''}>{r.schools?.school_name ?? '—'}</TableCell>
                            <TableCell>{r.status}</TableCell>
                            <TableCell>₹{Number(r.grand_total).toLocaleString('en-IN')}</TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </AccountsLayout>
  );
}
```

- [ ] **Step 2: Add the route**

In `src/App.tsx`:

```tsx
import AccountsOutstandingPage from "./pages/Accounts/AccountsOutstandingPage";
```

```tsx
<Route path="/accounts/outstanding" element={<ProtectedRoute accountantOnly><AccountsOutstandingPage /></ProtectedRoute>} />
```

- [ ] **Step 3: Run `tsc --noEmit` and confirm clean**

Run: `npx tsc --noEmit`
Expected: zero output.

- [ ] **Step 4: Commit**

```bash
git add src/pages/Accounts/AccountsOutstandingPage.tsx src/App.tsx
git commit -m "Add Accounts Outstanding page"
```

---

### Task 6: Deleted Payments page

**Files:**
- Create: `src/pages/Accounts/AccountsDeletedPaymentsPage.tsx`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `deleted_payments` (id, source_table, original_id, school_id, amount, payment_mode, payment_date, reference, deleted_by, deleted_at — see `supabase/migrations/20260821_deleted_payments_audit.sql`) joined to `schools` (school_name, ss_no); `AccountsLayout` (Task 2).

- [ ] **Step 1: Create `AccountsDeletedPaymentsPage.tsx`**

```tsx
// src/pages/Accounts/AccountsDeletedPaymentsPage.tsx
import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import AccountsLayout from './AccountsLayout';

interface DeletedPaymentRow {
  id: string;
  source_table: string;
  amount: number;
  payment_mode: string | null;
  payment_date: string | null;
  reference: string | null;
  deleted_by: string | null;
  deleted_at: string;
  schools: { school_name: string; ss_no: number | null } | null;
}

export default function AccountsDeletedPaymentsPage() {
  const [rows, setRows] = useState<DeletedPaymentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);
      const { data, error: queryError } = await supabase
        .from('deleted_payments')
        .select('id, source_table, amount, payment_mode, payment_date, reference, deleted_by, deleted_at, schools(school_name, ss_no)')
        .order('deleted_at', { ascending: false });
      if (queryError) {
        setError('Could not load the deleted-payments audit log. Please try again.');
        setLoading(false);
        return;
      }
      setRows((data ?? []) as unknown as DeletedPaymentRow[]);
      setLoading(false);
    }
    load();
  }, []);

  return (
    <AccountsLayout>
      <div className="max-w-7xl mx-auto p-6 space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Deleted Payments</h1>
          <p className="text-muted-foreground">Audit trail of every deleted payment, regardless of how it was deleted.</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Audit Log</CardTitle>
            <CardDescription>{rows.length} record(s)</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <p className="text-muted-foreground">Loading…</p>
            ) : error ? (
              <div className="rounded-md border border-red-200 bg-red-50 p-4 text-red-700 text-sm">{error}</div>
            ) : (
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Deleted At</TableHead>
                      <TableHead>Source</TableHead>
                      <TableHead>SS No</TableHead>
                      <TableHead>School Name</TableHead>
                      <TableHead>Amount</TableHead>
                      <TableHead>Payment Mode</TableHead>
                      <TableHead>Reference</TableHead>
                      <TableHead>Deleted Via</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={8} className="text-center text-muted-foreground py-8">No deleted payments</TableCell>
                      </TableRow>
                    ) : (
                      rows.map(r => (
                        <TableRow key={r.id}>
                          <TableCell>{new Date(r.deleted_at).toLocaleString('en-IN')}</TableCell>
                          <TableCell>{r.source_table === 'portal_payment_submissions' ? 'Portal Submission' : 'Payment Transaction'}</TableCell>
                          <TableCell>{r.schools?.ss_no ?? '—'}</TableCell>
                          <TableCell className="max-w-xs truncate" title={r.schools?.school_name ?? ''}>{r.schools?.school_name ?? '—'}</TableCell>
                          <TableCell>₹{Number(r.amount).toLocaleString('en-IN')}</TableCell>
                          <TableCell>{r.payment_mode ?? '—'}</TableCell>
                          <TableCell>{r.reference ?? '—'}</TableCell>
                          <TableCell>
                            {r.deleted_by ? (
                              <Badge variant="outline">App</Badge>
                            ) : (
                              <Badge variant="destructive">Outside normal flow</Badge>
                            )}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AccountsLayout>
  );
}
```

- [ ] **Step 2: Add the route**

In `src/App.tsx`:

```tsx
import AccountsDeletedPaymentsPage from "./pages/Accounts/AccountsDeletedPaymentsPage";
```

```tsx
<Route path="/accounts/deleted-payments" element={<ProtectedRoute accountantOnly><AccountsDeletedPaymentsPage /></ProtectedRoute>} />
```

- [ ] **Step 3: Run `tsc --noEmit` and confirm clean**

Run: `npx tsc --noEmit`
Expected: zero output.

- [ ] **Step 4: Commit**

```bash
git add src/pages/Accounts/AccountsDeletedPaymentsPage.tsx src/App.tsx
git commit -m "Add Accounts Deleted Payments audit page"
```

---

## Post-plan verification (not a task — controller does this after Task 6)

- Confirm `ProtectedRoute accountantOnly` actually blocks a manager profile from every new `/accounts/*` route (read `ProtectedRoute.tsx` — already established, but re-verify no route was accidentally added without the wrapper).
- Direct-query `accounts_payments_in` against the live linked project one more time post-merge to confirm it still matches `payment_transactions` + confirmed `product_orders` totals (nothing else should have touched those tables in between).
- Flag to Goghul: live browser click-through as accountant/superadmin is still needed before this is considered fully verified (this environment has no CRM login), same outstanding item every Sales-module feature this session has carried.
