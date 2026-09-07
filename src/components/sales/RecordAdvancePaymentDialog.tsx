import { useState, useRef, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

const MODES = ['NEFT', 'RTGS', 'IMPS', 'UPI', 'Cheque', 'Bank Transfer', 'Cash'];

type SchoolHit = { source: string; id: string; school_name: string; ss_no: number | null; district: string | null; state: string | null };

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}

export default function RecordAdvancePaymentDialog({ open, onOpenChange, onCreated }: Props) {
  const { toast } = useToast();
  const [school, setSchool] = useState<SchoolHit | null>(null);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SchoolHit[]>([]);
  const [searching, setSearching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  const [amount, setAmount] = useState('');
  const [mode, setMode] = useState(MODES[0]);
  const [date, setDate] = useState('');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setSchool(null); setQuery(''); setHits([]);
      setAmount(''); setMode(MODES[0]); setDate(''); setReference(''); setNote('');
      setFile(null); if (fileRef.current) fileRef.current.value = '';
    }
  }, [open]);

  const search = (q: string) => {
    setQuery(q);
    if (q.trim().length < 2) { setHits([]); return; }
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      const { data } = await supabase.rpc('search_schools_for_invoice' as any, { p_query: q.trim(), p_limit: 8 });
      setHits(((data as SchoolHit[]) ?? []).filter(h => h.source === 'crm'));
      setSearching(false);
    }, 300);
  };

  const amountNum = parseFloat(amount);
  const canSave = !!school && amountNum > 0 && !!date && !!mode && !!file && !saving;

  const handleSave = async () => {
    if (!canSave || !school || !file) return;
    setSaving(true);

    const ext = file.name.split('.').pop();
    const path = `${school.id}/advance-${Date.now()}.${ext}`;
    const { error: upErr } = await supabase.storage.from('payment-proofs').upload(path, file, { upsert: true });
    if (upErr) {
      setSaving(false);
      toast({ title: 'Upload failed', description: upErr.message, variant: 'destructive' });
      return;
    }
    const { data: signed } = await supabase.storage.from('payment-proofs').createSignedUrl(path, 63072000);
    const screenshotUrl = signed?.signedUrl ?? null;
    if (!screenshotUrl) {
      setSaving(false);
      toast({ title: 'Failed to prepare the uploaded file', variant: 'destructive' });
      return;
    }

    const { error } = await supabase.rpc('create_advance_payment_credit_note' as any, {
      p_school_id: school.id,
      p_amount: amountNum,
      p_note: note.trim() || null,
      p_payment_mode: mode,
      p_payment_date: date,
      p_payment_reference: reference.trim() || null,
      p_screenshot_url: screenshotUrl,
    });
    setSaving(false);
    if (error) { toast({ title: 'Error', description: error.message, variant: 'destructive' }); return; }
    toast({ title: 'Advance-payment credit note created' });
    onCreated();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Record Advance Payment</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Creates a standalone credit note for money a school has paid in advance. The balance can be
            applied to any future book order or refunded.
          </p>

          {school ? (
            <div className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
              <span>{school.school_name}{school.ss_no != null ? ` (SS #${school.ss_no})` : ''}</span>
              <Button variant="ghost" size="sm" onClick={() => setSchool(null)}>Change</Button>
            </div>
          ) : (
            <div className="relative">
              <Label>School</Label>
              <Input value={query} onChange={e => search(e.target.value)} placeholder="Search by name or SS No" />
              {searching && <p className="text-xs text-muted-foreground mt-1">Searching…</p>}
              {hits.length > 0 && (
                <div className="absolute z-10 mt-1 w-full max-h-52 overflow-auto rounded-md border bg-popover shadow">
                  {hits.map(h => (
                    <button key={h.id} className="block w-full text-left px-3 py-2 text-sm hover:bg-accent"
                      onClick={() => { setSchool(h); setQuery(''); setHits([]); }}>
                      {h.school_name}{h.ss_no != null ? ` (SS #${h.ss_no})` : ''}
                      <span className="text-muted-foreground"> — {[h.district, h.state].filter(Boolean).join(', ')}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <div>
            <Label>Amount received (₹)</Label>
            <Input type="number" min={0.01} step="0.01" value={amount} onChange={e => setAmount(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Mode</Label>
              <select className="w-full border rounded-md h-9 px-3 text-sm" value={mode} onChange={e => setMode(e.target.value)}>
                {MODES.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <div>
              <Label>Payment date</Label>
              <Input type="date" value={date} onChange={e => setDate(e.target.value)} />
            </div>
          </div>
          <div>
            <Label>Reference (UTR / transaction id)</Label>
            <Input value={reference} onChange={e => setReference(e.target.value)} />
          </div>
          <div>
            <Label>Payment proof</Label>
            <Input ref={fileRef} type="file" accept="image/*,.pdf" onChange={e => setFile(e.target.files?.[0] ?? null)} />
          </div>
          <div>
            <Label>Note (optional)</Label>
            <Textarea value={note} onChange={e => setNote(e.target.value)} rows={2}
              placeholder="e.g. lump sum covering registration + books; balance held as credit" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={!canSave}>{saving ? 'Saving…' : 'Create Credit Note'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
