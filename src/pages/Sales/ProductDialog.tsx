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
      const { data: cats, error: catsError } = await supabase.from('product_categories' as any).select('id, name').order('name');
      if (catsError) { toast({ title: 'Error', description: catsError.message, variant: 'destructive' }); return; }
      setCategories((cats || []) as unknown as ProductCategory[]);
      const { data: prods, error: prodsError } = await supabase.from('products' as any).select('series, subject, class_number');
      if (prodsError) { toast({ title: 'Error', description: prodsError.message, variant: 'destructive' }); return; }
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
