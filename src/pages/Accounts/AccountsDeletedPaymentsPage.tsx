import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import AccountsLayout from './AccountsLayout';

interface DeletedPaymentRow {
  id: string;
  source_table: string;
  amount: number;
  payment_mode: string | null;
  payment_date: string | null;
  reference: string | null;
  deleted_by: string | null;
  deleted_at: string;
  schools: { school_name: string; ss_no: number | null } | null;
}

export default function AccountsDeletedPaymentsPage() {
  const [rows, setRows] = useState<DeletedPaymentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);
      const { data, error: queryError } = await supabase
        .from('deleted_payments')
        .select('id, source_table, amount, payment_mode, payment_date, reference, deleted_by, deleted_at, schools(school_name, ss_no)')
        .order('deleted_at', { ascending: false });
      if (queryError) {
        setError('Could not load the deleted-payments audit log. Please try again.');
        setLoading(false);
        return;
      }
      setRows((data ?? []) as unknown as DeletedPaymentRow[]);
      setLoading(false);
    }
    load();
  }, []);

  return (
    <AccountsLayout>
      <div className="max-w-7xl mx-auto p-6 space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Deleted Payments</h1>
          <p className="text-muted-foreground">Audit trail of every deleted payment, regardless of how it was deleted.</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Audit Log</CardTitle>
            <CardDescription>{rows.length} record(s)</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <p className="text-muted-foreground">Loading…</p>
            ) : error ? (
              <div className="rounded-md border border-red-200 bg-red-50 p-4 text-red-700 text-sm">{error}</div>
            ) : (
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Deleted At</TableHead>
                      <TableHead>Source</TableHead>
                      <TableHead>SS No</TableHead>
                      <TableHead>School Name</TableHead>
                      <TableHead>Amount</TableHead>
                      <TableHead>Payment Mode</TableHead>
                      <TableHead>Reference</TableHead>
                      <TableHead>Deleted Via</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={8} className="text-center text-muted-foreground py-8">No deleted payments</TableCell>
                      </TableRow>
                    ) : (
                      rows.map(r => (
                        <TableRow key={r.id}>
                          <TableCell>{new Date(r.deleted_at).toLocaleString('en-IN')}</TableCell>
                          <TableCell>{r.source_table === 'portal_payment_submissions' ? 'Portal Submission' : 'Payment Transaction'}</TableCell>
                          <TableCell>{r.schools?.ss_no ?? '—'}</TableCell>
                          <TableCell className="max-w-xs truncate" title={r.schools?.school_name ?? ''}>{r.schools?.school_name ?? '—'}</TableCell>
                          <TableCell>₹{Number(r.amount).toLocaleString('en-IN')}</TableCell>
                          <TableCell>{r.payment_mode ?? '—'}</TableCell>
                          <TableCell>{r.reference ?? '—'}</TableCell>
                          <TableCell>
                            {r.deleted_by ? (
                              <Badge variant="outline">App</Badge>
                            ) : (
                              <Badge variant="destructive">Outside normal flow</Badge>
                            )}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AccountsLayout>
  );
}
