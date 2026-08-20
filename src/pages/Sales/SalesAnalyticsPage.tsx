import { useState, useEffect, useMemo } from 'react';
import SalesLayout from '@/components/sales/SalesLayout';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

type Metric = 'revenue' | 'quantity';

type LineRow = {
  quantity: number;
  line_total: number;
  product_id: string | null;
  invoices: { status: string; buyer_name: string } | null;
};

type Product = {
  id: string;
  name: string;
  class_number: number | null;
  subject: string | null;
  series: string | null;
  stock_quantity: number;
};

type ProductStat = Product & { qty: number; revenue: number };

const metricValue = (s: { qty: number; revenue: number }, metric: Metric) => (metric === 'revenue' ? s.revenue : s.qty);
const fmt = (value: number, metric: Metric) =>
  metric === 'revenue' ? `₹${value.toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : value.toLocaleString('en-IN');

function MetricToggle({ metric, onChange }: { metric: Metric; onChange: (m: Metric) => void }) {
  return (
    <div className="inline-flex rounded-lg border border-neutral-200 bg-white p-1">
      {(['revenue', 'quantity'] as const).map((m) => (
        <button
          key={m}
          type="button"
          onClick={() => onChange(m)}
          className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
            metric === m ? 'bg-orange-600 text-white' : 'text-neutral-600 hover:bg-neutral-50'
          }`}
        >
          {m === 'revenue' ? 'Revenue' : 'Quantity'}
        </button>
      ))}
    </div>
  );
}

function Bar({ label, value, max, metric }: { label: string; value: number; max: number; metric: Metric }) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  return (
    <div className="flex items-center gap-3 py-1.5">
      <div className="w-40 text-sm text-neutral-600 flex-shrink-0 truncate">{label}</div>
      <div className="flex-1 bg-neutral-100 rounded-full h-5 overflow-hidden">
        <div className="bg-orange-500 h-full rounded-full transition-all" style={{ width: `${pct}%` }} />
      </div>
      <div className="w-28 text-sm font-medium text-right flex-shrink-0">{fmt(value, metric)}</div>
    </div>
  );
}

function MoversTable({ title, badgeClass, items, metric }: { title: string; badgeClass: string; items: ProductStat[]; metric: Metric }) {
  return (
    <div className="bg-white rounded-xl border border-neutral-200 shadow-sm overflow-hidden">
      <div className="px-5 py-3 border-b border-neutral-200 flex items-center gap-2">
        <span className="font-semibold text-neutral-900">{title}</span>
        <Badge variant="outline" className={badgeClass}>{items.length}</Badge>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Item</TableHead>
            <TableHead>Qty Sold</TableHead>
            <TableHead>Revenue</TableHead>
            <TableHead>Current Stock</TableHead>
            <TableHead>Sell-Through</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.length === 0 ? (
            <TableRow><TableCell colSpan={5} className="text-center py-6 text-muted-foreground">No items.</TableCell></TableRow>
          ) : (
            items.map((p) => {
              // stock_quantity is what's LEFT after sales already decremented it —
              // add qty sold back to reconstruct the original starting-stock baseline.
              const startingStock = p.stock_quantity + p.qty;
              const sellThrough = startingStock > 0 ? (p.qty / startingStock) * 100 : 0;
              return (
                <TableRow key={p.id}>
                  <TableCell className="font-medium">{p.name}</TableCell>
                  <TableCell>{p.qty}</TableCell>
                  <TableCell>₹{p.revenue.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</TableCell>
                  <TableCell>{p.stock_quantity}</TableCell>
                  <TableCell>
                    {p.qty === 0 ? (
                      <Badge variant="outline" className="bg-red-50 text-red-600 border-red-100">Not sold</Badge>
                    ) : (
                      `${sellThrough.toFixed(0)}%`
                    )}
                  </TableCell>
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>
    </div>
  );
}

export default function SalesAnalyticsPage() {
  const { toast } = useToast();
  const [lines, setLines] = useState<LineRow[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [metric, setMetric] = useState<Metric>('revenue');

  useEffect(() => {
    setLoading(true);
    Promise.all([
      supabase
        .from('invoice_line_items' as any)
        .select('quantity, line_total, product_id, invoices(status, buyer_name)'),
      supabase
        .from('products' as any)
        .select('id, name, class_number, subject, series, stock_quantity')
        .eq('is_active', true),
    ]).then(([lineRes, productRes]) => {
      if (lineRes.error) toast({ title: 'Error loading sales data', description: lineRes.error.message, variant: 'destructive' });
      if (productRes.error) toast({ title: 'Error loading products', description: productRes.error.message, variant: 'destructive' });
      // Void invoices never actually sold anything — exclude them everywhere on this page.
      const validLines = ((lineRes.data || []) as unknown as LineRow[]).filter((l) => l.invoices?.status !== 'void');
      setLines(validLines);
      setProducts((productRes.data || []) as unknown as Product[]);
      setLoading(false);
    });
  }, []);

  const productStats: ProductStat[] = useMemo(() => {
    const salesByProduct = new Map<string, { qty: number; revenue: number }>();
    for (const l of lines) {
      if (!l.product_id) continue;
      const cur = salesByProduct.get(l.product_id) ?? { qty: 0, revenue: 0 };
      cur.qty += l.quantity;
      cur.revenue += l.line_total;
      salesByProduct.set(l.product_id, cur);
    }
    return products.map((p) => {
      const s = salesByProduct.get(p.id) ?? { qty: 0, revenue: 0 };
      return { ...p, qty: s.qty, revenue: s.revenue };
    });
  }, [lines, products]);

  const sortedProducts = useMemo(
    () => [...productStats].sort((a, b) => metricValue(b, metric) - metricValue(a, metric)),
    [productStats, metric]
  );

  // Three roughly-equal bands by rank. "Not sold" items are flagged within the
  // Low band rather than split into their own section — they'll always land there
  // anyway since they rank last on both metrics.
  const { topTier, midTier, lowTier } = useMemo(() => {
    const tierSize = Math.ceil(sortedProducts.length / 3);
    return {
      topTier: sortedProducts.slice(0, tierSize),
      midTier: sortedProducts.slice(tierSize, tierSize * 2),
      lowTier: sortedProducts.slice(tierSize * 2),
    };
  }, [sortedProducts]);

  const classStats = useMemo(() => {
    const map = new Map<number, { qty: number; revenue: number }>();
    for (const p of productStats) {
      if (p.class_number == null) continue;
      const cur = map.get(p.class_number) ?? { qty: 0, revenue: 0 };
      cur.qty += p.qty;
      cur.revenue += p.revenue;
      map.set(p.class_number, cur);
    }
    return [...map.entries()].sort((a, b) => a[0] - b[0]).map(([class_number, s]) => ({ label: `Class ${class_number}`, ...s }));
  }, [productStats]);

  const subjectStats = useMemo(() => {
    const map = new Map<string, { qty: number; revenue: number }>();
    for (const p of productStats) {
      const key = p.series === 'Impact Series' ? 'Mock Test' : (p.subject ?? 'Other');
      const cur = map.get(key) ?? { qty: 0, revenue: 0 };
      cur.qty += p.qty;
      cur.revenue += p.revenue;
      map.set(key, cur);
    }
    return [...map.entries()]
      .sort((a, b) => metricValue(b[1], metric) - metricValue(a[1], metric))
      .map(([label, s]) => ({ label, ...s }));
  }, [productStats, metric]);

  const schoolStats = useMemo(() => {
    const map = new Map<string, { qty: number; revenue: number }>();
    for (const l of lines) {
      const name = l.invoices?.buyer_name;
      if (!name) continue;
      const cur = map.get(name) ?? { qty: 0, revenue: 0 };
      cur.qty += l.quantity;
      cur.revenue += l.line_total;
      map.set(name, cur);
    }
    return [...map.entries()]
      .sort((a, b) => metricValue(b[1], metric) - metricValue(a[1], metric))
      .slice(0, 10)
      .map(([label, s]) => ({ label, ...s }));
  }, [lines, metric]);

  const classMax = Math.max(1, ...classStats.map((c) => metricValue(c, metric)));
  const subjectMax = Math.max(1, ...subjectStats.map((s) => metricValue(s, metric)));
  const schoolMax = Math.max(1, ...schoolStats.map((s) => metricValue(s, metric)));

  return (
    <SalesLayout>
      <div className="max-w-6xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold">Sales Analytics</h1>
            <p className="text-sm text-muted-foreground mt-1">All-time, across every paid invoice. Voided invoices excluded.</p>
          </div>
          <MetricToggle metric={metric} onChange={setMetric} />
        </div>

        {loading ? (
          <p className="text-muted-foreground py-8 text-center">Loading…</p>
        ) : (
          <div className="space-y-6">
            <MoversTable title="Top Sellers" badgeClass="bg-emerald-50 text-emerald-600 border-emerald-100" items={topTier} metric={metric} />
            <MoversTable title="Medium Sellers" badgeClass="bg-amber-50 text-amber-600 border-amber-100" items={midTier} metric={metric} />
            <MoversTable title="Low / Not Moving" badgeClass="bg-red-50 text-red-600 border-red-100" items={lowTier} metric={metric} />

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="bg-white rounded-xl border border-neutral-200 shadow-sm p-5">
                <div className="font-semibold text-neutral-900 mb-3">Sales by Class</div>
                {classStats.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No sales yet.</p>
                ) : (
                  classStats.map((c) => <Bar key={c.label} label={c.label} value={metricValue(c, metric)} max={classMax} metric={metric} />)
                )}
              </div>
              <div className="bg-white rounded-xl border border-neutral-200 shadow-sm p-5">
                <div className="font-semibold text-neutral-900 mb-3">Sales by Subject</div>
                {subjectStats.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No sales yet.</p>
                ) : (
                  subjectStats.map((s) => <Bar key={s.label} label={s.label} value={metricValue(s, metric)} max={subjectMax} metric={metric} />)
                )}
              </div>
            </div>

            <div className="bg-white rounded-xl border border-neutral-200 shadow-sm p-5">
              <div className="font-semibold text-neutral-900 mb-3">Top Buying Schools</div>
              {schoolStats.length === 0 ? (
                <p className="text-sm text-muted-foreground">No sales yet.</p>
              ) : (
                schoolStats.map((s) => <Bar key={s.label} label={s.label} value={metricValue(s, metric)} max={schoolMax} metric={metric} />)
              )}
            </div>
          </div>
        )}
      </div>
    </SalesLayout>
  );
}
