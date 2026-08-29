import { useState, useEffect } from 'react';
import SalesLayout from '@/components/sales/SalesLayout';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import IssueCreditDialog from '@/components/sales/IssueCreditDialog';
import MarkReturnReceivedDialog from '@/components/sales/MarkReturnReceivedDialog';
import SendReplacementDialog from '@/components/sales/SendReplacementDialog';

type ReturnRow = {
  id: string;
  quantity: number;
  reason_category: string;
  reason_note: string | null;
  status: 'requested' | 'credit_issued' | 'received';
  condition_on_receipt: 'resellable' | 'damaged' | null;
  requested_at: string;
  replacement_sent_at: string | null;
  replacement_order_reference: string | null;
  actual_product: { name: string } | null;
  invoice_line_items: {
    item_name: string;
    unit_price: number;
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
  const [creditTarget, setCreditTarget] = useState<{ returnId: string; schoolName: string; itemName: string; quantity: number; amount: number } | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<{ id: string; itemName: string } | null>(null);
  const [replacementTarget, setReplacementTarget] = useState<{ returnId: string; schoolName: string; itemName: string; quantity: number } | null>(null);

  const load = () => {
    setLoading(true);
    supabase
      .from('product_returns' as any)
      .select(`
        id, quantity, reason_category, reason_note, status, condition_on_receipt, requested_at,
        replacement_sent_at, replacement_order_reference,
        actual_product:products!product_returns_actual_product_id_fkey ( name ),
        invoice_line_items ( item_name, unit_price, invoices ( invoice_number, fy, schools ( school_name, ss_no ) ) )
      `)
      .order('requested_at', { ascending: false })
      .then(({ data }) => {
        setRows((data || []) as unknown as ReturnRow[]);
        setLoading(false);
      });
  };

  useEffect(() => { load(); }, []);

  const requested = rows.filter(r => r.status === 'requested');
  const awaitingReturn = rows.filter(r => r.status === 'credit_issued');
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

  const renderRows = (list: ReturnRow[], opts: { issueCredit?: boolean; markReceived?: boolean; showCondition?: boolean }) => (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>School</TableHead>
          <TableHead>Item</TableHead>
          <TableHead>Qty</TableHead>
          <TableHead>Reason</TableHead>
          <TableHead>Invoice</TableHead>
          <TableHead>Requested</TableHead>
          {opts.showCondition && <TableHead>Condition</TableHead>}
          {(opts.issueCredit || opts.markReceived) && <TableHead></TableHead>}
        </TableRow>
      </TableHeader>
      <TableBody>
        {loading ? (
          <TableRow><TableCell colSpan={7} className="text-center py-6 text-muted-foreground">Loading…</TableCell></TableRow>
        ) : list.length === 0 ? (
          <TableRow><TableCell colSpan={7} className="text-center py-6 text-muted-foreground">Nothing here.</TableCell></TableRow>
        ) : (
          list.map(r => (
            <TableRow key={r.id}>
              <TableCell>{schoolLabel(r)}</TableCell>
              <TableCell>
                {r.invoice_line_items?.item_name ?? '—'}
                {r.actual_product && (
                  <p className="text-xs text-amber-600 mt-0.5">Shipped instead: {r.actual_product.name}</p>
                )}
                {r.replacement_sent_at && (
                  <p className="text-xs text-emerald-600 mt-0.5">
                    ✓ Replacement sent {new Date(r.replacement_sent_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                    {r.replacement_order_reference ? ` (${r.replacement_order_reference})` : ''}
                  </p>
                )}
              </TableCell>
              <TableCell>{r.quantity}</TableCell>
              <TableCell><Badge variant="outline">{REASON_LABELS[r.reason_category] ?? r.reason_category}</Badge></TableCell>
              <TableCell>{invoiceLabel(r)}</TableCell>
              <TableCell>{new Date(r.requested_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</TableCell>
              {opts.showCondition && <TableCell className="capitalize">{r.condition_on_receipt}</TableCell>}
              {(opts.issueCredit || opts.markReceived) && (
                <TableCell>
                  {canManage && (
                    <div className="flex gap-2">
                      {opts.issueCredit && r.reason_category === 'wrong_item_shipped' && !r.replacement_sent_at && (
                        <Button size="sm" variant="outline" onClick={() => setReplacementTarget({
                          returnId: r.id,
                          schoolName: schoolLabel(r),
                          itemName: r.invoice_line_items?.item_name ?? 'item',
                          quantity: r.quantity,
                        })}>
                          Send Replacement
                        </Button>
                      )}
                      {opts.issueCredit && !r.replacement_sent_at && (
                        <Button size="sm" onClick={() => setCreditTarget({
                          returnId: r.id,
                          schoolName: schoolLabel(r),
                          itemName: r.invoice_line_items?.item_name ?? 'item',
                          quantity: r.quantity,
                          amount: (r.invoice_line_items?.unit_price ?? 0) * r.quantity,
                        })}>
                          Issue Credit
                        </Button>
                      )}
                      {opts.markReceived && (
                        <Button size="sm" variant={opts.issueCredit ? 'outline' : 'default'}
                          onClick={() => setConfirmTarget({ id: r.id, itemName: r.invoice_line_items?.item_name ?? 'item' })}>
                          Mark Received
                        </Button>
                      )}
                    </div>
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
            <TabsTrigger value="awaiting">Awaiting Return ({awaitingReturn.length})</TabsTrigger>
            <TabsTrigger value="received">Received ({received.length})</TabsTrigger>
          </TabsList>
          <TabsContent value="requested">{renderRows(requested, { issueCredit: true, markReceived: true })}</TabsContent>
          <TabsContent value="awaiting">{renderRows(awaitingReturn, { markReceived: true })}</TabsContent>
          <TabsContent value="received">{renderRows(received, { showCondition: true })}</TabsContent>
        </Tabs>
      </div>
      <IssueCreditDialog
        open={!!creditTarget}
        onOpenChange={(o) => { if (!o) setCreditTarget(null); }}
        target={creditTarget}
        onIssued={load}
      />
      <MarkReturnReceivedDialog
        open={!!confirmTarget}
        onOpenChange={(o) => { if (!o) setConfirmTarget(null); }}
        returnId={confirmTarget?.id ?? null}
        itemName={confirmTarget?.itemName ?? ''}
        onConfirmed={load}
      />
      <SendReplacementDialog
        open={!!replacementTarget}
        onOpenChange={(o) => { if (!o) setReplacementTarget(null); }}
        target={replacementTarget}
        onSent={load}
      />
    </SalesLayout>
  );
}
