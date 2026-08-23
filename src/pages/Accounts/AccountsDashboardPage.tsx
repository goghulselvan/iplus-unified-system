import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Wallet, TrendingDown, TrendingUp, AlertCircle, FileText, Clock } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import AccountsLayout from './AccountsLayout';

interface DashboardMetrics {
  totalCollected: number;
  totalPaidToSuppliers: number;
  outstandingFromSchools: number;
  openCreditBalance: number;
  pendingReviews: number;
}

export default function AccountsDashboardPage() {
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);
      const [
        { data: paymentsIn, error: paymentsInErr },
        { data: supplierPayments, error: supplierErr },
        { data: schools, error: schoolsErr },
        { data: creditNotes, error: creditErr },
        { count: pendingRegPayments, error: pendingRegErr },
        { count: pendingOrderPayments, error: pendingOrderErr },
      ] = await Promise.all([
        supabase.from('accounts_payments_in' as any).select('amount'),
        supabase.from('inventory_supplier_payments').select('amount'),
        supabase.from('schools').select('outstanding_balance').in('payment_status', ['Pending', 'Partial']),
        supabase.from('credit_notes_with_balance' as any).select('remaining_balance'),
        supabase.from('portal_payment_submissions').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
        supabase.from('product_orders').select('*', { count: 'exact', head: true }).eq('payment_status', 'pending'),
      ]);

      if (paymentsInErr || supplierErr || schoolsErr || creditErr || pendingRegErr || pendingOrderErr) {
        setError('Could not load dashboard metrics. Please try again.');
        setLoading(false);
        return;
      }

      const totalCollected = (paymentsIn ?? []).reduce((sum: number, r: any) => sum + Number(r.amount ?? 0), 0);
      const totalPaidToSuppliers = (supplierPayments ?? []).reduce((sum: number, r: any) => sum + Number(r.amount ?? 0), 0);
      const outstandingFromSchools = (schools ?? []).reduce((sum: number, r: any) => sum + Number(r.outstanding_balance ?? 0), 0);
      const openCreditBalance = (creditNotes ?? []).reduce((sum: number, r: any) => sum + Number(r.remaining_balance ?? 0), 0);

      setMetrics({
        totalCollected,
        totalPaidToSuppliers,
        outstandingFromSchools,
        openCreditBalance,
        pendingReviews: (pendingRegPayments ?? 0) + (pendingOrderPayments ?? 0),
      });
      setLoading(false);
    }
    load();
  }, []);

  const cards = metrics ? [
    { title: 'Total Collected', value: metrics.totalCollected, icon: Wallet, tone: 'text-emerald-600' },
    { title: 'Total Paid to Suppliers', value: metrics.totalPaidToSuppliers, icon: TrendingDown, tone: 'text-red-600' },
    { title: 'Net Position', value: metrics.totalCollected - metrics.totalPaidToSuppliers, icon: TrendingUp, tone: 'text-blue-600' },
    { title: 'Outstanding from Schools', value: metrics.outstandingFromSchools, icon: AlertCircle, tone: 'text-orange-600' },
    { title: 'Open Credit Note Balance', value: metrics.openCreditBalance, icon: FileText, tone: 'text-purple-600' },
  ] : [];

  return (
    <AccountsLayout>
      <div className="max-w-7xl mx-auto p-6 space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Accounts Dashboard</h1>
          <p className="text-muted-foreground">Every payment in, every payment out, and everything in between.</p>
        </div>

        {loading ? (
          <p className="text-muted-foreground">Loading…</p>
        ) : error ? (
          <div className="rounded-md border border-red-200 bg-red-50 p-4 text-red-700 text-sm">{error}</div>
        ) : (
          <>
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {cards.map(({ title, value, icon: Icon, tone }) => (
                <Card key={title}>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">{title}</CardTitle>
                    <Icon className={`h-4 w-4 ${tone}`} />
                  </CardHeader>
                  <CardContent>
                    <div className={`text-2xl font-bold ${tone}`}>₹{value.toLocaleString('en-IN')}</div>
                  </CardContent>
                </Card>
              ))}
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Pending Payment Reviews</CardTitle>
                  <Clock className="h-4 w-4 text-amber-600" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-amber-600">{metrics?.pendingReviews ?? 0}</div>
                  <p className="text-xs text-muted-foreground">Registration + book-order payments awaiting review</p>
                </CardContent>
              </Card>
            </div>
          </>
        )}
      </div>
    </AccountsLayout>
  );
}
