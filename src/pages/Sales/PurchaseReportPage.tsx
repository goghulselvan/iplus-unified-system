import { useState, useEffect, useMemo } from 'react';
import SalesLayout from '@/components/sales/SalesLayout';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

type PoStatus = 'draft' | 'ordered' | 'partially_received' | 'received' | 'cancelled';

const STATUS_LABELS: Record<PoStatus, string> = {
  draft: 'Draft',
  ordered: 'Ordered',
  partially_received: 'Partially Received',
  received: 'Received',
  cancelled: 'Cancelled',
};

const PENDING_STATUSES: PoStatus[] = ['draft', 'ordered', 'partially_received'];

const PAGE_SIZE = 200;

type PurchaseOrderRow = {
  id: string;
  po_number: number;
  supplier_id: string;
  order_date: string;
  status: PoStatus;
  created_at: string;
};

type PoItemRow = {
  id: string;
  purchase_order_id: string;
  quantity_ordered: number;
  unit_cost: number;
};

type GrnRow = {
  id: string;
  purchase_order_id: string;
  received_date: string;
};

type GrnItemRow = {
  grn_id: string;
  po_item_id: string;
  quantity_received: number;
};

type ReportRow = PurchaseOrderRow & {
  supplierName: string;
  orderedQty: number;
  orderedValue: number;
  receivedQty: number;
  receivedValue: number;
  lastReceivedDate: string | null;
};

export default function PurchaseReportPage() {
  const { toast } = useToast();
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrderRow[]>([]);
  const [poItems, setPoItems] = useState<PoItemRow[]>([]);
  const [grns, setGrns] = useState<GrnRow[]>([]);
  const [grnItems, setGrnItems] = useState<GrnItemRow[]>([]);
  const [suppliers, setSuppliers] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [supplierFilter, setSupplierFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');

  const loadAll = async () => {
    setLoading(true);
    setError(false);
    const [poRes, itemsRes, grnRes, grnItemsRes, suppliersRes] = await Promise.all([
      supabase
        .from('inventory_purchase_orders' as any)
        .select('id, po_number, supplier_id, order_date, status, created_at')
        .order('order_date', { ascending: false })
        .limit(PAGE_SIZE),
      supabase
        .from('inventory_po_items' as any)
        .select('id, purchase_order_id, quantity_ordered, unit_cost'),
      supabase
        .from('inventory_grn' as any)
        .select('id, purchase_order_id, received_date'),
      supabase
        .from('inventory_grn_items' as any)
        .select('grn_id, po_item_id, quantity_received'),
      supabase
        .from('inventory_suppliers' as any)
        .select('id, name')
        .order('name'),
    ]);

    const firstError = poRes.error || itemsRes.error || grnRes.error || grnItemsRes.error || suppliersRes.error;
    if (firstError) {
      setError(true);
      toast({ title: 'Error', description: firstError.message, variant: 'destructive' });
      setLoading(false);
      return;
    }

    setPurchaseOrders((poRes.data || []) as unknown as PurchaseOrderRow[]);
    setPoItems((itemsRes.data || []) as unknown as PoItemRow[]);
    setGrns((grnRes.data || []) as unknown as GrnRow[]);
    setGrnItems((grnItemsRes.data || []) as unknown as GrnItemRow[]);
    setSuppliers((suppliersRes.data || []) as unknown as { id: string; name: string }[]);
    setLoading(false);
  };

  useEffect(() => { loadAll(); }, []);

  const supplierNameById = useMemo(() => {
    const map: Record<string, string> = {};
    for (const s of suppliers) map[s.id] = s.name;
    return map;
  }, [suppliers]);

  const reportRows = useMemo<ReportRow[]>(() => {
    const orderedByPo: Record<string, { qty: number; value: number }> = {};
    for (const item of poItems) {
      const agg = (orderedByPo[item.purchase_order_id] ||= { qty: 0, value: 0 });
      agg.qty += item.quantity_ordered;
      agg.value += item.quantity_ordered * item.unit_cost;
    }

    const poItemById: Record<string, PoItemRow> = {};
    for (const item of poItems) poItemById[item.id] = item;

    const grnById: Record<string, GrnRow> = {};
    for (const g of grns) grnById[g.id] = g;

    const receivedByPo: Record<string, { qty: number; value: number; lastDate: string | null }> = {};
    for (const gi of grnItems) {
      const grn = grnById[gi.grn_id];
      if (!grn) continue;
      const agg = (receivedByPo[grn.purchase_order_id] ||= { qty: 0, value: 0, lastDate: null });
      agg.qty += gi.quantity_received;
      const poItem = poItemById[gi.po_item_id];
      if (poItem) agg.value += gi.quantity_received * poItem.unit_cost;
      if (!agg.lastDate || grn.received_date > agg.lastDate) agg.lastDate = grn.received_date;
    }

    return purchaseOrders.map(po => {
      const ordered = orderedByPo[po.id] || { qty: 0, value: 0 };
      const received = receivedByPo[po.id] || { qty: 0, value: 0, lastDate: null };
      return {
        ...po,
        supplierName: supplierNameById[po.supplier_id] || '—',
        orderedQty: ordered.qty,
        orderedValue: ordered.value,
        receivedQty: received.qty,
        receivedValue: received.value,
        lastReceivedDate: received.lastDate,
      };
    });
  }, [purchaseOrders, poItems, grns, grnItems, supplierNameById]);

  const filteredRows = useMemo(() => reportRows.filter(r => {
    if (supplierFilter !== 'all' && r.supplier_id !== supplierFilter) return false;
    if (statusFilter !== 'all' && r.status !== statusFilter) return false;
    return true;
  }), [reportRows, supplierFilter, statusFilter]);

  const totalPOs = filteredRows.length;
  const totalOrderedValue = useMemo(() => filteredRows.reduce((s, r) => s + r.orderedValue, 0), [filteredRows]);
  const totalReceivedValue = useMemo(() => filteredRows.reduce((s, r) => s + r.receivedValue, 0), [filteredRows]);
  const pendingCount = useMemo(() => filteredRows.filter(r => PENDING_STATUSES.includes(r.status)).length, [filteredRows]);

  const statusBadge = (s: PoStatus) => {
    if (s === 'cancelled') return <Badge variant="outline" className="bg-red-50 text-red-600 border-red-100">{STATUS_LABELS[s]}</Badge>;
    if (s === 'received') return <Badge variant="outline" className="bg-emerald-50 text-emerald-600 border-emerald-100">{STATUS_LABELS[s]}</Badge>;
    return <Badge variant="outline" className="bg-amber-50 text-amber-600 border-amber-100">{STATUS_LABELS[s]}</Badge>;
  };

  return (
    <SalesLayout>
      <div className="max-w-6xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold">Purchase Report</h1>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 mb-6">
          <div className="bg-white rounded-xl border border-neutral-200 shadow-sm p-5">
            <div className="text-sm text-muted-foreground">Total POs</div>
            <div className="text-2xl font-bold mt-1">{loading || error ? '—' : totalPOs}</div>
          </div>
          <div className="bg-white rounded-xl border border-neutral-200 shadow-sm p-5">
            <div className="text-sm text-muted-foreground">Total Ordered Value</div>
            <div className="text-2xl font-bold text-violet-700 mt-1">
              {loading || error ? '—' : `₹${totalOrderedValue.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`}
            </div>
          </div>
          <div className="bg-white rounded-xl border border-neutral-200 shadow-sm p-5">
            <div className="text-sm text-muted-foreground">Total Received Value</div>
            <div className="text-2xl font-bold text-green-700 mt-1">
              {loading || error ? '—' : `₹${totalReceivedValue.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`}
            </div>
          </div>
          <div className="bg-white rounded-xl border border-neutral-200 shadow-sm p-5">
            <div className="text-sm text-muted-foreground">Pending POs</div>
            <div className="text-2xl font-bold text-amber-600 mt-1">{loading || error ? '—' : pendingCount}</div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 mb-4">
          <Select value={supplierFilter} onValueChange={setSupplierFilter}>
            <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Suppliers</SelectItem>
              {suppliers.map(s => (
                <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="draft">Draft</SelectItem>
              <SelectItem value="ordered">Ordered</SelectItem>
              <SelectItem value="partially_received">Partially Received</SelectItem>
              <SelectItem value="received">Received</SelectItem>
              <SelectItem value="cancelled">Cancelled</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {!loading && !error && purchaseOrders.length === PAGE_SIZE && (
          <p className="text-sm text-muted-foreground mb-3">
            Showing the {PAGE_SIZE} most recent purchase orders.
          </p>
        )}

        <div className="bg-white rounded-xl border border-neutral-200 shadow-sm overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>PO Number</TableHead>
                <TableHead>Supplier</TableHead>
                <TableHead>Order Date</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Ordered Qty</TableHead>
                <TableHead>Received Qty</TableHead>
                <TableHead>Ordered Value</TableHead>
                <TableHead>Last Received Date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>
              ) : filteredRows.length === 0 ? (
                <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">{purchaseOrders.length === 0 ? 'No purchase orders yet.' : 'No purchase orders match these filters.'}</TableCell></TableRow>
              ) : (
                filteredRows.map(row => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">PO-{row.po_number}</TableCell>
                    <TableCell>{row.supplierName}</TableCell>
                    <TableCell>{new Date(row.order_date).toLocaleDateString('en-IN')}</TableCell>
                    <TableCell>{statusBadge(row.status)}</TableCell>
                    <TableCell>{row.orderedQty}</TableCell>
                    <TableCell>{row.receivedQty}</TableCell>
                    <TableCell>₹{row.orderedValue.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</TableCell>
                    <TableCell>{row.lastReceivedDate ? new Date(row.lastReceivedDate).toLocaleDateString('en-IN') : '—'}</TableCell>
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
