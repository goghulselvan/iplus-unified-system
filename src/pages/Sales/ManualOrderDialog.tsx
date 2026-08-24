import { useState, useEffect, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Trash2, Plus, Search, Upload } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';

type SchoolHit = {
  source: 'crm' | 'prospect';
  id: string;
  school_name: string;
  ss_no: number | null;
  address: string | null;
  district: string | null;
  state: string | null;
};

type Product = {
  id: string;
  name: string;
  unit_price: number;
  stock_quantity: number;
  class_number: number | null;
};

type LineItemForm = {
  product_id: string | null;
  quantity: number;
};

const PAYMENT_MODES = ['NEFT', 'IMPS', 'UPI', 'Cash', 'DD', 'Online Transfer'];

function emptyLine(): LineItemForm {
  return { product_id: null, quantity: 1 };
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (orderId: string) => void;
}

export default function ManualOrderDialog({ open, onOpenChange, onSaved }: Props) {
  const { toast } = useToast();
  const { user } = useAuth();

  const [schoolQuery, setSchoolQuery] = useState('');
  const [schoolHits, setSchoolHits] = useState<SchoolHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedSchool, setSelectedSchool] = useState<SchoolHit | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  const [products, setProducts] = useState<Product[]>([]);
  const [lineItems, setLineItems] = useState<LineItemForm[]>([emptyLine()]);

  const [availableCredit, setAvailableCredit] = useState<{ id: string; remaining_balance: number } | null>(null);
  const [applyCredit, setApplyCredit] = useState('');

  const [amount, setAmount] = useState('');
  const [payDate, setPayDate] = useState(new Date().toISOString().split('T')[0]);
  const [payMode, setPayMode] = useState('NEFT');
  const [utr, setUtr] = useState('');
  const [accountHolderName, setAccountHolderName] = useState('');
  const [notes, setNotes] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    supabase.from('products' as any).select('id, name, unit_price, stock_quantity, class_number').eq('is_active', true).order('class_number').order('name')
      .then(({ data }) => setProducts((data || []) as unknown as Product[]));

    setSelectedSchool(null);
    setSchoolQuery(''); setSchoolHits([]);
    setLineItems([emptyLine()]);
    setAmount(''); setPayDate(new Date().toISOString().split('T')[0]); setPayMode('NEFT');
    setUtr(''); setAccountHolderName(''); setNotes(''); setFile(null);
  }, [open]);

  useEffect(() => {
    if (!selectedSchool) { setAvailableCredit(null); setApplyCredit(''); return; }
    supabase.from('credit_notes_with_balance' as any)
      .select('id, remaining_balance')
      .eq('school_id', selectedSchool.id)
      .gt('remaining_balance', 0)
      .order('remaining_balance', { ascending: false })
      .limit(1)
      .then(({ data }) => {
        const row = (data?.[0] ?? null) as unknown as { id: string; remaining_balance: number } | null;
        setAvailableCredit(row);
        setApplyCredit('');
      });
  }, [selectedSchool?.id]);

  const searchSchools = async (q: string) => {
    setSchoolQuery(q);
    if (q.trim().length < 2) { setSchoolHits([]); return; }
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      const { data } = await supabase.rpc('search_schools_for_invoice' as any, { p_query: q.trim(), p_limit: 8 });
      setSchoolHits(((data as SchoolHit[]) ?? []).filter(h => h.source === 'crm'));
      setSearching(false);
    }, 300);
  };

  const pickSchool = (hit: SchoolHit) => {
    setSelectedSchool(hit);
    setSchoolQuery(''); setSchoolHits([]);
  };

  const addRow = () => setLineItems(prev => [...prev, emptyLine()]);
  const removeRow = (idx: number) => setLineItems(prev => prev.filter((_, i) => i !== idx));
  const updateRow = (idx: number, patch: Partial<LineItemForm>) => {
    setLineItems(prev => prev.map((l, i) => i === idx ? { ...l, ...patch } : l));
  };

  const productFor = (id: string | null) => products.find(p => p.id === id) ?? null;
  const cartTotal = lineItems.reduce((s, l) => {
    const p = productFor(l.product_id);
    return s + (p ? p.unit_price * l.quantity : 0);
  }, 0);

  const creditToApply = availableCredit ? Math.max(0, Math.min(parseFloat(applyCredit) || 0, availableCredit.remaining_balance, cartTotal)) : 0;
  const netDue = Math.max(cartTotal - creditToApply, 0);

  const canSave = !!selectedSchool
    && lineItems.length > 0
    && lineItems.every(l => l.product_id && l.quantity > 0)
    && payDate && payMode
    && (netDue === 0 ? true : (amount.trim() && parseFloat(amount) > 0 && !!file));

  const handleSave = async () => {
    if (!canSave || !selectedSchool) {
      toast({ title: 'Fill in all required fields', variant: 'destructive' });
      return;
    }
    setSaving(true);

    let screenshotUrl: string | null = null;
    if (netDue > 0) {
      if (!file) { setSaving(false); toast({ title: 'Payment proof is required', variant: 'destructive' }); return; }
      const ext = file.name.split('.').pop();
      const path = `${selectedSchool.id}/${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage.from('payment-proofs').upload(path, file, { upsert: true });
      if (upErr) {
        setSaving(false);
        toast({ title: 'Upload failed', description: upErr.message, variant: 'destructive' });
        return;
      }
      const { data: signedData } = await supabase.storage.from('payment-proofs').createSignedUrl(path, 63072000);
      screenshotUrl = signedData?.signedUrl ?? null;
      if (!screenshotUrl) {
        setSaving(false);
        toast({ title: 'Failed to prepare the uploaded file', variant: 'destructive' });
        return;
      }
    }

    const items = lineItems.map(l => ({ product_id: l.product_id, quantity: l.quantity }));
    const { data, error } = await supabase.rpc('create_manual_product_order' as any, {
      p_school_id: selectedSchool.id,
      p_items: items,
      p_payment_amount: netDue === 0 ? 0 : parseFloat(amount),
      p_payment_mode: payMode,
      p_payment_date: payDate,
      p_payment_utr_reference: utr.trim() || null,
      p_payment_account_holder_name: accountHolderName.trim() || null,
      p_payment_screenshot_url: screenshotUrl,
      p_notes: notes.trim() || null,
      p_credit_note_id: creditToApply > 0 ? availableCredit?.id ?? null : null,
      p_credit_amount: creditToApply > 0 ? creditToApply : null,
    });

    setSaving(false);
    if (error) { toast({ title: 'Error', description: error.message, variant: 'destructive' }); return; }

    // Order-received confirmation — fire-and-forget, doesn't block the dialog closing.
    // functions.invoke() resolves (doesn't reject) on a non-2xx response, so a plain
    // .catch() never sees a handled failure like "no active project" — must check
    // the resolved `error` too.
    const newOrderId = data as string;
    supabase.functions.invoke('send-whatsapp-template', {
      // Matches whatsapp_templates.template_key — our internal reference name,
      // NOT the actual AskEVA/Meta template name (that's askeva_template_name,
      // resolved server-side; it can differ, e.g. has a leading underscore there).
      body: { schoolId: selectedSchool.id, templateKey: 'book_order_confirmation', orderId: newOrderId },
    }).then(({ error: waError }) => {
      if (waError) toast({ title: 'Order created, but WhatsApp notification failed', description: waError.message, variant: 'destructive' });
    }).catch(console.error);
    if (user?.id) {
      supabase.functions.invoke('send-template-email', {
        body: { schoolId: selectedSchool.id, templateType: 'book_order_confirmation', userId: user.id, orderId: newOrderId },
      }).then(({ error: emailError }) => {
        if (emailError) toast({ title: 'Order created, but email notification failed', description: emailError.message, variant: 'destructive' });
      }).catch(console.error);
    }

    toast({ title: 'Order request created' });
    onSaved(newOrderId);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle>New Order Request (Manual)</DialogTitle></DialogHeader>

        <div className="space-y-4">
          <div>
            <Label>School (name or SS No)</Label>
            {selectedSchool ? (
              <div className="flex items-center justify-between border rounded-md px-3 py-2 bg-gray-50">
                <div>
                  <span className="text-sm font-medium">{selectedSchool.school_name}</span>
                  {selectedSchool.ss_no != null && <span className="text-xs text-muted-foreground ml-2">SS #{selectedSchool.ss_no}</span>}
                </div>
                <Button variant="ghost" size="sm" onClick={() => setSelectedSchool(null)}>Change</Button>
              </div>
            ) : (
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input className="pl-8" placeholder="Search school name or SS No…" value={schoolQuery}
                  onChange={e => searchSchools(e.target.value)} />
                {schoolHits.length > 0 && (
                  <div className="absolute z-10 w-full mt-1 bg-white border rounded-md shadow-lg max-h-56 overflow-y-auto">
                    {schoolHits.map(h => (
                      <button key={h.id} onClick={() => pickSchool(h)}
                        className="w-full text-left px-3 py-2 hover:bg-indigo-50 flex items-center justify-between">
                        <div>
                          <p className="text-sm font-medium">{h.school_name}</p>
                          <p className="text-xs text-muted-foreground">
                            {h.ss_no != null && `SS #${h.ss_no} · `}{[h.district, h.state].filter(Boolean).join(', ')}
                          </p>
                        </div>
                        <Badge variant="outline" className="text-[10px]">CRM</Badge>
                      </button>
                    ))}
                  </div>
                )}
                {searching && <p className="text-xs text-muted-foreground mt-1">Searching…</p>}
                <p className="text-xs text-muted-foreground mt-1">Only schools already registered in the CRM can order books. A prospect must be linked first.</p>
              </div>
            )}
          </div>

          <div className="border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left px-2 py-2 w-8">#</th>
                  <th className="text-left px-2 py-2">Product</th>
                  <th className="text-left px-2 py-2 w-24">Price</th>
                  <th className="text-left px-2 py-2 w-24">Stock</th>
                  <th className="text-left px-2 py-2 w-20">Qty</th>
                  <th className="text-right px-2 py-2 w-24">Total</th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody>
                {lineItems.map((l, idx) => {
                  const p = productFor(l.product_id);
                  const overStock = !!p && l.quantity > p.stock_quantity;
                  return (
                    <tr key={idx} className="border-t">
                      <td className="px-2 py-1.5">{idx + 1}</td>
                      <td className="px-2 py-1.5">
                        <Select value={l.product_id ?? ''} onValueChange={v => updateRow(idx, { product_id: v, quantity: 1 })}>
                          <SelectTrigger className="h-8"><SelectValue placeholder="Pick a product…" /></SelectTrigger>
                          <SelectContent>
                            {products.map(prod => (
                              <SelectItem key={prod.id} value={prod.id}>
                                {prod.name} {prod.stock_quantity <= 0 ? '(Out of Stock)' : ''}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {overStock && (
                          <p className="text-[11px] text-amber-600 mt-0.5">
                            Only {p!.stock_quantity} in stock — this line will wait as a backorder until restocked.
                          </p>
                        )}
                      </td>
                      <td className="px-2 py-1.5">{p ? `₹${p.unit_price.toLocaleString('en-IN')}` : '—'}</td>
                      <td className={`px-2 py-1.5 ${overStock ? 'text-amber-600 font-medium' : ''}`}>{p?.stock_quantity ?? '—'}</td>
                      <td className="px-2 py-1.5">
                        <Input
                          className={`h-8 ${overStock ? 'border-amber-400' : ''}`}
                          type="number" min="1" step="1" value={l.quantity}
                          onChange={e => updateRow(idx, { quantity: Math.max(1, Math.round(Number(e.target.value) || 1)) })}
                        />
                      </td>
                      <td className="px-2 py-1.5 text-right font-medium">{p ? `₹${(p.unit_price * l.quantity).toLocaleString('en-IN')}` : '—'}</td>
                      <td className="px-2 py-1.5">
                        {lineItems.length > 1 && (
                          <Button variant="ghost" size="sm" onClick={() => removeRow(idx)}><Trash2 className="h-3.5 w-3.5 text-red-600" /></Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <button onClick={addRow} className="w-full text-left px-3 py-2 text-sm text-indigo-600 hover:bg-indigo-50 border-t flex items-center gap-1.5">
              <Plus className="h-3.5 w-3.5" /> Add Row
            </button>
          </div>

          <div className="flex justify-end">
            <div className="w-56 flex justify-between font-semibold text-base border-t pt-1">
              <span>Cart Total</span><span>₹{cartTotal.toLocaleString('en-IN')}</span>
            </div>
          </div>

          <div className="border-t pt-4">
            <p className="text-sm font-semibold mb-3">Payment Details (as sent by the school)</p>
            {availableCredit && (
              <div className="border rounded-md p-3 bg-emerald-50 space-y-2 mb-3">
                <p className="text-sm font-medium text-emerald-800">
                  This school has ₹{availableCredit.remaining_balance.toLocaleString('en-IN', { minimumFractionDigits: 2 })} open credit.
                </p>
                <div>
                  <Label>Apply credit</Label>
                  <Input type="number" min={0} max={Math.min(availableCredit.remaining_balance, cartTotal)} step="0.01"
                    value={applyCredit} onChange={e => setApplyCredit(e.target.value)} placeholder="0.00" />
                </div>
                <p className="text-sm text-muted-foreground">
                  Net amount due: <span className="font-semibold text-foreground">₹{netDue.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                </p>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <Label>Amount Received (₹){netDue === 0 ? ' (fully covered by credit)' : ''}</Label>
                <Input type="number" min="1" step="0.01" value={amount}
                  onChange={e => setAmount(e.target.value)}
                  placeholder={cartTotal ? String(cartTotal) : ''} />
              </div>
              <div>
                <Label>Payment Date</Label>
                <Input type="date" value={payDate} max={new Date().toISOString().split('T')[0]} onChange={e => setPayDate(e.target.value)} />
              </div>
              <div>
                <Label>Payment Mode</Label>
                <Select value={payMode} onValueChange={setPayMode}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{PAYMENT_MODES.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label>UTR / Reference (optional)</Label>
                <Input value={utr} onChange={e => setUtr(e.target.value)} />
              </div>
              <div className="col-span-2">
                <Label>Account Holder Name (optional)</Label>
                <Input value={accountHolderName} onChange={e => setAccountHolderName(e.target.value)} />
              </div>
              <div className="col-span-2">
                <Label>Notes (optional)</Label>
                <Textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} />
              </div>
            </div>

            <Label>Payment Screenshot / Deposit Receipt{netDue === 0 ? ' (not required — fully covered by credit)' : ''}</Label>
            <div
              onClick={() => fileRef.current?.click()}
              className={`w-full px-4 py-4 rounded-lg border-2 border-dashed text-center cursor-pointer transition-colors ${
                file ? 'border-indigo-300 bg-indigo-50' : 'border-gray-300 hover:border-indigo-300 hover:bg-indigo-50/50'
              }`}
            >
              <Upload className={`h-5 w-5 mx-auto mb-1 ${file ? 'text-indigo-500' : 'text-muted-foreground'}`} />
              <p className="text-sm font-medium">{file ? file.name : 'Click to upload the screenshot forwarded by the school'}</p>
            </div>
            <input
              ref={fileRef} type="file" accept="image/*,.pdf" className="hidden"
              onChange={e => setFile(e.target.files?.[0] ?? null)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={!canSave || saving}>
            {saving ? 'Creating…' : 'Create Order Request'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
