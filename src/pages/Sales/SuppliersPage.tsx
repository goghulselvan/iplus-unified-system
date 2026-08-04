import { useState, useEffect } from 'react';
import SalesLayout from '@/components/sales/SalesLayout';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Plus, Pencil, Trash2, Wallet } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import SupplierDialog from './SupplierDialog';
import SupplierPaymentDialog from './SupplierPaymentDialog';

export type Supplier = {
  id: string;
  name: string;
  contact_person: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  gstin: string | null;
  is_active: boolean;
};

export default function SuppliersPage() {
  const { toast } = useToast();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [totalsPaid, setTotalsPaid] = useState<Record<string, number>>({});
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Supplier | null>(null);
  const [paymentTarget, setPaymentTarget] = useState<Supplier | null>(null);

  const loadSuppliers = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('inventory_suppliers' as any)
      .select('*')
      .order('name');
    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } else {
      setSuppliers((data || []) as unknown as Supplier[]);
    }
    setLoading(false);
  };

  const loadTotalsPaid = async () => {
    const { data, error } = await supabase
      .from('inventory_supplier_payments' as any)
      .select('supplier_id, amount');
    if (error) { toast({ title: 'Error', description: error.message, variant: 'destructive' }); return; }
    const rows = (data || []) as unknown as { supplier_id: string; amount: number }[];
    const totals: Record<string, number> = {};
    for (const r of rows) {
      totals[r.supplier_id] = (totals[r.supplier_id] || 0) + Number(r.amount);
    }
    setTotalsPaid(totals);
  };

  useEffect(() => { loadSuppliers(); loadTotalsPaid(); }, []);

  const openAdd = () => { setEditing(null); setDialogOpen(true); };
  const openEdit = (s: Supplier) => { setEditing(s); setDialogOpen(true); };

  const toggleActive = async (s: Supplier) => {
    const { error } = await supabase.from('inventory_suppliers' as any).update({ is_active: !s.is_active }).eq('id', s.id);
    if (error) { toast({ title: 'Error', description: error.message, variant: 'destructive' }); return; }
    loadSuppliers();
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    const { error } = await supabase.from('inventory_suppliers' as any).delete().eq('id', deleteTarget.id);
    if (error) { toast({ title: 'Error', description: error.message, variant: 'destructive' }); setDeleteTarget(null); return; }
    toast({ title: 'Supplier deleted' });
    setDeleteTarget(null);
    loadSuppliers();
  };

  const handlePaymentSaved = () => {
    setPaymentTarget(null);
    loadTotalsPaid();
  };

  return (
    <SalesLayout>
      <div className="max-w-6xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold">Suppliers</h1>
          <Button onClick={openAdd}><Plus className="h-4 w-4 mr-2" />Add Supplier</Button>
        </div>

        <div className="bg-white rounded-xl border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Contact Person</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>GSTIN</TableHead>
                <TableHead>Total Paid</TableHead>
                <TableHead>Active</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>
              ) : suppliers.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No suppliers yet.</TableCell></TableRow>
              ) : (
                suppliers.map(s => (
                  <TableRow key={s.id}>
                    <TableCell className="font-medium">{s.name}</TableCell>
                    <TableCell>{s.contact_person || '—'}</TableCell>
                    <TableCell>{s.phone || '—'}</TableCell>
                    <TableCell>{s.gstin || '—'}</TableCell>
                    <TableCell>₹{(totalsPaid[s.id] || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</TableCell>
                    <TableCell>
                      <button onClick={() => toggleActive(s)}>
                        <Badge variant={s.is_active ? 'default' : 'outline'}>{s.is_active ? 'Active' : 'Inactive'}</Badge>
                      </button>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" onClick={() => setPaymentTarget(s)}><Wallet className="h-3.5 w-3.5 mr-1" />Record Payment</Button>
                      <Button variant="ghost" size="sm" onClick={() => openEdit(s)}><Pencil className="h-3.5 w-3.5" /></Button>
                      <Button variant="ghost" size="sm" onClick={() => setDeleteTarget(s)}><Trash2 className="h-3.5 w-3.5 text-red-600" /></Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <SupplierDialog open={dialogOpen} onOpenChange={setDialogOpen} editing={editing} onSaved={loadSuppliers} />

      {paymentTarget && (
        <SupplierPaymentDialog
          open={!!paymentTarget}
          onOpenChange={open => { if (!open) setPaymentTarget(null); }}
          supplierId={paymentTarget.id}
          supplierName={paymentTarget.name}
          onSaved={handlePaymentSaved}
        />
      )}

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
