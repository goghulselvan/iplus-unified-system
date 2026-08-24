import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: { returnId: string; schoolName: string; itemName: string; quantity: number; amount: number } | null;
  onIssued: () => void;
}

export default function IssueCreditDialog({ open, onOpenChange, target, onIssued }: Props) {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);

  const handleConfirm = async () => {
    if (!target) return;
    setSaving(true);
    const { error } = await supabase.rpc('issue_credit_for_return' as any, {
      p_return_id: target.returnId,
    });
    setSaving(false);
    if (error) { toast({ title: 'Error', description: error.message, variant: 'destructive' }); return; }
    toast({ title: 'Credit issued' });
    onIssued();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Issue Credit{target ? ` — ${target.schoolName}` : ''}</DialogTitle>
          <DialogDescription>
            This mints a credit note immediately — the school doesn't need to wait for the
            returned book to physically arrive back. If this return needs a replacement book sent
            out, re-dispatch the original invoice for it — don't create a new Manual Order paid
            with this credit, that double-counts stock. Treat this credit as a separate surplus for
            the school (a future order, or a cash refund).
          </DialogDescription>
        </DialogHeader>
        {target && (
          <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3 text-sm space-y-1">
            <p><span className="font-bold">Item:</span> {target.itemName} × {target.quantity}</p>
            <p><span className="font-bold">Credit Amount:</span> ₹{target.amount.toLocaleString('en-IN')}</p>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleConfirm} disabled={!target || saving}>{saving ? 'Issuing…' : 'Issue Credit'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
