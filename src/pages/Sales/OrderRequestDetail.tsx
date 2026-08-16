import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import SalesLayout from '@/components/sales/SalesLayout';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ArrowLeft, ZoomIn, Upload } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

type PaymentStatus = 'pending' | 'confirmed' | 'resubmit_requested';
type LineStatus = 'pending' | 'invoiced_unpaid' | 'paid' | 'dispatched' | 'rejected';

const PAYMENT_MODES = ['NEFT', 'IMPS', 'UPI', 'Cash', 'DD', 'Online Transfer'];

type OrderDetail = {
  id: string;
  order_number: number | null;
  fy: number | null;
  source: 'portal' | 'manual';
  notes: string | null;
  payment_amount: number;
  verified_amount: number | null;
  payment_mode: string;
  payment_date: string;
  payment_utr_reference: string | null;
  payment_account_holder_name: string | null;
  payment_screenshot_url: string;
  payment_status: PaymentStatus;
  payment_review_note: string | null;
  schools: { school_name: string } | null;
};

type ItemRow = {
  id: string;
  quantity: number;
  unit_price: number;
  line_status: LineStatus;
  rejected_reason: string | null;
  products: { name: string; stock_quantity: number } | null;
  invoices: { invoice_number: number; fy: number } | null;
};

const LINE_LABELS: Record<LineStatus, string> = {
  pending: 'Pending', invoiced_unpaid: 'Invoiced (Unpaid)', paid: 'Paid', dispatched: 'Dispatched', rejected: 'Rejected',
};

const lineBadge = (s: LineStatus) => {
  if (s === 'dispatched') return <Badge variant="outline" className="bg-emerald-50 text-emerald-600 border-emerald-100">{LINE_LABELS[s]}</Badge>;
  if (s === 'paid') return <Badge variant="outline" className="bg-emerald-50 text-emerald-600 border-emerald-100">{LINE_LABELS[s]}</Badge>;
  if (s === 'invoiced_unpaid') return <Badge variant="outline" className="bg-amber-50 text-amber-600 border-amber-100">{LINE_LABELS[s]}</Badge>;
  if (s === 'rejected') return <Badge variant="outline" className="bg-red-50 text-red-600 border-red-100">{LINE_LABELS[s]}</Badge>;
  return <Badge variant="outline" className="bg-neutral-100 text-neutral-500 border-neutral-200">{LINE_LABELS[s]}</Badge>;
};

export default function OrderRequestDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [items, setItems] = useState<ItemRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [resubmitOpen, setResubmitOpen] = useState(false);
  const [resubmitReason, setResubmitReason] = useState('');
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [proofOpen, setProofOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmVerifiedAmount, setConfirmVerifiedAmount] = useState('');
  const [updatePaymentOpen, setUpdatePaymentOpen] = useState(false);
  const [updatePaymentSaving, setUpdatePaymentSaving] = useState(false);
  const [updateAmount, setUpdateAmount] = useState('');
  const [updateMode, setUpdateMode] = useState('');
  const [updateDate, setUpdateDate] = useState('');
  const [updateUtr, setUpdateUtr] = useState('');
  const [updateHolder, setUpdateHolder] = useState('');
  const [updateScreenshotUrl, setUpdateScreenshotUrl] = useState('');
  const [updateScreenshotFile, setUpdateScreenshotFile] = useState<File | null>(null);
  const [updateNote, setUpdateNote] = useState('');
  const updateFileRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    setLoading(true);
    const [orderRes, itemsRes] = await Promise.all([
      supabase.from('product_orders' as any)
        .select('id, order_number, fy, source, notes, payment_amount, verified_amount, payment_mode, payment_date, payment_utr_reference, payment_account_holder_name, payment_screenshot_url, payment_status, payment_review_note, schools(school_name)')
        .eq('id', id).single(),
      supabase.from('product_order_items' as any)
        .select('id, quantity, unit_price, line_status, rejected_reason, products(name, stock_quantity), invoices(invoice_number, fy)')
        .eq('order_id', id),
    ]);
    if (orderRes.error) toast({ title: 'Error', description: orderRes.error.message, variant: 'destructive' });
    else setOrder(orderRes.data as unknown as OrderDetail);
    if (itemsRes.error) toast({ title: 'Error', description: itemsRes.error.message, variant: 'destructive' });
    else setItems((itemsRes.data || []) as unknown as ItemRow[]);
    setLoading(false);
  };

  useEffect(() => { load(); }, [id]);

  const toggleSelected = (itemId: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId); else next.add(itemId);
      return next;
    });
  };

  const openConfirmDialog = () => {
    setConfirmVerifiedAmount(String(order!.payment_amount));
    setConfirmOpen(true);
  };

  const handleConfirm = async () => {
    const { error } = await supabase.rpc('confirm_product_order_payment' as any, {
      p_order_id: id,
      p_verified_amount: Number(confirmVerifiedAmount),
    });
    if (error) { toast({ title: 'Error', description: error.message, variant: 'destructive' }); return; }
    toast({ title: 'Order confirmed' });
    setConfirmOpen(false);
    load();
  };

  const handleRequestResubmit = async () => {
    if (!resubmitReason.trim()) return;
    const { error } = await supabase.rpc('request_order_payment_resubmit' as any, { p_order_id: id, p_reason: resubmitReason.trim() });
    if (error) { toast({ title: 'Error', description: error.message, variant: 'destructive' }); return; }
    toast({ title: 'Resubmit requested' });
    setResubmitOpen(false); setResubmitReason('');
    load();
  };

  const openUpdatePaymentDialog = () => {
    if (!order) return;
    setUpdateAmount(String(order.payment_amount));
    setUpdateMode(order.payment_mode);
    setUpdateDate(order.payment_date.slice(0, 10));
    setUpdateUtr(order.payment_utr_reference ?? '');
    setUpdateHolder(order.payment_account_holder_name ?? '');
    setUpdateScreenshotUrl(order.payment_screenshot_url);
    setUpdateScreenshotFile(null);
    setUpdateNote('');
    setUpdatePaymentOpen(true);
  };

  const handleUpdatePayment = async () => {
    setUpdatePaymentSaving(true);

    let screenshotUrl = updateScreenshotUrl;
    if (updateScreenshotFile) {
      const ext = updateScreenshotFile.name.split('.').pop();
      const path = `${id}/${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage.from('payment-proofs').upload(path, updateScreenshotFile, { upsert: true });
      if (upErr) {
        setUpdatePaymentSaving(false);
        toast({ title: 'Upload failed', description: upErr.message, variant: 'destructive' });
        return;
      }
      const { data: signedData } = await supabase.storage.from('payment-proofs').createSignedUrl(path, 63072000);
      if (!signedData?.signedUrl) {
        setUpdatePaymentSaving(false);
        toast({ title: 'Failed to prepare the uploaded file', variant: 'destructive' });
        return;
      }
      screenshotUrl = signedData.signedUrl;
      setUpdateScreenshotUrl(screenshotUrl);
    }

    const { error } = await supabase.rpc('update_order_payment_details' as any, {
      p_order_id: id,
      p_payment_amount: Number(updateAmount),
      p_payment_mode: updateMode,
      p_payment_date: updateDate,
      p_payment_utr_reference: updateUtr || null,
      p_payment_account_holder_name: updateHolder || null,
      p_payment_screenshot_url: screenshotUrl,
      p_note: updateNote.trim() || null,
    });
    setUpdatePaymentSaving(false);
    if (error) { toast({ title: 'Error', description: error.message, variant: 'destructive' }); return; }
    toast({ title: 'Payment details updated' });
    setUpdatePaymentOpen(false);
    load();
  };

  const handleApprove = async () => {
    if (selected.size === 0) return;
    const { data, error } = await supabase.rpc('approve_order_items' as any, { p_order_id: id, p_item_ids: Array.from(selected) });
    if (error) { toast({ title: 'Error', description: error.message, variant: 'destructive' }); return; }
    toast({ title: 'Invoice created' });
    setSelected(new Set());
    load();
  };

  const handleReject = async () => {
    if (selected.size === 0 || !rejectReason.trim()) return;
    const { error } = await supabase.rpc('reject_order_items' as any, { p_order_id: id, p_item_ids: Array.from(selected), p_reason: rejectReason.trim() });
    if (error) { toast({ title: 'Error', description: error.message, variant: 'destructive' }); return; }
    toast({ title: 'Items rejected' });
    setRejectOpen(false); setRejectReason(''); setSelected(new Set());
    load();
  };

  if (loading || !order) {
    return <SalesLayout><div className="max-w-4xl mx-auto px-4 py-8 text-muted-foreground">Loading…</div></SalesLayout>;
  }

  // Only pending line items are what Confirm is about to process — already-invoiced
  // or rejected lines aren't part of what "the order's actual total" means here.
  const computedOrderTotal = items
    .filter(i => i.line_status === 'pending')
    .reduce((sum, i) => sum + i.quantity * i.unit_price, 0);

  return (
    <SalesLayout>
      <div className="max-w-4xl mx-auto px-4 py-8">
        <button onClick={() => navigate('/sales/order-requests')} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-gray-900 mb-4">
          <ArrowLeft className="h-4 w-4" /> Back to Order Requests
        </button>

        <div className="flex items-center gap-2 mb-1">
          <h1 className="text-3xl font-bold">{order.schools?.school_name ?? '—'}</h1>
          {order.order_number != null && order.fy != null && (
            <span className="font-mono text-sm text-muted-foreground bg-neutral-100 px-2 py-1 rounded-md">
              ORD/{order.fy}-{order.fy + 1}/{order.order_number}
            </span>
          )}
          {order.source === 'manual' && <Badge variant="outline" className="text-xs bg-blue-50 text-blue-600 border-blue-100">Manual Order</Badge>}
        </div>
        <p className="text-sm text-muted-foreground mb-6">
          ₹{order.payment_amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })} · {order.payment_mode} · {new Date(order.payment_date).toLocaleDateString('en-IN')}
          {order.verified_amount != null && Number(order.verified_amount) !== Number(order.payment_amount) && (
            <span className="ml-2 text-amber-600 font-medium">⚠ Verified: ₹{order.verified_amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
          )}
        </p>

        <div className="bg-white rounded-xl border border-neutral-200 shadow-sm p-5 mb-6">
          <div className="flex items-center justify-between mb-3">
            <div className="font-semibold">Payment Proof</div>
          </div>
          <button
            type="button"
            onClick={() => setProofOpen(true)}
            className="group relative block max-w-sm mb-3"
          >
            <img src={order.payment_screenshot_url} alt="Payment proof" className="w-full rounded-lg border border-neutral-200 group-hover:opacity-90 transition-opacity" />
            <span className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/10 rounded-lg transition-colors">
              <ZoomIn className="h-6 w-6 text-white opacity-0 group-hover:opacity-100 drop-shadow transition-opacity" />
            </span>
          </button>
          <div className="text-sm text-muted-foreground grid grid-cols-2 gap-2">
            <div>UTR / Reference: {order.payment_utr_reference || '—'}</div>
            <div>Account Holder: {order.payment_account_holder_name || '—'}</div>
          </div>
          {order.payment_review_note && (
            <div className={`mt-3 text-sm rounded-lg p-3 whitespace-pre-line ${order.payment_status === 'resubmit_requested' ? 'bg-red-50 text-red-700' : 'bg-neutral-50 text-neutral-700'}`}>
              {order.payment_status === 'resubmit_requested' ? 'Resubmit reason: ' : 'Notes: '}{order.payment_review_note}
            </div>
          )}

          {order.payment_status === 'pending' && (
            <div className="flex gap-2 mt-4">
              <Button onClick={openConfirmDialog}>Confirm Order</Button>
              <Button variant="outline" onClick={openUpdatePaymentDialog}>Update Payment</Button>
              <Button variant="outline" onClick={() => setResubmitOpen(true)}>Request Resubmit</Button>
            </div>
          )}
          {order.payment_status === 'resubmit_requested' && (
            <p className="text-sm text-amber-600 mt-4">Waiting for the school to resubmit payment proof.</p>
          )}
        </div>

        <div className="bg-white rounded-xl border border-neutral-200 shadow-sm overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                {order.payment_status === 'confirmed' && <TableHead className="w-10"></TableHead>}
                <TableHead>Product</TableHead>
                <TableHead>Qty</TableHead>
                <TableHead>Stock</TableHead>
                <TableHead>Unit Price</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Invoice</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map(i => (
                <TableRow key={i.id}>
                  {order.payment_status === 'confirmed' && (
                    <TableCell>
                      {i.line_status === 'pending' && (
                        <Checkbox
                          checked={selected.has(i.id)}
                          disabled={!!i.products && i.quantity > i.products.stock_quantity}
                          onCheckedChange={() => toggleSelected(i.id)}
                        />
                      )}
                    </TableCell>
                  )}
                  <TableCell className="font-medium">{i.products?.name ?? '—'}</TableCell>
                  <TableCell>{i.quantity}</TableCell>
                  <TableCell className={i.products && i.quantity > i.products.stock_quantity ? 'text-red-600 font-medium' : ''}>
                    {i.products?.stock_quantity ?? '—'}
                  </TableCell>
                  <TableCell>₹{i.unit_price.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</TableCell>
                  <TableCell>
                    {lineBadge(i.line_status)}
                    {i.line_status === 'rejected' && i.rejected_reason && (
                      <div className="text-xs text-muted-foreground mt-1">{i.rejected_reason}</div>
                    )}
                  </TableCell>
                  <TableCell>{i.invoices ? `INV/${i.invoices.fy}-${i.invoices.fy + 1}/${i.invoices.invoice_number}` : '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        {order.payment_status === 'confirmed' && (
          <div className="flex gap-2 mt-4">
            <Button onClick={handleApprove} disabled={selected.size === 0}>Approve Selected → Create Invoice</Button>
            <Button variant="outline" onClick={() => setRejectOpen(true)} disabled={selected.size === 0}>Reject Selected</Button>
          </div>
        )}
      </div>

      <Dialog open={proofOpen} onOpenChange={setProofOpen}>
        <DialogContent className="max-w-3xl p-2">
          <img src={order.payment_screenshot_url} alt="Payment proof" className="w-full max-h-[80vh] object-contain rounded" />
          <DialogFooter className="px-2 pb-2">
            <Button variant="outline" onClick={() => setProofOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={resubmitOpen} onOpenChange={setResubmitOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Request Payment Resubmit</DialogTitle></DialogHeader>
          <Textarea value={resubmitReason} onChange={e => setResubmitReason(e.target.value)} placeholder="Reason (shown to the school)" />
          <DialogFooter>
            <Button variant="outline" onClick={() => setResubmitOpen(false)}>Cancel</Button>
            <Button onClick={handleRequestResubmit} disabled={!resubmitReason.trim()}>Request Resubmit</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Confirm Order</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Declared amount: ₹{order.payment_amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}. Enter what the screenshot actually shows.
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="confirm-verified-amount">Verified Amount (₹)</Label>
              <Input
                id="confirm-verified-amount"
                type="number"
                min="0"
                step="0.01"
                value={confirmVerifiedAmount}
                onChange={(e) => setConfirmVerifiedAmount(e.target.value)}
              />
            </div>
            {confirmVerifiedAmount !== '' && Number(confirmVerifiedAmount) !== Number(order.payment_amount) && (
              <p className="text-sm bg-amber-50 text-amber-700 rounded-lg p-3">
                This differs from the declared amount — the verified figure is what gets recorded against this order.
              </p>
            )}
            {confirmVerifiedAmount !== '' && Number(confirmVerifiedAmount) < computedOrderTotal && (
              <p className="text-sm bg-amber-50 text-amber-700 rounded-lg p-3">
                This is less than the order's actual total (₹{computedOrderTotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}). The order will still be marked as fully paid — confirm this is intentional.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>Cancel</Button>
            <Button onClick={handleConfirm} disabled={confirmVerifiedAmount === '' || Number(confirmVerifiedAmount) <= 0}>Confirm & Record</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={updatePaymentOpen} onOpenChange={setUpdatePaymentOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Update Payment Details</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Use this when more proof arrives (e.g. a second transfer covering a shortfall) before the order is confirmed.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="update-amount">Total Amount (₹)</Label>
                <Input id="update-amount" type="number" min="0" step="0.01" value={updateAmount} onChange={(e) => setUpdateAmount(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="update-mode">Payment Mode</Label>
                <Select value={updateMode} onValueChange={setUpdateMode}>
                  <SelectTrigger id="update-mode"><SelectValue /></SelectTrigger>
                  <SelectContent>{PAYMENT_MODES.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="update-date">Payment Date</Label>
                <Input id="update-date" type="date" value={updateDate} onChange={(e) => setUpdateDate(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="update-utr">UTR / Reference</Label>
                <Input id="update-utr" value={updateUtr} onChange={(e) => setUpdateUtr(e.target.value)} />
              </div>
              <div className="space-y-1.5 col-span-2">
                <Label htmlFor="update-holder">Account Holder</Label>
                <Input id="update-holder" value={updateHolder} onChange={(e) => setUpdateHolder(e.target.value)} />
              </div>
              <div className="space-y-1.5 col-span-2">
                <Label>Payment Screenshot / Deposit Receipt</Label>
                {order.payment_screenshot_url && (
                  <a
                    href={order.payment_screenshot_url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-2 text-xs text-indigo-600 hover:underline mb-1.5"
                  >
                    <img src={order.payment_screenshot_url} alt="Current proof on file" className="h-10 w-10 object-cover rounded border border-neutral-200" />
                    View current proof on file
                  </a>
                )}
                <div
                  onClick={() => updateFileRef.current?.click()}
                  className={`w-full px-4 py-4 rounded-lg border-2 border-dashed text-center cursor-pointer transition-colors ${
                    updateScreenshotFile ? 'border-indigo-300 bg-indigo-50' : 'border-gray-300 hover:border-indigo-300 hover:bg-indigo-50/50'
                  }`}
                >
                  <Upload className={`h-5 w-5 mx-auto mb-1 ${updateScreenshotFile ? 'text-indigo-500' : 'text-muted-foreground'}`} />
                  <p className="text-sm font-medium">
                    {updateScreenshotFile ? updateScreenshotFile.name : 'Click to replace with a new screenshot (optional — leave as-is to keep the current proof)'}
                  </p>
                </div>
                <input
                  ref={updateFileRef} type="file" accept="image/*,.pdf" className="hidden"
                  onChange={(e) => setUpdateScreenshotFile(e.target.files?.[0] ?? null)}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="update-note">Note (optional, appended to the review note)</Label>
              <Textarea id="update-note" value={updateNote} onChange={(e) => setUpdateNote(e.target.value)} placeholder="e.g. Second transfer of ₹2,000 confirmed via WhatsApp" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUpdatePaymentOpen(false)}>Cancel</Button>
            <Button
              onClick={handleUpdatePayment}
              disabled={updateAmount === '' || Number(updateAmount) < 0 || !updateScreenshotUrl || updatePaymentSaving}
            >
              {updatePaymentSaving ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Reject Selected Items</DialogTitle></DialogHeader>
          <Textarea value={rejectReason} onChange={e => setRejectReason(e.target.value)} placeholder="Reason (shown to the school)" />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handleReject} disabled={!rejectReason.trim()}>Reject</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SalesLayout>
  );
}
