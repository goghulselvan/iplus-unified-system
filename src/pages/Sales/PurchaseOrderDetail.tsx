import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import SalesLayout from '@/components/sales/SalesLayout';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { ArrowLeft, PackageCheck, Ban } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import ReceiveGrnDialog, { PoItemForReceiving } from './ReceiveGrnDialog';

type PoStatus = 'draft' | 'ordered' | 'partially_received' | 'received' | 'cancelled';

const STATUS_LABELS: Record<PoStatus, string> = {
  draft: 'Draft',
  ordered: 'Ordered',
  partially_received: 'Partially Received',
  received: 'Received',
  cancelled: 'Cancelled',
};

type PurchaseOrderDetailRow = {
  id: string;
  po_number: number;
  order_date: string;
  expected_date: string | null;
  status: PoStatus;
  notes: string | null;
  inventory_suppliers: { name: string; contact_person: string | null; phone: string | null } | null;
};

type PoItemRow = {
  id: string;
  product_id: string;
  quantity_ordered: number;
  unit_cost: number;
  row_order: number;
  products: { name: string; sku: string | null } | null;
};

type GrnRow = {
  id: string;
  grn_number: number;
  received_date: string;
  notes: string | null;
};

type GrnItemRow = {
  grn_id: string;
  quantity_received: number;
  po_item_id: string;
  inventory_po_items: { product_id: string; products: { name: string } | null } | null;
};

export default function PurchaseOrderDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [po, setPo] = useState<PurchaseOrderDetailRow | null>(null);
  const [items, setItems] = useState<PoItemRow[]>([]);
  const [receivedByItem, setReceivedByItem] = useState<Record<string, number>>({});
  const [grns, setGrns] = useState<GrnRow[]>([]);
  const [grnItemsByGrn, setGrnItemsByGrn] = useState<Record<string, GrnItemRow[]>>({});
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const loadPo = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setNotFound(false);

    const { data: poData, error: poError } = await supabase
      .from('inventory_purchase_orders' as any)
      .select('id, po_number, order_date, expected_date, status, notes, inventory_suppliers(name, contact_person, phone)')
      .eq('id', id)
      .single();
    if (poError || !poData) {
      toast({ title: 'Error loading purchase order', description: poError?.message, variant: 'destructive' });
      setNotFound(true);
      setLoading(false);
      return;
    }
    setPo(poData as unknown as PurchaseOrderDetailRow);

    const { data: itemsData, error: itemsError } = await supabase
      .from('inventory_po_items' as any)
      .select('id, product_id, quantity_ordered, unit_cost, row_order, products(name, sku)')
      .eq('purchase_order_id', id)
      .order('row_order');
    if (itemsError) {
      toast({ title: 'Error loading line items', description: itemsError.message, variant: 'destructive' });
      setLoading(false);
      return;
    }
    const poItems = (itemsData || []) as unknown as PoItemRow[];
    setItems(poItems);

    const itemIds = poItems.map(i => i.id);
    if (itemIds.length > 0) {
      const { data: grnItemsForSum, error: grnSumError } = await supabase
        .from('inventory_grn_items' as any)
        .select('po_item_id, quantity_received')
        .in('po_item_id', itemIds);
      if (grnSumError) {
        toast({ title: 'Error loading receiving history', description: grnSumError.message, variant: 'destructive' });
      }
      const sums: Record<string, number> = {};
      for (const row of (grnItemsForSum || []) as unknown as { po_item_id: string; quantity_received: number }[]) {
        sums[row.po_item_id] = (sums[row.po_item_id] || 0) + Number(row.quantity_received);
      }
      setReceivedByItem(sums);
    } else {
      setReceivedByItem({});
    }

    const { data: grnData, error: grnError } = await supabase
      .from('inventory_grn' as any)
      .select('id, grn_number, received_date, notes')
      .eq('purchase_order_id', id)
      .order('grn_number', { ascending: false });
    if (grnError) {
      toast({ title: 'Error loading GRN history', description: grnError.message, variant: 'destructive' });
      setLoading(false);
      return;
    }
    const grnRows = (grnData || []) as unknown as GrnRow[];
    setGrns(grnRows);

    const grnIds = grnRows.map(g => g.id);
    if (grnIds.length > 0) {
      const { data: grnItemsData, error: grnItemsError } = await supabase
        .from('inventory_grn_items' as any)
        .select('grn_id, quantity_received, po_item_id, inventory_po_items(product_id, products(name))')
        .in('grn_id', grnIds);
      if (grnItemsError) {
        toast({ title: 'Error loading GRN line items', description: grnItemsError.message, variant: 'destructive' });
      }
      const byGrn: Record<string, GrnItemRow[]> = {};
      for (const row of (grnItemsData || []) as unknown as GrnItemRow[]) {
        (byGrn[row.grn_id] ||= []).push(row);
      }
      setGrnItemsByGrn(byGrn);
    } else {
      setGrnItemsByGrn({});
    }

    setLoading(false);
  }, [id, toast]);

  useEffect(() => { loadPo(); }, [loadPo]);

  const handleCancelPo = async () => {
    if (!po) return;
    setCancelling(true);
    const { error } = await supabase
      .from('inventory_purchase_orders' as any)
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('id', po.id);
    setCancelling(false);
    if (error) { toast({ title: 'Error', description: error.message, variant: 'destructive' }); return; }
    toast({ title: 'Purchase order cancelled' });
    setCancelOpen(false);
    loadPo();
  };

  const statusBadge = (s: PoStatus) => {
    if (s === 'cancelled') return <Badge variant="outline" className="bg-red-50 text-red-600 border-red-100">{STATUS_LABELS[s]}</Badge>;
    if (s === 'received') return <Badge variant="outline" className="bg-emerald-50 text-emerald-600 border-emerald-100">{STATUS_LABELS[s]}</Badge>;
    return <Badge variant="outline" className="bg-amber-50 text-amber-600 border-amber-100">{STATUS_LABELS[s]}</Badge>;
  };

  const grandTotal = items.reduce((s, i) => s + i.quantity_ordered * i.unit_cost, 0);

  const canReceive = !!po && po.status !== 'received' && po.status !== 'cancelled';
  const canCancel = !!po && (po.status === 'ordered' || po.status === 'partially_received');

  const poItemsForReceiving: PoItemForReceiving[] = items.map(i => ({
    id: i.id,
    product_id: i.product_id,
    product_name: i.products?.name || '—',
    quantity_ordered: i.quantity_ordered,
    already_received: receivedByItem[i.id] || 0,
  }));

  if (loading) {
    return (
      <SalesLayout>
        <div className="max-w-5xl mx-auto px-4 py-8 text-center text-muted-foreground">Loading…</div>
      </SalesLayout>
    );
  }

  if (notFound || !po) {
    return (
      <SalesLayout>
        <div className="max-w-5xl mx-auto px-4 py-8 text-center text-muted-foreground">Purchase order not found.</div>
      </SalesLayout>
    );
  }

  return (
    <SalesLayout>
      <div className="max-w-5xl mx-auto px-4 py-8">
        <button
          onClick={() => navigate('/sales/purchase-orders')}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-4"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back to Purchase Orders
        </button>

        <div className="flex items-start justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold">PO-{po.po_number}</h1>
            <p className="text-muted-foreground text-sm mt-1">{po.inventory_suppliers?.name || '—'}</p>
          </div>
          <div className="flex items-center gap-3">
            {statusBadge(po.status)}
            {canCancel && (
              <Button variant="outline" className="text-red-600 hover:text-red-700" onClick={() => setCancelOpen(true)}>
                <Ban className="h-4 w-4 mr-2" /> Cancel Purchase Order
              </Button>
            )}
            {canReceive && (
              <Button onClick={() => setReceiveOpen(true)}>
                <PackageCheck className="h-4 w-4 mr-2" /> Receive Goods
              </Button>
            )}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-neutral-200 shadow-sm p-4 mb-6 grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div>
            <div className="text-muted-foreground">Order Date</div>
            <div className="font-medium">{new Date(po.order_date).toLocaleDateString('en-IN')}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Expected Date</div>
            <div className="font-medium">{po.expected_date ? new Date(po.expected_date).toLocaleDateString('en-IN') : '—'}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Contact Person</div>
            <div className="font-medium">{po.inventory_suppliers?.contact_person || '—'}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Phone</div>
            <div className="font-medium">{po.inventory_suppliers?.phone || '—'}</div>
          </div>
          {po.notes && (
            <div className="col-span-2 md:col-span-4">
              <div className="text-muted-foreground">Notes</div>
              <div className="font-medium">{po.notes}</div>
            </div>
          )}
        </div>

        <div className="bg-white rounded-xl border border-neutral-200 shadow-sm overflow-hidden mb-8">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product</TableHead>
                <TableHead>Ordered</TableHead>
                <TableHead>Received</TableHead>
                <TableHead>Unit Cost</TableHead>
                <TableHead className="text-right">Line Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map(i => (
                <TableRow key={i.id}>
                  <TableCell className="font-medium">{i.products?.name || '—'}</TableCell>
                  <TableCell>{i.quantity_ordered}</TableCell>
                  <TableCell>{receivedByItem[i.id] || 0}</TableCell>
                  <TableCell>₹{i.unit_cost.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</TableCell>
                  <TableCell className="text-right">₹{(i.quantity_ordered * i.unit_cost).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="flex justify-end px-4 py-3 border-t bg-neutral-50">
            <div className="text-sm font-semibold">Grand Total: ₹{grandTotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</div>
          </div>
        </div>

        <h2 className="text-lg font-semibold mb-3">Goods Received History</h2>
        {grns.length === 0 ? (
          <div className="text-sm text-muted-foreground">No goods received yet.</div>
        ) : (
          <div className="space-y-3">
            {grns.map(g => (
              <div key={g.id} className="bg-white rounded-xl border border-neutral-200 shadow-sm p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="font-medium">GRN-{g.grn_number} — {new Date(g.received_date).toLocaleDateString('en-IN')}</div>
                </div>
                {g.notes && <div className="text-sm text-muted-foreground mb-2">{g.notes}</div>}
                <ul className="text-sm space-y-1">
                  {(grnItemsByGrn[g.id] || []).map((gi, idx) => (
                    <li key={idx} className="flex justify-between">
                      <span>{gi.inventory_po_items?.products?.name || '—'}</span>
                      <span className="font-medium">{gi.quantity_received}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>

      <ReceiveGrnDialog
        open={receiveOpen}
        onOpenChange={setReceiveOpen}
        purchaseOrderId={po.id}
        poItems={poItemsForReceiving}
        onSaved={loadPo}
      />

      <AlertDialog open={cancelOpen} onOpenChange={open => !open && setCancelOpen(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel PO-{po.po_number}?</AlertDialogTitle>
            <AlertDialogDescription>This cannot be undone. The purchase order will be marked cancelled and goods can no longer be received against it.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={cancelling}>Back</AlertDialogCancel>
            <AlertDialogAction onClick={handleCancelPo} disabled={cancelling} className="bg-red-600 hover:bg-red-700">
              {cancelling ? 'Cancelling…' : 'Cancel Purchase Order'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SalesLayout>
  );
}
