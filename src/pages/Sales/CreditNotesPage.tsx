import { useState, useEffect } from 'react';
import SalesLayout from '@/components/sales/SalesLayout';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import IssueRefundDialog from '@/components/sales/IssueRefundDialog';

type OpenCreditRow = {
  id: string;
  credit_note_number: number | null;
  fy: number | null;
  amount: number;
  remaining_balance: number;
  schools: { school_name: string; ss_no: number | null } | null;
};

type RefundHistoryRow = {
  id: string;
  amount: number;
  refund_mode: string | null;
  refund_reference: string | null;
  recorded_at: string;
  credit_notes: { credit_note_number: number | null; fy: number | null; schools: { school_name: string } | null } | null;
};

export default function CreditNotesPage() {
  const { profile } = useAuth();
  const canManage = profile?.role === 'superadmin' || profile?.role === 'accountant';
  const [openCredits, setOpenCredits] = useState<OpenCreditRow[]>([]);
  const [history, setHistory] = useState<RefundHistoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refundTarget, setRefundTarget] = useState<{ id: string; remaining_balance: number; school_name: string } | null>(null);

  const load = () => {
    setLoading(true);
    Promise.all([
      supabase.from('credit_notes_with_balance' as any)
        .select('id, credit_note_number, fy, amount, remaining_balance, schools ( school_name, ss_no )')
        .gt('remaining_balance', 0)
        .order('fy', { ascending: false }).order('credit_note_number', { ascending: false }),
      supabase.from('credit_note_applications' as any)
        .select('id, amount, refund_mode, refund_reference, recorded_at, credit_notes ( credit_note_number, fy, schools ( school_name ) )')
        .eq('application_type', 'refund')
        .order('recorded_at', { ascending: false }),
    ]).then(([openRes, historyRes]) => {
      setOpenCredits((openRes.data || []) as unknown as OpenCreditRow[]);
      setHistory((historyRes.data || []) as unknown as RefundHistoryRow[]);
      setLoading(false);
    });
  };

  useEffect(() => { load(); }, []);

  const cnLabel = (num: number | null, fy: number | null) => num ? `CN/${fy}-${(fy ?? 0) + 1}/${num}` : '—';

  return (
    <SalesLayout>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <h1 className="text-2xl font-bold text-neutral-900 mb-4">Credit Notes</h1>
        <Tabs defaultValue="open">
          <TabsList>
            <TabsTrigger value="open">Open ({openCredits.length})</TabsTrigger>
            <TabsTrigger value="history">Refund History ({history.length})</TabsTrigger>
          </TabsList>
          <TabsContent value="open">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Credit Note</TableHead>
                  <TableHead>School</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Remaining Balance</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow><TableCell colSpan={5} className="text-center py-6 text-muted-foreground">Loading…</TableCell></TableRow>
                ) : openCredits.length === 0 ? (
                  <TableRow><TableCell colSpan={5} className="text-center py-6 text-muted-foreground">No open credit.</TableCell></TableRow>
                ) : (
                  openCredits.map(c => (
                    <TableRow key={c.id}>
                      <TableCell>{cnLabel(c.credit_note_number, c.fy)}</TableCell>
                      <TableCell>{c.schools?.school_name ?? '—'}{c.schools?.ss_no != null ? ` (SS #${c.schools.ss_no})` : ''}</TableCell>
                      <TableCell>₹{c.amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</TableCell>
                      <TableCell className="font-semibold">₹{c.remaining_balance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</TableCell>
                      <TableCell>
                        {canManage && (
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
                  <TableHead>Mode</TableHead>
                  <TableHead>Reference</TableHead>
                  <TableHead>When</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow><TableCell colSpan={6} className="text-center py-6 text-muted-foreground">Loading…</TableCell></TableRow>
                ) : history.length === 0 ? (
                  <TableRow><TableCell colSpan={6} className="text-center py-6 text-muted-foreground">No refunds issued yet.</TableCell></TableRow>
                ) : (
                  history.map(h => (
                    <TableRow key={h.id}>
                      <TableCell>{cnLabel(h.credit_notes?.credit_note_number ?? null, h.credit_notes?.fy ?? null)}</TableCell>
                      <TableCell>{h.credit_notes?.schools?.school_name ?? '—'}</TableCell>
                      <TableCell>₹{h.amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</TableCell>
                      <TableCell>{h.refund_mode}</TableCell>
                      <TableCell>{h.refund_reference ?? '—'}</TableCell>
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
