// src/pages/Accounts/AccountsSupplierPaymentsPage.tsx
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

interface SupplierPaymentRow {
  id: string;
  payment_date: string;
  amount: number;
  payment_mode: string | null;
  reference: string | null;
  notes: string | null;
  inventory_suppliers: { name: string } | null;
}

export default function AccountsSupplierPaymentsPage() {
  const [rows, setRows] = useState<SupplierPaymentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);
      const { data, error: queryError } = await supabase
        .from('inventory_supplier_payments')
        .select('id, payment_date, amount, payment_mode, reference, notes, inventory_suppliers(name)')
        .order('payment_date', { ascending: false });
      if (queryError) {
        setError('Could not load supplier payments. Please try again.');
        setLoading(false);
        return;
      }
      setRows((data ?? []) as unknown as SupplierPaymentRow[]);
      setLoading(false);
    }
    load();
  }, []);

  const filtered = rows.filter(r => {
    if (startDate && r.payment_date < startDate) return false;
    if (endDate && r.payment_date > endDate) return false;
    return true;
  });

  const totalAmount = filtered.reduce((sum, r) => sum + Number(r.amount), 0);

  function exportCSV() {
    const headers = ['Date', 'Supplier', 'Amount', 'Payment Mode', 'Reference', 'Notes'];
    const data = [
      headers,
      ...filtered.map(r => [
        r.payment_date, r.inventory_suppliers?.name ?? '—', r.amount, r.payment_mode ?? '', r.reference ?? '', r.notes ?? '',
      ]),
    ];
    downloadCSV(data, `supplier_payments_${startDate || 'all'}_to_${endDate || 'all'}.csv`);
  }

  return (
    <AccountsLayout>
      <div className="max-w-7xl mx-auto p-6 space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Supplier Payments</h1>
          <p className="text-muted-foreground">Every payment made to book suppliers, across all purchase orders.</p>
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
                      <TableHead>Supplier</TableHead>
                      <TableHead>Amount</TableHead>
                      <TableHead>Payment Mode</TableHead>
                      <TableHead>Reference</TableHead>
                      <TableHead>Notes</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center text-muted-foreground py-8">No supplier payments found</TableCell>
                      </TableRow>
                    ) : (
                      filtered.map(r => (
                        <TableRow key={r.id}>
                          <TableCell>{new Date(r.payment_date).toLocaleDateString('en-IN')}</TableCell>
                          <TableCell>{r.inventory_suppliers?.name ?? '—'}</TableCell>
                          <TableCell>₹{Number(r.amount).toLocaleString('en-IN')}</TableCell>
                          <TableCell>{r.payment_mode ?? '—'}</TableCell>
                          <TableCell>{r.reference ?? '—'}</TableCell>
                          <TableCell className="max-w-xs truncate" title={r.notes ?? ''}>{r.notes ?? '—'}</TableCell>
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
