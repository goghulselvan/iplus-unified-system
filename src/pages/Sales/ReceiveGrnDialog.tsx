import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

export type PoItemForReceiving = {
  id: string;
  product_id: string;
  product_name: string;
  quantity_ordered: number;
  already_received: number;
};

const today = () => new Date().toISOString().slice(0, 10);

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  purchaseOrderId: string;
  poItems: PoItemForReceiving[];
  onSaved: () => void;
}

export default function ReceiveGrnDialog({ open, onOpenChange, purchaseOrderId, poItems, onSaved }: Props) {
  const { toast } = useToast();

  const [receivedDate, setReceivedDate] = useState(today());
  const [notes, setNotes] = useState('');
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setReceivedDate(today());
    setNotes('');
    const defaults: Record<string, number> = {};
    for (const item of poItems) {
      defaults[item.id] = Math.max(0, item.quantity_ordered - item.already_received);
    }
    setQuantities(defaults);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const updateQty = (itemId: string, value: number) => {
    setQuantities(prev => ({ ...prev, [itemId]: Math.max(0, Math.round(value) || 0) }));
  };

  const canSave = Object.values(quantities).some(q => q > 0);

  const handleSave = async () => {
    if (!receivedDate) {
      toast({ title: 'Received date is required', variant: 'destructive' });
      return;
    }
    if (!canSave) {
      toast({ title: 'Enter a quantity greater than 0 for at least one item', variant: 'destructive' });
      return;
    }
    setSaving(true);
    const payloadItems = poItems.map(i => ({
      po_item_id: i.id,
      quantity_received: quantities[i.id] ?? 0,
    }));
    const { data, error } = await supabase.rpc('receive_grn' as any, {
      p_purchase_order_id: purchaseOrderId,
      p_received_date: receivedDate,
      p_notes: notes.trim() || null,
      p_items: payloadItems,
    });
    setSaving(false);
    if (error) { toast({ title: 'Error', description: error.message, variant: 'destructive' }); return; }
    const r = data as any;
    toast({ title: `Goods received — PO status: ${r.po_status}` });
    onSaved();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Receive Goods</DialogTitle></DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Received Date</Label>
              <Input type="date" value={receivedDate} onChange={e => setReceivedDate(e.target.value)} />
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
                  <th className="text-left px-2 py-2">Product</th>
                  <th className="text-left px-2 py-2 w-24">Ordered</th>
                  <th className="text-left px-2 py-2 w-28">Already Received</th>
                  <th className="text-left px-2 py-2 w-32">Receiving Now</th>
                </tr>
              </thead>
              <tbody>
                {poItems.map(item => (
                  <tr key={item.id} className="border-t">
                    <td className="px-2 py-1.5 font-medium">{item.product_name}</td>
                    <td className="px-2 py-1.5">{item.quantity_ordered}</td>
                    <td className="px-2 py-1.5">{item.already_received}</td>
                    <td className="px-2 py-1.5">
                      <Input
                        className="h-8"
                        type="number"
                        min="0"
                        step="1"
                        value={quantities[item.id] ?? 0}
                        onChange={e => updateQty(item.id, Number(e.target.value))}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving || !canSave}>{saving ? 'Saving…' : 'Receive Goods'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
