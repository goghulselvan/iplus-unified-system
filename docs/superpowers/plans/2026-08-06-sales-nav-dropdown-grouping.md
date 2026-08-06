# Sales Nav Dropdown Grouping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorganize the Sales module's nav bar from 9 flat items into 6 (Dashboard/Products/Invoices standalone + Procurement/Inventory/Reports dropdowns), so it fits its viewport instead of overflowing.

**Architecture:** Single-file change to `src/components/sales/SalesLayout.tsx`, reusing the `DropdownMenu` components already in this codebase (`src/components/ui/dropdown-menu.tsx`) and already used for exactly this purpose by the main CRM navbar's "Communication" dropdown (`src/components/layout/Navbar.tsx:141-169`). No new components, no route changes, no changes to any of the 9 underlying pages.

**Tech Stack:** React + TypeScript + Vite, shadcn/ui `DropdownMenu` (Radix UI primitive underneath), react-router-dom.

## Global Constraints

- Design doc: `docs/superpowers/specs/2026-08-06-sales-nav-dropdown-grouping-design.md`.
- Final structure: `Dashboard`, `Products`, `Invoices` stay standalone links (unchanged from today). `Procurement` (Suppliers, Purchase Orders), `Inventory` (Stock Movements, Item Issue), `Reports` (Stock Report, Purchase Report) become dropdowns.
- Dropdown trigger active-state: highlight with the same `bg-orange-50 text-orange-700` treatment as a standalone active link whenever `location.pathname` matches ANY child route in that group — mirroring `Navbar.tsx:148`'s `communicationNavigation.some(item => location.pathname === item.href)` check.
- No test framework — verify via `npx tsc --noEmit` + `npm run build` (visual correctness needs the user's own browser click-through, no CRM login in this dev environment).
- Do not touch: any route in `App.tsx`, any of the 9 pages themselves, any RPC/query logic. This is a nav-structure/UI change only.

---

### Task 1: Reorganize SalesLayout.tsx nav into dropdown groups

**Files:**
- Modify: `src/components/sales/SalesLayout.tsx` (full rewrite — small file, shown in full below)

**Interfaces:**
- Produces: nothing consumed elsewhere (this is the only file in this plan).
- Consumes: `DropdownMenu`/`DropdownMenuTrigger`/`DropdownMenuContent`/`DropdownMenuItem` from `@/components/ui/dropdown-menu` (already exported, already used by `src/components/layout/Navbar.tsx`).

- [ ] **Step 1: Replace `SalesLayout.tsx` in full**

```tsx
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { LogOut, ArrowLeft, ChevronDown, LayoutDashboard, Package, FileText, Truck, ClipboardList, PackageMinus, ArrowUpDown, BarChart3, FileBarChart } from 'lucide-react';

const standaloneNav = [
  { label: 'Dashboard', href: '/sales/dashboard', icon: LayoutDashboard },
  { label: 'Products', href: '/sales/products', icon: Package },
  { label: 'Invoices', href: '/sales/invoices', icon: FileText },
];

const navGroups = [
  {
    label: 'Procurement',
    items: [
      { label: 'Suppliers', href: '/sales/suppliers', icon: Truck },
      { label: 'Purchase Orders', href: '/sales/purchase-orders', icon: ClipboardList },
    ],
  },
  {
    label: 'Inventory',
    items: [
      { label: 'Stock Movements', href: '/sales/stock-movements', icon: ArrowUpDown },
      { label: 'Item Issue', href: '/sales/item-issue', icon: PackageMinus },
    ],
  },
  {
    label: 'Reports',
    items: [
      { label: 'Stock Report', href: '/sales/stock-report', icon: BarChart3 },
      { label: 'Purchase Report', href: '/sales/purchase-report', icon: FileBarChart },
    ],
  },
];

const SalesLayout = ({ children }: { children: React.ReactNode }) => {
  const { profile, signOut } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  const linkClass = (active: boolean) =>
    `flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors whitespace-nowrap ${
      active
        ? 'bg-orange-50 text-orange-700'
        : 'text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900'
    }`;

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
                {standaloneNav.map(({ label, href, icon: Icon }) => (
                  <Link key={href} to={href} className={linkClass(location.pathname === href)}>
                    <Icon className="h-3.5 w-3.5" />
                    {label}
                  </Link>
                ))}
                {navGroups.map((group) => {
                  const isActive = group.items.some((item) => location.pathname === item.href);
                  return (
                    <DropdownMenu key={group.label}>
                      <DropdownMenuTrigger asChild>
                        <button className={linkClass(isActive)}>
                          {group.label}
                          <ChevronDown className="h-3 w-3" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start" className="w-48">
                        {group.items.map(({ label, href, icon: Icon }) => (
                          <DropdownMenuItem key={href} asChild>
                            <Link
                              to={href}
                              className={`flex items-center gap-2 w-full ${
                                location.pathname === href ? 'bg-accent text-accent-foreground' : ''
                              }`}
                            >
                              <Icon className="h-3.5 w-3.5" />
                              {label}
                            </Link>
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  );
                })}
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

- [ ] **Step 2: Typecheck + build**

```bash
npx tsc --noEmit
npm run build
```

- [ ] **Step 3: Commit**

```bash
git add src/components/sales/SalesLayout.tsx
git commit -m "Group Sales nav into dropdowns (Procurement/Inventory/Reports), keep Dashboard/Products/Invoices standalone"
```

---

## Self-Review Notes

- **Spec coverage:** design doc's final nav structure (3 standalone + 3 dropdowns, exact item groupings), active-state highlighting for both standalone links and dropdown triggers, and reuse of the existing `DropdownMenu` components/pattern are all covered in this single task.
- **No placeholders:** full file given, not described; every icon import matches an icon already used in the pre-existing `SalesLayout.tsx` (no new icons introduced beyond `ChevronDown`, which the design doc's UI Pattern section explicitly calls for, matching the main navbar's own dropdown trigger).
- **Type consistency:** N/A — single file, no cross-task interfaces.
- **Single task, not multiple:** per Task Right-Sizing, this is one cohesive, independently-testable deliverable (the whole nav either renders and navigates correctly, or it doesn't) — splitting it further would just fragment one file's edit across artificial boundaries.
