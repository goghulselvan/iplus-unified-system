import { useState, useEffect } from 'react';
import SalesLayout from '@/components/sales/SalesLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

type Product = {
  id: string;
  name: string;
  hsn_code: string | null;
  gst_rate: number;
  unit_price: number;
  stock_quantity: number;
  is_active: boolean;
};

const GST_RATES = [0, 5, 12, 18, 28];
const LOW_STOCK_THRESHOLD = 5;
const emptyForm = { name: '', hsn_code: '', gst_rate: '18', unit_price: '', stock_quantity: '' };

export default function ProductsPage() {
  const { toast } = useToast();
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Product | null>(null);

  const loadProducts = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('products' as any)
      .select('id, name, hsn_code, gst_rate, unit_price, stock_quantity, is_active')
      .order('name');
    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } else {
      setProducts((data || []) as unknown as Product[]);
    }
    setLoading(false);
  };

  useEffect(() => { loadProducts(); }, []);

  const openAdd = () => { setEditing(null); setForm(emptyForm); setDialogOpen(true); };

  const openEdit = (p: Product) => {
    setEditing(p);
    setForm({
      name: p.name,
      hsn_code: p.hsn_code ?? '',
      gst_rate: String(p.gst_rate),
      unit_price: String(p.unit_price),
      stock_quantity: String(p.stock_quantity),
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) { toast({ title: 'Name is required', variant: 'destructive' }); return; }
    setSaving(true);
    const payload = {
      name: form.name.trim(),
      hsn_code: form.hsn_code.trim() || null,
      gst_rate: Number(form.gst_rate),
      unit_price: Number(form.unit_price) || 0,
      stock_quantity: Number(form.stock_quantity) || 0,
    };
    const { error } = editing
      ? await supabase.from('products' as any).update(payload).eq('id', editing.id)
      : await supabase.from('products' as any).insert(payload);
    setSaving(false);
    if (error) { toast({ title: 'Error', description: error.message, variant: 'destructive' }); return; }
    toast({ title: editing ? 'Product updated' : 'Product added' });
    setDialogOpen(false);
    loadProducts();
  };

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

        <div className="bg-white rounded-xl border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
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
                <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>
              ) : products.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No products yet.</TableCell></TableRow>
              ) : (
                products.map(p => (
                  <TableRow key={p.id}>
                    <TableCell className="font-medium">{p.name}</TableCell>
                    <TableCell>{p.hsn_code || '—'}</TableCell>
                    <TableCell>{p.gst_rate}%</TableCell>
                    <TableCell>₹{p.unit_price.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</TableCell>
                    <TableCell>
                      {p.stock_quantity}
                      {p.stock_quantity < LOW_STOCK_THRESHOLD && (
                        <Badge variant="destructive" className="ml-2 text-[10px]">Low stock</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <button onClick={() => toggleActive(p)}>
                        <Badge variant={p.is_active ? 'default' : 'outline'}>{p.is_active ? 'Active' : 'Inactive'}</Badge>
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

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{editing ? 'Edit Product' : 'Add Product'}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="p-name">Name</Label>
              <Input id="p-name" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
            </div>
            <div>
              <Label htmlFor="p-hsn">HSN/SAC Code</Label>
              <Input id="p-hsn" value={form.hsn_code} onChange={e => setForm(f => ({ ...f, hsn_code: e.target.value }))} />
            </div>
            <div>
              <Label>GST Rate</Label>
              <Select value={form.gst_rate} onValueChange={v => setForm(f => ({ ...f, gst_rate: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {GST_RATES.map(r => <SelectItem key={r} value={String(r)}>{r}%</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="p-price">Unit Price (₹)</Label>
              <Input id="p-price" type="number" min="0" step="0.01" value={form.unit_price} onChange={e => setForm(f => ({ ...f, unit_price: e.target.value }))} />
            </div>
            <div>
              <Label htmlFor="p-stock">{editing ? 'Stock Quantity' : 'Initial Stock Quantity'}</Label>
              <Input id="p-stock" type="number" min="0" value={form.stock_quantity} onChange={e => setForm(f => ({ ...f, stock_quantity: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
