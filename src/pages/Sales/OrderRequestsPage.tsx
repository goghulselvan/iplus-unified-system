import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import SalesLayout from '@/components/sales/SalesLayout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import ManualOrderDialog from './ManualOrderDialog';

type PaymentStatus = 'pending' | 'confirmed' | 'resubmit_requested';
type LineStatus = 'pending' | 'invoiced_unpaid' | 'paid' | 'dispatched' | 'rejected';

type OrderRow = {
  id: string;
  order_number: number | null;
  fy: number | null;
  source: 'portal' | 'manual';
  payment_amount: number;
  verified_amount: number | null;
  payment_status: PaymentStatus;
  created_at: string;
  schools: { school_name: string } | null;
  product_order_items: { line_status: LineStatus }[];
};

const orderRef = (o: { order_number: number | null; fy: number | null }) =>
  o.order_number != null && o.fy != null ? `ORD/${o.fy}-${o.fy + 1}/${o.order_number}` : '—';

const PAGE_SIZE = 200;

const PAYMENT_LABELS: Record<PaymentStatus, string> = {
  pending: 'Pending Review',
  confirmed: 'Confirmed',
  resubmit_requested: 'Resubmit Requested',
};

const paymentBadge = (s: PaymentStatus) => {
  if (s === 'confirmed') return <Badge variant="outline" className="bg-emerald-50 text-emerald-600 border-emerald-100">{PAYMENT_LABELS[s]}</Badge>;
  if (s === 'resubmit_requested') return <Badge variant="outline" className="bg-red-50 text-red-600 border-red-100">{PAYMENT_LABELS[s]}</Badge>;
  return <Badge variant="outline" className="bg-amber-50 text-amber-600 border-amber-100">{PAYMENT_LABELS[s]}</Badge>;
};

const rollup = (items: { line_status: LineStatus }[]) => {
  if (items.length === 0) return <span className="text-muted-foreground">—</span>;
  const counts: Record<LineStatus, number> = { pending: 0, invoiced_unpaid: 0, paid: 0, dispatched: 0, rejected: 0 };
  items.forEach(i => { counts[i.line_status]++; });
  const parts: string[] = [];
  if (counts.dispatched) parts.push(`${counts.dispatched} dispatched`);
  if (counts.paid) parts.push(`${counts.paid} paid`);
  if (counts.invoiced_unpaid) parts.push(`${counts.invoiced_unpaid} invoiced`);
  if (counts.rejected) parts.push(`${counts.rejected} rejected`);
  return (
    <span className="flex items-center gap-2 flex-wrap">
      {counts.pending > 0 && (
        <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-red-100 text-red-700 text-xs font-semibold">
          {counts.pending} pending
        </span>
      )}
      {parts.length > 0 && <span className="text-muted-foreground">{parts.join(' · ')}</span>}
      {counts.pending === 0 && parts.length === 0 && <span className="text-muted-foreground">—</span>}
    </span>
  );
};

export default function OrderRequestsPage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [statusFilter, setStatusFilter] = useState('all');
  const [manualOpen, setManualOpen] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(false);
    const { data, error: loadErr } = await supabase
      .from('product_orders' as any)
      .select('id, order_number, fy, source, payment_amount, verified_amount, payment_status, created_at, schools(school_name), product_order_items(line_status)')
      .order('created_at', { ascending: false })
      .limit(PAGE_SIZE);
    if (loadErr) {
      setError(true);
      toast({ title: 'Error', description: loadErr.message, variant: 'destructive' });
    } else {
      setOrders((data || []) as unknown as OrderRow[]);
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const filtered = useMemo(
    () => statusFilter === 'all' ? orders : orders.filter(o => o.payment_status === statusFilter),
    [orders, statusFilter]
  );

  return (
    <SalesLayout>
      <div className="max-w-6xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-3xl font-bold">Order Requests</h1>
          <div className="flex items-center gap-3">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="pending">Pending Review</SelectItem>
                <SelectItem value="confirmed">Confirmed</SelectItem>
                <SelectItem value="resubmit_requested">Resubmit Requested</SelectItem>
              </SelectContent>
            </Select>
            <Button onClick={() => setManualOpen(true)}><Plus className="h-4 w-4 mr-2" />New Order Request</Button>
          </div>
        </div>

        <ManualOrderDialog
          open={manualOpen}
          onOpenChange={setManualOpen}
          onSaved={orderId => navigate(`/sales/order-requests/${orderId}`)}
        />

        <div className="bg-white rounded-xl border border-neutral-200 shadow-sm overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Order No.</TableHead>
                <TableHead>School</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Payment Status</TableHead>
                <TableHead>Items</TableHead>
                <TableHead>Submitted</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>
              ) : error ? (
                <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">—</TableCell></TableRow>
              ) : filtered.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">No order requests.</TableCell></TableRow>
              ) : (
                filtered.map(o => (
                  <TableRow key={o.id} className="cursor-pointer hover:bg-neutral-50" onClick={() => navigate(`/sales/order-requests/${o.id}`)}>
                    <TableCell className="font-mono text-sm">
                      <div className="flex items-center gap-1.5">
                        {orderRef(o)}
                        {o.source === 'manual' && <Badge variant="outline" className="text-[10px] bg-blue-50 text-blue-600 border-blue-100">Manual</Badge>}
                      </div>
                    </TableCell>
                    <TableCell className="font-medium">{o.schools?.school_name ?? '—'}</TableCell>
                    <TableCell>
                      ₹{o.payment_amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      {o.verified_amount != null && Number(o.verified_amount) !== Number(o.payment_amount) && (
                        <div className="text-xs font-normal text-amber-600 mt-0.5">
                          ⚠ Verified: ₹{Number(o.verified_amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>{paymentBadge(o.payment_status)}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{rollup(o.product_order_items)}</TableCell>
                    <TableCell>{new Date(o.created_at).toLocaleDateString('en-IN')}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </SalesLayout>
  );
}
