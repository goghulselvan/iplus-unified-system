# Sales Nav Dropdown Grouping — Design

## Goal

The Sales module nav bar (`src/components/sales/SalesLayout.tsx`) has grown to 9 flat items (Dashboard, Products, Invoices, Suppliers, Purchase Orders, Stock Movements, Item Issue, Stock Report, Purchase Report) — too wide to fit its viewport, rendering cramped/small. Group the less-frequently-visited pages into dropdown categories, keeping the most-used pages one click away.

## Final nav structure

6 top-level items:

| Item | Type | Children |
|---|---|---|
| Dashboard | standalone link | — |
| Products | standalone link | — |
| Invoices | standalone link | — |
| Procurement | dropdown | Suppliers, Purchase Orders |
| Inventory | dropdown | Stock Movements, Item Issue |
| Reports | dropdown | Stock Report, Purchase Report |

Dashboard/Products/Invoices are unchanged from today (same link, same active-state highlight). The 6 pages currently rendered as flat links (Suppliers, Purchase Orders, Stock Movements, Item Issue, Stock Report, Purchase Report) move into their 3 dropdowns; none of those pages, their routes, or their functionality change — this is nav-structure-only.

## UI pattern

Reuse the `DropdownMenu`/`DropdownMenuTrigger`/`DropdownMenuContent`/`DropdownMenuItem` components already in this codebase (`src/components/ui/dropdown-menu.tsx`) and already used for exactly this purpose elsewhere — the main CRM navbar's "Communication" dropdown (`src/components/layout/Navbar.tsx:141-162`). Match that established pattern:

- Trigger renders as a `Button variant="ghost"` styled to match the Sales nav's existing link styling (not the main navbar's indigo styling — Sales nav is now near-white/orange per the visual refresh), with a `ChevronDown` icon after the label.
- Trigger highlights with the same active-state treatment as a standalone nav link (`bg-orange-50 text-orange-700`) whenever `location.pathname` matches ANY of that dropdown's child routes — mirroring the main navbar's `communicationNavigation.some(item => location.pathname === item.href)` check.
- `DropdownMenuContent` items navigate via the same `Link`/`to` pattern as the rest of this nav (or `DropdownMenuItem asChild` wrapping a `Link`, matching the main navbar's pattern at `Navbar.tsx:162`).
- Each dropdown item keeps its current icon (`Truck`/`ClipboardList` for Procurement's children, `ArrowUpDown`/`PackageMinus` for Inventory's, `BarChart3`/`FileBarChart` for Reports') shown inline in the dropdown list.

## Not in scope

No change to any page's route, component, query, or functionality — this is a nav-structure/UI change only, identical in spirit to the visual refresh that immediately preceded it (pure presentation, zero behavior change to the 9 underlying pages).

## Verification

`npx tsc --noEmit` + `npm run build` clean; visual correctness needs the user's own browser click-through (no CRM login in this dev environment) — specifically confirming each dropdown opens, each item navigates correctly, and the active-state highlight fires correctly both for a dropdown's trigger (when on a child page) and for the standalone Dashboard/Products/Invoices links.
