import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { PackageCheck, XCircle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { shortBookName } from '@/utils/bookName';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: { returnId: string; schoolName: string; itemName: string; wrongItemName: string | null; quantity: number } | null;
  onSent: () => void;
}

export default function SendReplacementDialog({ open, onOpenChange, target, onSent }: Props) {
  const { toast } = useToast();
  const [reference, setReference] = useState('');
  const [checked, setChecked] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) { setReference(''); setChecked(false); }
  }, [open, target]);

  const handleConfirm = async () => {
    if (!target || !checked) return;
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

  const sendName = target ? shortBookName(target.itemName) : '';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Send Replacement</DialogTitle>
          <DialogDescription>{target?.schoolName}</DialogDescription>
        </DialogHeader>
        {target && (
          <div className="space-y-3">
            <div className="rounded-lg border-2 border-emerald-600 bg-emerald-50 p-4">
              <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-emerald-800">
                <PackageCheck className="h-4 w-4" aria-hidden="true" /> Pack this
              </p>
              <p className="mt-1 text-2xl font-bold text-neutral-900">
                {sendName} <span className="text-emerald-800">× {target.quantity}</span>
              </p>
              {sendName !== target.itemName && <p className="text-xs text-neutral-600">{target.itemName}</p>}
            </div>
            {target.wrongItemName && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3">
                <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-red-700">
                  <XCircle className="h-4 w-4" aria-hidden="true" /> Not this — the wrong book the school received
                </p>
                <p className="mt-0.5 text-base font-semibold text-neutral-700 line-through decoration-red-400">
                  {shortBookName(target.wrongItemName)}
                </p>
              </div>
            )}
            <label htmlFor="replacement-checked" className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-neutral-200 p-3">
              <Checkbox id="replacement-checked" checked={checked} onCheckedChange={(v) => setChecked(v === true)} className="mt-0.5" />
              <span className="text-sm text-neutral-800">
                I checked the book cover in the parcel — it says <span className="font-bold">{sendName}</span>, {target.quantity} {target.quantity === 1 ? 'copy' : 'copies'}.
              </span>
            </label>
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
          <Button onClick={handleConfirm} disabled={!target || !checked || saving}>{saving ? 'Saving…' : 'Mark Sent'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
