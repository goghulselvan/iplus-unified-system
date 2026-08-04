# Inventory Module — Phase 1: Items & Categories Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the existing `products` table with categories, richer item attributes (SKU, unit, item type, per-item low-stock threshold, expiry, location, barcode, image), and the Ignite/Impact Series + Subject + Class taxonomy — then rebuild the Products page's add/edit dialog and add search/filter to it, all without touching the existing 48 rows' identity or breaking the live invoicing system.

**Architecture:** One migration adds `product_categories` (new table) and 11 new columns on `products`, then backfills series/subject/class_number for the 48 existing rows from their names (naming convention verified 48/48 consistent) and seeds one starting category. The Products page splits from one 211-line file into three: `ProductsPage.tsx` (orchestration + table), `ProductDialog.tsx` (add/edit form, extracted since it's growing to 15 fields), `ProductsFilterBar.tsx` (search + 7 filters).

**Tech Stack:** React + TypeScript + Vite, shadcn/ui components, Supabase (Postgres + supabase-js client, direct table calls not RPCs — matches this page's existing pattern), Supabase CLI (`db query --linked --file`) for migrations.

## Global Constraints

- Never use `supabase db push` in this repo — migration history has ordering gaps (per this repo's established practice). Apply migrations with `supabase db query --linked --file <path>` and register the version in `supabase_migrations.schema_migrations`.
- RLS on any new table: `is_crm_user()` — role-agnostic, matches every other table in this CRM except Invoices' manager restriction (not applicable here).
- No test framework exists in this repo (`package.json` has no `test` script, no `.test.`/`.spec.` files anywhere) — verification is `npx tsc --noEmit` + `npm run build` + direct SQL queries against the live DB, matching how every other change in this repo is verified.
- Follow existing file conventions exactly: `supabase.from('table' as any)` casting pattern, `useToast()` for feedback, shadcn `Select`/`Dialog`/`Table` components already imported in `ProductsPage.tsx`.

---

### Task 1: Migration — categories table, products columns, backfill

**Files:**
- Create: `supabase/migrations/20260805_inventory_phase1_categories_and_items.sql`

**Interfaces:**
- Produces: `public.product_categories(id uuid, name text, description text, is_active boolean)`; `public.products` gains `category_id uuid`, `sku text`, `item_type text` (`'consumable'|'saleable'`), `unit text`, `minimum_stock_level integer`, `expiry_date date`, `location text`, `barcode text`, `image_url text`, `series text`, `subject text`, `class_number integer`. All 48 existing rows get `series`/`subject`/`class_number`/`category_id` backfilled.

- [ ] **Step 1: Write the migration file**

```sql
-- Phase 1 of inventory module rebuild: categories + richer item attributes
-- + Ignite/Impact Series taxonomy, backfilled for the 48 existing products.

CREATE TABLE IF NOT EXISTS public.product_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  description text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.product_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "crm_users_read_product_categories" ON public.product_categories
  FOR SELECT USING (is_crm_user());
CREATE POLICY "crm_users_write_product_categories" ON public.product_categories
  FOR ALL USING (is_crm_user()) WITH CHECK (is_crm_user());

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS category_id uuid REFERENCES public.product_categories(id),
  ADD COLUMN IF NOT EXISTS sku text,
  ADD COLUMN IF NOT EXISTS item_type text NOT NULL DEFAULT 'saleable'
    CHECK (item_type IN ('consumable', 'saleable')),
  ADD COLUMN IF NOT EXISTS unit text NOT NULL DEFAULT 'pcs',
  ADD COLUMN IF NOT EXISTS minimum_stock_level integer NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS expiry_date date,
  ADD COLUMN IF NOT EXISTS location text,
  ADD COLUMN IF NOT EXISTS barcode text,
  ADD COLUMN IF NOT EXISTS image_url text,
  ADD COLUMN IF NOT EXISTS series text,
  ADD COLUMN IF NOT EXISTS subject text,
  ADD COLUMN IF NOT EXISTS class_number integer;

CREATE UNIQUE INDEX IF NOT EXISTS products_sku_unique
  ON public.products (sku) WHERE sku IS NOT NULL;

-- Backfill taxonomy for the 48 existing Olympiad products (naming convention
-- verified 48/48 consistent on 2026-08-04: "{Subject} - iPlus Olympiads -
-- Ignite Series - Class {N}" or "Class {N} Mock Test - iPlus Olympiads -
-- Impact Series").
UPDATE public.products SET
  series = CASE WHEN name ILIKE '%Mock Test%' THEN 'Impact Series' ELSE 'Ignite Series' END,
  subject = CASE
    WHEN name ILIKE 'English%' THEN 'English'
    WHEN name ILIKE 'Maths%' THEN 'Maths'
    WHEN name ILIKE 'Science%' THEN 'Science'
    WHEN name ILIKE 'GK & Social Science%' THEN 'GK & Social Science'
    WHEN name ILIKE 'Logical Reasoning%' THEN 'Logical Reasoning'
    ELSE NULL
  END,
  class_number = substring(name from 'Class (\d+)')::integer
WHERE series IS NULL;

-- Seed a starting category so the dropdown isn't empty on first load.
INSERT INTO public.product_categories (name, description)
VALUES ('Olympiad Books & Mock Tests', 'Ignite Series subject books and Impact Series mock tests')
ON CONFLICT (name) DO NOTHING;

UPDATE public.products
SET category_id = (SELECT id FROM public.product_categories WHERE name = 'Olympiad Books & Mock Tests')
WHERE category_id IS NULL;
```

- [ ] **Step 2: Apply the migration**

Run: `cd /Users/goghulselvan/Desktop/Claude-workspace/vg-iplus-crm-main && supabase db query --linked --file supabase/migrations/20260805_inventory_phase1_categories_and_items.sql`

Expected: no errors.

- [ ] **Step 3: Register the migration version**

Run:
```bash
supabase db query --linked "INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('20260805', 'inventory_phase1_categories_and_items');"
```

- [ ] **Step 4: Verify schema**

Run:
```bash
supabase db query --linked "SELECT column_name, data_type FROM information_schema.columns WHERE table_name='products' AND column_name IN ('category_id','sku','item_type','unit','minimum_stock_level','expiry_date','location','barcode','image_url','series','subject','class_number') ORDER BY column_name;"
```
Expected: all 12 columns listed.

- [ ] **Step 5: Verify backfill**

Run:
```bash
supabase db query --linked "SELECT series, subject, class_number, count(*) FROM products GROUP BY series, subject, class_number ORDER BY series, class_number, subject;"
```
Expected: 48 total rows across the groups — 40 rows split across 5 subjects × 8 classes (series='Ignite Series'), 8 rows with subject=NULL, class_number 1-8 (series='Impact Series'). No NULL series.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260805_inventory_phase1_categories_and_items.sql
git commit -m "Add inventory phase 1: product categories + item taxonomy columns, backfilled for existing 48 products"
```

---

### Task 2: Extract and rebuild the Add/Edit Product dialog

**Files:**
- Create: `src/pages/Sales/ProductDialog.tsx`
- Modify: `src/pages/Sales/ProductsPage.tsx` (remove inline dialog, import and render `ProductDialog`)

**Interfaces:**
- Consumes: nothing from Task 1 beyond the DB schema (queried directly).
- Produces: `ProductDialog` component with props `{ open, onOpenChange, editing, onSaved }`; internally fetches `product_categories` and distinct series/subject/class_number values on mount. `ProductsPage.tsx`'s `Product` type gains all 12 new fields so Task 3's filter bar can rely on it.

- [ ] **Step 1: Create `ProductDialog.tsx`**

```tsx
import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import type { Product } from './ProductsPage';

const GST_RATES = [0, 5, 12, 18, 28];
const ITEM_TYPES = [
  { value: 'saleable', label: 'Saleable' },
  { value: 'consumable', label: 'Consumable' },
];
const CUSTOM = '__custom__';

const emptyForm = {
  name: '', hsn_code: '', gst_rate: '18', unit_price: '', stock_quantity: '',
  category_id: '', sku: '', item_type: 'saleable', unit: 'pcs',
  minimum_stock_level: '5', expiry_date: '', location: '', barcode: '', image_url: '',
  series: '', subject: '', class_number: '',
};

type ProductCategory = { id: string; name: string };

// Reusable "pick existing value or type a custom one" select — used for
// Series, Subject, and Class, which are free-text columns on `products`
// (not their own lookup table) so a custom entry just becomes the new value.
function ComboField({
  label, value, options, onChange, placeholder,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
  placeholder: string;
}) {
  const isCustomMode = value !== '' && !options.includes(value);
  const [customMode, setCustomMode] = useState(isCustomMode);

  return (
    <div>
      <Label>{label}</Label>
      {customMode ? (
        <div className="flex gap-2">
          <Input value={value} placeholder={placeholder} onChange={e => onChange(e.target.value)} autoFocus />
          <Button type="button" variant="outline" size="sm" onClick={() => { setCustomMode(false); onChange(''); }}>
            Cancel
          </Button>
        </div>
      ) : (
        <Select
          value={value || undefined}
          onValueChange={v => {
            if (v === CUSTOM) { setCustomMode(true); onChange(''); return; }
            onChange(v);
          }}
        >
          <SelectTrigger><SelectValue placeholder={placeholder} /></SelectTrigger>
          <SelectContent>
            {options.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}
            <SelectItem value={CUSTOM}>+ Add custom…</SelectItem>
          </SelectContent>
        </Select>
      )}
    </div>
  );
}

export default function ProductDialog({
  open, onOpenChange, editing, onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: Product | null;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [categories, setCategories] = useState<ProductCategory[]>([]);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [addingCategory, setAddingCategory] = useState(false);
  const [seriesOptions, setSeriesOptions] = useState<string[]>([]);
  const [subjectOptions, setSubjectOptions] = useState<string[]>([]);
  const [classOptions, setClassOptions] = useState<string[]>([]);

  useEffect(() => {
    if (!open) return;
    (async () => {
      const { data: cats } = await supabase.from('product_categories' as any).select('id, name').order('name');
      setCategories((cats || []) as unknown as ProductCategory[]);
      const { data: prods } = await supabase.from('products' as any).select('series, subject, class_number');
      const rows = (prods || []) as unknown as { series: string | null; subject: string | null; class_number: number | null }[];
      setSeriesOptions([...new Set(rows.map(r => r.series).filter(Boolean))] as string[]);
      setSubjectOptions([...new Set(rows.map(r => r.subject).filter(Boolean))] as string[]);
      setClassOptions([...new Set(rows.map(r => r.class_number).filter((n): n is number => n != null))].sort((a, b) => a - b).map(String));
    })();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setForm(editing ? {
      name: editing.name,
      hsn_code: editing.hsn_code ?? '',
      gst_rate: String(editing.gst_rate),
      unit_price: String(editing.unit_price),
      stock_quantity: String(editing.stock_quantity),
      category_id: editing.category_id ?? '',
      sku: editing.sku ?? '',
      item_type: editing.item_type,
      unit: editing.unit,
      minimum_stock_level: String(editing.minimum_stock_level),
      expiry_date: editing.expiry_date ?? '',
      location: editing.location ?? '',
      barcode: editing.barcode ?? '',
      image_url: editing.image_url ?? '',
      series: editing.series ?? '',
      subject: editing.subject ?? '',
      class_number: editing.class_number != null ? String(editing.class_number) : '',
    } : emptyForm);
  }, [open, editing]);

  const handleAddCategory = async () => {
    if (!newCategoryName.trim()) return;
    setAddingCategory(true);
    const { data, error } = await supabase.from('product_categories' as any)
      .insert({ name: newCategoryName.trim() }).select('id, name').single();
    setAddingCategory(false);
    if (error) { toast({ title: 'Error', description: error.message, variant: 'destructive' }); return; }
    const cat = data as unknown as ProductCategory;
    setCategories(c => [...c, cat].sort((a, b) => a.name.localeCompare(b.name)));
    setForm(f => ({ ...f, category_id: cat.id }));
    setNewCategoryName('');
  };

  const handleSave = async () => {
    if (!form.name.trim()) { toast({ title: 'Name is required', variant: 'destructive' }); return; }
    setSaving(true);
    const payload = {
      name: form.name.trim(),
      hsn_code: form.hsn_code.trim() || null,
      gst_rate: Number(form.gst_rate),
      unit_price: Number(form.unit_price) || 0,
      stock_quantity: Number(form.stock_quantity) || 0,
      category_id: form.category_id || null,
      sku: form.sku.trim() || null,
      item_type: form.item_type,
      unit: form.unit.trim() || 'pcs',
      minimum_stock_level: Number(form.minimum_stock_level) || 0,
      expiry_date: form.expiry_date || null,
      location: form.location.trim() || null,
      barcode: form.barcode.trim() || null,
      image_url: form.image_url.trim() || null,
      series: form.series.trim() || null,
      subject: form.subject.trim() || null,
      class_number: form.class_number ? Number(form.class_number) : null,
    };
    const { error } = editing
      ? await supabase.from('products' as any).update(payload).eq('id', editing.id)
      : await supabase.from('products' as any).insert(payload);
    setSaving(false);
    if (error) { toast({ title: 'Error', description: error.message, variant: 'destructive' }); return; }
    toast({ title: editing ? 'Product updated' : 'Product added' });
    onOpenChange(false);
    onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{editing ? 'Edit Product' : 'Add Product'}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <Label htmlFor="p-name">Name</Label>
            <Input id="p-name" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
          </div>

          <div>
            <Label>Category</Label>
            <Select value={form.category_id || undefined} onValueChange={v => setForm(f => ({ ...f, category_id: v }))}>
              <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
              <SelectContent>
                {categories.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <div className="flex gap-2 mt-1.5">
              <Input placeholder="New category name" value={newCategoryName} onChange={e => setNewCategoryName(e.target.value)} className="h-8 text-xs" />
              <Button type="button" variant="outline" size="sm" className="h-8" disabled={addingCategory} onClick={handleAddCategory}>+ Add</Button>
            </div>
          </div>

          <div>
            <Label>Item Type</Label>
            <Select value={form.item_type} onValueChange={v => setForm(f => ({ ...f, item_type: v }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {ITEM_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <ComboField label="Series" value={form.series} options={seriesOptions} placeholder="Select series" onChange={v => setForm(f => ({ ...f, series: v }))} />
          <ComboField label="Subject" value={form.subject} options={subjectOptions} placeholder="Select subject" onChange={v => setForm(f => ({ ...f, subject: v }))} />
          <ComboField label="Class" value={form.class_number} options={classOptions} placeholder="Select class" onChange={v => setForm(f => ({ ...f, class_number: v }))} />

          <div>
            <Label htmlFor="p-sku">SKU</Label>
            <Input id="p-sku" value={form.sku} onChange={e => setForm(f => ({ ...f, sku: e.target.value }))} />
          </div>
          <div>
            <Label htmlFor="p-hsn">HSN/SAC Code</Label>
            <Input id="p-hsn" value={form.hsn_code} onChange={e => setForm(f => ({ ...f, hsn_code: e.target.value }))} />
          </div>
          <div>
            <Label>GST Rate</Label>
            <Select value={form.gst_rate} onValueChange={v => setForm(f => ({ ...f, gst_rate: v }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{GST_RATES.map(r => <SelectItem key={r} value={String(r)}>{r}%</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="p-unit">Unit</Label>
            <Input id="p-unit" value={form.unit} onChange={e => setForm(f => ({ ...f, unit: e.target.value }))} placeholder="pcs, kg, box…" />
          </div>
          <div>
            <Label htmlFor="p-price">Unit Price (₹)</Label>
            <Input id="p-price" type="number" min="0" step="0.01" value={form.unit_price} onChange={e => setForm(f => ({ ...f, unit_price: e.target.value }))} />
          </div>
          <div>
            <Label htmlFor="p-stock">{editing ? 'Stock Quantity' : 'Initial Stock Quantity'}</Label>
            <Input id="p-stock" type="number" min="0" value={form.stock_quantity} onChange={e => setForm(f => ({ ...f, stock_quantity: e.target.value }))} />
          </div>
          <div>
            <Label htmlFor="p-minstock">Minimum Stock Level</Label>
            <Input id="p-minstock" type="number" min="0" value={form.minimum_stock_level} onChange={e => setForm(f => ({ ...f, minimum_stock_level: e.target.value }))} />
          </div>
          <div>
            <Label htmlFor="p-expiry">Expiry Date</Label>
            <Input id="p-expiry" type="date" value={form.expiry_date} onChange={e => setForm(f => ({ ...f, expiry_date: e.target.value }))} />
          </div>
          <div>
            <Label htmlFor="p-location">Storage Location</Label>
            <Input id="p-location" value={form.location} onChange={e => setForm(f => ({ ...f, location: e.target.value }))} />
          </div>
          <div>
            <Label htmlFor="p-barcode">Barcode</Label>
            <Input id="p-barcode" value={form.barcode} onChange={e => setForm(f => ({ ...f, barcode: e.target.value }))} />
          </div>
          <div className="col-span-2">
            <Label htmlFor="p-image">Image URL</Label>
            <Input id="p-image" value={form.image_url} onChange={e => setForm(f => ({ ...f, image_url: e.target.value }))} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Modify `ProductsPage.tsx`** — export the `Product` type, remove the inline dialog + its state/handlers, render `ProductDialog`

Replace the `Product` type definition (lines 15-23) with:

```tsx
export type Product = {
  id: string;
  name: string;
  hsn_code: string | null;
  gst_rate: number;
  unit_price: number;
  stock_quantity: number;
  is_active: boolean;
  category_id: string | null;
  sku: string | null;
  item_type: 'consumable' | 'saleable';
  unit: string;
  minimum_stock_level: number;
  expiry_date: string | null;
  location: string | null;
  barcode: string | null;
  image_url: string | null;
  series: string | null;
  subject: string | null;
  class_number: number | null;
};
```

Update the `loadProducts` select to fetch every column (`select('*')` instead of the explicit narrower list, since the narrower list will now be missing the 12 new fields):

```tsx
const loadProducts = async () => {
  setLoading(true);
  const { data, error } = await supabase
    .from('products' as any)
    .select('*')
    .order('name');
  if (error) {
    toast({ title: 'Error', description: error.message, variant: 'destructive' });
  } else {
    setProducts((data || []) as unknown as Product[]);
  }
  setLoading(false);
};
```

Delete: the `emptyForm` constant, the `form`/`saving` state, `openAdd`/`openEdit`/`handleSave` functions (all move into `ProductDialog.tsx`), and the entire inline `<Dialog>...</Dialog>` JSX block at the bottom of the file (lines 160-195 in the original).

Keep: `dialogOpen`/`editing` state (now just used to open/close and pass to `ProductDialog`), simplify `openAdd`/`openEdit` to:

```tsx
const openAdd = () => { setEditing(null); setDialogOpen(true); };
const openEdit = (p: Product) => { setEditing(p); setDialogOpen(true); };
```

Add the import and render `ProductDialog` in place of the deleted inline dialog:

```tsx
import ProductDialog from './ProductDialog';
// ...
<ProductDialog open={dialogOpen} onOpenChange={setDialogOpen} editing={editing} onSaved={loadProducts} />
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: clean build.

- [ ] **Step 5: Commit**

```bash
git add src/pages/Sales/ProductDialog.tsx src/pages/Sales/ProductsPage.tsx
git commit -m "Extract Product dialog with category/series/subject/class + full item attributes"
```

---

### Task 3: Search + filter bar, per-item low-stock badge

**Files:**
- Create: `src/pages/Sales/ProductsFilterBar.tsx`
- Modify: `src/pages/Sales/ProductsPage.tsx` (filter state, filtered list, render filter bar, per-item low-stock badge)

**Interfaces:**
- Consumes: `Product` type from Task 2 (`ProductsPage.tsx` exports it).
- Produces: `ProductsFilterBar` component `{ filters, onChange, categories, seriesOptions, subjectOptions, classOptions }`; `ProductsPage.tsx` gains a `ProductFilters` type and `filteredProducts` derived list.

- [ ] **Step 1: Create `ProductsFilterBar.tsx`**

```tsx
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export type ProductFilters = {
  search: string;
  categoryId: string;      // 'all' or a category id
  itemType: string;        // 'all' | 'consumable' | 'saleable'
  series: string;          // 'all' or a series value
  subject: string;         // 'all' or a subject value
  classNumber: string;     // 'all' or a class number as string
  stockStatus: string;     // 'all' | 'low' | 'out'
  activeStatus: string;    // 'all' | 'active' | 'inactive'
};

export const DEFAULT_FILTERS: ProductFilters = {
  search: '', categoryId: 'all', itemType: 'all', series: 'all',
  subject: 'all', classNumber: 'all', stockStatus: 'all', activeStatus: 'all',
};

export default function ProductsFilterBar({
  filters, onChange, categories, seriesOptions, subjectOptions, classOptions,
}: {
  filters: ProductFilters;
  onChange: (f: ProductFilters) => void;
  categories: { id: string; name: string }[];
  seriesOptions: string[];
  subjectOptions: string[];
  classOptions: string[];
}) {
  const set = (patch: Partial<ProductFilters>) => onChange({ ...filters, ...patch });

  return (
    <div className="flex flex-wrap gap-2 mb-4 items-center">
      <Input
        placeholder="Search by name or SKU…"
        value={filters.search}
        onChange={e => set({ search: e.target.value })}
        className="max-w-xs"
      />
      <Select value={filters.categoryId} onValueChange={v => set({ categoryId: v })}>
        <SelectTrigger className="w-[160px]"><SelectValue placeholder="Category" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Categories</SelectItem>
          {categories.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
        </SelectContent>
      </Select>
      <Select value={filters.itemType} onValueChange={v => set({ itemType: v })}>
        <SelectTrigger className="w-[140px]"><SelectValue placeholder="Item Type" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Types</SelectItem>
          <SelectItem value="saleable">Saleable</SelectItem>
          <SelectItem value="consumable">Consumable</SelectItem>
        </SelectContent>
      </Select>
      <Select value={filters.series} onValueChange={v => set({ series: v })}>
        <SelectTrigger className="w-[140px]"><SelectValue placeholder="Series" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Series</SelectItem>
          {seriesOptions.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
        </SelectContent>
      </Select>
      <Select value={filters.subject} onValueChange={v => set({ subject: v })}>
        <SelectTrigger className="w-[160px]"><SelectValue placeholder="Subject" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Subjects</SelectItem>
          {subjectOptions.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
        </SelectContent>
      </Select>
      <Select value={filters.classNumber} onValueChange={v => set({ classNumber: v })}>
        <SelectTrigger className="w-[120px]"><SelectValue placeholder="Class" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Classes</SelectItem>
          {classOptions.map(c => <SelectItem key={c} value={c}>Class {c}</SelectItem>)}
        </SelectContent>
      </Select>
      <Select value={filters.stockStatus} onValueChange={v => set({ stockStatus: v })}>
        <SelectTrigger className="w-[140px]"><SelectValue placeholder="Stock" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Stock</SelectItem>
          <SelectItem value="low">Low Stock</SelectItem>
          <SelectItem value="out">Out of Stock</SelectItem>
        </SelectContent>
      </Select>
      <Select value={filters.activeStatus} onValueChange={v => set({ activeStatus: v })}>
        <SelectTrigger className="w-[120px]"><SelectValue placeholder="Status" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Status</SelectItem>
          <SelectItem value="active">Active</SelectItem>
          <SelectItem value="inactive">Inactive</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
```

- [ ] **Step 2: Wire filters into `ProductsPage.tsx`**

Add imports:
```tsx
import ProductsFilterBar, { DEFAULT_FILTERS, type ProductFilters } from './ProductsFilterBar';
import { useMemo } from 'react';
```
(merge `useMemo` into the existing `import { useState, useEffect } from 'react';` line.)

Add state and derived category/series/subject/class option lists and the filtered list:

```tsx
const [filters, setFilters] = useState<ProductFilters>(DEFAULT_FILTERS);
const [categories, setCategories] = useState<{ id: string; name: string }[]>([]);

useEffect(() => {
  supabase.from('product_categories' as any).select('id, name').order('name')
    .then(({ data }) => setCategories((data || []) as unknown as { id: string; name: string }[]));
}, []);

const seriesOptions = useMemo(() => [...new Set(products.map(p => p.series).filter(Boolean))] as string[], [products]);
const subjectOptions = useMemo(() => [...new Set(products.map(p => p.subject).filter(Boolean))] as string[], [products]);
const classOptions = useMemo(() =>
  [...new Set(products.map(p => p.class_number).filter((n): n is number => n != null))].sort((a, b) => a - b).map(String),
  [products]);

const filteredProducts = useMemo(() => products.filter(p => {
  if (filters.search && !p.name.toLowerCase().includes(filters.search.toLowerCase()) && !(p.sku ?? '').toLowerCase().includes(filters.search.toLowerCase())) return false;
  if (filters.categoryId !== 'all' && p.category_id !== filters.categoryId) return false;
  if (filters.itemType !== 'all' && p.item_type !== filters.itemType) return false;
  if (filters.series !== 'all' && p.series !== filters.series) return false;
  if (filters.subject !== 'all' && p.subject !== filters.subject) return false;
  if (filters.classNumber !== 'all' && String(p.class_number) !== filters.classNumber) return false;
  if (filters.stockStatus === 'low' && !(p.stock_quantity > 0 && p.stock_quantity < p.minimum_stock_level)) return false;
  if (filters.stockStatus === 'out' && p.stock_quantity !== 0) return false;
  if (filters.activeStatus === 'active' && !p.is_active) return false;
  if (filters.activeStatus === 'inactive' && p.is_active) return false;
  return true;
}), [products, filters]);
```

Render the filter bar above the table, and switch the table body to map over `filteredProducts` instead of `products`:

```tsx
<ProductsFilterBar
  filters={filters} onChange={setFilters} categories={categories}
  seriesOptions={seriesOptions} subjectOptions={subjectOptions} classOptions={classOptions}
/>
```

Replace `products.map(p => (` with `filteredProducts.map(p => (` in the table body, and the empty-state check `products.length === 0` with `filteredProducts.length === 0` (with a different message when filters are active vs. when the catalog is genuinely empty — check `products.length === 0 ? 'No products yet.' : 'No products match these filters.'`).

Replace the low-stock badge condition — delete the module-level `const LOW_STOCK_THRESHOLD = 5;` constant entirely, and change:
```tsx
{p.stock_quantity < LOW_STOCK_THRESHOLD && (
```
to:
```tsx
{p.stock_quantity < p.minimum_stock_level && (
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: clean build.

- [ ] **Step 5: Verify against real data**

Run:
```bash
supabase db query --linked "SELECT count(*) FILTER (WHERE series = 'Ignite Series') AS ignite, count(*) FILTER (WHERE series = 'Impact Series') AS impact FROM products;"
```
Expected: `ignite: 40, impact: 8` — confirms the filter dropdowns' data source is correct before relying on it in the UI (no live browser session available to click-test directly, per this repo's established verification limits — flag for Goghul to click-through once deployed).

- [ ] **Step 6: Commit**

```bash
git add src/pages/Sales/ProductsFilterBar.tsx src/pages/Sales/ProductsPage.tsx
git commit -m "Add search + category/type/series/subject/class/stock/status filters to Products page"
```

---

## Self-Review Notes

- **Spec coverage:** Phase 1 spec calls for category filter, item-type filter, search by name/SKU, Series/Subject/Class filters + dropdown-with-custom-entry, per-item low-stock threshold. All covered across Tasks 1-3.
- **Type consistency:** `Product` type defined once in `ProductsPage.tsx` (Task 2), imported by `ProductDialog.tsx`; `ProductFilters` type defined once in `ProductsFilterBar.tsx` (Task 3), imported by `ProductsPage.tsx`. `class_number` is `number | null` on the type but handled as string in Select components throughout (Select requires string values) — consistent conversion at every read/write site.
- **No placeholders:** all SQL and TSX above is complete, no TODOs.
- **Not covered by this plan, deliberately deferred to Phase 2-6 per the design doc:** Suppliers, Purchase Orders, GRN, Stock Add/Adjustment, Item Issue, Reports. Each gets its own plan written after this phase ships and is verified.
