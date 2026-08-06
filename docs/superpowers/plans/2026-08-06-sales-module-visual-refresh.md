# Sales Module Visual Refresh + Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-theme the Sales module's nav bar and all 8 existing pages to a brighter, more premium visual language (near-white background, white soft-shadow cards, bold black numbers, orange accent), and add a new Dashboard page with 10 clickable insight tiles that becomes the module's landing page.

**Architecture:** No new tables, no new RPCs, no functional behavior changes — every existing query, dialog, and RPC call stays exactly as-is. This is (1) a visual re-skin applied via Tailwind class changes to 9 existing files, and (2) one new read-only aggregation page (`DashboardPage.tsx`) following the exact `Promise.all` + loading/error-state pattern already established by `StockReportPage.tsx`/`PurchaseReportPage.tsx`.

**Tech Stack:** React + TypeScript + Vite, shadcn/ui (the existing `Badge` component, restyled via its `className` override — its base class already includes `rounded-full`, so no new pill component is needed), Supabase (direct `.select()` calls, no RPCs).

## Global Constraints

- Design doc: `docs/superpowers/specs/2026-08-06-sales-module-visual-refresh-design.md` — read for full visual rationale; this plan's Global Constraints section below is the authoritative, exact-values version of that doc's Color Values section.
- Color tokens (standard Tailwind palette, no custom hex — matches this codebase's existing convention of using only standard Tailwind shade classes):
  - Page background: `bg-neutral-50`
  - Card: `bg-white rounded-xl border border-neutral-200 shadow-sm` (adds `shadow-sm` and `border-neutral-200` to every existing `bg-white rounded-xl border` card across the module — this exact 4-class combination is the one new "card" convention, used everywhere)
  - Numbers: default to `text-gray-900` (bold black), NOT colored, except where color is semantic (see badge table below)
  - Orange brand accent: `orange-50`/`orange-600` (e.g. `bg-orange-50 text-orange-600`) — used for the nav's active tab and the Dashboard's primary accents only, never for status semantics
  - Emphasis (dark) card: `bg-gray-900 text-white` — used once, for the Dashboard's Out of Stock tile only
- Badge recolor table (every status badge in the module moves from the shadcn `Badge` component's saturated `variant="destructive"/"default"/"outline"` look to a soft-pill `className` override — the `Badge` component itself is unchanged, `rounded-full` is already its base class):

  | Meaning | Old | New `className` |
  |---|---|---|
  | Danger / Out of stock / Cancelled | `variant="destructive"` | `bg-red-50 text-red-600 border-red-100` |
  | Warning / Low stock / Pending PO statuses | `bg-amber-100 text-amber-700` or `variant="outline"` used for this meaning | `bg-amber-50 text-amber-600 border-amber-100` |
  | Success / Active / Received / Paid | `variant="default"` or `bg-emerald-100 text-emerald-700` | `bg-emerald-50 text-emerald-600 border-emerald-100` |
  | Neutral / Inactive / Void / type-tag | `variant="outline"` or `bg-gray-200 text-gray-600` | `bg-neutral-100 text-neutral-500 border-neutral-200` |

  This table is the single source of truth every task below references — do not invent new colors per-file.
- No test framework — verify via `npx tsc --noEmit` + `npm run build` (visual correctness needs the user's own browser click-through, no CRM login in this dev environment).
- Do not touch: any RPC, any Supabase query's selected columns/filters/logic (only className/JSX structure changes), any dialog component, any button's function (only its color classes, where explicitly listed).

---

### Task 1: Nav restyle + routing + new Dashboard page

**Files:**
- Modify: `src/components/sales/SalesLayout.tsx` (full rewrite — small file, shown in full below)
- Modify: `src/App.tsx` (add Dashboard import, add `/sales/dashboard` route, change `/sales` redirect target)
- Create: `src/pages/Sales/DashboardPage.tsx`

**Interfaces:**
- Produces: the final nav bar visual pattern (light bg, orange active pill) and card visual pattern (`bg-white rounded-xl border border-neutral-200 shadow-sm`) that Tasks 2 and 3 replicate on every other page — get this task's visual language exactly right, since it's the reference the other two tasks copy.
- Consumes: `products`, `inventory_purchase_orders`, `inventory_po_items`, `inventory_suppliers`, `inventory_item_issues`, `inventory_stock_adds`, `inventory_stock_adjustments`, `invoices` — all read-only, all through their existing RLS SELECT policies (same tables every other Sales page already reads).

- [ ] **Step 1: Rewrite `SalesLayout.tsx`**

Replace the entire file with:

```tsx
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { LogOut, ArrowLeft, LayoutDashboard, Package, FileText, Truck, ClipboardList, PackageMinus, ArrowUpDown } from 'lucide-react';

const SalesLayout = ({ children }: { children: React.ReactNode }) => {
  const { profile, signOut } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  const nav = [
    { label: 'Dashboard', href: '/sales/dashboard', icon: LayoutDashboard },
    { label: 'Products', href: '/sales/products', icon: Package },
    { label: 'Invoices', href: '/sales/invoices', icon: FileText },
    { label: 'Suppliers', href: '/sales/suppliers', icon: Truck },
    { label: 'Purchase Orders', href: '/sales/purchase-orders', icon: ClipboardList },
    { label: 'Stock Movements', href: '/sales/stock-movements', icon: ArrowUpDown },
    { label: 'Item Issue', href: '/sales/item-issue', icon: PackageMinus },
    { label: 'Stock Report', href: '/sales/stock-report', icon: FileText },
    { label: 'Purchase Report', href: '/sales/purchase-report', icon: FileText },
  ];

  return (
    <div className="min-h-screen bg-neutral-50 flex flex-col">
      <nav className="bg-white text-neutral-900 shadow-sm border-b border-neutral-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-14">
            <div className="flex items-center gap-6">
              <button
                onClick={() => navigate('/module-select')}
                className="flex items-center gap-1.5 text-neutral-500 hover:text-neutral-900 text-sm transition-colors"
              >
                <ArrowLeft className="h-4 w-4" />
                Back
              </button>
              <div className="h-5 w-px bg-neutral-200" />
              <span className="font-semibold text-sm tracking-wide text-neutral-900">Sales</span>
              <div className="flex items-center gap-1 overflow-x-auto">
                {nav.map(({ label, href, icon: Icon }) => (
                  <Link
                    key={href}
                    to={href}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors whitespace-nowrap ${
                      location.pathname === href
                        ? 'bg-orange-50 text-orange-600'
                        : 'text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900'
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {label}
                  </Link>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-neutral-500 text-sm">{profile?.username}</span>
              <Button
                variant="ghost"
                size="sm"
                onClick={signOut}
                className="text-neutral-500 hover:text-neutral-900 hover:bg-neutral-100 h-8 w-8 p-0"
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

export default SalesLayout;
```

(Note: `Stock Report` and `Purchase Report` reuse the `FileText` icon since no more distinct icons remain unused in this nav — this is a cosmetic nav-icon choice, not a functional change.)

- [ ] **Step 2: Wire routing in `App.tsx`**

Add the import (alongside the existing Sales page imports, e.g. after the `PurchaseReportPage` import line):

```tsx
import DashboardPage from "./pages/Sales/DashboardPage";
```

Change the existing `/sales` redirect line from:

```tsx
<Route path="/sales" element={<ProtectedRoute><Navigate to="/sales/invoices" replace /></ProtectedRoute>} />
```

to:

```tsx
<Route path="/sales" element={<ProtectedRoute><Navigate to="/sales/dashboard" replace /></ProtectedRoute>} />
```

Add a new route immediately after it (before `/sales/products`):

```tsx
<Route path="/sales/dashboard" element={<ProtectedRoute><DashboardPage /></ProtectedRoute>} />
```

- [ ] **Step 3: Create `DashboardPage.tsx`**

```tsx
import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import SalesLayout from '@/components/sales/SalesLayout';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

type Product = {
  id: string;
  name: string;
  stock_quantity: number;
  minimum_stock_level: number;
  unit_price: number;
};

type ActivityEvent = {
  key: string;
  label: string;
  timestamp: string;
  href: string;
};

const PENDING_PO_STATUSES = ['draft', 'ordered', 'partially_received'];

const isOutOfStock = (p: Pick<Product, 'stock_quantity'>) => p.stock_quantity <= 0;
const isLowStock = (p: Pick<Product, 'stock_quantity' | 'minimum_stock_level'>) =>
  !isOutOfStock(p) && p.stock_quantity < p.minimum_stock_level;

const money = (n: number) => `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function DashboardPage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const [products, setProducts] = useState<Product[]>([]);
  const [pendingPoCount, setPendingPoCount] = useState(0);
  const [openOrderValue, setOpenOrderValue] = useState(0);
  const [activeSupplierCount, setActiveSupplierCount] = useState(0);
  const [itemsIssuedThisMonth, setItemsIssuedThisMonth] = useState(0);
  const [stockMovementsThisMonth, setStockMovementsThisMonth] = useState(0);
  const [invoiceRevenueThisMonth, setInvoiceRevenueThisMonth] = useState(0);
  const [recentActivity, setRecentActivity] = useState<ActivityEvent[]>([]);

  const load = async () => {
    setLoading(true);
    setError(false);

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthStartDate = monthStart.toISOString().slice(0, 10);
    const monthStartIso = monthStart.toISOString();

    const [
      productsRes,
      poRes,
      poItemsRes,
      suppliersRes,
      issuesRes,
      addsRes,
      adjustmentsRes,
      invoicesRes,
    ] = await Promise.all([
      supabase.from('products' as any)
        .select('id, name, stock_quantity, minimum_stock_level, unit_price')
        .eq('is_active', true),
      supabase.from('inventory_purchase_orders' as any)
        .select('id')
        .in('status', PENDING_PO_STATUSES),
      supabase.from('inventory_po_items' as any)
        .select('purchase_order_id, quantity_ordered, unit_cost'),
      supabase.from('inventory_suppliers' as any)
        .select('id')
        .eq('is_active', true),
      supabase.from('inventory_item_issues' as any)
        .select('id, quantity, issued_to_type, issue_date, created_at, products(name)')
        .gte('issue_date', monthStartDate),
      supabase.from('inventory_stock_adds' as any)
        .select('id, quantity, added_date, created_at, products(name)')
        .gte('added_date', monthStartDate),
      supabase.from('inventory_stock_adjustments' as any)
        .select('id, quantity_delta, adjusted_date, created_at, products(name)')
        .gte('adjusted_date', monthStartDate),
      supabase.from('invoices' as any)
        .select('grand_total, status, created_at')
        .gte('created_at', monthStartIso),
    ]);

    const firstError = productsRes.error || poRes.error || poItemsRes.error || suppliersRes.error
      || issuesRes.error || addsRes.error || adjustmentsRes.error || invoicesRes.error;
    if (firstError) {
      setError(true);
      toast({ title: 'Error loading dashboard', description: firstError.message, variant: 'destructive' });
      setLoading(false);
      return;
    }

    const productRows = (productsRes.data || []) as unknown as Product[];
    setProducts(productRows);

    const pendingPoIds = new Set(((poRes.data || []) as unknown as { id: string }[]).map(po => po.id));
    setPendingPoCount(pendingPoIds.size);

    const poItems = (poItemsRes.data || []) as unknown as { purchase_order_id: string; quantity_ordered: number; unit_cost: number }[];
    setOpenOrderValue(
      poItems.filter(item => pendingPoIds.has(item.purchase_order_id))
        .reduce((sum, item) => sum + item.quantity_ordered * item.unit_cost, 0)
    );

    setActiveSupplierCount((suppliersRes.data || []).length);

    const issues = (issuesRes.data || []) as unknown as {
      id: string; quantity: number; issued_to_type: string; issue_date: string; created_at: string; products: { name: string } | null;
    }[];
    setItemsIssuedThisMonth(issues.reduce((sum, i) => sum + i.quantity, 0));

    const adds = (addsRes.data || []) as unknown as {
      id: string; quantity: number; added_date: string; created_at: string; products: { name: string } | null;
    }[];
    const adjustments = (adjustmentsRes.data || []) as unknown as {
      id: string; quantity_delta: number; adjusted_date: string; created_at: string; products: { name: string } | null;
    }[];
    setStockMovementsThisMonth(adds.length + adjustments.length);

    const invoiceRows = (invoicesRes.data || []) as unknown as { grand_total: number; status: string }[];
    setInvoiceRevenueThisMonth(
      invoiceRows.filter(inv => inv.status !== 'void').reduce((sum, inv) => sum + inv.grand_total, 0)
    );

    const events: ActivityEvent[] = [
      ...adds.map(a => ({
        key: `add-${a.id}`,
        label: `Stock added — ${a.products?.name ?? 'Unknown product'} (+${a.quantity})`,
        timestamp: a.created_at,
        href: '/sales/stock-movements',
      })),
      ...adjustments.map(a => ({
        key: `adj-${a.id}`,
        label: `Stock adjusted — ${a.products?.name ?? 'Unknown product'} (${a.quantity_delta > 0 ? '+' : ''}${a.quantity_delta})`,
        timestamp: a.created_at,
        href: '/sales/stock-movements',
      })),
      ...issues.map(i => ({
        key: `issue-${i.id}`,
        label: `Item issued — ${i.quantity} × ${i.products?.name ?? 'Unknown product'} to ${i.issued_to_type}`,
        timestamp: i.created_at,
        href: '/sales/item-issue',
      })),
    ].sort((a, b) => b.timestamp.localeCompare(a.timestamp)).slice(0, 5);
    setRecentActivity(events);

    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const outOfStockCount = useMemo(() => products.filter(isOutOfStock).length, [products]);
  const lowStockCount = useMemo(() => products.filter(isLowStock).length, [products]);
  const stockValue = useMemo(
    () => products.reduce((sum, p) => sum + Math.max(p.stock_quantity, 0) * p.unit_price, 0),
    [products]
  );
  const healthyPercent = useMemo(() => {
    if (products.length === 0) return 0;
    const healthy = products.filter(p => p.stock_quantity >= p.minimum_stock_level).length;
    return Math.round((healthy / products.length) * 100);
  }, [products]);
  const needsAttention = useMemo(() => {
    const rank = (p: Product) => (isOutOfStock(p) ? 0 : isLowStock(p) ? 1 : 2);
    return products
      .filter(p => isOutOfStock(p) || isLowStock(p))
      .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))
      .slice(0, 5);
  }, [products]);

  const tile = (
    label: string, value: string, href: string,
    opts?: { emphasis?: boolean }
  ) => (
    <button
      onClick={() => navigate(href)}
      className={`text-left rounded-xl border shadow-sm p-4 transition-colors ${
        opts?.emphasis
          ? 'bg-gray-900 border-gray-900 hover:bg-gray-800'
          : 'bg-white border-neutral-200 hover:bg-neutral-50'
      }`}
    >
      <div className={`text-xs ${opts?.emphasis ? 'text-neutral-400' : 'text-muted-foreground'}`}>{label}</div>
      <div className={`text-2xl font-bold mt-1 ${opts?.emphasis ? 'text-white' : 'text-gray-900'}`}>
        {loading || error ? '—' : value}
      </div>
    </button>
  );

  return (
    <SalesLayout>
      <div className="max-w-6xl mx-auto px-4 py-8">
        <div className="bg-gradient-to-br from-orange-50 to-neutral-50 rounded-2xl px-6 py-5 mb-6 border border-orange-100">
          <h1 className="text-xl font-bold text-gray-900">Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-1">Overview of your catalog, procurement, and stock activity.</p>
        </div>

        <div className="text-xs font-bold text-orange-600 uppercase tracking-wide mb-2">Catalog &amp; Stock</div>
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 mb-6">
          {tile('Active Products', String(products.length), '/sales/products')}
          {tile('Out of Stock', String(outOfStockCount), '/sales/stock-report', { emphasis: true })}
          {tile('Low Stock', String(lowStockCount), '/sales/stock-report')}
          {tile('Stock Value', money(stockValue), '/sales/stock-report')}
        </div>

        <div className="text-xs font-bold text-orange-600 uppercase tracking-wide mb-2">Procurement</div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
          {tile('Pending POs', String(pendingPoCount), '/sales/purchase-orders')}
          {tile('Open Order Value', money(openOrderValue), '/sales/purchase-report')}
          {tile('Active Suppliers', String(activeSupplierCount), '/sales/suppliers')}
        </div>

        <div className="text-xs font-bold text-orange-600 uppercase tracking-wide mb-2">Activity (this month)</div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
          {tile('Items Issued', String(itemsIssuedThisMonth), '/sales/item-issue')}
          {tile('Stock Movements', String(stockMovementsThisMonth), '/sales/stock-movements')}
          {tile('Invoice Revenue', money(invoiceRevenueThisMonth), '/sales/invoices')}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="bg-white rounded-xl border border-neutral-200 shadow-sm p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="text-sm font-bold text-gray-900">Needs Attention</div>
              <button onClick={() => navigate('/sales/stock-report')} className="text-xs text-orange-600 hover:underline">
                View full report →
              </button>
            </div>
            {loading ? (
              <div className="text-sm text-muted-foreground py-4 text-center">Loading…</div>
            ) : needsAttention.length === 0 ? (
              <div className="text-sm text-muted-foreground py-4 text-center">Nothing needs attention.</div>
            ) : (
              needsAttention.map(p => (
                <button
                  key={p.id}
                  onClick={() => navigate('/sales/stock-report')}
                  className="w-full text-left flex items-center justify-between py-2 border-b border-neutral-100 last:border-0 text-sm"
                >
                  <span className="text-gray-700">{p.name}</span>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                    isOutOfStock(p) ? 'bg-red-50 text-red-600' : 'bg-amber-50 text-amber-600'
                  }`}>
                    {isOutOfStock(p) ? 'Out of stock' : `Low (${p.stock_quantity})`}
                  </span>
                </button>
              ))
            )}
          </div>

          <div className="bg-white rounded-xl border border-neutral-200 shadow-sm p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="text-sm font-bold text-gray-900">Recent Activity</div>
              <button onClick={() => navigate('/sales/stock-movements')} className="text-xs text-orange-600 hover:underline">
                View all →
              </button>
            </div>
            {loading ? (
              <div className="text-sm text-muted-foreground py-4 text-center">Loading…</div>
            ) : recentActivity.length === 0 ? (
              <div className="text-sm text-muted-foreground py-4 text-center">No activity this month yet.</div>
            ) : (
              recentActivity.map(e => (
                <button
                  key={e.key}
                  onClick={() => navigate(e.href)}
                  className="w-full text-left py-2 border-b border-neutral-100 last:border-0 text-sm text-gray-700"
                >
                  {e.label}
                </button>
              ))
            )}
          </div>

          <div className="bg-white rounded-xl border border-neutral-200 shadow-sm p-4 flex flex-col items-center justify-center">
            <div className="text-sm font-bold text-gray-900 self-start mb-1">Stock Health</div>
            <svg width="140" height="84" viewBox="0 0 140 84" className="mt-2">
              <path d="M14,80 A56,56 0 0,1 126,80" fill="none" stroke="#f3e3d6" strokeWidth="13" />
              <path
                d="M14,80 A56,56 0 0,1 126,80"
                fill="none"
                stroke="#ea580c"
                strokeWidth="13"
                strokeLinecap="round"
                strokeDasharray={`${(healthyPercent / 100) * 176} 176`}
              />
            </svg>
            <div className="text-2xl font-bold text-gray-900 -mt-2">{loading || error ? '—' : `${healthyPercent}%`}</div>
            <div className="text-[10px] text-muted-foreground">products in healthy stock</div>
          </div>
        </div>
      </div>
    </SalesLayout>
  );
}
```

- [ ] **Step 4: Typecheck + build**

```bash
npx tsc --noEmit
npm run build
```

- [ ] **Step 5: Smoke test**

```bash
supabase db query --linked "SELECT count(*) FILTER (WHERE stock_quantity<=0) AS out_of_stock, count(*) FILTER (WHERE stock_quantity>0 AND stock_quantity<minimum_stock_level) AS low_stock, sum(GREATEST(stock_quantity,0)*unit_price) AS stock_value, round(100.0*count(*) FILTER (WHERE stock_quantity>=minimum_stock_level)/count(*)) AS healthy_pct FROM products WHERE is_active=true;"
supabase db query --linked "SELECT count(*) AS pending_pos FROM inventory_purchase_orders WHERE status IN ('draft','ordered','partially_received');"
supabase db query --linked "SELECT count(*) AS active_suppliers FROM inventory_suppliers WHERE is_active=true;"
```

Confirm these match the Dashboard's tiles and gauge (ask the user to click through — no CRM login available in this environment).

- [ ] **Step 6: Commit**

```bash
git add src/components/sales/SalesLayout.tsx src/App.tsx src/pages/Sales/DashboardPage.tsx
git commit -m "Add Sales Dashboard page + restyled nav (orange accent, near-white bg)"
```

---

### Task 2: Restyle Products, Invoices, Suppliers, Purchase Orders, Purchase Order Detail

**Files:**
- Modify: `src/pages/Sales/ProductsPage.tsx`
- Modify: `src/pages/Sales/InvoicesPage.tsx`
- Modify: `src/pages/Sales/SuppliersPage.tsx`
- Modify: `src/pages/Sales/PurchaseOrdersPage.tsx`
- Modify: `src/pages/Sales/PurchaseOrderDetail.tsx`

**Interfaces:**
- Consumes: the badge recolor table and card convention from Global Constraints (established concretely by Task 1's `SalesLayout.tsx`/`DashboardPage.tsx` — read those files after Task 1 lands to see the pattern in a real file, not just the table).
- Produces: nothing consumed by Task 3 (fully independent files, no shared state).

Every change in this task is a className swap on existing JSX — no logic, query, or structural changes. Apply exactly these replacements (use exact-string find/replace; each string below is unique within its file except where "replace all" is noted):

- [ ] **Step 1: `ProductsPage.tsx`**

Replace:
```tsx
<div className="bg-white rounded-xl border overflow-hidden">
```
with:
```tsx
<div className="bg-white rounded-xl border border-neutral-200 shadow-sm overflow-hidden">
```

Replace:
```tsx
<Badge variant="destructive" className="ml-2 text-[10px]">Out of stock</Badge>
```
with:
```tsx
<Badge className="ml-2 text-[10px] bg-red-50 text-red-600 border-red-100">Out of stock</Badge>
```

Replace:
```tsx
<Badge variant="destructive" className="ml-2 text-[10px]">Low stock</Badge>
```
with:
```tsx
<Badge className="ml-2 text-[10px] bg-amber-50 text-amber-600 border-amber-100">Low stock</Badge>
```

Replace:
```tsx
<Badge variant={p.is_active ? 'default' : 'outline'}>{p.is_active ? 'Active' : 'Inactive'}</Badge>
```
with:
```tsx
<Badge className={p.is_active ? 'bg-emerald-50 text-emerald-600 border-emerald-100' : 'bg-neutral-100 text-neutral-500 border-neutral-200'}>{p.is_active ? 'Active' : 'Inactive'}</Badge>
```

- [ ] **Step 2: `InvoicesPage.tsx`**

Replace:
```tsx
<div className="bg-white rounded-xl border overflow-hidden">
```
with:
```tsx
<div className="bg-white rounded-xl border border-neutral-200 shadow-sm overflow-hidden">
```

Replace the whole `statusBadge` function body:
```tsx
  const statusBadge = (s: string) => {
    if (s === 'paid') return <Badge className="bg-emerald-100 text-emerald-700">Paid</Badge>;
    if (s === 'void') return <Badge className="bg-gray-200 text-gray-600">Void</Badge>;
    return <Badge className="bg-amber-100 text-amber-700">Unpaid</Badge>;
  };
```
with:
```tsx
  const statusBadge = (s: string) => {
    if (s === 'paid') return <Badge className="bg-emerald-50 text-emerald-600 border-emerald-100">Paid</Badge>;
    if (s === 'void') return <Badge className="bg-neutral-100 text-neutral-500 border-neutral-200">Void</Badge>;
    return <Badge className="bg-amber-50 text-amber-600 border-amber-100">Unpaid</Badge>;
  };
```

- [ ] **Step 3: `SuppliersPage.tsx`**

Replace:
```tsx
<div className="bg-white rounded-xl border overflow-hidden">
```
with:
```tsx
<div className="bg-white rounded-xl border border-neutral-200 shadow-sm overflow-hidden">
```

Replace:
```tsx
<Badge variant={s.is_active ? 'default' : 'outline'}>{s.is_active ? 'Active' : 'Inactive'}</Badge>
```
with:
```tsx
<Badge className={s.is_active ? 'bg-emerald-50 text-emerald-600 border-emerald-100' : 'bg-neutral-100 text-neutral-500 border-neutral-200'}>{s.is_active ? 'Active' : 'Inactive'}</Badge>
```

- [ ] **Step 4: `PurchaseOrdersPage.tsx`**

Replace:
```tsx
<div className="bg-white rounded-xl border overflow-hidden">
```
with:
```tsx
<div className="bg-white rounded-xl border border-neutral-200 shadow-sm overflow-hidden">
```

Replace the whole `statusBadge` function body:
```tsx
  const statusBadge = (s: PoStatus) => {
    if (s === 'cancelled') return <Badge variant="destructive">{STATUS_LABELS[s]}</Badge>;
    if (s === 'received') return <Badge variant="default">{STATUS_LABELS[s]}</Badge>;
    return <Badge variant="outline">{STATUS_LABELS[s]}</Badge>;
  };
```
with:
```tsx
  const statusBadge = (s: PoStatus) => {
    if (s === 'cancelled') return <Badge className="bg-red-50 text-red-600 border-red-100">{STATUS_LABELS[s]}</Badge>;
    if (s === 'received') return <Badge className="bg-emerald-50 text-emerald-600 border-emerald-100">{STATUS_LABELS[s]}</Badge>;
    return <Badge className="bg-amber-50 text-amber-600 border-amber-100">{STATUS_LABELS[s]}</Badge>;
  };
```

- [ ] **Step 5: `PurchaseOrderDetail.tsx`**

This file has the same `bg-white rounded-xl border overflow-hidden` and duplicated `statusBadge` pattern as `PurchaseOrdersPage.tsx` (confirmed identical during Phase 6's whole-branch review). Apply the exact same two replacements as Step 4 to this file — find the matching strings (`bg-white rounded-xl border overflow-hidden` and the `statusBadge` function body with `if (s === 'cancelled') return <Badge variant="destructive">...`) and replace with the same new versions shown in Step 4.

- [ ] **Step 6: Typecheck + build**

```bash
npx tsc --noEmit
npm run build
```

- [ ] **Step 7: Commit**

```bash
git add src/pages/Sales/ProductsPage.tsx src/pages/Sales/InvoicesPage.tsx src/pages/Sales/SuppliersPage.tsx src/pages/Sales/PurchaseOrdersPage.tsx src/pages/Sales/PurchaseOrderDetail.tsx
git commit -m "Restyle Products/Invoices/Suppliers/Purchase Orders to new visual language"
```

---

### Task 3: Restyle Stock Movements, Item Issue, Stock Report, Purchase Report

**Files:**
- Modify: `src/pages/Sales/StockMovementsPage.tsx`
- Modify: `src/pages/Sales/ItemIssuePage.tsx`
- Modify: `src/pages/Sales/StockReportPage.tsx`
- Modify: `src/pages/Sales/PurchaseReportPage.tsx`

**Interfaces:**
- Consumes: same badge recolor table and card convention as Task 2 (fully independent of Task 2's files — no shared state, no ordering dependency between Task 2 and Task 3, only both depend on Task 1 being done first).
- Produces: nothing (final task of this plan).

- [ ] **Step 1: `StockMovementsPage.tsx`**

Replace (this exact string appears twice in the file — once for the Stock Adds table, once for the Adjustments table; replace **both** occurrences with the same new string):
```tsx
<div className="bg-white rounded-xl border overflow-hidden mt-4">
```
with:
```tsx
<div className="bg-white rounded-xl border border-neutral-200 shadow-sm overflow-hidden mt-4">
```

Replace:
```tsx
                          <Badge variant={a.quantity_delta > 0 ? 'default' : 'destructive'}>
```
with:
```tsx
                          <Badge className={a.quantity_delta > 0 ? 'bg-emerald-50 text-emerald-600 border-emerald-100' : 'bg-red-50 text-red-600 border-red-100'}>
```

If this file also has any `bg-white rounded-xl border p-5` summary-card divs (check for them — earlier phases of this module sometimes added summary cards, sometimes didn't), apply the same treatment: append `border-neutral-200 shadow-sm` so the string reads `bg-white rounded-xl border border-neutral-200 shadow-sm p-5`. If no such divs exist in this file, skip this — do not add new summary cards that weren't already there (out of scope for a re-theme task).

- [ ] **Step 2: `ItemIssuePage.tsx`**

Find every `bg-white rounded-xl border` occurrence in this file (there is at least one for the main table; Phase 6 added summary cards using `bg-white rounded-xl border p-5` for the 4 stat tiles — there will be multiple occurrences: one for the table container, ending in `overflow-hidden`, and up to 4 for the summary-card divs, ending in `p-5`). For each, insert `border-neutral-200 shadow-sm` after `border` so:
- `bg-white rounded-xl border overflow-hidden` → `bg-white rounded-xl border border-neutral-200 shadow-sm overflow-hidden`
- `bg-white rounded-xl border p-5` → `bg-white rounded-xl border border-neutral-200 shadow-sm p-5` (apply to all 4 summary-card divs)

Replace:
```tsx
<Badge variant="outline" className="mr-1.5 text-[10px]">{TYPE_LABELS[i.issued_to_type]}</Badge>
```
with:
```tsx
<Badge className="mr-1.5 text-[10px] bg-neutral-100 text-neutral-500 border-neutral-200">{TYPE_LABELS[i.issued_to_type]}</Badge>
```

- [ ] **Step 3: `StockReportPage.tsx`**

Find every `bg-white rounded-xl border` occurrence (the 3 summary cards using `bg-white rounded-xl border p-5`, plus the table container using `bg-white rounded-xl border overflow-hidden`). Apply the same `border-neutral-200 shadow-sm` insertion to all of them, same pattern as Step 2.

Replace:
```tsx
                        <Badge variant="destructive">Out of Stock</Badge>
```
with:
```tsx
                        <Badge className="bg-red-50 text-red-600 border-red-100">Out of Stock</Badge>
```

Replace:
```tsx
                        <Badge className="bg-amber-100 text-amber-700">Low Stock</Badge>
```
with:
```tsx
                        <Badge className="bg-amber-50 text-amber-600 border-amber-100">Low Stock</Badge>
```

Replace:
```tsx
                        <Badge variant="outline">OK</Badge>
```
with:
```tsx
                        <Badge className="bg-neutral-100 text-neutral-500 border-neutral-200">OK</Badge>
```

- [ ] **Step 4: `PurchaseReportPage.tsx`**

Find every `bg-white rounded-xl border` occurrence (the 4 summary cards using `bg-white rounded-xl border p-5`, plus the table container). Apply the same `border-neutral-200 shadow-sm` insertion to all of them.

Replace the whole `statusBadge` function body (identical to `PurchaseOrdersPage.tsx`/`PurchaseOrderDetail.tsx`, confirmed during Phase 6's whole-branch review):
```tsx
  const statusBadge = (s: PoStatus) => {
    if (s === 'cancelled') return <Badge variant="destructive">{STATUS_LABELS[s]}</Badge>;
    if (s === 'received') return <Badge variant="default">{STATUS_LABELS[s]}</Badge>;
    return <Badge variant="outline">{STATUS_LABELS[s]}</Badge>;
  };
```
with:
```tsx
  const statusBadge = (s: PoStatus) => {
    if (s === 'cancelled') return <Badge className="bg-red-50 text-red-600 border-red-100">{STATUS_LABELS[s]}</Badge>;
    if (s === 'received') return <Badge className="bg-emerald-50 text-emerald-600 border-emerald-100">{STATUS_LABELS[s]}</Badge>;
    return <Badge className="bg-amber-50 text-amber-600 border-amber-100">{STATUS_LABELS[s]}</Badge>;
  };
```

- [ ] **Step 5: Typecheck + build**

```bash
npx tsc --noEmit
npm run build
```

- [ ] **Step 6: Commit**

```bash
git add src/pages/Sales/StockMovementsPage.tsx src/pages/Sales/ItemIssuePage.tsx src/pages/Sales/StockReportPage.tsx src/pages/Sales/PurchaseReportPage.tsx
git commit -m "Restyle Stock Movements/Item Issue/Stock Report/Purchase Report to new visual language"
```

---

## Self-Review Notes

- **Spec coverage:** design doc's visual language (nav, cards, badges, page bg) applied across all 9 surfaces (Task 1's nav + Tasks 2/3's 8 pages); new Dashboard page with all 10 tiles, Needs Attention panel, Recent Activity panel, and Stock Health gauge built in Task 1; every tile/row is a real `<button onClick={() => navigate(...)}>`, satisfying the explicit clickable requirement.
- **Deliberate in-scope fix:** `ProductsPage.tsx` currently renders both "Out of stock" and "Low stock" with the same `variant="destructive"` (red) — a pre-existing inconsistency flagged during Phase 6's whole-branch review as a Minor finding. This plan fixes it (Task 2, Step 1) since the new badge table explicitly requires low-stock to read amber, not red — this is now in-scope rather than a separate deferred fix.
- **In-scope precision fix:** the Dashboard's "Invoice Revenue" tile excludes `status = 'void'` invoices from the sum — the design doc's formula didn't explicitly address void invoices; counting voided invoices as revenue would be a real correctness bug, not a stylistic ambiguity, so this plan makes the exclusion explicit.
- **No placeholders:** every className change is an exact string-to-string replacement; `DashboardPage.tsx` is given in full, not described.
- **Type consistency:** `DashboardPage.tsx`'s local types (`Product`, `ActivityEvent`) are self-contained to that one file — no cross-task type sharing needed, since Tasks 2/3 only change classNames, not types/props.
- **Ordering:** Task 1 must land before Tasks 2/3 (they read Task 1's finished files as the pattern reference), but Tasks 2 and 3 touch fully disjoint files with no shared state — they can run in either order, or even in parallel, once Task 1 is merged. Per subagent-driven-development's rule against parallel implementer dispatch, this plan still runs them sequentially within one SDD cycle by default.
