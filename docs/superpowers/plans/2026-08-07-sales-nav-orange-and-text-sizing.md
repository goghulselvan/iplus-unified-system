# Sales Nav Orange + Text Sizing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two corrections to the Sales module, per direct user feedback: (1) the nav bar should be a solid orange background, not the current white background with orange-only text accents; (2) the Sales module's text sizes (page titles and stat-card numbers) are smaller than the main CRM module's equivalent elements and should match.

**Architecture:** Two independent, mechanical className-only changes — no logic/query/structural changes anywhere. Task 1 touches only `SalesLayout.tsx` (nav bar). Task 2 touches the other 10 Sales page files (text size bumps only).

**Tech Stack:** React + TypeScript + Vite, Tailwind CSS.

## Global Constraints

- No test framework — verify via `npx tsc --noEmit` + `npm run build` (visual correctness needs the user's own browser click-through).
- Do not touch: any route, any Supabase query, any dialog, any button's function — every change in this plan is a className swap only.
- Reference for the nav bar's new structure: the main CRM navbar (`src/components/layout/Navbar.tsx`) uses `bg-primary text-primary-foreground` with active link `bg-primary-foreground text-primary` and inactive `hover:bg-primary/80` — same *structural* pattern (solid brand-color bar, white active-pill), just orange instead of CRM's blue `primary`. The Sales module's OWN pre-visual-refresh nav (`bg-violet-700` with `text-violet-200`/`bg-violet-500` accents) is the closer literal reference for the exact shade-pairing convention, since this module deliberately uses orange as its own brand color, distinct from CRM's blue.
- Reference for text sizing: CRM's page titles (`src/pages/Dashboard.tsx:76`, `src/pages/SchoolDetail.tsx:494`) use `text-3xl font-bold`; CRM's Dashboard hero-tile numbers (`src/pages/Dashboard.tsx:122,137,153`) use `text-3xl font-bold`. Sales currently uses `text-2xl` (page titles) and `text-xl` (Dashboard's own title) — bump all of these to `text-3xl` to match.

---

### Task 1: Nav bar — solid orange background

**Files:**
- Modify: `src/components/sales/SalesLayout.tsx`

**Interfaces:**
- Produces: nothing consumed elsewhere.
- Consumes: nothing new.

- [ ] **Step 1: Replace the nav bar's color scheme**

Replace:
```tsx
      <nav className="bg-white text-neutral-900 shadow-sm border-b border-neutral-200">
```
with:
```tsx
      <nav className="bg-orange-600 text-white shadow-lg">
```

Replace:
```tsx
                onClick={() => navigate('/module-select')}
                className="flex items-center gap-1.5 text-neutral-500 hover:text-neutral-900 text-sm transition-colors"
```
with:
```tsx
                onClick={() => navigate('/module-select')}
                className="flex items-center gap-1.5 text-orange-100 hover:text-white text-sm transition-colors"
```

Replace:
```tsx
              <div className="h-5 w-px bg-neutral-200" />
              <span className="font-semibold text-sm tracking-wide text-neutral-900">Sales</span>
```
with:
```tsx
              <div className="h-5 w-px bg-orange-400" />
              <span className="font-semibold text-sm tracking-wide text-white">Sales</span>
```

Replace the `linkClass` helper function body:
```tsx
  const linkClass = (active: boolean) =>
    `flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors whitespace-nowrap ${
      active
        ? 'bg-orange-50 text-orange-700'
        : 'text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900'
    }`;
```
with:
```tsx
  const linkClass = (active: boolean) =>
    `flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors whitespace-nowrap ${
      active
        ? 'bg-white text-orange-700'
        : 'text-orange-100 hover:bg-orange-700 hover:text-white'
    }`;
```

Replace:
```tsx
              <span className="text-neutral-500 text-sm">{profile?.username}</span>
              <Button
                variant="ghost"
                size="sm"
                onClick={signOut}
                className="text-neutral-500 hover:text-neutral-900 hover:bg-neutral-100 h-8 w-8 p-0"
              >
```
with:
```tsx
              <span className="text-orange-100 text-sm">{profile?.username}</span>
              <Button
                variant="ghost"
                size="sm"
                onClick={signOut}
                className="text-orange-100 hover:text-white hover:bg-orange-700 h-8 w-8 p-0"
              >
```

(The `<main className="flex-1">` and the outer `<div className="min-h-screen bg-neutral-50 flex flex-col">` are unchanged — only the `<nav>` itself and its direct contents change color. The page content below the nav stays on the near-white background from the visual refresh.)

- [ ] **Step 2: Typecheck + build**

```bash
npx tsc --noEmit
npm run build
```

- [ ] **Step 3: Commit**

```bash
git add src/components/sales/SalesLayout.tsx
git commit -m "Change Sales nav bar to solid orange background (was white with orange-text accents)"
```

---

### Task 2: Text sizing — page titles and stat-card numbers to match CRM

**Files:**
- Modify: `src/pages/Sales/DashboardPage.tsx`
- Modify: `src/pages/Sales/ProductsPage.tsx`
- Modify: `src/pages/Sales/InvoicesPage.tsx`
- Modify: `src/pages/Sales/SuppliersPage.tsx`
- Modify: `src/pages/Sales/PurchaseOrdersPage.tsx`
- Modify: `src/pages/Sales/PurchaseOrderDetail.tsx`
- Modify: `src/pages/Sales/StockMovementsPage.tsx`
- Modify: `src/pages/Sales/ItemIssuePage.tsx`
- Modify: `src/pages/Sales/StockReportPage.tsx`
- Modify: `src/pages/Sales/PurchaseReportPage.tsx`

**Interfaces:**
- Consumes: nothing from Task 1 (fully independent file set — `SalesLayout.tsx` isn't touched here).
- Produces: nothing consumed elsewhere.

Every change below is `text-2xl` → `text-3xl` (or, for Dashboard's own title, `text-xl` → `text-3xl`) on an existing className string — no other change. Where a page has multiple `text-2xl font-bold` occurrences (page title + stat-card numbers), replace ALL of them the same way — use `replace_all` semantics per file rather than only the first match.

- [ ] **Step 1: `DashboardPage.tsx`** — 3 sites

Replace:
```tsx
          <h1 className="text-xl font-bold text-gray-900">Dashboard</h1>
```
with:
```tsx
          <h1 className="text-3xl font-bold text-gray-900">Dashboard</h1>
```

Replace (this is inside the shared `tile()` helper — one change here affects all 10 dashboard tiles):
```tsx
      <div className={`text-2xl font-bold mt-1 ${opts?.emphasis ? 'text-white' : 'text-gray-900'}`}>
```
with:
```tsx
      <div className={`text-3xl font-bold mt-1 ${opts?.emphasis ? 'text-white' : 'text-gray-900'}`}>
```

Replace:
```tsx
            <div className="text-2xl font-bold text-gray-900 -mt-2">{loading || error ? '—' : `${healthyPercent}%`}</div>
```
with:
```tsx
            <div className="text-3xl font-bold text-gray-900 -mt-2">{loading || error ? '—' : `${healthyPercent}%`}</div>
```

- [ ] **Step 2: `ProductsPage.tsx`** — 1 site

Replace:
```tsx
          <h1 className="text-2xl font-bold">Products</h1>
```
with:
```tsx
          <h1 className="text-3xl font-bold">Products</h1>
```

- [ ] **Step 3: `InvoicesPage.tsx`** — 1 site

Replace:
```tsx
          <h1 className="text-2xl font-bold">Invoices</h1>
```
with:
```tsx
          <h1 className="text-3xl font-bold">Invoices</h1>
```

- [ ] **Step 4: `SuppliersPage.tsx`** — 1 site

Replace:
```tsx
          <h1 className="text-2xl font-bold">Suppliers</h1>
```
with:
```tsx
          <h1 className="text-3xl font-bold">Suppliers</h1>
```

- [ ] **Step 5: `PurchaseOrdersPage.tsx`** — 1 site

Replace:
```tsx
          <h1 className="text-2xl font-bold">Purchase Orders</h1>
```
with:
```tsx
          <h1 className="text-3xl font-bold">Purchase Orders</h1>
```

- [ ] **Step 6: `PurchaseOrderDetail.tsx`** — 1 site

Replace:
```tsx
            <h1 className="text-2xl font-bold">PO-{po.po_number}</h1>
```
with:
```tsx
            <h1 className="text-3xl font-bold">PO-{po.po_number}</h1>
```

- [ ] **Step 7: `StockMovementsPage.tsx`** — 1 site

Replace:
```tsx
          <h1 className="text-2xl font-bold">Stock Movements</h1>
```
with:
```tsx
          <h1 className="text-3xl font-bold">Stock Movements</h1>
```

- [ ] **Step 8: `ItemIssuePage.tsx`** — 5 sites (1 page title + 4 stat-card numbers)

Replace:
```tsx
          <h1 className="text-2xl font-bold">Item Issue</h1>
```
with:
```tsx
          <h1 className="text-3xl font-bold">Item Issue</h1>
```

Replace:
```tsx
            <div className="text-2xl font-bold text-gray-900 mt-1">{loading || error ? '—' : totalQuantity}</div>
```
with:
```tsx
            <div className="text-3xl font-bold text-gray-900 mt-1">{loading || error ? '—' : totalQuantity}</div>
```

Replace (this exact string appears 3 times — for Students, Staff, and Other quantity tiles; replace **all 3** occurrences):
```tsx
            <div className="text-2xl font-bold mt-1">{loading || error ? '—' : studentQuantity}</div>
```
with:
```tsx
            <div className="text-3xl font-bold mt-1">{loading || error ? '—' : studentQuantity}</div>
```
(Note: this specific line only matches the `studentQuantity` variable — the `staffQuantity` and `otherQuantity` lines are textually different strings, each needs its own replace. List them explicitly:)

Replace:
```tsx
            <div className="text-2xl font-bold mt-1">{loading || error ? '—' : staffQuantity}</div>
```
with:
```tsx
            <div className="text-3xl font-bold mt-1">{loading || error ? '—' : staffQuantity}</div>
```

Replace:
```tsx
            <div className="text-2xl font-bold mt-1">{loading || error ? '—' : otherQuantity}</div>
```
with:
```tsx
            <div className="text-3xl font-bold mt-1">{loading || error ? '—' : otherQuantity}</div>
```

- [ ] **Step 9: `StockReportPage.tsx`** — 4 sites (1 page title + 3 stat-card numbers)

Replace:
```tsx
          <h1 className="text-2xl font-bold">Stock Report</h1>
```
with:
```tsx
          <h1 className="text-3xl font-bold">Stock Report</h1>
```

Replace:
```tsx
            <div className="text-2xl font-bold text-red-600 mt-1">{loading || error ? '—' : outOfStockCount}</div>
```
with:
```tsx
            <div className="text-3xl font-bold text-red-600 mt-1">{loading || error ? '—' : outOfStockCount}</div>
```

Replace:
```tsx
            <div className="text-2xl font-bold text-amber-600 mt-1">{loading || error ? '—' : lowStockCount}</div>
```
with:
```tsx
            <div className="text-3xl font-bold text-amber-600 mt-1">{loading || error ? '—' : lowStockCount}</div>
```

Replace (the Total Stock Value card's number — check the file for its exact surrounding text, it's the third `text-2xl font-bold text-gray-900 mt-1` div in this file, distinguish it from other files by its money-formatted content):
```tsx
            <div className="text-2xl font-bold text-gray-900 mt-1">
```
with:
```tsx
            <div className="text-3xl font-bold text-gray-900 mt-1">
```

- [ ] **Step 10: `PurchaseReportPage.tsx`** — 5 sites (1 page title + 4 stat-card numbers)

Replace:
```tsx
          <h1 className="text-2xl font-bold">Purchase Report</h1>
```
with:
```tsx
          <h1 className="text-3xl font-bold">Purchase Report</h1>
```

Replace:
```tsx
            <div className="text-2xl font-bold mt-1">{loading || error ? '—' : totalPOs}</div>
```
with:
```tsx
            <div className="text-3xl font-bold mt-1">{loading || error ? '—' : totalPOs}</div>
```

Replace:
```tsx
            <div className="text-2xl font-bold text-gray-900 mt-1">
```
with:
```tsx
            <div className="text-3xl font-bold text-gray-900 mt-1">
```

Replace:
```tsx
            <div className="text-2xl font-bold text-emerald-600 mt-1">
```
with:
```tsx
            <div className="text-3xl font-bold text-emerald-600 mt-1">
```

Replace:
```tsx
            <div className="text-2xl font-bold text-amber-600 mt-1">{loading || error ? '—' : pendingCount}</div>
```
with:
```tsx
            <div className="text-3xl font-bold text-amber-600 mt-1">{loading || error ? '—' : pendingCount}</div>
```

- [ ] **Step 11: Typecheck + build**

```bash
npx tsc --noEmit
npm run build
```

- [ ] **Step 12: Verify no `text-2xl` remain on any page title or stat-card number in the Sales module**

```bash
grep -rn "text-2xl font-bold" src/pages/Sales/*.tsx
```

Expected: no output (every occurrence from the plan's scope has been bumped to `text-3xl`). If anything remains, it was missed — go back and fix it before committing.

- [ ] **Step 13: Commit**

```bash
git add src/pages/Sales/DashboardPage.tsx src/pages/Sales/ProductsPage.tsx src/pages/Sales/InvoicesPage.tsx src/pages/Sales/SuppliersPage.tsx src/pages/Sales/PurchaseOrdersPage.tsx src/pages/Sales/PurchaseOrderDetail.tsx src/pages/Sales/StockMovementsPage.tsx src/pages/Sales/ItemIssuePage.tsx src/pages/Sales/StockReportPage.tsx src/pages/Sales/PurchaseReportPage.tsx
git commit -m "Bump Sales module page titles and stat-card numbers from text-2xl/xl to text-3xl, matching CRM module's text sizing"
```

---

## Self-Review Notes

- **Spec coverage:** both user asks covered — Task 1 (nav orange) and Task 2 (text sizing, scope confirmed as "page titles AND stat-card numbers" via a direct question to the user before writing this plan).
- **No placeholders:** every replacement is an exact string; Step 9/10 flag the two cases (`StockReportPage.tsx`'s Total Stock Value card, `PurchaseReportPage.tsx`'s two `text-gray-900`/`text-emerald-600` cards) where the old string alone isn't uniquely distinguishing within the plan's prose — but each is still a complete, valid find/replace instruction since the string IS unique within its own file (verified via grep before writing this plan).
- **Verification step added:** Task 2 Step 12's grep sweep exists specifically to catch any missed occurrence before committing, given the volume of near-identical replacements (18 total sites across 10 files) — this is the main risk for this kind of mechanical task.
- **Independent tasks:** Task 1 and Task 2 touch completely disjoint files — no ordering dependency, could run in parallel, but per subagent-driven-development's default this plan runs them sequentially in one SDD cycle.
