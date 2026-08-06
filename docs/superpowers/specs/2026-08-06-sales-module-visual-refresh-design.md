# Sales Module Visual Refresh + Dashboard — Design

## Goal

The Sales module (Products, Invoices, Suppliers, Purchase Orders, Stock Movements, Item Issue, Stock Report, Purchase Report — 8 pages, built across the earlier 6-phase inventory rebuild) currently looks flat and plain: a solid `bg-violet-700` nav bar, plain white cards, colored numbers as the only visual interest. Goghul wants a brighter, more premium look across the whole module, plus a new Dashboard page that gives an at-a-glance overview of the whole module with click-through navigation into every metric's detail page.

This was worked out interactively via the brainstorming visual companion — three rounds of mockups (initial style directions → orange/red palette exploration → a reference screenshot Goghul supplied of a premium analytics-dashboard aesthetic) converged on the direction below.

## Visual Language (applies everywhere in the Sales module)

This replaces the current look on all 8 existing pages and defines the new Dashboard's look. It is NOT a new design system for the whole CRM — scoped to the Sales module only (other modules — CRM, Prospect — keep their current look, e.g. Prospect's `bg-indigo-700` nav stays as-is).

- **Page background:** near-white (`bg-neutral-50` or equivalent very-light-gray — explicitly NOT a visibly gray tone; Goghul flagged this after seeing an early mockup that read as too gray).
- **Nav bar:** light/white background, NOT the current solid saturated color block. The active tab is a soft rounded pill: light-orange background, orange text (`bg-orange-50 text-orange-700` or nearest Tailwind equivalent to Goghul's swatch — see Color Values below). Inactive tabs are plain gray text. Top nav stays horizontal (matches every other module in this CRM — Goghul explicitly confirmed no switch to a sidebar, even though his reference image used one).
- **Cards:** white background, thin border (`border-neutral-200`ish), soft shadow (`shadow-sm`), `rounded-xl` corners — matches the existing report pages' card convention (`bg-white rounded-xl border p-5`), just adding the shadow and swapping any solid-color card backgrounds for white.
- **Numbers:** bold, near-black (`text-gray-900`), NOT colored by default. Color is reserved for cards/badges where it carries real meaning:
  - Red = out-of-stock / danger / cancelled (unchanged meaning from today)
  - Amber = low-stock / pending (unchanged meaning from today)
  - Green = received / success / healthy (unchanged meaning from today)
  - Orange = the module's brand accent (active nav tab, primary CTAs, the Dashboard's gauge chart, one or two "total value"-style metrics) — a NEW usage, distinct from the semantic red/amber/green above
- **Badges/status pills:** small, rounded-full, soft-background + colored-text style (e.g. `bg-red-50 text-red-600`) — replacing the current plain `Badge` component's more saturated look, applied consistently to every status indicator across all 8 pages (PO status, invoice status, out-of-stock/low-stock tags, etc.)
- **Emphasis card:** on the Dashboard specifically, the single most urgent tile (Out of Stock count) gets a dark/black-background card instead of white, to draw the eye — the one deliberate exception to "cards are white."

### Color values

Approximating Goghul's supplied orange swatch to the nearest standard Tailwind shade (this codebase uses standard Tailwind palette classes throughout — `violet-700`, `amber-600`, `red-600`, etc. — no custom hex tokens anywhere, so this refresh follows that same convention rather than introducing a bespoke color):

- Primary accent: `orange-600` (`#EA580C`) for text/icons, `orange-50` (`#FFF7ED`) for soft badge/pill backgrounds
- If `orange-600` doesn't read close enough to the swatch once it's live on screen, the implementer should compare directly and shift to `orange-500` or `orange-700` — this is a visual judgment call to make with eyes on the actual rendered page, not a spec ambiguity to resolve here.
- Page background: `neutral-50` (`#FAFAFA`)
- Card border: `neutral-200` (`#E5E5E5`)
- Emphasis (dark) card: `gray-900` (`#111827`) background, white text

## Scope: what gets re-themed

All 9 surfaces get the visual language above applied:

1. `src/components/sales/SalesLayout.tsx` — nav bar restyle (light bg, orange active-pill)
2. `src/pages/Sales/ProductsPage.tsx` — cards/badges restyle
3. `src/pages/Sales/InvoicesPage.tsx` — cards/badges restyle
4. `src/pages/Sales/SuppliersPage.tsx` — cards/badges restyle
5. `src/pages/Sales/PurchaseOrdersPage.tsx` + `PurchaseOrderDetail.tsx` — cards/badges restyle
6. `src/pages/Sales/StockMovementsPage.tsx` — cards/badges restyle
7. `src/pages/Sales/ItemIssuePage.tsx` — cards/badges restyle
8. `src/pages/Sales/StockReportPage.tsx` — cards/badges restyle
9. `src/pages/Sales/PurchaseReportPage.tsx` — cards/badges restyle

Plus one new page:

10. `src/pages/Sales/DashboardPage.tsx` (new) — becomes the Sales module's landing route (`/sales` redirects here instead of `/sales/products`; nav gets a new "Dashboard" first entry)

**Explicitly out of scope:** switching to a sidebar nav (Goghul confirmed top nav stays); changing any other CRM module's visual style; changing any page's functional behavior, data, or layout structure beyond what's needed to apply the new color/card language (this is a re-theme, not a rebuild — every existing table, filter, dialog, and RPC call stays exactly as-is).

## New Dashboard Page

Becomes `/sales`'s landing route. Read-only, pure aggregation over existing tables — no new tables, no new RPCs (same constraint every report page in this module has followed).

### Layout

**Header:** "Welcome back" greeting band with a soft orange-tinted gradient background (`from-orange-50 to-neutral-50`).

**Row 1 — Catalog & Stock (4 tiles):**
| Tile | Metric | Click target |
|---|---|---|
| Active Products | `count(*) WHERE is_active=true` from `products` | `/sales/products` |
| Out of Stock | `count(*) WHERE stock_quantity<=0 AND is_active=true` (dark emphasis card) | `/sales/stock-report` |
| Low Stock | `count(*) WHERE stock_quantity>0 AND stock_quantity<minimum_stock_level AND is_active=true` | `/sales/stock-report` |
| Stock Value | `Σ GREATEST(stock_quantity,0)*unit_price` — same formula as `StockReportPage.tsx` | `/sales/stock-report` |

**Row 2 — Procurement (3 tiles):**
| Tile | Metric | Click target |
|---|---|---|
| Pending POs | `count(*) WHERE status IN ('draft','ordered','partially_received')` from `inventory_purchase_orders` | `/sales/purchase-orders` |
| Open Order Value | `Σ quantity_ordered*unit_cost` for POs in pending statuses — same join pattern as `PurchaseReportPage.tsx` | `/sales/purchase-report` |
| Active Suppliers | `count(*) WHERE is_active=true` from `inventory_suppliers` | `/sales/suppliers` |

**Row 3 — Activity, this calendar month (3 tiles):**
| Tile | Metric | Click target |
|---|---|---|
| Items Issued | `Σ quantity WHERE issue_date >= date_trunc('month', now())` from `inventory_item_issues` | `/sales/item-issue` |
| Stock Movements | `count(*) WHERE added_date >= date_trunc('month', now())` from `inventory_stock_adds`, PLUS `count(*) WHERE adjusted_date >= date_trunc('month', now())` from `inventory_stock_adjustments` — the two counts summed into one tile number | `/sales/stock-movements` |
| Invoice Revenue | `Σ grand_total WHERE created_at >= date_trunc('month', now())` from `invoices` | `/sales/invoices` |

**Below the tiles — two panels side by side:**
- **"Needs Attention"** — top 5 out-of-stock/low-stock products by name, each row a link to `/sales/stock-report`; "View full report →" link in the panel header.
- **"Recent Activity"** — last 5 events merged from stock adds, stock adjustments, and item issues (each event: what happened, when, in plain text — "Stock added — {product} (+{qty})", "Item issued — {qty} to {type}"), each row linking to its source page; "View all →" link in the header.

**"Stock Health" gauge** (semi-circular donut, orange fill): `% = count(products WHERE stock_quantity >= minimum_stock_level AND is_active=true) / count(products WHERE is_active=true)`.

### Interaction

Every tile and every row in the two panels is a clickable button/link (the user's explicit requirement) — not just visually hoverable, actually navigates via `react-router`'s `Link`/`useNavigate` to the stated target route.

## Not in scope / explicitly deferred

- Sidebar navigation (Goghul's reference image used one; declined in favor of keeping the existing top-nav pattern consistent with the rest of the CRM)
- Any change to other CRM modules' visual style
- Any new backend functionality — this is UI/theme + one new read-only aggregation page, following the same "no new RPCs, read through existing RLS" pattern as Phase 6

## Verification approach

Same as every prior phase in this module: `npx tsc --noEmit` + `npm run build` clean, plus direct SQL smoke tests for the Dashboard's aggregation queries (compare against hand-run SQL). Visual correctness (does it actually look like the approved mockups) needs Goghul's own click-through in the browser — no CRM login available in this dev environment, per `[[feedback_no_crm_login_verify_via_cli]]`.

## Implementation approach note

This touches 9 files with a shared visual language plus 1 new page with real aggregation logic — larger than a single task, comparable in size to the earlier 6-phase inventory rebuild. The implementation plan should break this into a small number of phases (e.g., shared nav/theme foundation first, then the new Dashboard, then the remaining page-by-page restyles, done in a sensible batch order) rather than one giant task, following the same subagent-driven-development pattern used throughout this project.
