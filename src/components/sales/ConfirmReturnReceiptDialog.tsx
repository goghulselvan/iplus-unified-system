import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  returnId: string | null;
  itemName: string;
  onConfirmed: () => void;
}

export default function ConfirmReturnReceiptDialog({ open, onOpenChange, returnId, itemName, onConfirmed }: Props) {
  const { toast } = useToast();
  const [condition, setCondition] = useState<'resellable' | 'damaged' | ''>('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) { setCondition(''); }
  }, [open, returnId]);

  const handleConfirm = async () => {
    if (!returnId || !condition) return;
    setSaving(true);
    const { error } = await supabase.rpc('confirm_return_received' as any, {
      p_return_id: returnId,
      p_condition: condition,
    });
    setSaving(false);
    if (error) { toast({ title: 'Error', description: error.message, variant: 'destructive' }); return; }
    toast({ title: 'Return received, credit note issued' });
    setCondition('');
    onConfirmed();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Confirm Receipt — {itemName}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <Label>Condition on receipt</Label>
          <RadioGroup value={condition} onValueChange={(v) => setCondition(v as 'resellable' | 'damaged')}>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="resellable" id="cond-resellable" />
              <Label htmlFor="cond-resellable" className="font-normal">Resellable — add back to stock</Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="damaged" id="cond-damaged" />
              <Label htmlFor="cond-damaged" className="font-normal">Damaged — write off, do not restock</Label>
            </div>
          </RadioGroup>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleConfirm} disabled={!condition || saving}>{saving ? 'Saving…' : 'Confirm Receipt'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
