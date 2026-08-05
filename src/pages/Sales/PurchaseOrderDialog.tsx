import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Trash2, Plus } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import type { Supplier } from './SuppliersPage';

type PoProduct = {
  id: string;
  name: string;
  sku: string | null;
};

type LineItemForm = {
  product_id: string | null;
  quantity_ordered: number;
  unit_cost: number;
};

function emptyLine(): LineItemForm {
  return { product_id: null, quantity_ordered: 1, unit_cost: 0 };
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}

export default function PurchaseOrderDialog({ open, onOpenChange, onSaved }: Props) {
  const { toast } = useToast();

  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [supplierId, setSupplierId] = useState<string | null>(null);
  const [expectedDate, setExpectedDate] = useState('');
  const [notes, setNotes] = useState('');

  const [products, setProducts] = useState<PoProduct[]>([]);
  const [lineItems, setLineItems] = useState<LineItemForm[]>([emptyLine()]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    supabase.from('inventory_suppliers' as any).select('*').eq('is_active', true).order('name')
      .then(({ data }) => setSuppliers((data || []) as unknown as Supplier[]));
    supabase.from('products' as any).select('id, name, sku').eq('is_active', true).order('name')
      .then(({ data }) => setProducts((data || []) as unknown as PoProduct[]));

    setSupplierId(null);
    setExpectedDate('');
    setNotes('');
    setLineItems([emptyLine()]);
  }, [open]);

  const addRow = () => setLineItems(prev => [...prev, emptyLine()]);
  const removeRow = (idx: number) => setLineItems(prev => prev.filter((_, i) => i !== idx));
  const updateRow = (idx: number, patch: Partial<LineItemForm>) => {
    setLineItems(prev => prev.map((l, i) => i === idx ? { ...l, ...patch } : l));
  };

  const grandTotal = lineItems.reduce((s, l) => s + l.quantity_ordered * l.unit_cost, 0);

  const canSave = !!supplierId && lineItems.length > 0
    && lineItems.every(l => !!l.product_id && l.quantity_ordered >= 1 && l.unit_cost >= 0);

  const handleSave = async () => {
    if (!canSave) { toast({ title: 'Fill in all required fields', variant: 'destructive' }); return; }
    setSaving(true);
    const payloadLineItems = lineItems.map(l => ({
      product_id: l.product_id, quantity_ordered: l.quantity_ordered, unit_cost: l.unit_cost,
    }));
    const { data, error } = await supabase.rpc('create_purchase_order' as any, {
      p_supplier_id: supplierId,
      p_expected_date: expectedDate || null,
      p_notes: notes.trim() || null,
      p_line_items: payloadLineItems,
    });
    setSaving(false);
    if (error) { toast({ title: 'Error', description: error.message, variant: 'destructive' }); return; }
    const r = data as any;
    toast({ title: `Purchase order #${r.po_number} created` });
    onSaved();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle>New Purchase Order</DialogTitle></DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Supplier</Label>
              <Select value={supplierId ?? ''} onValueChange={setSupplierId}>
                <SelectTrigger><SelectValue placeholder="Select a supplier…" /></SelectTrigger>
                <SelectContent>
                  {suppliers.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Expected Date</Label>
              <Input type="date" value={expectedDate} onChange={e => setExpectedDate(e.target.value)} />
            </div>
            <div className="col-span-2">
              <Label>Notes</Label>
              <Textarea value={notes} onChange={e => setNotes(e.target.value)} />
            </div>
          </div>

          <div className="border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left px-2 py-2 w-8">#</th>
                  <th className="text-left px-2 py-2">Product</th>
                  <th className="text-left px-2 py-2 w-24">Qty Ordered</th>
                  <th className="text-left px-2 py-2 w-28">Unit Cost</th>
                  <th className="text-right px-2 py-2 w-28">Total</th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody>
                {lineItems.map((l, idx) => (
                  <tr key={idx} className="border-t">
                    <td className="px-2 py-1.5">{idx + 1}</td>
                    <td className="px-2 py-1.5">
                      <Select value={l.product_id ?? ''} onValueChange={v => updateRow(idx, { product_id: v })}>
                        <SelectTrigger className="h-8"><SelectValue placeholder="Pick a product…" /></SelectTrigger>
                        <SelectContent>
                          {products.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="px-2 py-1.5">
                      <Input className="h-8" type="number" min="1" step="1" value={l.quantity_ordered}
                        onChange={e => updateRow(idx, { quantity_ordered: Math.max(1, Math.round(Number(e.target.value) || 1)) })} />
                    </td>
                    <td className="px-2 py-1.5">
                      <Input className="h-8" type="number" min="0" step="0.01" value={l.unit_cost}
                        onChange={e => updateRow(idx, { unit_cost: Number(e.target.value) })} />
                    </td>
                    <td className="px-2 py-1.5 text-right font-medium">
                      ₹{(l.quantity_ordered * l.unit_cost).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="px-2 py-1.5">
                      {lineItems.length > 1 && (
                        <Button variant="ghost" size="sm" onClick={() => removeRow(idx)}><Trash2 className="h-3.5 w-3.5 text-red-600" /></Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button onClick={addRow} className="w-full text-left px-3 py-2 text-sm text-indigo-600 hover:bg-indigo-50 border-t flex items-center gap-1.5">
              <Plus className="h-3.5 w-3.5" /> Add Row
            </button>
          </div>

          <div className="flex justify-end">
            <div className="w-64 space-y-1 text-sm">
              <div className="flex justify-between font-semibold text-base border-t pt-1">
                <span>Grand Total</span>
                <span>₹{grandTotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
              </div>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={!canSave || saving}>{saving ? 'Saving…' : 'Create Purchase Order'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
