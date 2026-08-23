import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import ReportReturnDialog from './ReportReturnDialog';

type LineItem = { id: string; item_name: string; quantity: number; unit_price: number; line_total: number };

export default function InvoiceItemsDialog({
  invoiceId,
  onOpenChange,
}: {
  invoiceId: string | null;
  onOpenChange: (open: boolean) => void;
}) {
  const [items, setItems] = useState<LineItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [isSchoolBilled, setIsSchoolBilled] = useState(false);
  const [returnedByLine, setReturnedByLine] = useState<Record<string, number>>({});
  const [returnTarget, setReturnTarget] = useState<{ id: string; item_name: string; maxReturnable: number } | null>(null);

  const loadReturned = async (lineIds: string[]) => {
    if (lineIds.length === 0) { setReturnedByLine({}); return; }
    const { data } = await supabase
      .from('product_returns' as any)
      .select('invoice_line_item_id, quantity')
      .in('invoice_line_item_id', lineIds);
    const totals: Record<string, number> = {};
    for (const row of (data || []) as unknown as { invoice_line_item_id: string; quantity: number }[]) {
      totals[row.invoice_line_item_id] = (totals[row.invoice_line_item_id] || 0) + row.quantity;
    }
    setReturnedByLine(totals);
  };

  const load = () => {
    if (!invoiceId) return;
    setLoading(true);
    Promise.all([
      supabase.from('invoice_line_items' as any).select('id, item_name, quantity, unit_price, line_total')
        .eq('invoice_id', invoiceId).order('row_order'),
      supabase.from('invoices' as any).select('school_id').eq('id', invoiceId).single(),
    ]).then(([itemsRes, invoiceRes]) => {
      const rows = (itemsRes.data || []) as unknown as LineItem[];
      setItems(rows);
      setIsSchoolBilled(!!(invoiceRes.data as unknown as { school_id: string | null } | null)?.school_id);
      setLoading(false);
      loadReturned(rows.map(r => r.id));
    });
  };

  useEffect(() => { load(); }, [invoiceId]);

  const totalQty = items.reduce((sum, it) => sum + it.quantity, 0);

  return (
    <Dialog open={!!invoiceId} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Invoiced Items</DialogTitle></DialogHeader>
        {!loading && items.length > 0 && (
          <p className="text-sm text-muted-foreground -mt-2">Total Quantity: <span className="font-semibold text-foreground">{totalQty}</span></p>
        )}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Item</TableHead>
              <TableHead>Qty</TableHead>
              <TableHead>Unit Price</TableHead>
              <TableHead>Amount</TableHead>
              {isSchoolBilled && <TableHead></TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={5} className="text-center py-6 text-muted-foreground">Loading…</TableCell></TableRow>
            ) : items.length === 0 ? (
              <TableRow><TableCell colSpan={5} className="text-center py-6 text-muted-foreground">No items.</TableCell></TableRow>
            ) : (
              items.map((it) => {
                const maxReturnable = it.quantity - (returnedByLine[it.id] || 0);
                return (
                  <TableRow key={it.id}>
                    <TableCell className="font-medium">{it.item_name}</TableCell>
                    <TableCell>{it.quantity}</TableCell>
                    <TableCell>₹{it.unit_price.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</TableCell>
                    <TableCell>₹{it.line_total.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</TableCell>
                    {isSchoolBilled && (
                      <TableCell>
                        {maxReturnable > 0 && (
                          <Button variant="outline" size="sm"
                            onClick={() => setReturnTarget({ id: it.id, item_name: it.item_name, maxReturnable })}>
                            Report Return
                          </Button>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </DialogContent>
      <ReportReturnDialog
        open={!!returnTarget}
        onOpenChange={(o) => { if (!o) setReturnTarget(null); }}
        lineItem={returnTarget}
        onReported={load}
      />
    </Dialog>
  );
}
