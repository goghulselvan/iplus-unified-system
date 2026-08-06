import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import SalesLayout from '@/components/sales/SalesLayout';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

type Product = {
  id: string;
  name: string;
  stock_quantity: number;
  minimum_stock_level: number;
  unit_price: number;
};

type ActivityEvent = {
  key: string;
  label: string;
  timestamp: string;
  href: string;
};

const PENDING_PO_STATUSES = ['draft', 'ordered', 'partially_received'];

const isOutOfStock = (p: Pick<Product, 'stock_quantity'>) => p.stock_quantity <= 0;
const isLowStock = (p: Pick<Product, 'stock_quantity' | 'minimum_stock_level'>) =>
  !isOutOfStock(p) && p.stock_quantity < p.minimum_stock_level;

const money = (n: number) => `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function DashboardPage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const [products, setProducts] = useState<Product[]>([]);
  const [pendingPoCount, setPendingPoCount] = useState(0);
  const [openOrderValue, setOpenOrderValue] = useState(0);
  const [activeSupplierCount, setActiveSupplierCount] = useState(0);
  const [itemsIssuedThisMonth, setItemsIssuedThisMonth] = useState(0);
  const [stockMovementsThisMonth, setStockMovementsThisMonth] = useState(0);
  const [invoiceRevenueThisMonth, setInvoiceRevenueThisMonth] = useState(0);
  const [recentActivity, setRecentActivity] = useState<ActivityEvent[]>([]);

  const load = async () => {
    setLoading(true);
    setError(false);

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthStartDate = monthStart.toISOString().slice(0, 10);
    const monthStartIso = monthStart.toISOString();

    const [
      productsRes,
      poRes,
      poItemsRes,
      suppliersRes,
      issuesRes,
      addsRes,
      adjustmentsRes,
      invoicesRes,
    ] = await Promise.all([
      supabase.from('products' as any)
        .select('id, name, stock_quantity, minimum_stock_level, unit_price')
        .eq('is_active', true),
      supabase.from('inventory_purchase_orders' as any)
        .select('id')
        .in('status', PENDING_PO_STATUSES),
      supabase.from('inventory_po_items' as any)
        .select('purchase_order_id, quantity_ordered, unit_cost'),
      supabase.from('inventory_suppliers' as any)
        .select('id')
        .eq('is_active', true),
      supabase.from('inventory_item_issues' as any)
        .select('id, quantity, issued_to_type, issue_date, created_at, products(name)')
        .gte('issue_date', monthStartDate),
      supabase.from('inventory_stock_adds' as any)
        .select('id, quantity, added_date, created_at, products(name)')
        .gte('added_date', monthStartDate),
      supabase.from('inventory_stock_adjustments' as any)
        .select('id, quantity_delta, adjusted_date, created_at, products(name)')
        .gte('adjusted_date', monthStartDate),
      supabase.from('invoices' as any)
        .select('grand_total, status, created_at')
        .gte('created_at', monthStartIso),
    ]);

    const firstError = productsRes.error || poRes.error || poItemsRes.error || suppliersRes.error
      || issuesRes.error || addsRes.error || adjustmentsRes.error || invoicesRes.error;
    if (firstError) {
      setError(true);
      toast({ title: 'Error loading dashboard', description: firstError.message, variant: 'destructive' });
      setLoading(false);
      return;
    }

    const productRows = (productsRes.data || []) as unknown as Product[];
    setProducts(productRows);

    const pendingPoIds = new Set(((poRes.data || []) as unknown as { id: string }[]).map(po => po.id));
    setPendingPoCount(pendingPoIds.size);

    const poItems = (poItemsRes.data || []) as unknown as { purchase_order_id: string; quantity_ordered: number; unit_cost: number }[];
    setOpenOrderValue(
      poItems.filter(item => pendingPoIds.has(item.purchase_order_id))
        .reduce((sum, item) => sum + item.quantity_ordered * item.unit_cost, 0)
    );

    setActiveSupplierCount((suppliersRes.data || []).length);

    const issues = (issuesRes.data || []) as unknown as {
      id: string; quantity: number; issued_to_type: string; issue_date: string; created_at: string; products: { name: string } | null;
    }[];
    setItemsIssuedThisMonth(issues.reduce((sum, i) => sum + i.quantity, 0));

    const adds = (addsRes.data || []) as unknown as {
      id: string; quantity: number; added_date: string; created_at: string; products: { name: string } | null;
    }[];
    const adjustments = (adjustmentsRes.data || []) as unknown as {
      id: string; quantity_delta: number; adjusted_date: string; created_at: string; products: { name: string } | null;
    }[];
    setStockMovementsThisMonth(adds.length + adjustments.length);

    const invoiceRows = (invoicesRes.data || []) as unknown as { grand_total: number; status: string }[];
    setInvoiceRevenueThisMonth(
      invoiceRows.filter(inv => inv.status !== 'void').reduce((sum, inv) => sum + inv.grand_total, 0)
    );

    const events: ActivityEvent[] = [
      ...adds.map(a => ({
        key: `add-${a.id}`,
        label: `Stock added — ${a.products?.name ?? 'Unknown product'} (+${a.quantity})`,
        timestamp: a.created_at,
        href: '/sales/stock-movements',
      })),
      ...adjustments.map(a => ({
        key: `adj-${a.id}`,
        label: `Stock adjusted — ${a.products?.name ?? 'Unknown product'} (${a.quantity_delta > 0 ? '+' : ''}${a.quantity_delta})`,
        timestamp: a.created_at,
        href: '/sales/stock-movements',
      })),
      ...issues.map(i => ({
        key: `issue-${i.id}`,
        label: `Item issued — ${i.quantity} × ${i.products?.name ?? 'Unknown product'} to ${i.issued_to_type}`,
        timestamp: i.created_at,
        href: '/sales/item-issue',
      })),
    ].sort((a, b) => b.timestamp.localeCompare(a.timestamp)).slice(0, 5);
    setRecentActivity(events);

    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const outOfStockCount = useMemo(() => products.filter(isOutOfStock).length, [products]);
  const lowStockCount = useMemo(() => products.filter(isLowStock).length, [products]);
  const stockValue = useMemo(
    () => products.reduce((sum, p) => sum + Math.max(p.stock_quantity, 0) * p.unit_price, 0),
    [products]
  );
  const healthyPercent = useMemo(() => {
    if (products.length === 0) return 0;
    const healthy = products.filter(p => p.stock_quantity >= p.minimum_stock_level).length;
    return Math.round((healthy / products.length) * 100);
  }, [products]);
  const needsAttention = useMemo(() => {
    const rank = (p: Product) => (isOutOfStock(p) ? 0 : isLowStock(p) ? 1 : 2);
    return products
      .filter(p => isOutOfStock(p) || isLowStock(p))
      .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))
      .slice(0, 5);
  }, [products]);

  const tile = (
    label: string, value: string, href: string,
    opts?: { emphasis?: boolean }
  ) => (
    <button
      onClick={() => navigate(href)}
      className={`text-left rounded-xl border shadow-sm p-4 transition-colors ${
        opts?.emphasis
          ? 'bg-gray-900 border-gray-900 hover:bg-gray-800'
          : 'bg-white border-neutral-200 hover:bg-neutral-50'
      }`}
    >
      <div className={`text-xs ${opts?.emphasis ? 'text-neutral-400' : 'text-muted-foreground'}`}>{label}</div>
      <div className={`text-2xl font-bold mt-1 ${opts?.emphasis ? 'text-white' : 'text-gray-900'}`}>
        {loading || error ? '—' : value}
      </div>
    </button>
  );

  return (
    <SalesLayout>
      <div className="max-w-6xl mx-auto px-4 py-8">
        <div className="bg-gradient-to-br from-orange-50 to-neutral-50 rounded-2xl px-6 py-5 mb-6 border border-orange-100">
          <h1 className="text-xl font-bold text-gray-900">Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-1">Overview of your catalog, procurement, and stock activity.</p>
        </div>

        <div className="text-xs font-bold text-orange-600 uppercase tracking-wide mb-2">Catalog &amp; Stock</div>
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 mb-6">
          {tile('Active Products', String(products.length), '/sales/products')}
          {tile('Out of Stock', String(outOfStockCount), '/sales/stock-report', { emphasis: true })}
          {tile('Low Stock', String(lowStockCount), '/sales/stock-report')}
          {tile('Stock Value', money(stockValue), '/sales/stock-report')}
        </div>

        <div className="text-xs font-bold text-orange-600 uppercase tracking-wide mb-2">Procurement</div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
          {tile('Pending POs', String(pendingPoCount), '/sales/purchase-orders')}
          {tile('Open Order Value', money(openOrderValue), '/sales/purchase-report')}
          {tile('Active Suppliers', String(activeSupplierCount), '/sales/suppliers')}
        </div>

        <div className="text-xs font-bold text-orange-600 uppercase tracking-wide mb-2">Activity (this month)</div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
          {tile('Items Issued', String(itemsIssuedThisMonth), '/sales/item-issue')}
          {tile('Stock Movements', String(stockMovementsThisMonth), '/sales/stock-movements')}
          {tile('Invoice Revenue', money(invoiceRevenueThisMonth), '/sales/invoices')}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="bg-white rounded-xl border border-neutral-200 shadow-sm p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="text-sm font-bold text-gray-900">Needs Attention</div>
              <button onClick={() => navigate('/sales/stock-report')} className="text-xs text-orange-600 hover:underline">
                View full report →
              </button>
            </div>
            {loading ? (
              <div className="text-sm text-muted-foreground py-4 text-center">Loading…</div>
            ) : needsAttention.length === 0 ? (
              <div className="text-sm text-muted-foreground py-4 text-center">Nothing needs attention.</div>
            ) : (
              needsAttention.map(p => (
                <button
                  key={p.id}
                  onClick={() => navigate('/sales/stock-report')}
                  className="w-full text-left flex items-center justify-between py-2 border-b border-neutral-100 last:border-0 text-sm"
                >
                  <span className="text-gray-700">{p.name}</span>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                    isOutOfStock(p) ? 'bg-red-50 text-red-600' : 'bg-amber-50 text-amber-600'
                  }`}>
                    {isOutOfStock(p) ? 'Out of stock' : `Low (${p.stock_quantity})`}
                  </span>
                </button>
              ))
            )}
          </div>

          <div className="bg-white rounded-xl border border-neutral-200 shadow-sm p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="text-sm font-bold text-gray-900">Recent Activity</div>
              <button onClick={() => navigate('/sales/stock-movements')} className="text-xs text-orange-600 hover:underline">
                View all →
              </button>
            </div>
            {loading ? (
              <div className="text-sm text-muted-foreground py-4 text-center">Loading…</div>
            ) : recentActivity.length === 0 ? (
              <div className="text-sm text-muted-foreground py-4 text-center">No activity this month yet.</div>
            ) : (
              recentActivity.map(e => (
                <button
                  key={e.key}
                  onClick={() => navigate(e.href)}
                  className="w-full text-left py-2 border-b border-neutral-100 last:border-0 text-sm text-gray-700"
                >
                  {e.label}
                </button>
              ))
            )}
          </div>

          <div className="bg-white rounded-xl border border-neutral-200 shadow-sm p-4 flex flex-col items-center justify-center">
            <div className="text-sm font-bold text-gray-900 self-start mb-1">Stock Health</div>
            <svg width="140" height="84" viewBox="0 0 140 84" className="mt-2">
              <path d="M14,80 A56,56 0 0,1 126,80" fill="none" stroke="#f3e3d6" strokeWidth="13" />
              <path
                d="M14,80 A56,56 0 0,1 126,80"
                fill="none"
                stroke="#ea580c"
                strokeWidth="13"
                strokeLinecap="round"
                strokeDasharray={`${(healthyPercent / 100) * 176} 176`}
              />
            </svg>
            <div className="text-2xl font-bold text-gray-900 -mt-2">{loading || error ? '—' : `${healthyPercent}%`}</div>
            <div className="text-[10px] text-muted-foreground">products in healthy stock</div>
          </div>
        </div>
      </div>
    </SalesLayout>
  );
}
