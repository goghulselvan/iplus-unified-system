import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { supabase } from '@/integrations/supabase/client';
import AccountsLayout from './AccountsLayout';

interface SchoolOutstandingRow {
  id: string;
  ss_no: number | null;
  school_name: string;
  district: string | null;
  state: string | null;
  outstanding_balance: number;
  payment_status: string;
}

interface InvoiceOutstandingRow {
  id: string;
  invoice_number: number | null;
  fy: number | null;
  grand_total: number;
  status: string;
  schools: { school_name: string; ss_no: number | null } | null;
}

export default function AccountsOutstandingPage() {
  const [schoolRows, setSchoolRows] = useState<SchoolOutstandingRow[]>([]);
  const [invoiceRows, setInvoiceRows] = useState<InvoiceOutstandingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);
      const [{ data: schools, error: schoolsErr }, { data: invoices, error: invoicesErr }] = await Promise.all([
        supabase
          .from('schools')
          .select('id, ss_no, school_name, district, state, outstanding_balance, payment_status')
          .in('payment_status', ['Pending', 'Partial'])
          .gt('outstanding_balance', 0)
          .order('outstanding_balance', { ascending: false }),
        supabase
          .from('invoices')
          .select('id, invoice_number, fy, grand_total, status, schools(school_name, ss_no)')
          .eq('status', 'unpaid'),
      ]);
      if (schoolsErr || invoicesErr) {
        setError('Could not load outstanding balances. Please try again.');
        setLoading(false);
        return;
      }
      setSchoolRows((schools ?? []) as unknown as SchoolOutstandingRow[]);
      setInvoiceRows((invoices ?? []) as unknown as InvoiceOutstandingRow[]);
      setLoading(false);
    }
    load();
  }, []);

  const schoolTotal = schoolRows.reduce((sum, r) => sum + Number(r.outstanding_balance), 0);
  const invoiceTotal = invoiceRows.reduce((sum, r) => sum + Number(r.grand_total), 0);

  return (
    <AccountsLayout>
      <div className="max-w-7xl mx-auto p-6 space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Outstanding</h1>
          <p className="text-muted-foreground">Who owes iPlus money — registration balances and unpaid book-order invoices.</p>
        </div>

        {loading ? (
          <p className="text-muted-foreground">Loading…</p>
        ) : error ? (
          <div className="rounded-md border border-red-200 bg-red-50 p-4 text-red-700 text-sm">{error}</div>
        ) : (
          <>
            <Card>
              <CardHeader>
                <CardTitle>Registration Outstanding</CardTitle>
                <CardDescription>{schoolRows.length} school(s) · ₹{schoolTotal.toLocaleString('en-IN')} total</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>SS No</TableHead>
                        <TableHead>School Name</TableHead>
                        <TableHead>District</TableHead>
                        <TableHead>State</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Outstanding</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {schoolRows.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={6} className="text-center text-muted-foreground py-8">No registration balances outstanding</TableCell>
                        </TableRow>
                      ) : (
                        schoolRows.map(r => (
                          <TableRow key={r.id}>
                            <TableCell>{r.ss_no ?? '—'}</TableCell>
                            <TableCell className="max-w-xs truncate" title={r.school_name}>{r.school_name}</TableCell>
                            <TableCell>{r.district ?? '—'}</TableCell>
                            <TableCell>{r.state ?? '—'}</TableCell>
                            <TableCell>{r.payment_status}</TableCell>
                            <TableCell>₹{Number(r.outstanding_balance).toLocaleString('en-IN')}</TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Book-Order Outstanding</CardTitle>
                <CardDescription>{invoiceRows.length} invoice(s) · ₹{invoiceTotal.toLocaleString('en-IN')} total</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Invoice</TableHead>
                        <TableHead>SS No</TableHead>
                        <TableHead>School Name</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Amount</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {invoiceRows.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={5} className="text-center text-muted-foreground py-8">No unpaid book-order invoices</TableCell>
                        </TableRow>
                      ) : (
                        invoiceRows.map(r => (
                          <TableRow key={r.id}>
                            <TableCell>{r.invoice_number != null && r.fy != null ? `INV/${r.fy}-${r.fy + 1}/${r.invoice_number}` : '—'}</TableCell>
                            <TableCell>{r.schools?.ss_no ?? '—'}</TableCell>
                            <TableCell className="max-w-xs truncate" title={r.schools?.school_name ?? ''}>{r.schools?.school_name ?? '—'}</TableCell>
                            <TableCell>{r.status}</TableCell>
                            <TableCell>₹{Number(r.grand_total).toLocaleString('en-IN')}</TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </AccountsLayout>
  );
}
