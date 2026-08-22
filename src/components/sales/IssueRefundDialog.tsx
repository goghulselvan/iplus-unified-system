import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

const REFUND_MODES = ['Bank Transfer', 'UPI', 'Cash'];

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  creditNote: { id: string; remaining_balance: number; school_name: string } | null;
  onIssued: () => void;
}

export default function IssueRefundDialog({ open, onOpenChange, creditNote, onIssued }: Props) {
  const { toast } = useToast();
  const [amount, setAmount] = useState('');
  const [mode, setMode] = useState(REFUND_MODES[0]);
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open && creditNote) { setAmount(String(creditNote.remaining_balance)); setMode(REFUND_MODES[0]); setReference(''); setNote(''); }
  }, [open, creditNote?.id]);

  const amountNum = parseFloat(amount);
  const canSave = !!creditNote && amountNum > 0 && amountNum <= creditNote.remaining_balance;

  const handleSave = async () => {
    if (!canSave || !creditNote) return;
    setSaving(true);
    const { error } = await supabase.rpc('issue_credit_refund' as any, {
      p_credit_note_id: creditNote.id,
      p_amount: amountNum,
      p_refund_mode: mode,
      p_refund_reference: reference.trim() || null,
      p_note: note.trim() || null,
    });
    setSaving(false);
    if (error) { toast({ title: 'Error', description: error.message, variant: 'destructive' }); return; }
    toast({ title: 'Refund recorded' });
    onIssued();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Issue Refund{creditNote ? ` — ${creditNote.school_name}` : ''}</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Amount (max ₹{creditNote?.remaining_balance.toLocaleString('en-IN')})</Label>
            <Input type="number" min={0.01} max={creditNote?.remaining_balance} step="0.01" value={amount}
              onChange={e => setAmount(e.target.value)} />
          </div>
          <div>
            <Label>Mode</Label>
            <select className="w-full border rounded-md h-9 px-3 text-sm" value={mode} onChange={e => setMode(e.target.value)}>
              {REFUND_MODES.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div>
            <Label>Reference (optional)</Label>
            <Input value={reference} onChange={e => setReference(e.target.value)} placeholder="UTR / transaction id" />
          </div>
          <div>
            <Label>Note (optional)</Label>
            <Textarea value={note} onChange={e => setNote(e.target.value)} rows={2} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={!canSave || saving}>{saving ? 'Saving…' : 'Issue Refund'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
