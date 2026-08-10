import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import SalesLayout from '@/components/sales/SalesLayout';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { ArrowLeft, ZoomIn } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

type PaymentStatus = 'pending' | 'confirmed' | 'resubmit_requested';
type LineStatus = 'pending' | 'invoiced_unpaid' | 'paid' | 'dispatched' | 'rejected';

type OrderDetail = {
  id: string;
  notes: string | null;
  payment_amount: number;
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

  const load = async () => {
    setLoading(true);
    const [orderRes, itemsRes] = await Promise.all([
      supabase.from('product_orders' as any)
        .select('id, notes, payment_amount, payment_mode, payment_date, payment_utr_reference, payment_account_holder_name, payment_screenshot_url, payment_status, payment_review_note, schools(school_name)')
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

  const handleConfirm = async () => {
    const { error } = await supabase.rpc('confirm_product_order_payment' as any, { p_order_id: id });
    if (error) { toast({ title: 'Error', description: error.message, variant: 'destructive' }); return; }
    toast({ title: 'Order confirmed' });
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

  return (
    <SalesLayout>
      <div className="max-w-4xl mx-auto px-4 py-8">
        <button onClick={() => navigate('/sales/order-requests')} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-gray-900 mb-4">
          <ArrowLeft className="h-4 w-4" /> Back to Order Requests
        </button>

        <h1 className="text-3xl font-bold mb-1">{order.schools?.school_name ?? '—'}</h1>
        <p className="text-sm text-muted-foreground mb-6">₹{order.payment_amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })} · {order.payment_mode} · {new Date(order.payment_date).toLocaleDateString('en-IN')}</p>

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
            <div className="mt-3 text-sm bg-red-50 text-red-700 rounded-lg p-3">Resubmit reason: {order.payment_review_note}</div>
          )}

          {order.payment_status === 'pending' && (
            <div className="flex gap-2 mt-4">
              <Button onClick={handleConfirm}>Confirm Order</Button>
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
