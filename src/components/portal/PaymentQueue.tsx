import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { CheckCircle2, ExternalLink, RefreshCw } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';

interface PaymentSubmission {
  id: string;
  school_id: string;
  amount_paid: number;
  payment_date: string;
  payment_mode: string;
  utr_reference: string | null;
  notes: string | null;
  screenshot_url: string | null;
  status: 'pending' | 'acknowledged' | 'rejected';
  acknowledged_at: string | null;
  created_at: string;
  schools: { school_name: string; ss_no: number | null } | null;
}

export function PaymentQueue() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [filter, setFilter] = useState<'pending' | 'acknowledged' | 'all'>('pending');

  const { data: submissions = [], isLoading, refetch } = useQuery({
    queryKey: ['admin-payment-queue', filter],
    queryFn: async (): Promise<PaymentSubmission[]> => {
      let q = supabase
        .from('portal_payment_submissions')
        .select('*, schools(school_name, ss_no)')
        .order('created_at', { ascending: false });
      if (filter !== 'all') q = q.eq('status', filter);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as PaymentSubmission[];
    },
  });

  const acknowledgeMutation = useMutation({
    mutationFn: async (submissionId: string) => {
      const { data, error } = await supabase.rpc('acknowledge_portal_payment', {
        p_submission_id: submissionId,
        p_admin_user_id: user!.id,
      });
      if (error) throw error;
      return data as { success: boolean; payment_status: string; total_paid: number; expected: number };
    },
    onSuccess: (result, submissionId) => {
      qc.invalidateQueries({ queryKey: ['admin-payment-queue'] });
      qc.invalidateQueries({ queryKey: ['nav-badge-counts'] });
      toast({
        title: 'Payment Acknowledged',
        description: `Status: ${result.payment_status === 'Received' ? '✓ Paid in full' : '⚠ Partial — awaiting balance'}`,
      });
      // Auto-send email + WA to school
      const submission = submissions.find(s => s.id === submissionId);
      if (submission) {
        const templateKey = result.payment_status === 'Partial' ? 'payment_partial' : 'payment_received';
        supabase.auth.getUser().then(({ data: { user: u } }) => {
          Promise.allSettled([
            supabase.functions.invoke('send-template-email', {
              body: { schoolId: submission.school_id, templateType: templateKey, userId: u?.id },
            }),
            supabase.functions.invoke('send-whatsapp-template', {
              body: { schoolId: submission.school_id, templateKey },
            }),
          ]);
        });
      }
    },
    onError: (err: Error) => {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    },
  });

  const pendingCount = submissions.filter((s) => s.status === 'pending').length;

  return (
    <div className="space-y-4">
      {/* Header row */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {(['pending', 'acknowledged', 'all'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                filter === f
                  ? 'bg-indigo-100 text-indigo-700'
                  : 'text-muted-foreground hover:bg-muted'
              }`}
            >
              {f === 'pending' ? `Pending${pendingCount > 0 ? ` (${pendingCount})` : ''}` : f === 'acknowledged' ? 'Acknowledged' : 'All'}
            </button>
          ))}
          <button onClick={() => refetch()} className="p-1.5 rounded-lg hover:bg-muted transition-colors">
            <RefreshCw className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>

      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground py-6 text-center">Loading…</p>
      ) : submissions.length === 0 ? (
        <div className="text-center py-10 border rounded-xl">
          <p className="text-sm font-medium text-foreground">No payment submissions</p>
          <p className="text-sm text-muted-foreground mt-1">
            {filter === 'pending' ? 'All caught up!' : 'No submissions in this category.'}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 border-b">
              <tr>
                <th className="text-left px-4 py-3 font-semibold text-muted-foreground text-xs uppercase tracking-wider">School</th>
                <th className="text-left px-4 py-3 font-semibold text-muted-foreground text-xs uppercase tracking-wider">Amount</th>
                <th className="text-left px-4 py-3 font-semibold text-muted-foreground text-xs uppercase tracking-wider">Pay Date</th>
                <th className="text-left px-4 py-3 font-semibold text-muted-foreground text-xs uppercase tracking-wider">Mode</th>
                <th className="text-left px-4 py-3 font-semibold text-muted-foreground text-xs uppercase tracking-wider">UTR / Ref</th>
                <th className="text-left px-4 py-3 font-semibold text-muted-foreground text-xs uppercase tracking-wider">Notes</th>
                <th className="text-left px-4 py-3 font-semibold text-muted-foreground text-xs uppercase tracking-wider">Proof</th>
                <th className="text-left px-4 py-3 font-semibold text-muted-foreground text-xs uppercase tracking-wider">Submitted</th>
                <th className="text-left px-4 py-3 font-semibold text-muted-foreground text-xs uppercase tracking-wider">Status</th>
                <th className="px-4 py-3 w-32" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {submissions.map((s) => (
                <tr key={s.id} className="hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-3 font-medium">
                    <div>{s.schools?.school_name ?? s.school_id.slice(0, 8)}</div>
                    {s.schools?.ss_no && (
                      <div className="text-xs text-muted-foreground">SS {s.schools.ss_no}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 font-semibold">
                    ₹{Number(s.amount_paid).toLocaleString('en-IN')}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {new Date(s.payment_date).toLocaleDateString('en-IN')}
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-muted text-muted-foreground">
                      {s.payment_mode}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">
                    {s.utr_reference ?? '—'}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground text-xs max-w-[160px]">
                    {s.notes ? (
                      <span title={s.notes} className="line-clamp-2">{s.notes}</span>
                    ) : '—'}
                  </td>
                  <td className="px-4 py-3">
                    {s.screenshot_url ? (
                      <a
                        href={s.screenshot_url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-indigo-600 hover:underline text-xs"
                      >
                        View <ExternalLink className="h-3 w-3" />
                      </a>
                    ) : (
                      <span className="text-muted-foreground text-xs">None</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground text-xs">
                    {new Date(s.created_at).toLocaleDateString('en-IN')}
                  </td>
                  <td className="px-4 py-3">
                    <Badge
                      variant={
                        s.status === 'acknowledged'
                          ? 'default'
                          : s.status === 'rejected'
                          ? 'destructive'
                          : 'secondary'
                      }
                      className={s.status === 'acknowledged' ? 'bg-emerald-100 text-emerald-700' : ''}
                    >
                      {s.status === 'acknowledged' ? 'Acknowledged' : s.status === 'rejected' ? 'Rejected' : 'Pending'}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    {s.status === 'pending' && (
                      <Button
                        size="sm"
                        onClick={() => acknowledgeMutation.mutate(s.id)}
                        disabled={acknowledgeMutation.isPending}
                        className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 h-8 text-xs"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        Acknowledge
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
