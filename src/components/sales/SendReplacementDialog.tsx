import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: { returnId: string; schoolName: string; itemName: string; quantity: number } | null;
  onSent: () => void;
}

export default function SendReplacementDialog({ open, onOpenChange, target, onSent }: Props) {
  const { toast } = useToast();
  const [reference, setReference] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setReference('');
  }, [open, target]);

  const handleConfirm = async () => {
    if (!target) return;
    setSaving(true);
    const { error } = await supabase.rpc('mark_replacement_sent' as any, {
      p_return_id: target.returnId,
      p_reference: reference,
    });
    setSaving(false);
    if (error) { toast({ title: 'Error', description: error.message, variant: 'destructive' }); return; }
    toast({ title: 'Replacement marked as sent' });
    onSent();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Send Replacement{target ? ` — ${target.schoolName}` : ''}</DialogTitle>
          <DialogDescription>
            Confirms the correct item has actually gone out to the school. This doesn't create a
            new order — if you haven't dispatched it yet, do that first, then come back and mark
            it here.
          </DialogDescription>
        </DialogHeader>
        {target && (
          <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3 text-sm">
            <p><span className="font-bold">Item owed:</span> {target.itemName} × {target.quantity}</p>
          </div>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="replacement-ref">Order / dispatch reference (optional)</Label>
          <Input
            id="replacement-ref"
            placeholder="e.g. Order #41, or bundled with Order #40"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleConfirm} disabled={!target || saving}>{saving ? 'Saving…' : 'Mark Sent'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
