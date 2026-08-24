import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

const REASON_OPTIONS = [
  { value: 'wrong_item_shipped', label: 'Wrong item shipped' },
  { value: 'wrong_item_ordered_by_staff', label: 'Staff entered the wrong item' },
  { value: 'damaged_in_transit', label: 'Damaged in transit' },
  { value: 'other', label: 'Other' },
];

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lineItem: { id: string; item_name: string; maxReturnable: number } | null;
  onReported: () => void;
}

export default function ReportReturnDialog({ open, onOpenChange, lineItem, onReported }: Props) {
  const { toast } = useToast();
  const [quantity, setQuantity] = useState('1');
  const [reason, setReason] = useState('wrong_item_shipped');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [products, setProducts] = useState<{ id: string; name: string }[]>([]);
  const [actualProductId, setActualProductId] = useState<string>('');

  useEffect(() => {
    if (open) { setQuantity('1'); setReason('wrong_item_shipped'); setNote(''); setActualProductId(''); }
  }, [open, lineItem?.id]);

  useEffect(() => {
    if (!open) return;
    supabase.from('products').select('id, name').eq('is_active', true).order('name')
      .then(({ data }) => setProducts(data ?? []));
  }, [open]);

  const qtyNum = parseInt(quantity, 10);
  const canSave = !!lineItem && qtyNum > 0 && qtyNum <= lineItem.maxReturnable;

  const handleSave = async () => {
    if (!canSave || !lineItem) return;
    setSaving(true);
    const { error } = await supabase.rpc('report_return' as any, {
      p_invoice_line_item_id: lineItem.id,
      p_quantity: qtyNum,
      p_reason_category: reason,
      p_reason_note: note.trim() || null,
      p_actual_product_id: actualProductId || null,
    });
    setSaving(false);
    if (error) { toast({ title: 'Error', description: error.message, variant: 'destructive' }); return; }
    toast({ title: 'Return reported' });
    onReported();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Report Return{lineItem ? ` — ${lineItem.item_name}` : ''}</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Quantity returning</Label>
            <Input type="number" min={1} max={lineItem?.maxReturnable ?? 1} value={quantity}
              onChange={e => setQuantity(e.target.value)} />
            {lineItem && (
              <p className="text-xs text-muted-foreground mt-1">
                Up to {lineItem.maxReturnable} of this line can still be returned.
              </p>
            )}
          </div>
          <div>
            <Label>Reason</Label>
            <Select value={reason} onValueChange={(newReason) => {
              setReason(newReason);
              if (newReason !== 'wrong_item_shipped') {
                setActualProductId('');
              }
            }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {REASON_OPTIONS.map(r => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {reason === 'wrong_item_shipped' && (
            <div>
              <Label>What was actually sent instead? <span className="text-muted-foreground font-normal">(optional)</span></Label>
              <Select value={actualProductId} onValueChange={setActualProductId}>
                <SelectTrigger><SelectValue placeholder="Select if known…" /></SelectTrigger>
                <SelectContent>
                  {products.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-1">
                Leave blank if you don't know yet — the return can still be reported, but stock will only
                correct for the invoiced item unless you specify what actually shipped.
              </p>
            </div>
          )}
          <div>
            <Label>Note (optional)</Label>
            <Textarea value={note} onChange={e => setNote(e.target.value)} rows={2} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={!canSave || saving}>{saving ? 'Saving…' : 'Report Return'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
