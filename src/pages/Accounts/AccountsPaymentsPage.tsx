// src/pages/Accounts/AccountsPaymentsPage.tsx
import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Download } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { downloadCSV } from '@/utils/csvExport';
import AccountsLayout from './AccountsLayout';

interface PaymentRow {
  id: string;
  category: 'registration' | 'book_order';
  transaction_date: string;
  school_id: string;
  school_name: string;
  ss_no: number | null;
  amount: number;
  payment_mode: string | null;
  reference: string | null;
}

export default function AccountsPaymentsPage() {
  const [rows, setRows] = useState<PaymentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [category, setCategory] = useState<'all' | 'registration' | 'book_order'>('all');

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);
      const { data, error: queryError } = await supabase
        .from('accounts_payments_in' as any)
        .select('id, category, transaction_date, school_id, school_name, ss_no, amount, payment_mode, reference')
        .order('transaction_date', { ascending: false });
      if (queryError) {
        setError('Could not load payments. Please try again.');
        setLoading(false);
        return;
      }
      setRows((data ?? []) as unknown as PaymentRow[]);
      setLoading(false);
    }
    load();
  }, []);

  const filtered = rows.filter(r => {
    if (startDate && r.transaction_date < startDate) return false;
    if (endDate && r.transaction_date > endDate) return false;
    if (category !== 'all' && r.category !== category) return false;
    return true;
  });

  const totalAmount = filtered.reduce((sum, r) => sum + Number(r.amount), 0);

  function exportCSV() {
    const headers = ['Date', 'Category', 'SS No', 'School Name', 'Amount', 'Payment Mode', 'Reference'];
    const data = [
      headers,
      ...filtered.map(r => [
        r.transaction_date, r.category === 'registration' ? 'Registration' : 'Book Order',
        r.ss_no, r.school_name, r.amount, r.payment_mode ?? '', r.reference ?? '',
      ]),
    ];
    downloadCSV(data, `payments_${startDate || 'all'}_to_${endDate || 'all'}.csv`);
  }

  return (
    <AccountsLayout>
      <div className="max-w-7xl mx-auto p-6 space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Payments</h1>
          <p className="text-muted-foreground">Every payment received — registration fees and book orders, in one place.</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Filter & Export</CardTitle>
            <CardDescription>{filtered.length} record(s) · ₹{totalAmount.toLocaleString('en-IN')} total</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-4 items-end mb-4">
              <div>
                <Label htmlFor="startDate">Start Date</Label>
                <Input id="startDate" type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="endDate">End Date</Label>
                <Input id="endDate" type="date" value={endDate} onChange={e => setEndDate(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="category">Category</Label>
                <select
                  id="category"
                  value={category}
                  onChange={e => setCategory(e.target.value as typeof category)}
                  className="flex h-10 rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="all">All</option>
                  <option value="registration">Registration</option>
                  <option value="book_order">Book Order</option>
                </select>
              </div>
              <Button variant="outline" onClick={exportCSV}>
                <Download className="h-4 w-4 mr-2" />
                Export CSV
              </Button>
            </div>

            {loading ? (
              <p className="text-muted-foreground">Loading…</p>
            ) : error ? (
              <div className="rounded-md border border-red-200 bg-red-50 p-4 text-red-700 text-sm">{error}</div>
            ) : (
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead>SS No</TableHead>
                      <TableHead>School Name</TableHead>
                      <TableHead>Amount</TableHead>
                      <TableHead>Payment Mode</TableHead>
                      <TableHead>Reference</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center text-muted-foreground py-8">No payments found</TableCell>
                      </TableRow>
                    ) : (
                      filtered.map(r => (
                        <TableRow key={r.id}>
                          <TableCell>{new Date(r.transaction_date).toLocaleDateString('en-IN')}</TableCell>
                          <TableCell>{r.category === 'registration' ? 'Registration' : 'Book Order'}</TableCell>
                          <TableCell>{r.ss_no ?? '—'}</TableCell>
                          <TableCell className="max-w-xs truncate" title={r.school_name}>{r.school_name}</TableCell>
                          <TableCell>₹{Number(r.amount).toLocaleString('en-IN')}</TableCell>
                          <TableCell>{r.payment_mode ?? '—'}</TableCell>
                          <TableCell>{r.reference ?? '—'}</TableCell>
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
