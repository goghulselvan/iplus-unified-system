import { useState, useEffect, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Trash2, Plus, Search } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

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
  hsn_code: string | null;
  gst_rate: number;
  unit_price: number;
};

export type LineItemForm = {
  product_id: string | null;
  item_name: string;
  hsn_code: string;
  gst_rate: number;
  quantity: number;
  unit_price: number;
};

export type EditingInvoice = {
  id: string;
  school_id: string | null;
  prospect_school_id: string | null;
  buyer_name: string;
  buyer_ss_no: number | null;
  buyer_address: string;
  buyer_state: string;
  buyer_gstin: string;
  payment_method: string;
  line_items: LineItemForm[];
};

const PAYMENT_METHODS = ['Cash Deposit', 'UPI', 'Online Transfer'];
const GST_RATES = [0, 5, 12, 18, 28];

function emptyLine(): LineItemForm {
  return { product_id: null, item_name: '', hsn_code: '', gst_rate: 18, quantity: 1, unit_price: 0 };
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editingInvoice: EditingInvoice | null;
  onSaved: (result: { id: string; invoice_number?: number; fy?: number; low_stock_warnings?: any[] }) => void;
}

export default function InvoiceDialog({ open, onOpenChange, editingInvoice, onSaved }: Props) {
  const { toast } = useToast();
  const isEdit = !!editingInvoice;

  const [schoolQuery, setSchoolQuery] = useState('');
  const [schoolHits, setSchoolHits] = useState<SchoolHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedSchool, setSelectedSchool] = useState<SchoolHit | null>(null);

  const [buyerName, setBuyerName] = useState('');
  const [buyerAddress, setBuyerAddress] = useState('');
  const [buyerState, setBuyerState] = useState('');
  const [buyerGstin, setBuyerGstin] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('Cash Deposit');

  const [products, setProducts] = useState<Product[]>([]);
  const [lineItems, setLineItems] = useState<LineItemForm[]>([emptyLine()]);
  const [saving, setSaving] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (!open) return;
    supabase.from('products' as any).select('id, name, hsn_code, gst_rate, unit_price').eq('is_active', true).order('name')
      .then(({ data }) => setProducts((data || []) as unknown as Product[]));

    if (editingInvoice) {
      setSelectedSchool({
        source: editingInvoice.school_id ? 'crm' : 'prospect',
        id: (editingInvoice.school_id || editingInvoice.prospect_school_id)!,
        school_name: editingInvoice.buyer_name,
        ss_no: editingInvoice.buyer_ss_no,
        address: editingInvoice.buyer_address,
        district: null,
        state: editingInvoice.buyer_state,
      });
      setBuyerName(editingInvoice.buyer_name);
      setBuyerAddress(editingInvoice.buyer_address);
      setBuyerState(editingInvoice.buyer_state);
      setBuyerGstin(editingInvoice.buyer_gstin);
      setPaymentMethod(editingInvoice.payment_method);
      setLineItems(editingInvoice.line_items.length ? editingInvoice.line_items : [emptyLine()]);
    } else {
      setSelectedSchool(null);
      setBuyerName(''); setBuyerAddress(''); setBuyerState(''); setBuyerGstin('');
      setPaymentMethod('Cash Deposit');
      setLineItems([emptyLine()]);
    }
    setSchoolQuery(''); setSchoolHits([]);
  }, [open, editingInvoice]);

  const searchSchools = async (q: string) => {
    setSchoolQuery(q);
    if (q.trim().length < 2) { setSchoolHits([]); return; }
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      const { data } = await supabase.rpc('search_schools_for_invoice' as any, { p_query: q.trim(), p_limit: 6 });
      setSchoolHits((data as SchoolHit[]) ?? []);
      setSearching(false);
    }, 300);
  };

  const pickSchool = (hit: SchoolHit) => {
    setSelectedSchool(hit);
    setBuyerName(hit.school_name);
    setBuyerAddress(hit.address || '');
    setBuyerState(hit.state || '');
    setSchoolQuery(''); setSchoolHits([]);
  };

  const addRow = () => setLineItems(prev => [...prev, emptyLine()]);
  const removeRow = (idx: number) => setLineItems(prev => prev.filter((_, i) => i !== idx));
  const updateRow = (idx: number, patch: Partial<LineItemForm>) => {
    setLineItems(prev => prev.map((l, i) => i === idx ? { ...l, ...patch } : l));
  };

  const pickProduct = (idx: number, productId: string) => {
    const p = products.find(p => p.id === productId);
    if (!p) return;
    updateRow(idx, { product_id: p.id, item_name: p.name, hsn_code: p.hsn_code || '', gst_rate: p.gst_rate, unit_price: p.unit_price });
  };

  const isTn = buyerState.trim().toLowerCase() === 'tamil nadu';
  const subtotal = lineItems.reduce((s, l) => s + l.quantity * l.unit_price, 0);
  const totalTax = lineItems.reduce((s, l) => s + (l.quantity * l.unit_price * l.gst_rate) / 100, 0);
  const cgst = isTn ? totalTax / 2 : 0;
  const sgst = isTn ? totalTax / 2 : 0;
  const igst = isTn ? 0 : totalTax;
  const grandTotal = subtotal + totalTax;

  const canSave = !!(selectedSchool || isEdit) && buyerName.trim() && buyerState.trim() && paymentMethod
    && lineItems.length > 0 && lineItems.every(l => l.item_name.trim() && l.quantity > 0);

  const handleSave = async () => {
    if (!canSave) { toast({ title: 'Fill in all required fields', variant: 'destructive' }); return; }
    setSaving(true);
    const payloadLineItems = lineItems.map(l => ({
      product_id: l.product_id, item_name: l.item_name.trim(), hsn_code: l.hsn_code || null,
      gst_rate: l.gst_rate, quantity: l.quantity, unit_price: l.unit_price,
    }));

    if (isEdit) {
      const { data, error } = await supabase.rpc('update_invoice' as any, {
        p_invoice_id: editingInvoice!.id,
        p_buyer_name: buyerName.trim(), p_buyer_address: buyerAddress.trim() || null,
        p_buyer_state: buyerState.trim(), p_buyer_gstin: buyerGstin.trim() || null,
        p_payment_method: paymentMethod, p_line_items: payloadLineItems,
      });
      setSaving(false);
      if (error) { toast({ title: 'Error', description: error.message, variant: 'destructive' }); return; }
      toast({ title: 'Invoice updated' });
      onSaved({ id: editingInvoice!.id, low_stock_warnings: (data as any)?.low_stock_warnings });
    } else {
      const { data, error } = await supabase.rpc('create_invoice' as any, {
        p_school_id: selectedSchool!.source === 'crm' ? selectedSchool!.id : null,
        p_prospect_school_id: selectedSchool!.source === 'prospect' ? selectedSchool!.id : null,
        p_buyer_name: buyerName.trim(), p_buyer_address: buyerAddress.trim() || null,
        p_buyer_state: buyerState.trim(), p_buyer_gstin: buyerGstin.trim() || null,
        p_payment_method: paymentMethod, p_line_items: payloadLineItems,
      });
      setSaving(false);
      if (error) { toast({ title: 'Error', description: error.message, variant: 'destructive' }); return; }
      toast({ title: 'Invoice created' });
      const r = data as any;
      onSaved({ id: r.id, invoice_number: r.invoice_number, fy: r.fy, low_stock_warnings: r.low_stock_warnings });
    }
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{isEdit ? 'Edit Invoice' : 'New Invoice'}</DialogTitle></DialogHeader>

        <div className="space-y-4">
          {!isEdit && (
            <div>
              <Label>School (name or SS No)</Label>
              {selectedSchool ? (
                <div className="flex items-center justify-between border rounded-md px-3 py-2 bg-gray-50">
                  <span className="text-sm font-medium">{selectedSchool.school_name}</span>
                  <Button variant="ghost" size="sm" onClick={() => { setSelectedSchool(null); setBuyerName(''); setBuyerAddress(''); setBuyerState(''); }}>Change</Button>
                </div>
              ) : (
                <div className="relative">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input className="pl-8" placeholder="Search school name or SS No…" value={schoolQuery}
                    onChange={e => searchSchools(e.target.value)} />
                  {schoolHits.length > 0 && (
                    <div className="absolute z-10 w-full mt-1 bg-white border rounded-md shadow-lg max-h-56 overflow-y-auto">
                      {schoolHits.map(h => (
                        <button key={`${h.source}-${h.id}`} onClick={() => pickSchool(h)}
                          className="w-full text-left px-3 py-2 hover:bg-indigo-50 flex items-center justify-between">
                          <div>
                            <p className="text-sm font-medium">{h.school_name}</p>
                            <p className="text-xs text-muted-foreground">
                              {h.ss_no != null && `SS #${h.ss_no} · `}{[h.district, h.state].filter(Boolean).join(', ')}
                            </p>
                          </div>
                          <Badge variant="outline" className="text-[10px]">{h.source === 'crm' ? 'CRM' : 'Prospect'}</Badge>
                        </button>
                      ))}
                    </div>
                  )}
                  {searching && <p className="text-xs text-muted-foreground mt-1">Searching…</p>}
                </div>
              )}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Buyer Name</Label>
              <Input value={buyerName} onChange={e => setBuyerName(e.target.value)} />
            </div>
            <div>
              <Label>State</Label>
              <Input value={buyerState} onChange={e => setBuyerState(e.target.value)} />
            </div>
            <div className="col-span-2">
              <Label>Address</Label>
              <Input value={buyerAddress} onChange={e => setBuyerAddress(e.target.value)} />
            </div>
            <div>
              <Label>GSTIN (optional)</Label>
              <Input value={buyerGstin} onChange={e => setBuyerGstin(e.target.value)} />
            </div>
            <div>
              <Label>Payment Method</Label>
              <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PAYMENT_METHODS.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left px-2 py-2 w-8">#</th>
                  <th className="text-left px-2 py-2">Item</th>
                  <th className="text-left px-2 py-2 w-20">GST%</th>
                  <th className="text-left px-2 py-2 w-20">Price</th>
                  <th className="text-left px-2 py-2 w-16">Qty</th>
                  <th className="text-right px-2 py-2 w-24">Total</th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody>
                {lineItems.map((l, idx) => (
                  <tr key={idx} className="border-t">
                    <td className="px-2 py-1.5">{idx + 1}</td>
                    <td className="px-2 py-1.5">
                      <Select value={l.product_id ?? '__custom__'} onValueChange={v => v === '__custom__' ? updateRow(idx, { product_id: null }) : pickProduct(idx, v)}>
                        <SelectTrigger className="h-8 mb-1"><SelectValue placeholder="Pick a product…" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__custom__">Custom item…</SelectItem>
                          {products.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      <Input className="h-8" placeholder="Item name" value={l.item_name} onChange={e => updateRow(idx, { item_name: e.target.value })} disabled={!!l.product_id} />
                    </td>
                    <td className="px-2 py-1.5">
                      <Select value={String(l.gst_rate)} onValueChange={v => updateRow(idx, { gst_rate: Number(v) })}>
                        <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                        <SelectContent>{GST_RATES.map(r => <SelectItem key={r} value={String(r)}>{r}%</SelectItem>)}</SelectContent>
                      </Select>
                    </td>
                    <td className="px-2 py-1.5">
                      <Input className="h-8" type="number" min="0" step="0.01" value={l.unit_price} onChange={e => updateRow(idx, { unit_price: Number(e.target.value) })} />
                    </td>
                    <td className="px-2 py-1.5">
                      <Input className="h-8" type="number" min="1" step="1" value={l.quantity} onChange={e => updateRow(idx, { quantity: Math.max(1, Math.round(Number(e.target.value) || 1)) })} />
                    </td>
                    <td className="px-2 py-1.5 text-right font-medium">₹{(l.quantity * l.unit_price).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
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
              <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span>₹{subtotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span></div>
              {isTn ? (
                <>
                  <div className="flex justify-between"><span className="text-muted-foreground">CGST</span><span>₹{cgst.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">SGST</span><span>₹{sgst.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span></div>
                </>
              ) : (
                <div className="flex justify-between"><span className="text-muted-foreground">IGST</span><span>₹{igst.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span></div>
              )}
              <div className="flex justify-between font-semibold text-base border-t pt-1"><span>Grand Total</span><span>₹{grandTotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span></div>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={!canSave || saving}>
            {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Generate Invoice'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
