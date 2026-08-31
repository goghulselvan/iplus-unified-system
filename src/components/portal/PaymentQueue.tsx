import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { CheckCircle2, ExternalLink, RefreshCw, Trash2 } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { sendPaymentReceiptComms } from '@/utils/sendPaymentReceipt';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

interface PaymentSubmission {
  id: string;
  school_id: string;
  amount_paid: number;
  verified_amount: number | null;
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
  const { user, profile } = useAuth();
  const isSuperadmin = profile?.role === 'superadmin';
  const qc = useQueryClient();
  const [filter, setFilter] = useState<'pending' | 'acknowledged' | 'all'>('pending');
  const [ackTarget, setAckTarget] = useState<PaymentSubmission | null>(null);
  const [verifiedAmountInput, setVerifiedAmountInput] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<PaymentSubmission | null>(null);
  const [deleteReason, setDeleteReason] = useState('');

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
    mutationFn: async ({ submissionId, verifiedAmount }: { submissionId: string; verifiedAmount: number }) => {
      const { data, error } = await supabase.rpc('acknowledge_portal_payment', {
        p_submission_id: submissionId,
        p_admin_user_id: user!.id,
        p_verified_amount: verifiedAmount,
      });
      if (error) throw error;
      return data as { success: boolean; payment_status: string; total_paid: number; expected: number; transaction_id?: string };
    },
    onSuccess: (result, { submissionId }) => {
      qc.invalidateQueries({ queryKey: ['admin-payment-queue'] });
      qc.invalidateQueries({ queryKey: ['nav-badge-counts'] });
      toast({
        title: 'Payment Acknowledged',
        description: `Status: ${result.payment_status === 'Received' ? '✓ Paid in full' : '⚠ Partial — awaiting balance'}`,
      });
      const submission = submissions.find(s => s.id === submissionId);
      if (submission && result.transaction_id) {
        const templateKey = result.payment_status === 'Partial' ? 'payment_partial' : 'payment_received';
        supabase.auth.getUser()
          .then(({ data: { user: u } }) =>
            sendPaymentReceiptComms({
              schoolId: submission.school_id,
              transactionId: result.transaction_id!,
              templateType: templateKey,
              userId: u?.id,
            }))
          .then(r => {
            if (r.errors.length) {
              toast({ title: 'Receipt comms incomplete', description: r.errors.join(' · '), variant: 'destructive' });
            } else {
              toast({
                title: `Receipt ${r.receiptNo ?? ''} sent`,
                description: r.waViaDocument
                  ? 'Email + WhatsApp sent with the receipt PDF.'
                  : 'Email sent with receipt PDF; WhatsApp sent as text (receipt template not active yet).',
              });
            }
          });
      }
      setAckTarget(null);
      setVerifiedAmountInput('');
    },
    onError: (err: Error) => {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => {
      const { error } = await supabase.rpc('delete_pending_payment_submission' as any, { p_submission_id: id, p_reason: reason });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-payment-queue'] });
      toast({ title: 'Payment submission deleted' });
      setDeleteTarget(null);
      setDeleteReason('');
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
                    {s.verified_amount != null && Number(s.verified_amount) !== Number(s.amount_paid) && (
                      <div className="text-xs font-normal text-amber-600 mt-0.5">
                        ⚠ Verified: ₹{Number(s.verified_amount).toLocaleString('en-IN')}
                      </div>
                    )}
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
                    <div className="flex items-center gap-1.5">
                      {s.status === 'pending' && (
                        <Button
                          size="sm"
                          onClick={() => { setAckTarget(s); setVerifiedAmountInput(String(s.amount_paid)); }}
                          className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 h-8 text-xs"
                        >
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          Acknowledge
                        </Button>
                      )}
                      {isSuperadmin && s.status === 'pending' && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setDeleteTarget(s)}
                          className="flex items-center gap-1.5 h-8 text-xs text-red-600 border-red-200 hover:bg-red-50 hover:text-red-700"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          Delete
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={!!ackTarget} onOpenChange={(open) => { if (!open) { setAckTarget(null); setVerifiedAmountInput(''); } }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Acknowledge Payment</DialogTitle></DialogHeader>
          {ackTarget && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                {ackTarget.schools?.school_name} declared ₹{Number(ackTarget.amount_paid).toLocaleString('en-IN')}.
                Enter what the screenshot actually shows.
              </p>
              <div className="space-y-1.5">
                <Label htmlFor="verified-amount">Verified Amount (₹)</Label>
                <Input
                  id="verified-amount"
                  type="number"
                  min="0"
                  step="0.01"
                  value={verifiedAmountInput}
                  onChange={(e) => setVerifiedAmountInput(e.target.value)}
                />
              </div>
              {Number(verifiedAmountInput) !== Number(ackTarget.amount_paid) && verifiedAmountInput !== '' && (
                <p className="text-sm bg-amber-50 text-amber-700 rounded-lg p-3">
                  This differs from the declared amount (₹{Number(ackTarget.amount_paid).toLocaleString('en-IN')}) — the verified figure will be what counts toward this school's total.
                </p>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setAckTarget(null); setVerifiedAmountInput(''); }}>Cancel</Button>
            <Button
              onClick={() => ackTarget && acknowledgeMutation.mutate({ submissionId: ackTarget.id, verifiedAmount: Number(verifiedAmountInput) })}
              disabled={acknowledgeMutation.isPending || verifiedAmountInput === '' || Number(verifiedAmountInput) <= 0}
            >
              Confirm & Acknowledge
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) { setDeleteTarget(null); setDeleteReason(''); } }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Delete Payment Submission</DialogTitle></DialogHeader>
          {deleteTarget && (
            <div className="space-y-3">
              <p className="text-sm font-bold text-foreground">Are you sure you want to delete this payment?</p>
              <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3 text-sm space-y-1">
                <p><span className="font-bold">School Name:</span> {deleteTarget.schools?.school_name ?? '—'}</p>
                <p><span className="font-bold">Payment Amount:</span> ₹{Number(deleteTarget.amount_paid).toLocaleString('en-IN')}</p>
                <p><span className="font-bold">Date:</span> {new Date(deleteTarget.created_at).toLocaleDateString('en-IN')}</p>
              </div>
              <div className="space-y-1">
                <Label htmlFor="delete-reason" className="text-sm font-semibold">
                  Reason for deleting <span className="text-destructive">*</span>
                </Label>
                <Textarea
                  id="delete-reason"
                  value={deleteReason}
                  onChange={(e) => setDeleteReason(e.target.value)}
                  placeholder="Why is this payment being deleted? (e.g. duplicate proof, wrong school, test entry)"
                  rows={3}
                />
                <p className="text-xs text-muted-foreground">
                  Required. Recorded permanently in the payment deletion log alongside who deleted it and when.
                  Use this only for a wrong/duplicate proof that was never acknowledged.
                </p>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setDeleteTarget(null); setDeleteReason(''); }}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => deleteTarget && deleteMutation.mutate({ id: deleteTarget.id, reason: deleteReason.trim() })}
              disabled={deleteMutation.isPending || deleteReason.trim().length < 3}
            >
              {deleteMutation.isPending ? 'Deleting…' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
