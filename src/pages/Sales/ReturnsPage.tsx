import { useState, useEffect } from 'react';
import SalesLayout from '@/components/sales/SalesLayout';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CheckCircle2, PackageCheck, Printer, XCircle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import IssueCreditDialog from '@/components/sales/IssueCreditDialog';
import MarkReturnReceivedDialog from '@/components/sales/MarkReturnReceivedDialog';
import SendReplacementDialog from '@/components/sales/SendReplacementDialog';
import { shortBookName } from '@/utils/bookName';
import { generateReplacementSlip } from '@/utils/replacementSlipGenerator';

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
    products: { name: string } | null;
    invoices: { invoice_number: number | null; fy: number | null; schools: { id: string; school_name: string; ss_no: number | null } | null } | null;
  } | null;
};

const REASON_LABELS: Record<string, string> = {
  wrong_item_shipped: 'Wrong item shipped',
  wrong_item_ordered_by_staff: 'Staff entered wrong item',
  damaged_in_transit: 'Damaged in transit',
  other: 'Other',
};

const shortDate = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

// Invoice lines snapshot the name at billing; the live product name is the one printed on today's books.
const orderedName = (r: ReturnRow) => r.invoice_line_items?.products?.name ?? r.invoice_line_items?.item_name ?? 'item';

const awaitsReplacement = (r: ReturnRow) =>
  r.reason_category === 'wrong_item_shipped' && !r.replacement_sent_at && r.status !== 'credit_issued';

export default function ReturnsPage() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const canManage = profile?.role === 'superadmin' || profile?.role === 'accountant';
  const [rows, setRows] = useState<ReturnRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [creditTarget, setCreditTarget] = useState<{ returnId: string; schoolName: string; itemName: string; quantity: number; amount: number } | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<{ id: string; itemName: string } | null>(null);
  const [replacementTarget, setReplacementTarget] = useState<{ returnId: string; schoolName: string; itemName: string; wrongItemName: string | null; quantity: number } | null>(null);
  const [printingSchoolId, setPrintingSchoolId] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    supabase
      .from('product_returns' as any)
      .select(`
        id, quantity, reason_category, reason_note, status, condition_on_receipt, requested_at,
        replacement_sent_at, replacement_order_reference,
        actual_product:products!product_returns_actual_product_id_fkey ( name ),
        invoice_line_items ( item_name, unit_price, products ( name ), invoices ( invoice_number, fy, schools ( id, school_name, ss_no ) ) )
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
    if (!inv?.invoice_number) return null;
    return `INV/${inv.fy}-${(inv.fy ?? 0) + 1}/${inv.invoice_number}`;
  };
  const schoolLabel = (r: ReturnRow) => {
    const school = r.invoice_line_items?.invoices?.schools;
    return school ? `${school.school_name}${school.ss_no != null ? ` (SS #${school.ss_no})` : ''}` : '—';
  };

  // One slip per school covering every replacement still owed to it, merged by book.
  const printSlip = async (r: ReturnRow) => {
    const school = r.invoice_line_items?.invoices?.schools;
    if (!school) return;
    setPrintingSchoolId(school.id);
    try {
      const owed = rows.filter(x => x.invoice_line_items?.invoices?.schools?.id === school.id && awaitsReplacement(x));
      const byBook = new Map<string, number>();
      owed.forEach(x => byBook.set(orderedName(x), (byBook.get(orderedName(x)) ?? 0) + x.quantity));
      const blob = await generateReplacementSlip({
        schoolName: school.school_name,
        ssNo: school.ss_no,
        invoiceRefs: [...new Set(owed.map(invoiceLabel).filter((v): v is string => !!v))],
        items: [...byBook].map(([name, quantity]) => ({ name, quantity })),
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Replacement_SS${school.ss_no ?? ''}_${new Date().toISOString().slice(0, 10)}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast({ title: 'Could not generate the slip', description: e instanceof Error ? e.message : String(e), variant: 'destructive' });
    } finally {
      setPrintingSchoolId(null);
    }
  };

  const replacementCell = (r: ReturnRow) => {
    if (r.reason_category !== 'wrong_item_shipped') return <span className="text-muted-foreground">—</span>;
    if (r.replacement_sent_at) {
      return (
        <div>
          <span className="inline-flex items-center gap-1 text-sm font-medium text-emerald-700">
            <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> Sent {shortDate(r.replacement_sent_at)}
          </span>
          {r.replacement_order_reference && <p className="text-xs text-muted-foreground mt-0.5">{r.replacement_order_reference}</p>}
        </div>
      );
    }
    if (r.status === 'credit_issued') return <span className="text-sm text-muted-foreground">Credit issued instead</span>;
    return (
      <div>
        <p className="flex items-center gap-1 font-bold text-neutral-900">
          <PackageCheck className="h-4 w-4 shrink-0 text-emerald-700" aria-hidden="true" />
          Send {shortBookName(orderedName(r))} × {r.quantity}
        </p>
        <Badge variant="outline" className="mt-1 bg-amber-50 text-amber-700 border-amber-200">Not sent yet</Badge>
      </div>
    );
  };

  const renderRows = (list: ReturnRow[], opts: { issueCredit?: boolean; markReceived?: boolean; showCondition?: boolean; sendReplacement?: boolean }) => {
    const colCount = 8 + (opts.showCondition ? 1 : 0);
    return (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>School</TableHead>
            <TableHead>Ordered</TableHead>
            <TableHead>Wrong book sent</TableHead>
            <TableHead>Qty</TableHead>
            <TableHead>Replacement to send</TableHead>
            <TableHead>Reason</TableHead>
            <TableHead>Requested</TableHead>
            {opts.showCondition && <TableHead>Condition</TableHead>}
            <TableHead></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading ? (
            <TableRow><TableCell colSpan={colCount} className="text-center py-6 text-muted-foreground">Loading…</TableCell></TableRow>
          ) : list.length === 0 ? (
            <TableRow><TableCell colSpan={colCount} className="text-center py-6 text-muted-foreground">Nothing here.</TableCell></TableRow>
          ) : (
            list.map(r => {
              const schoolId = r.invoice_line_items?.invoices?.schools?.id;
              return (
                <TableRow key={r.id}>
                  <TableCell>
                    {schoolLabel(r)}
                    {invoiceLabel(r) && <p className="text-xs text-muted-foreground mt-0.5">{invoiceLabel(r)}</p>}
                  </TableCell>
                  <TableCell className="font-semibold text-neutral-900" title={orderedName(r)}>
                    {shortBookName(orderedName(r))}
                  </TableCell>
                  <TableCell>
                    {r.actual_product ? (
                      <span className="inline-flex items-center gap-1 font-medium text-red-700" title={r.actual_product.name}>
                        <XCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
                        {shortBookName(r.actual_product.name)}
                      </span>
                    ) : <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="tabular-nums">{r.quantity}</TableCell>
                  <TableCell>{replacementCell(r)}</TableCell>
                  <TableCell><Badge variant="outline">{REASON_LABELS[r.reason_category] ?? r.reason_category}</Badge></TableCell>
                  <TableCell>{new Date(r.requested_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</TableCell>
                  {opts.showCondition && <TableCell className="capitalize">{r.condition_on_receipt}</TableCell>}
                  <TableCell>
                    <div className="flex flex-wrap justify-end gap-2">
                      {awaitsReplacement(r) && schoolId && (
                        <Button size="sm" variant="outline" disabled={printingSchoolId === schoolId} onClick={() => printSlip(r)}>
                          <Printer className="h-3.5 w-3.5 mr-1" aria-hidden="true" />
                          {printingSchoolId === schoolId ? 'Slip…' : 'Print Slip'}
                        </Button>
                      )}
                      {canManage && opts.sendReplacement && awaitsReplacement(r) && (
                        <Button size="sm" variant="outline" onClick={() => setReplacementTarget({
                          returnId: r.id,
                          schoolName: schoolLabel(r),
                          itemName: orderedName(r),
                          wrongItemName: r.actual_product?.name ?? null,
                          quantity: r.quantity,
                        })}>
                          Send Replacement
                        </Button>
                      )}
                      {canManage && opts.issueCredit && !r.replacement_sent_at && (
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
                      {canManage && opts.markReceived && (
                        <Button size="sm" variant={opts.issueCredit ? 'outline' : 'default'}
                          onClick={() => setConfirmTarget({ id: r.id, itemName: r.invoice_line_items?.item_name ?? 'item' })}>
                          Mark Received
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>
    );
  };

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
          <TabsContent value="requested">{renderRows(requested, { issueCredit: true, markReceived: true, sendReplacement: true })}</TabsContent>
          <TabsContent value="awaiting">{renderRows(awaitingReturn, { markReceived: true })}</TabsContent>
          <TabsContent value="received">{renderRows(received, { showCondition: true, sendReplacement: true })}</TabsContent>
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
