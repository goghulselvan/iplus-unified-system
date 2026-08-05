import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

const ISSUED_TO_TYPES = [
  { value: 'student', label: 'Student' },
  { value: 'staff', label: 'Staff' },
  { value: 'other', label: 'Other' },
];

type IssueProduct = { id: string; name: string; stock_quantity: number };

const emptyForm = {
  product_id: '', issued_to_type: 'student', issued_to_name: '', quantity: '1', notes: '',
};

export default function IssueItemDialog({
  open, onOpenChange, onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [products, setProducts] = useState<IssueProduct[]>([]);

  useEffect(() => {
    if (!open) return;
    setForm(emptyForm);
    (async () => {
      try {
        const { data, error } = await supabase.from('products' as any).select('id, name, stock_quantity').eq('is_active', true).order('name');
        if (error) { toast({ title: 'Error loading products', description: error.message, variant: 'destructive' }); return; }
        setProducts((data || []) as unknown as IssueProduct[]);
      } catch (err: any) {
        toast({ title: 'Error loading products', description: err?.message ?? 'Unknown error', variant: 'destructive' });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const selectedProduct = products.find(p => p.id === form.product_id);
  const quantityNum = Number(form.quantity);
  const exceedsStock = !!selectedProduct && quantityNum > selectedProduct.stock_quantity;

  const handleSave = async () => {
    if (!form.product_id) { toast({ title: 'Select a product', variant: 'destructive' }); return; }
    if (!form.issued_to_name.trim()) { toast({ title: 'Issued-to name is required', variant: 'destructive' }); return; }
    if (!quantityNum || quantityNum <= 0) { toast({ title: 'Quantity must be greater than 0', variant: 'destructive' }); return; }

    const quantityInt = Math.floor(quantityNum);
    if (quantityInt <= 0) { toast({ title: 'Quantity must be greater than 0', variant: 'destructive' }); return; }

    setSaving(true);
    const { data, error } = await supabase.rpc('issue_item' as any, {
      p_product_id: form.product_id,
      p_issued_to_type: form.issued_to_type,
      p_issued_to_name: form.issued_to_name.trim(),
      p_quantity: quantityInt,
      p_notes: form.notes.trim() || null,
    });
    setSaving(false);
    if (error) { toast({ title: 'Error', description: error.message, variant: 'destructive' }); return; }
    const r = data as any;
    toast({ title: `Item issued — remaining stock: ${r.new_stock_quantity}` });
    onOpenChange(false);
    onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Issue Item</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <Label>Product</Label>
            <Select value={form.product_id || undefined} onValueChange={v => setForm(f => ({ ...f, product_id: v }))}>
              <SelectTrigger><SelectValue placeholder="Select product" /></SelectTrigger>
              <SelectContent>
                {products.map(p => <SelectItem key={p.id} value={p.id}>{p.name} (stock: {p.stock_quantity})</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Issued To Type</Label>
            <Select value={form.issued_to_type} onValueChange={v => setForm(f => ({ ...f, issued_to_type: v }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {ISSUED_TO_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="ii-name">Issued To Name</Label>
            <Input id="ii-name" value={form.issued_to_name} onChange={e => setForm(f => ({ ...f, issued_to_name: e.target.value }))} />
          </div>
          <div>
            <Label htmlFor="ii-qty">Quantity</Label>
            <Input id="ii-qty" type="number" min="1" step="1" value={form.quantity} onChange={e => setForm(f => ({ ...f, quantity: e.target.value }))} />
            {exceedsStock && (
              <p className="text-[11px] text-amber-600 mt-1">
                Exceeds current stock ({selectedProduct!.stock_quantity}) — allowed, but stock will go negative.
              </p>
            )}
          </div>
          <div className="col-span-2">
            <Label htmlFor="ii-notes">Notes</Label>
            <Textarea id="ii-notes" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? 'Issuing…' : 'Issue Item'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
