import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import type { Product } from './ProductsPage';

type AdjustDirection = 'increase' | 'decrease';

const emptyForm = { product_id: '', direction: 'increase' as AdjustDirection, quantity: '', reason: '' };

export default function StockAdjustmentDialog({
  open, onOpenChange, onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [products, setProducts] = useState<Product[]>([]);

  useEffect(() => {
    if (!open) return;
    setForm(emptyForm);
    supabase.from('products' as any).select('*').eq('is_active', true).order('name')
      .then(({ data, error }) => {
        if (error) { toast({ title: 'Error loading products', description: error.message, variant: 'destructive' }); return; }
        setProducts((data || []) as unknown as Product[]);
      });
  }, [open]);

  const canSave = !!form.product_id && Number(form.quantity) > 0 && form.reason.trim().length > 0;

  const handleSave = async () => {
    if (!canSave) { toast({ title: 'Fill in all required fields', variant: 'destructive' }); return; }
    setSaving(true);
    const delta = form.direction === 'increase' ? Number(form.quantity) : -Number(form.quantity);
    const { data, error } = await supabase.rpc('create_stock_adjustment' as any, {
      p_product_id: form.product_id,
      p_quantity_delta: delta,
      p_reason: form.reason.trim(),
    });
    setSaving(false);
    if (error) {
      // Surface the RPC's own message verbatim — it's already a clear,
      // specific explanation (e.g. "This adjustment would make stock
      // negative. Current stock: 12."), not a generic error.
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
      return;
    }
    const r = data as any;
    toast({ title: `Stock adjusted — new quantity: ${r.new_stock_quantity}` });
    onOpenChange(false);
    onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Adjust Stock</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Product</Label>
            <Select value={form.product_id || undefined} onValueChange={v => setForm(f => ({ ...f, product_id: v }))}>
              <SelectTrigger><SelectValue placeholder="Select product" /></SelectTrigger>
              <SelectContent>
                {products.map(p => <SelectItem key={p.id} value={p.id}>{p.name} (current: {p.stock_quantity})</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Adjustment Type</Label>
            <div className="flex gap-2">
              <Button
                type="button" variant={form.direction === 'increase' ? 'default' : 'outline'}
                className="flex-1" onClick={() => setForm(f => ({ ...f, direction: 'increase' }))}
              >
                Increase
              </Button>
              <Button
                type="button" variant={form.direction === 'decrease' ? 'default' : 'outline'}
                className="flex-1" onClick={() => setForm(f => ({ ...f, direction: 'decrease' }))}
              >
                Decrease
              </Button>
            </div>
          </div>
          <div>
            <Label htmlFor="sa-qty">Quantity</Label>
            <Input id="sa-qty" type="number" min="1" value={form.quantity} onChange={e => setForm(f => ({ ...f, quantity: e.target.value }))} />
          </div>
          <div>
            <Label htmlFor="sa-reason">Reason</Label>
            <Textarea id="sa-reason" value={form.reason} onChange={e => setForm(f => ({ ...f, reason: e.target.value }))} placeholder="e.g. Damaged in storage, stock count correction…" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={!canSave || saving}>{saving ? 'Saving…' : 'Save Adjustment'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
