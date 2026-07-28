import { useState, useEffect, useMemo } from 'react';
import SalesLayout from '@/components/sales/SalesLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Textarea } from '@/components/ui/textarea';
import { Plus, Download, Pencil, Ban, Trash2, Search } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import InvoiceDialog, { EditingInvoice } from './InvoiceDialog';
import { generateInvoice } from '@/utils/invoiceGenerator';

type InvoiceRow = {
  id: string;
  invoice_number: number;
  fy: number;
  buyer_name: string;
  school_id: string | null;
  prospect_school_id: string | null;
  payment_method: string;
  status: 'unpaid' | 'paid' | 'void';
  grand_total: number;
  created_at: string;
};

const PAGE_SIZE = 200;

export default function InvoicesPage() {
  const { toast } = useToast();
  const { profile } = useAuth();
  const canManage = profile?.role === 'superadmin' || profile?.role === 'accountant';

  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [sortBy, setSortBy] = useState('newest');

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingInvoice, setEditingInvoice] = useState<EditingInvoice | null>(null);
  const [voidTarget, setVoidTarget] = useState<InvoiceRow | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<InvoiceRow | null>(null);

  const loadInvoices = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('invoices' as any)
      .select('id, invoice_number, fy, buyer_name, school_id, prospect_school_id, payment_method, status, grand_total, created_at')
      .order('fy', { ascending: false })
      .order('invoice_number', { ascending: false })
      .limit(PAGE_SIZE);
    if (error) { toast({ title: 'Error', description: error.message, variant: 'destructive' }); setLoading(false); return; }
    setInvoices((data || []) as unknown as InvoiceRow[]);
    setLoading(false);
  };

  useEffect(() => { loadInvoices(); }, []);

  const filtered = useMemo(() => {
    let rows = invoices;
    if (statusFilter !== 'all') rows = rows.filter(r => r.status === statusFilter);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      rows = rows.filter(r => String(r.invoice_number).includes(q) || r.buyer_name.toLowerCase().includes(q));
    }
    const sorted = [...rows];
    switch (sortBy) {
      case 'oldest': sorted.sort((a, b) => (a.fy - b.fy) || (a.invoice_number - b.invoice_number)); break;
      case 'amount_desc': sorted.sort((a, b) => b.grand_total - a.grand_total); break;
      case 'amount_asc': sorted.sort((a, b) => a.grand_total - b.grand_total); break;
      default: sorted.sort((a, b) => (b.fy - a.fy) || (b.invoice_number - a.invoice_number));
    }
    return sorted;
  }, [invoices, statusFilter, search, sortBy]);

  const openNew = () => { setEditingInvoice(null); setDialogOpen(true); };

  const openEdit = async (row: InvoiceRow) => {
    const { data: inv, error: e1 } = await supabase.from('invoices' as any).select('*').eq('id', row.id).single();
    const { data: items, error: e2 } = await supabase.from('invoice_line_items' as any).select('*').eq('invoice_id', row.id).order('row_order');
    if (e1 || e2 || !inv) { toast({ title: 'Error loading invoice', variant: 'destructive' }); return; }
    const invAny = inv as any;
    setEditingInvoice({
      id: invAny.id,
      school_id: invAny.school_id,
      prospect_school_id: invAny.prospect_school_id,
      buyer_name: invAny.buyer_name,
      buyer_ss_no: null,
      buyer_address: invAny.buyer_address || '',
      buyer_state: invAny.buyer_state,
      buyer_gstin: invAny.buyer_gstin || '',
      payment_method: invAny.payment_method,
      line_items: ((items || []) as any[]).map(li => ({
        product_id: li.product_id, item_name: li.item_name, hsn_code: li.hsn_code || '',
        gst_rate: li.gst_rate, quantity: li.quantity, unit_price: li.unit_price,
      })),
    });
    setDialogOpen(true);
  };

  const handleDownload = async (id: string) => {
    const { data: inv } = await supabase.from('invoices' as any).select('*').eq('id', id).single();
    const { data: items, error: itemsError } = await supabase.from('invoice_line_items' as any).select('*').eq('invoice_id', id).order('row_order');
    if (!inv || itemsError) { toast({ title: 'Error loading invoice', variant: 'destructive' }); return; }
    const invAny = inv as any;
    const blob = await generateInvoice({
      invoiceNumber: invAny.invoice_number,
      fy: invAny.fy,
      invoiceDate: new Date(invAny.created_at),
      buyerName: invAny.buyer_name,
      buyerSsNo: null,
      buyerAddress: invAny.buyer_address,
      buyerState: invAny.buyer_state,
      buyerGstin: invAny.buyer_gstin,
      paymentMethod: invAny.payment_method,
      status: invAny.status,
      lineItems: ((items || []) as any[]).map(li => ({
        itemName: li.item_name, hsnCode: li.hsn_code, gstRate: li.gst_rate,
        quantity: li.quantity, unitPrice: li.unit_price, lineTotal: li.line_total,
      })),
      subtotal: invAny.subtotal, cgstAmount: invAny.cgst_amount, sgstAmount: invAny.sgst_amount,
      igstAmount: invAny.igst_amount, grandTotal: invAny.grand_total,
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Invoice_INV-${invAny.fy}-${invAny.fy + 1}-${invAny.invoice_number}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleSaved = async (result: { id: string; low_stock_warnings?: any[] }) => {
    await loadInvoices();
    if (result.low_stock_warnings?.length) {
      toast({ title: 'Low stock warning', description: `${result.low_stock_warnings.length} product(s) now below zero stock.`, variant: 'destructive' });
    }
    handleDownload(result.id);
  };

  const togglePaid = async (row: InvoiceRow) => {
    const { error } = await supabase.rpc('mark_invoice_paid' as any, { p_invoice_id: row.id, p_paid: row.status !== 'paid' });
    if (error) { toast({ title: 'Error', description: error.message, variant: 'destructive' }); return; }
    loadInvoices();
  };

  const handleVoid = async () => {
    if (!voidTarget || !voidReason.trim()) return;
    const { error } = await supabase.rpc('void_invoice' as any, { p_invoice_id: voidTarget.id, p_reason: voidReason.trim() });
    if (error) { toast({ title: 'Error', description: error.message, variant: 'destructive' }); return; }
    toast({ title: 'Invoice voided' });
    setVoidTarget(null); setVoidReason('');
    loadInvoices();
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    const { error } = await supabase.from('invoices' as any).delete().eq('id', deleteTarget.id);
    if (error) { toast({ title: 'Error', description: error.message, variant: 'destructive' }); setDeleteTarget(null); return; }
    toast({ title: 'Invoice deleted' });
    setDeleteTarget(null);
    loadInvoices();
  };

  const statusBadge = (s: string) => {
    if (s === 'paid') return <Badge className="bg-emerald-100 text-emerald-700">Paid</Badge>;
    if (s === 'void') return <Badge className="bg-gray-200 text-gray-600">Void</Badge>;
    return <Badge className="bg-amber-100 text-amber-700">Unpaid</Badge>;
  };

  return (
    <SalesLayout>
      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold">Invoices</h1>
          <Button onClick={openNew}><Plus className="h-4 w-4 mr-2" />New Invoice</Button>
        </div>

        <div className="flex flex-wrap items-center gap-3 mb-4">
          <div className="relative flex-1 min-w-56">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input className="pl-8" placeholder="Search invoice no. or buyer name…" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="unpaid">Unpaid</SelectItem>
              <SelectItem value="paid">Paid</SelectItem>
              <SelectItem value="void">Void</SelectItem>
            </SelectContent>
          </Select>
          <Select value={sortBy} onValueChange={setSortBy}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="newest">Newest First</SelectItem>
              <SelectItem value="oldest">Oldest First</SelectItem>
              <SelectItem value="amount_desc">Amount High→Low</SelectItem>
              <SelectItem value="amount_asc">Amount Low→High</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="bg-white rounded-xl border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Invoice No.</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Buyer</TableHead>
                <TableHead>Payment Method</TableHead>
                <TableHead>Grand Total</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>
              ) : filtered.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No invoices found.</TableCell></TableRow>
              ) : (
                filtered.map(row => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">INV/{row.fy}-{row.fy + 1}/{row.invoice_number}</TableCell>
                    <TableCell>{new Date(row.created_at).toLocaleDateString('en-IN')}</TableCell>
                    <TableCell>{row.buyer_name}</TableCell>
                    <TableCell>{row.payment_method}</TableCell>
                    <TableCell>₹{row.grand_total.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</TableCell>
                    <TableCell>{statusBadge(row.status)}</TableCell>
                    <TableCell className="text-right space-x-1">
                      <Button variant="ghost" size="sm" onClick={() => handleDownload(row.id)}><Download className="h-3.5 w-3.5" /></Button>
                      {row.status !== 'void' && (
                        <Button variant="ghost" size="sm" onClick={() => togglePaid(row)}>
                          {row.status === 'paid' ? 'Mark Unpaid' : 'Mark Paid'}
                        </Button>
                      )}
                      {canManage && row.status !== 'void' && (
                        <>
                          <Button variant="ghost" size="sm" onClick={() => openEdit(row)}><Pencil className="h-3.5 w-3.5" /></Button>
                          <Button variant="ghost" size="sm" onClick={() => setVoidTarget(row)}><Ban className="h-3.5 w-3.5 text-amber-600" /></Button>
                        </>
                      )}
                      {canManage && (
                        <Button variant="ghost" size="sm" onClick={() => setDeleteTarget(row)}><Trash2 className="h-3.5 w-3.5 text-red-600" /></Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <InvoiceDialog open={dialogOpen} onOpenChange={setDialogOpen} editingInvoice={editingInvoice} onSaved={handleSaved} />

      <Dialog open={!!voidTarget} onOpenChange={open => { if (!open) { setVoidTarget(null); setVoidReason(''); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Void Invoice INV/{voidTarget?.fy}-{(voidTarget?.fy ?? 0) + 1}/{voidTarget?.invoice_number}</DialogTitle></DialogHeader>
          <Textarea placeholder="Reason for voiding (required)" value={voidReason} onChange={e => setVoidReason(e.target.value)} />
          <DialogFooter>
            <Button variant="outline" onClick={() => { setVoidTarget(null); setVoidReason(''); }}>Cancel</Button>
            <Button onClick={handleVoid} disabled={!voidReason.trim()} className="bg-amber-600 hover:bg-amber-700">Void Invoice</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={open => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Invoice INV/{deleteTarget?.fy}-{(deleteTarget?.fy ?? 0) + 1}/{deleteTarget?.invoice_number}?</AlertDialogTitle>
            <AlertDialogDescription>This permanently removes the invoice and will leave a gap in the invoice number sequence. This cannot be undone.</AlertDialogDescription>
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
