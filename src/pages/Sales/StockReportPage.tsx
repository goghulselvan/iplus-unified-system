import { useState, useEffect, useMemo } from 'react';
import SalesLayout from '@/components/sales/SalesLayout';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import ProductsFilterBar, { DEFAULT_FILTERS, type ProductFilters } from './ProductsFilterBar';

type StockRow = {
  id: string;
  name: string;
  sku: string | null;
  category_id: string | null;
  item_type: 'consumable' | 'saleable';
  series: string | null;
  subject: string | null;
  class_number: number | null;
  unit: string;
  stock_quantity: number;
  minimum_stock_level: number;
  unit_price: number;
  is_active: boolean;
  product_categories: { name: string } | null;
};

const isOutOfStock = (p: { stock_quantity: number }) => p.stock_quantity <= 0;
const isLowStock = (p: { stock_quantity: number; minimum_stock_level: number }) =>
  !isOutOfStock(p) && p.stock_quantity < p.minimum_stock_level;

export default function StockReportPage() {
  const { toast } = useToast();
  const [products, setProducts] = useState<StockRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<ProductFilters>(DEFAULT_FILTERS);
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([]);

  const loadCategories = async () => {
    const { data } = await supabase.from('product_categories' as any).select('id, name').order('name');
    setCategories((data || []) as unknown as { id: string; name: string }[]);
  };

  const loadProducts = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('products' as any)
      .select('id, name, sku, category_id, item_type, series, subject, class_number, unit, stock_quantity, minimum_stock_level, unit_price, is_active, product_categories(name)')
      .eq('is_active', true)
      .order('name');
    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } else {
      setProducts((data || []) as unknown as StockRow[]);
    }
    setLoading(false);
  };

  useEffect(() => { loadCategories(); loadProducts(); }, []);

  const seriesOptions = useMemo(() => [...new Set(products.map(p => p.series).filter(Boolean))] as string[], [products]);
  const subjectOptions = useMemo(() => [...new Set(products.map(p => p.subject).filter(Boolean))] as string[], [products]);
  const classOptions = useMemo(() =>
    [...new Set(products.map(p => p.class_number).filter((n): n is number => n != null))].sort((a, b) => a - b).map(String),
    [products]);

  const filteredProducts = useMemo(() => products.filter(p => {
    if (filters.search && !p.name.toLowerCase().includes(filters.search.toLowerCase()) && !(p.sku ?? '').toLowerCase().includes(filters.search.toLowerCase())) return false;
    if (filters.categoryId !== 'all' && p.category_id !== filters.categoryId) return false;
    if (filters.itemType !== 'all' && p.item_type !== filters.itemType) return false;
    if (filters.series !== 'all' && p.series !== filters.series) return false;
    if (filters.subject !== 'all' && p.subject !== filters.subject) return false;
    if (filters.classNumber !== 'all' && String(p.class_number) !== filters.classNumber) return false;
    if (filters.stockStatus === 'low' && !isLowStock(p)) return false;
    if (filters.stockStatus === 'out' && !isOutOfStock(p)) return false;
    return true;
  }), [products, filters]);

  // Out-of-stock rows first, then low-stock, then the rest — each group alphabetical by name.
  const sortedProducts = useMemo(() => {
    const rank = (p: StockRow) => (isOutOfStock(p) ? 0 : isLowStock(p) ? 1 : 2);
    return [...filteredProducts].sort((a, b) => {
      const r = rank(a) - rank(b);
      if (r !== 0) return r;
      return a.name.localeCompare(b.name);
    });
  }, [filteredProducts]);

  // Summary totals are computed from the full unfiltered active-product list — always the true totals.
  const outOfStockCount = useMemo(() => products.filter(isOutOfStock).length, [products]);
  const lowStockCount = useMemo(() => products.filter(isLowStock).length, [products]);
  const totalStockValue = useMemo(
    () => products.reduce((sum, p) => sum + Math.max(p.stock_quantity, 0) * p.unit_price, 0),
    [products]
  );

  return (
    <SalesLayout>
      <div className="max-w-6xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold">Stock Report</h1>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
          <div className="bg-white rounded-xl border p-5">
            <div className="text-sm text-muted-foreground">Out of Stock</div>
            <div className="text-2xl font-bold text-red-600 mt-1">{outOfStockCount}</div>
          </div>
          <div className="bg-white rounded-xl border p-5">
            <div className="text-sm text-muted-foreground">Low Stock</div>
            <div className="text-2xl font-bold text-amber-600 mt-1">{lowStockCount}</div>
          </div>
          <div className="bg-white rounded-xl border p-5">
            <div className="text-sm text-muted-foreground">Total Stock Value</div>
            <div className="text-2xl font-bold text-violet-700 mt-1">
              ₹{totalStockValue.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
            </div>
          </div>
        </div>

        <ProductsFilterBar
          filters={filters} onChange={setFilters} categories={categories}
          seriesOptions={seriesOptions} subjectOptions={subjectOptions} classOptions={classOptions}
          hideActiveStatus
        />

        <div className="bg-white rounded-xl border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Category</TableHead>
                <TableHead>SKU</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Series</TableHead>
                <TableHead>Subject-Class</TableHead>
                <TableHead>Current Stock</TableHead>
                <TableHead>Minimum Level</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Stock Value</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>
              ) : sortedProducts.length === 0 ? (
                <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground">{products.length === 0 ? 'No active products.' : 'No products match these filters.'}</TableCell></TableRow>
              ) : (
                sortedProducts.map(p => (
                  <TableRow key={p.id}>
                    <TableCell>{p.product_categories?.name ?? '—'}</TableCell>
                    <TableCell>{p.sku || '—'}</TableCell>
                    <TableCell className="font-medium">{p.name}</TableCell>
                    <TableCell>{p.series ?? '—'}</TableCell>
                    <TableCell>
                      {p.subject || p.class_number != null
                        ? `${p.subject ?? ''}${p.subject && p.class_number != null ? ' - ' : ''}${p.class_number != null ? `Class ${p.class_number}` : ''}`
                        : '—'}
                    </TableCell>
                    <TableCell>{p.stock_quantity} {p.unit}</TableCell>
                    <TableCell>{p.minimum_stock_level} {p.unit}</TableCell>
                    <TableCell>
                      {isOutOfStock(p) ? (
                        <Badge variant="destructive">Out of Stock</Badge>
                      ) : isLowStock(p) ? (
                        <Badge className="bg-amber-100 text-amber-700">Low Stock</Badge>
                      ) : (
                        <Badge variant="outline">OK</Badge>
                      )}
                    </TableCell>
                    <TableCell>₹{(p.stock_quantity * p.unit_price).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</TableCell>
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
