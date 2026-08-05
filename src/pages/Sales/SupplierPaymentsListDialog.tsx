import { useState, useEffect, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Trash2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

type SupplierPaymentRow = {
  id: string;
  amount: number;
  payment_date: string;
  payment_mode: string;
  reference: string | null;
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  supplierId: string;
  supplierName: string;
  onChanged: () => void;
}

export default function SupplierPaymentsListDialog({ open, onOpenChange, supplierId, supplierName, onChanged }: Props) {
  const { toast } = useToast();
  const [payments, setPayments] = useState<SupplierPaymentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<SupplierPaymentRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  const loadPayments = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('inventory_supplier_payments' as any)
      .select('*')
      .eq('supplier_id', supplierId)
      .order('payment_date', { ascending: false });
    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } else {
      setPayments((data || []) as unknown as SupplierPaymentRow[]);
    }
    setLoading(false);
  }, [supplierId, toast]);

  useEffect(() => {
    if (!open) return;
    loadPayments();
  }, [open, loadPayments]);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    const { error } = await supabase.from('inventory_supplier_payments' as any).delete().eq('id', deleteTarget.id);
    setDeleting(false);
    if (error) { toast({ title: 'Error', description: error.message, variant: 'destructive' }); return; }
    toast({ title: 'Payment deleted' });
    setDeleteTarget(null);
    loadPayments();
    onChanged();
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Payment History — {supplierName}</DialogTitle></DialogHeader>

          <div className="border rounded-lg overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Mode</TableHead>
                  <TableHead>Reference</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>
                ) : payments.length === 0 ? (
                  <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">No payments recorded yet.</TableCell></TableRow>
                ) : (
                  payments.map(p => (
                    <TableRow key={p.id}>
                      <TableCell>{new Date(p.payment_date).toLocaleDateString('en-IN')}</TableCell>
                      <TableCell>₹{Number(p.amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</TableCell>
                      <TableCell>{p.payment_mode}</TableCell>
                      <TableCell>{p.reference || '—'}</TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="sm" onClick={() => setDeleteTarget(p)}><Trash2 className="h-3.5 w-3.5 text-red-600" /></Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={open => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this payment?</AlertDialogTitle>
            <AlertDialogDescription>
              ₹{deleteTarget ? Number(deleteTarget.amount).toLocaleString('en-IN', { minimumFractionDigits: 2 }) : ''} on {deleteTarget ? new Date(deleteTarget.payment_date).toLocaleDateString('en-IN') : ''}. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} disabled={deleting} className="bg-red-600 hover:bg-red-700">
              {deleting ? 'Deleting…' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
