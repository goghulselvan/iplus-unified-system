import { useState, useEffect, useMemo } from 'react';
import SalesLayout from '@/components/sales/SalesLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import ProductDialog from './ProductDialog';
import ProductsFilterBar, { DEFAULT_FILTERS, type ProductFilters } from './ProductsFilterBar';

export type Product = {
  id: string;
  name: string;
  hsn_code: string | null;
  gst_rate: number;
  unit_price: number;
  stock_quantity: number;
  is_active: boolean;
  category_id: string | null;
  sku: string | null;
  item_type: 'consumable' | 'saleable';
  unit: string;
  minimum_stock_level: number;
  expiry_date: string | null;
  location: string | null;
  barcode: string | null;
  image_url: string | null;
  series: string | null;
  subject: string | null;
  class_number: number | null;
};

const isOutOfStock = (p: Pick<Product, 'stock_quantity'>) => p.stock_quantity <= 0;
const isLowStock = (p: Pick<Product, 'stock_quantity' | 'minimum_stock_level'>) =>
  !isOutOfStock(p) && p.stock_quantity < p.minimum_stock_level;

export default function ProductsPage() {
  const { toast } = useToast();
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Product | null>(null);
  const [filters, setFilters] = useState<ProductFilters>(DEFAULT_FILTERS);
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([]);

  const loadCategories = async () => {
    const { data } = await supabase.from('product_categories' as any).select('id, name').order('name');
    setCategories((data || []) as unknown as { id: string; name: string }[]);
  };

  useEffect(() => { loadCategories(); }, []);

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
    if (filters.activeStatus === 'active' && !p.is_active) return false;
    if (filters.activeStatus === 'inactive' && p.is_active) return false;
    return true;
  }), [products, filters]);

  const loadProducts = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('products' as any)
      .select('*')
      .order('name');
    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } else {
      setProducts((data || []) as unknown as Product[]);
    }
    setLoading(false);
  };

  useEffect(() => { loadProducts(); }, []);

  const openAdd = () => { setEditing(null); setDialogOpen(true); };
  const openEdit = (p: Product) => { setEditing(p); setDialogOpen(true); };

  const toggleActive = async (p: Product) => {
    const { error } = await supabase.from('products' as any).update({ is_active: !p.is_active }).eq('id', p.id);
    if (error) { toast({ title: 'Error', description: error.message, variant: 'destructive' }); return; }
    loadProducts();
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    const { error } = await supabase.from('products' as any).delete().eq('id', deleteTarget.id);
    if (error) { toast({ title: 'Error', description: error.message, variant: 'destructive' }); setDeleteTarget(null); return; }
    toast({ title: 'Product deleted' });
    setDeleteTarget(null);
    loadProducts();
  };

  return (
    <SalesLayout>
      <div className="max-w-6xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold">Products</h1>
          <Button onClick={openAdd}><Plus className="h-4 w-4 mr-2" />Add Product</Button>
        </div>

        <ProductsFilterBar
          filters={filters} onChange={setFilters} categories={categories}
          seriesOptions={seriesOptions} subjectOptions={subjectOptions} classOptions={classOptions}
        />

        <div className="bg-white rounded-xl border border-neutral-200 shadow-sm overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Series / Subject / Class</TableHead>
                <TableHead>HSN/SAC</TableHead>
                <TableHead>GST Rate</TableHead>
                <TableHead>Unit Price</TableHead>
                <TableHead>Stock</TableHead>
                <TableHead>Active</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>
              ) : filteredProducts.length === 0 ? (
                <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground">{products.length === 0 ? 'No products yet.' : 'No products match these filters.'}</TableCell></TableRow>
              ) : (
                filteredProducts.map(p => (
                  <TableRow key={p.id}>
                    <TableCell className="font-medium">{p.name}</TableCell>
                    <TableCell>{categories.find(c => c.id === p.category_id)?.name ?? '—'}</TableCell>
                    <TableCell>
                      <div>{p.series ?? '—'}</div>
                      {(p.subject || p.class_number != null) && (
                        <div className="text-xs text-muted-foreground">
                          {p.subject ?? ''}{p.subject && p.class_number != null ? ' · ' : ''}{p.class_number != null ? `Class ${p.class_number}` : ''}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>{p.hsn_code || '—'}</TableCell>
                    <TableCell>{p.gst_rate}%</TableCell>
                    <TableCell>₹{p.unit_price.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</TableCell>
                    <TableCell>
                      {p.stock_quantity}
                      {isOutOfStock(p) && (
                        <Badge className="ml-2 text-[10px] bg-red-50 text-red-600 border-red-100">Out of stock</Badge>
                      )}
                      {isLowStock(p) && (
                        <Badge className="ml-2 text-[10px] bg-amber-50 text-amber-600 border-amber-100">Low stock</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <button onClick={() => toggleActive(p)}>
                        <Badge className={p.is_active ? 'bg-emerald-50 text-emerald-600 border-emerald-100' : 'bg-neutral-100 text-neutral-500 border-neutral-200'}>{p.is_active ? 'Active' : 'Inactive'}</Badge>
                      </button>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" onClick={() => openEdit(p)}><Pencil className="h-3.5 w-3.5" /></Button>
                      <Button variant="ghost" size="sm" onClick={() => setDeleteTarget(p)}><Trash2 className="h-3.5 w-3.5 text-red-600" /></Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <ProductDialog open={dialogOpen} onOpenChange={setDialogOpen} editing={editing} onSaved={loadProducts} onCategoryAdded={loadCategories} />

      <AlertDialog open={!!deleteTarget} onOpenChange={open => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete "{deleteTarget?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-red-600 hover:bg-red-700">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SalesLayout>
  );
}
