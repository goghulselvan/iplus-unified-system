import { useState, useEffect } from 'react';
import SalesLayout from '@/components/sales/SalesLayout';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import ConfirmReturnReceiptDialog from '@/components/sales/ConfirmReturnReceiptDialog';

type ReturnRow = {
  id: string;
  quantity: number;
  reason_category: string;
  reason_note: string | null;
  status: 'requested' | 'received';
  condition_on_receipt: 'resellable' | 'damaged' | null;
  requested_at: string;
  invoice_line_items: {
    item_name: string;
    invoices: { invoice_number: number | null; fy: number | null; schools: { school_name: string; ss_no: number | null } | null } | null;
  } | null;
};

const REASON_LABELS: Record<string, string> = {
  wrong_item_shipped: 'Wrong item shipped',
  wrong_item_ordered_by_staff: 'Staff entered wrong item',
  damaged_in_transit: 'Damaged in transit',
  other: 'Other',
};

export default function ReturnsPage() {
  const { profile } = useAuth();
  const canManage = profile?.role === 'superadmin' || profile?.role === 'accountant';
  const [rows, setRows] = useState<ReturnRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmTarget, setConfirmTarget] = useState<{ id: string; itemName: string } | null>(null);

  const load = () => {
    setLoading(true);
    supabase
      .from('product_returns' as any)
      .select(`
        id, quantity, reason_category, reason_note, status, condition_on_receipt, requested_at,
        invoice_line_items ( item_name, invoices ( invoice_number, fy, schools ( school_name, ss_no ) ) )
      `)
      .order('requested_at', { ascending: false })
      .then(({ data }) => {
        setRows((data || []) as unknown as ReturnRow[]);
        setLoading(false);
      });
  };

  useEffect(() => { load(); }, []);

  const requested = rows.filter(r => r.status === 'requested');
  const received = rows.filter(r => r.status === 'received');

  const invoiceLabel = (r: ReturnRow) => {
    const inv = r.invoice_line_items?.invoices;
    if (!inv?.invoice_number) return '—';
    return `INV/${inv.fy}-${(inv.fy ?? 0) + 1}/${inv.invoice_number}`;
  };
  const schoolLabel = (r: ReturnRow) => {
    const school = r.invoice_line_items?.invoices?.schools;
    return school ? `${school.school_name}${school.ss_no != null ? ` (SS #${school.ss_no})` : ''}` : '—';
  };

  const renderRows = (list: ReturnRow[], showAction: boolean) => (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>School</TableHead>
          <TableHead>Item</TableHead>
          <TableHead>Qty</TableHead>
          <TableHead>Reason</TableHead>
          <TableHead>Invoice</TableHead>
          {!showAction && <TableHead>Condition</TableHead>}
          {showAction && <TableHead></TableHead>}
        </TableRow>
      </TableHeader>
      <TableBody>
        {loading ? (
          <TableRow><TableCell colSpan={6} className="text-center py-6 text-muted-foreground">Loading…</TableCell></TableRow>
        ) : list.length === 0 ? (
          <TableRow><TableCell colSpan={6} className="text-center py-6 text-muted-foreground">Nothing here.</TableCell></TableRow>
        ) : (
          list.map(r => (
            <TableRow key={r.id}>
              <TableCell>{schoolLabel(r)}</TableCell>
              <TableCell>{r.invoice_line_items?.item_name ?? '—'}</TableCell>
              <TableCell>{r.quantity}</TableCell>
              <TableCell><Badge variant="outline">{REASON_LABELS[r.reason_category] ?? r.reason_category}</Badge></TableCell>
              <TableCell>{invoiceLabel(r)}</TableCell>
              {!showAction && <TableCell className="capitalize">{r.condition_on_receipt}</TableCell>}
              {showAction && (
                <TableCell>
                  {canManage && (
                    <Button size="sm" onClick={() => setConfirmTarget({ id: r.id, itemName: r.invoice_line_items?.item_name ?? 'item' })}>
                      Confirm Receipt
                    </Button>
                  )}
                </TableCell>
              )}
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  );

  return (
    <SalesLayout>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <h1 className="text-2xl font-bold text-neutral-900 mb-4">Returns</h1>
        <Tabs defaultValue="requested">
          <TabsList>
            <TabsTrigger value="requested">Requested ({requested.length})</TabsTrigger>
            <TabsTrigger value="received">Received ({received.length})</TabsTrigger>
          </TabsList>
          <TabsContent value="requested">{renderRows(requested, true)}</TabsContent>
          <TabsContent value="received">{renderRows(received, false)}</TabsContent>
        </Tabs>
      </div>
      <ConfirmReturnReceiptDialog
        open={!!confirmTarget}
        onOpenChange={(o) => { if (!o) setConfirmTarget(null); }}
        returnId={confirmTarget?.id ?? null}
        itemName={confirmTarget?.itemName ?? ''}
        onConfirmed={load}
      />
    </SalesLayout>
  );
}
