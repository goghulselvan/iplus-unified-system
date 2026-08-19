import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { supabase } from '@/integrations/supabase/client';

type LineItem = { item_name: string; quantity: number; unit_price: number; line_total: number };

export default function InvoiceItemsDialog({
  invoiceId,
  onOpenChange,
}: {
  invoiceId: string | null;
  onOpenChange: (open: boolean) => void;
}) {
  const [items, setItems] = useState<LineItem[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!invoiceId) return;
    setLoading(true);
    supabase
      .from('invoice_line_items' as any)
      .select('item_name, quantity, unit_price, line_total')
      .eq('invoice_id', invoiceId)
      .order('row_order')
      .then(({ data }) => {
        setItems((data || []) as unknown as LineItem[]);
        setLoading(false);
      });
  }, [invoiceId]);

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
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={4} className="text-center py-6 text-muted-foreground">Loading…</TableCell></TableRow>
            ) : items.length === 0 ? (
              <TableRow><TableCell colSpan={4} className="text-center py-6 text-muted-foreground">No items.</TableCell></TableRow>
            ) : (
              items.map((it, idx) => (
                <TableRow key={idx}>
                  <TableCell className="font-medium">{it.item_name}</TableCell>
                  <TableCell>{it.quantity}</TableCell>
                  <TableCell>₹{it.unit_price.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</TableCell>
                  <TableCell>₹{it.line_total.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </DialogContent>
    </Dialog>
  );
}
