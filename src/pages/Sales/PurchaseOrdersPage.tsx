import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import SalesLayout from '@/components/sales/SalesLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Plus, Search, Eye } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import PurchaseOrderDialog from './PurchaseOrderDialog';

type PoStatus = 'draft' | 'ordered' | 'partially_received' | 'received' | 'cancelled';

type PurchaseOrderRow = {
  id: string;
  po_number: number;
  order_date: string;
  expected_date: string | null;
  status: PoStatus;
  inventory_suppliers: { name: string } | null;
  inventory_po_items: { quantity_ordered: number; unit_cost: number }[];
};

const PAGE_SIZE = 200;

const STATUS_LABELS: Record<PoStatus, string> = {
  draft: 'Draft',
  ordered: 'Ordered',
  partially_received: 'Partially Received',
  received: 'Received',
  cancelled: 'Cancelled',
};

export default function PurchaseOrdersPage() {
  const { toast } = useToast();
  const navigate = useNavigate();

  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [dialogOpen, setDialogOpen] = useState(false);

  const loadPurchaseOrders = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('inventory_purchase_orders' as any)
      .select('id, po_number, order_date, expected_date, status, inventory_suppliers(name), inventory_po_items(quantity_ordered, unit_cost)')
      .order('po_number', { ascending: false })
      .limit(PAGE_SIZE);
    if (error) { toast({ title: 'Error', description: error.message, variant: 'destructive' }); setLoading(false); return; }
    setPurchaseOrders((data || []) as unknown as PurchaseOrderRow[]);
    setLoading(false);
  };

  useEffect(() => { loadPurchaseOrders(); }, []);

  const filtered = useMemo(() => {
    let rows = purchaseOrders;
    if (statusFilter !== 'all') rows = rows.filter(r => r.status === statusFilter);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      rows = rows.filter(r => String(r.po_number).includes(q) || (r.inventory_suppliers?.name || '').toLowerCase().includes(q));
    }
    return rows;
  }, [purchaseOrders, statusFilter, search]);

  const openNew = () => setDialogOpen(true);

  const poTotal = (row: PurchaseOrderRow) =>
    row.inventory_po_items.reduce((s, i) => s + i.quantity_ordered * i.unit_cost, 0);

  const statusBadge = (s: PoStatus) => {
    if (s === 'cancelled') return <Badge variant="outline" className="bg-red-50 text-red-600 border-red-100">{STATUS_LABELS[s]}</Badge>;
    if (s === 'received') return <Badge variant="outline" className="bg-emerald-50 text-emerald-600 border-emerald-100">{STATUS_LABELS[s]}</Badge>;
    return <Badge variant="outline" className="bg-amber-50 text-amber-600 border-amber-100">{STATUS_LABELS[s]}</Badge>;
  };

  return (
    <SalesLayout>
      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold">Purchase Orders</h1>
          <Button onClick={openNew}><Plus className="h-4 w-4 mr-2" />New Purchase Order</Button>
        </div>

        <div className="flex flex-wrap items-center gap-3 mb-4">
          <div className="relative flex-1 min-w-56">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input className="pl-8" placeholder="Search PO no. or supplier name…" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
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

        <div className="bg-white rounded-xl border border-neutral-200 shadow-sm overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>PO #</TableHead>
                <TableHead>Supplier</TableHead>
                <TableHead>Order Date</TableHead>
                <TableHead>Expected Date</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Total</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>
              ) : filtered.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No purchase orders found.</TableCell></TableRow>
              ) : (
                filtered.map(row => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">PO-{row.po_number}</TableCell>
                    <TableCell>{row.inventory_suppliers?.name || '—'}</TableCell>
                    <TableCell>{new Date(row.order_date).toLocaleDateString('en-IN')}</TableCell>
                    <TableCell>{row.expected_date ? new Date(row.expected_date).toLocaleDateString('en-IN') : '—'}</TableCell>
                    <TableCell>{statusBadge(row.status)}</TableCell>
                    <TableCell>₹{poTotal(row).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" onClick={() => navigate(`/sales/purchase-orders/${row.id}`)}>
                        <Eye className="h-3.5 w-3.5 mr-1" />View
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <PurchaseOrderDialog open={dialogOpen} onOpenChange={setDialogOpen} onSaved={loadPurchaseOrders} />
    </SalesLayout>
  );
}
