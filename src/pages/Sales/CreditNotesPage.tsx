import { useState, useEffect } from 'react';
import SalesLayout from '@/components/sales/SalesLayout';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import IssueRefundDialog from '@/components/sales/IssueRefundDialog';

type CreditNoteRow = {
  id: string;
  credit_note_number: number | null;
  fy: number | null;
  amount: number;
  remaining_balance: number;
  created_at: string;
  schools: { school_name: string; ss_no: number | null } | null;
};

type ApplicationHistoryRow = {
  id: string;
  application_type: 'invoice' | 'refund';
  amount: number;
  refund_mode: string | null;
  refund_reference: string | null;
  recorded_at: string;
  credit_notes: { credit_note_number: number | null; fy: number | null; schools: { school_name: string } | null } | null;
  invoices: { invoice_number: number | null; fy: number | null } | null;
};

export default function CreditNotesPage() {
  const { profile } = useAuth();
  const canManage = profile?.role === 'superadmin' || profile?.role === 'accountant';
  const [creditNotes, setCreditNotes] = useState<CreditNoteRow[]>([]);
  const [history, setHistory] = useState<ApplicationHistoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refundTarget, setRefundTarget] = useState<{ id: string; remaining_balance: number; school_name: string } | null>(null);

  const load = () => {
    setLoading(true);
    Promise.all([
      supabase.from('credit_notes_with_balance' as any)
        .select('id, credit_note_number, fy, amount, remaining_balance, created_at, schools ( school_name, ss_no )')
        .order('fy', { ascending: false }).order('credit_note_number', { ascending: false }),
      supabase.from('credit_note_applications' as any)
        .select('id, application_type, amount, refund_mode, refund_reference, recorded_at, credit_notes ( credit_note_number, fy, schools ( school_name ) ), invoices ( invoice_number, fy )')
        .order('recorded_at', { ascending: false }),
    ]).then(([creditNotesRes, historyRes]) => {
      setCreditNotes((creditNotesRes.data || []) as unknown as CreditNoteRow[]);
      setHistory((historyRes.data || []) as unknown as ApplicationHistoryRow[]);
      setLoading(false);
    });
  };

  useEffect(() => { load(); }, []);

  const cnLabel = (num: number | null, fy: number | null) => num ? `CN/${fy}-${(fy ?? 0) + 1}/${num}` : '—';
  const invLabel = (num: number | null, fy: number | null) => num ? `INV/${fy}-${(fy ?? 0) + 1}/${num}` : '—';

  return (
    <SalesLayout>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <h1 className="text-2xl font-bold text-neutral-900 mb-4">Credit Notes</h1>
        <Tabs defaultValue="notes">
          <TabsList>
            <TabsTrigger value="notes">Credit Notes ({creditNotes.length})</TabsTrigger>
            <TabsTrigger value="history">Application History ({history.length})</TabsTrigger>
          </TabsList>
          <TabsContent value="notes">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Credit Note</TableHead>
                  <TableHead>School</TableHead>
                  <TableHead>Issued</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Remaining Balance</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow><TableCell colSpan={7} className="text-center py-6 text-muted-foreground">Loading…</TableCell></TableRow>
                ) : creditNotes.length === 0 ? (
                  <TableRow><TableCell colSpan={7} className="text-center py-6 text-muted-foreground">No credit notes issued yet.</TableCell></TableRow>
                ) : (
                  creditNotes.map(c => (
                    <TableRow key={c.id}>
                      <TableCell>{cnLabel(c.credit_note_number, c.fy)}</TableCell>
                      <TableCell>{c.schools?.school_name ?? '—'}{c.schools?.ss_no != null ? ` (SS #${c.schools.ss_no})` : ''}</TableCell>
                      <TableCell>{new Date(c.created_at).toLocaleDateString('en-IN')}</TableCell>
                      <TableCell>₹{c.amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</TableCell>
                      <TableCell className="font-semibold">₹{c.remaining_balance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</TableCell>
                      <TableCell>
                        {c.remaining_balance > 0 ? (
                          <Badge variant="outline" className="bg-emerald-50 text-emerald-600 border-emerald-100">Open</Badge>
                        ) : (
                          <Badge variant="outline" className="bg-neutral-100 text-neutral-500 border-neutral-200">Fully Claimed</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        {canManage && c.remaining_balance > 0 && (
                          <Button size="sm" variant="outline" onClick={() => setRefundTarget({
                            id: c.id, remaining_balance: c.remaining_balance, school_name: c.schools?.school_name ?? 'School',
                          })}>
                            Issue Refund
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </TabsContent>
          <TabsContent value="history">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Credit Note</TableHead>
                  <TableHead>School</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Claimed Via</TableHead>
                  <TableHead>Mode / Reference</TableHead>
                  <TableHead>When</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow><TableCell colSpan={6} className="text-center py-6 text-muted-foreground">Loading…</TableCell></TableRow>
                ) : history.length === 0 ? (
                  <TableRow><TableCell colSpan={6} className="text-center py-6 text-muted-foreground">No credit has been claimed yet.</TableCell></TableRow>
                ) : (
                  history.map(h => (
                    <TableRow key={h.id}>
                      <TableCell>{cnLabel(h.credit_notes?.credit_note_number ?? null, h.credit_notes?.fy ?? null)}</TableCell>
                      <TableCell>{h.credit_notes?.schools?.school_name ?? '—'}</TableCell>
                      <TableCell>₹{h.amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</TableCell>
                      <TableCell>
                        {h.application_type === 'invoice' ? (
                          <Badge variant="outline" className="bg-blue-50 text-blue-600 border-blue-100">
                            Applied to {invLabel(h.invoices?.invoice_number ?? null, h.invoices?.fy ?? null)}
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="bg-amber-50 text-amber-600 border-amber-100">Refunded</Badge>
                        )}
                      </TableCell>
                      <TableCell>{h.application_type === 'refund' ? `${h.refund_mode ?? ''}${h.refund_reference ? ` · ${h.refund_reference}` : ''}` : '—'}</TableCell>
                      <TableCell>{new Date(h.recorded_at).toLocaleDateString('en-IN')}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </TabsContent>
        </Tabs>
      </div>
      <IssueRefundDialog
        open={!!refundTarget}
        onOpenChange={(o) => { if (!o) setRefundTarget(null); }}
        creditNote={refundTarget}
        onIssued={load}
      />
    </SalesLayout>
  );
}
