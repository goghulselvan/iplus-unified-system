import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { usePaymentTransactions } from '@/hooks/usePaymentTransactions';
import { useSchoolWorkflow } from '@/hooks/useSchoolProjectWorkflow';
import { toast } from 'sonner';
import { Trash2, Download, Mail, CheckCircle, ExternalLink } from 'lucide-react';
import type { School } from '@/types/database';
import { AddPaymentDialog } from './AddPaymentDialog';
import { AddRefundDialog } from './AddRefundDialog';
import { useAuth } from '@/hooks/useAuth';
import { generateReceipt } from '@/utils/receiptGenerator';
import { sendPaymentReceiptComms } from '@/utils/sendPaymentReceipt';
import { EmailConfirmationDialog } from '@/components/communication/EmailConfirmationDialog';
import { useCommunicationTemplates } from '@/hooks/useCommunicationTemplates';

const DEFAULT_RATE = 150;

interface PaymentTransaction {
  id: string;
  payment_date: string;
  payment_amount: number;
  payment_mode: string;
  transaction_reference?: string;
  notes?: string;
  created_at: string;
  receipt_number?: number;
  receipt_fy?: number;
}

interface EnhancedPaymentTrackerProps {
  school: School;
  onUpdate: () => void;
}

const PAYMENT_STATUS_CONFIG: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline'; className?: string }> = {
  Received: { label: 'Received', variant: 'default' },
  Partial:  { label: 'Partial',  variant: 'secondary' },
  Pending:  { label: 'Pending',  variant: 'destructive' },
  Overpaid: { label: 'Overpaid', variant: 'outline', className: 'border-orange-300 bg-orange-100 text-orange-700' },
};

export const EnhancedPaymentTracker: React.FC<EnhancedPaymentTrackerProps> = ({ school, onUpdate }) => {
  const { profile } = useAuth();
  const qc = useQueryClient();
  const [downloadingReceipt, setDownloadingReceipt] = useState<string | null>(null);
  const [emailDialogOpen, setEmailDialogOpen] = useState(false);
  const [selectedTransaction, setSelectedTransaction] = useState<PaymentTransaction | null>(null);
  const [emailPreview, setEmailPreview] = useState({ subject: '', body: '' });

  const { getActiveTemplate } = useCommunicationTemplates(school.current_project_id || undefined);

  const { data: workflowData, isLoading: workflowLoading } = useSchoolWorkflow(school.id);
  const { data: paymentTransactions = [], isLoading: txLoading } = usePaymentTransactions(school.id);

  const projectId = school.current_project_id;

  const { data: activeProject } = useQuery({
    queryKey: ['project-name-year', projectId],
    queryFn: async () => {
      const { data } = await supabase
        .from('olympiad_projects')
        .select('project_name, project_year')
        .eq('id', projectId!)
        .maybeSingle();
      return data;
    },
    enabled: !!projectId,
  });

  const { data: enrollmentCount = 0 } = useQuery({
    queryKey: ['portal-enrollment-count', school.id, projectId],
    queryFn: async () => {
      const { data: students } = await supabase
        .from('portal_registered_students')
        .select('id')
        .eq('school_id', school.id)
        .eq('project_id', projectId!);
      if (!students?.length) return 0;
      const { count } = await supabase
        .from('portal_student_enrollments')
        .select('id', { count: 'exact', head: true })
        .in('student_id', students.map(s => s.id));
      return count ?? 0;
    },
    enabled: !!projectId,
    staleTime: 2 * 60 * 1000,
  });

  const { data: portalSubmissions = [], refetch: refetchPortalSubmissions } = useQuery({
    queryKey: ['portal-payment-submissions', school.id, projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('portal_payment_submissions')
        .select('id, amount_paid, payment_date, payment_mode, utr_reference, account_holder_name, notes, screenshot_url, status, acknowledged_at, created_at')
        .eq('school_id', school.id)
        .eq('project_id', projectId!)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!projectId,
  });

  const acknowledgeMutation = useMutation({
    mutationFn: async (submissionId: string) => {
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase
        .from('portal_payment_submissions')
        .update({ status: 'acknowledged', acknowledged_at: new Date().toISOString(), acknowledged_by: user?.id ?? null })
        .eq('id', submissionId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Payment submission acknowledged');
      refetchPortalSubmissions();
    },
    onError: () => toast.error('Failed to acknowledge'),
  });

  const isLoading = workflowLoading || txLoading;
  const ratePerEntry = (workflowData as any)?.per_entry_rate ?? DEFAULT_RATE;
  const concessionPerEntry = (workflowData as any)?.concession_per_entry ?? 0;

  const grossFee = enrollmentCount * ratePerEntry;
  const totalConcession = enrollmentCount * concessionPerEntry;
  const netToCollect = Math.max(0, grossFee - totalConcession);
  const totalReceived = school.payment_received || 0;
  const outstandingBalance = Math.max(0, netToCollect - totalReceived);

  // Badge driven by DB payment_status set by the RPC
  const dbStatus = school.payment_status as string | null;
  const statusConfig = PAYMENT_STATUS_CONFIG[dbStatus ?? ''] ?? PAYMENT_STATUS_CONFIG['Pending'];

  // Same rule as the portal acknowledge flow: Partial gets the partial template,
  // everything else the full confirmation (with receipt document on WA).
  const paymentTemplateKey: 'payment_received' | 'payment_partial' =
    dbStatus === 'Partial' ? 'payment_partial' : 'payment_received';

  // Real WA-send capability lives in whatsapp_templates (what sendPaymentReceiptComms
  // actually checks), not in the older communication_templates registry — checking
  // the right table here so the confirm dialog stops claiming "no active WhatsApp
  // template" when payment_receipt/payment_receipt_partial are in fact Meta-approved.
  const waDocumentTemplateKey = paymentTemplateKey === 'payment_partial' ? 'payment_receipt_partial' : 'payment_receipt';
  const { data: waTemplateActive = false } = useQuery({
    queryKey: ['wa-template-active', waDocumentTemplateKey, projectId],
    queryFn: async () => {
      const { data } = await supabase
        .from('whatsapp_templates')
        .select('id')
        .eq('template_key', waDocumentTemplateKey)
        .eq('project_id', projectId!)
        .eq('is_active', true)
        .maybeSingle();
      return !!data;
    },
    enabled: !!projectId,
  });

  const handlePaymentAdded = async () => {
    await supabase.rpc('recalculate_school_payment_totals', { p_school_id: school.id });
    qc.invalidateQueries({ queryKey: ['payment-transactions', school.id] });
    qc.invalidateQueries({ queryKey: ['portal-enrollment-count', school.id] });
    qc.invalidateQueries({ queryKey: ['school-workflow', school.id] });
    onUpdate();
  };

  const handleDownloadReceipt = async (transaction: PaymentTransaction) => {
    if (!transaction.receipt_number) { toast.error('Receipt number not found'); return; }
    setDownloadingReceipt(transaction.id);
    try {
      const pdfBlob = await generateReceipt({
        receiptNumber: transaction.receipt_number,
        fy: transaction.receipt_fy ?? 26,
        ssNo: school.ss_no,
        schoolName: school.school_name,
        paymentDate: new Date(transaction.payment_date),
        amount: transaction.payment_amount,
        paymentMode: transaction.payment_mode,
        transactionReference: transaction.transaction_reference,
        totalReceived: school.payment_received || 0,
        balanceDue: school.outstanding_balance || 0,
      });
      const url = URL.createObjectURL(pdfBlob);
      const a = document.createElement('a');
      a.href = url;
      const fy = transaction.receipt_fy ?? 26;
      a.download = `Receipt_${transaction.receipt_number}_${fy}-${fy + 1}_${school.ss_no}_${school.school_name.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('Receipt downloaded');
    } catch {
      toast.error('Failed to generate receipt');
    } finally {
      setDownloadingReceipt(null);
    }
  };

  const handleDeletePayment = async (transactionId: string, amount: number) => {
    try {
      const { error } = await supabase.from('payment_transactions').delete().eq('id', transactionId);
      if (error) { toast.error('Failed to delete payment'); return; }
      const label = amount < 0 ? `Refund of ₹${Math.abs(amount).toLocaleString()}` : `Payment of ₹${amount.toLocaleString()}`;
      toast.success(`${label} deleted`);
      await handlePaymentAdded();
    } catch {
      toast.error('Failed to delete');
    }
  };

  const handleSendPaymentEmail = async (transaction: PaymentTransaction) => {
    if (!school.current_project_id) { toast.error('No project assigned to this school'); return; }
    const template = await getActiveTemplate(school.current_project_id, paymentTemplateKey);
    if (!template) {
      toast.error('No active payment confirmation template found.', { duration: 5000 });
      return;
    }
    const variables: Record<string, string> = {
      '{school_name}': school.school_name,
      '{ss_no}': school.ss_no.toString(),
      '{contact_person}': school.contact_person_name || 'Sir/Madam',
      '{payment_amount}': transaction.payment_amount.toString(),
      '{payment_date}': transaction.payment_date,
      '{student_count}': enrollmentCount.toString(),
      '{project_name}': activeProject?.project_name ?? 'iPlus Olympiads',
      '{project_year}': activeProject?.project_year?.toString() ?? '',
    };
    let subject = template.subject;
    let body = template.email_body;
    Object.entries(variables).forEach(([k, v]) => {
      subject = subject.replace(new RegExp(k.replace(/[{}]/g, '\\$&'), 'g'), v);
      body = body.replace(new RegExp(k.replace(/[{}]/g, '\\$&'), 'g'), v);
    });
    setEmailPreview({ subject, body });
    setSelectedTransaction(transaction);
    setEmailDialogOpen(true);
  };

  const handleConfirmSendEmail = async () => {
    if (!selectedTransaction) return;
    setEmailDialogOpen(false);
    const r = await sendPaymentReceiptComms({
      schoolId: school.id,
      transactionId: selectedTransaction.id,
      templateType: paymentTemplateKey,
      userId: profile?.user_id,
    });
    if (r.errors.length) {
      toast.error(`Receipt comms incomplete: ${r.errors.join(' · ')}`);
    } else {
      toast.success(
        r.waViaDocument
          ? `Receipt ${r.receiptNo ?? ''} sent — email + WhatsApp with PDF`
          : `Receipt ${r.receiptNo ?? ''} sent — email with PDF; WhatsApp as text (receipt template not active yet)`,
      );
    }
    setSelectedTransaction(null);
  };

  const isRefund = (t: PaymentTransaction) => t.payment_amount < 0 || t.payment_mode === 'Refund';

  return (
    <div className="space-y-6">
      {/* Fee Summary */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            Fee Summary
            <Badge
              variant={statusConfig.variant}
              className={statusConfig.className}
            >
              {statusConfig.label}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                <div className="p-3 bg-muted/50 rounded-lg">
                  <p className="text-xs text-muted-foreground mb-1">Total Registrations</p>
                  <p className="text-xl font-bold">{enrollmentCount}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">live from portal</p>
                </div>
                <div className="p-3 bg-muted/50 rounded-lg">
                  <p className="text-xs text-muted-foreground mb-1">Rate per Registration</p>
                  <p className="text-xl font-bold">₹{ratePerEntry}</p>
                </div>
                <div className="p-3 bg-muted/50 rounded-lg">
                  <p className="text-xs text-muted-foreground mb-1">Concession per Registration</p>
                  <p className="text-xl font-bold">
                    {concessionPerEntry > 0 ? `₹${concessionPerEntry}` : '—'}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">set in Registrations tab</p>
                </div>
              </div>

              <div className="border-t pt-4 grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="p-3 bg-muted/50 rounded-lg">
                  <p className="text-xs text-muted-foreground mb-1">Gross Fee</p>
                  <p className="text-lg font-semibold">₹{grossFee.toLocaleString('en-IN')}</p>
                  <p className="text-xs text-muted-foreground">{enrollmentCount} × ₹{ratePerEntry}</p>
                </div>
                <div className="p-3 bg-amber-50 rounded-lg">
                  <p className="text-xs text-muted-foreground mb-1">Total Concession</p>
                  <p className="text-lg font-semibold text-amber-700">
                    {totalConcession > 0 ? `− ₹${totalConcession.toLocaleString('en-IN')}` : '—'}
                  </p>
                  {totalConcession > 0 && (
                    <p className="text-xs text-muted-foreground">{enrollmentCount} × ₹{concessionPerEntry}</p>
                  )}
                </div>
                <div className="p-3 bg-indigo-50 rounded-lg">
                  <p className="text-xs text-muted-foreground mb-1">Net to Collect</p>
                  <p className="text-lg font-bold text-indigo-700">₹{netToCollect.toLocaleString('en-IN')}</p>
                </div>
                <div className={`p-3 rounded-lg ${
                  totalReceived > netToCollect && netToCollect >= 0
                    ? 'bg-orange-50'
                    : outstandingBalance > 0
                    ? 'bg-red-50'
                    : 'bg-green-50'
                }`}>
                  <p className="text-xs text-muted-foreground mb-1">
                    {totalReceived > netToCollect && netToCollect > 0 ? 'Overpaid by' : 'Outstanding Balance'}
                  </p>
                  <p className={`text-lg font-bold ${
                    totalReceived > netToCollect && netToCollect > 0
                      ? 'text-orange-700'
                      : outstandingBalance > 0
                      ? 'text-red-700'
                      : 'text-green-700'
                  }`}>
                    {totalReceived > netToCollect && netToCollect > 0
                      ? `₹${(totalReceived - netToCollect).toLocaleString('en-IN')}`
                      : `₹${outstandingBalance.toLocaleString('en-IN')}`}
                  </p>
                  <p className="text-xs text-muted-foreground">received ₹{totalReceived.toLocaleString('en-IN')}</p>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Portal Payment Submissions */}
      {portalSubmissions.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              Portal Payment Submissions
              <Badge variant="secondary">{portalSubmissions.length} submission{portalSubmissions.length !== 1 ? 's' : ''}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Mode</TableHead>
                  <TableHead>UTR / Ref</TableHead>
                  <TableHead>Account Holder</TableHead>
                  <TableHead>Proof</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {portalSubmissions.map(sub => (
                  <TableRow key={sub.id} className={sub.status === 'acknowledged' ? 'opacity-60' : undefined}>
                    <TableCell>{new Date(sub.payment_date).toLocaleDateString('en-IN')}</TableCell>
                    <TableCell className="font-medium">₹{Number(sub.amount_paid).toLocaleString('en-IN')}</TableCell>
                    <TableCell>{sub.payment_mode ?? '—'}</TableCell>
                    <TableCell className="font-mono text-xs">{sub.utr_reference ?? '—'}</TableCell>
                    <TableCell className="text-xs">{(sub as any).account_holder_name ?? '—'}</TableCell>
                    <TableCell>
                      {sub.screenshot_url ? (
                        <a href={sub.screenshot_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-indigo-600 hover:underline text-xs">
                          View <ExternalLink className="h-3 w-3" />
                        </a>
                      ) : '—'}
                    </TableCell>
                    <TableCell>
                      {sub.status === 'acknowledged' ? (
                        <Badge variant="default" className="bg-green-600 text-white text-xs">Acknowledged</Badge>
                      ) : (
                        <Badge variant="secondary" className="text-xs">Pending Review</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {sub.status !== 'acknowledged' && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs gap-1"
                          disabled={acknowledgeMutation.isPending}
                          onClick={() => acknowledgeMutation.mutate(sub.id)}
                        >
                          <CheckCircle className="h-3.5 w-3.5" />
                          Acknowledge
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <p className="text-xs text-muted-foreground mt-3">
              Acknowledging confirms you have seen the proof. Record the verified payment below via "Add Payment" to update the payment status.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Payment History */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            Payment History
            <div className="flex items-center gap-2">
              <AddRefundDialog
                schoolId={school.id}
                schoolName={school.school_name}
                onRefundAdded={handlePaymentAdded}
              />
              <AddPaymentDialog
                schoolId={school.id}
                schoolName={school.school_name}
                onPaymentAdded={handlePaymentAdded}
              />
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-4 text-sm text-muted-foreground">Loading…</div>
          ) : paymentTransactions.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No payment transactions yet. Click "Add Payment" to record one.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Receipt No.</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Mode</TableHead>
                  <TableHead>Reference</TableHead>
                  <TableHead>Notes</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paymentTransactions.map(transaction => {
                  const refund = isRefund(transaction);
                  return (
                    <TableRow key={transaction.id} className={refund ? 'bg-red-50/50' : undefined}>
                      <TableCell className="font-medium">
                        {transaction.receipt_number ? `${transaction.receipt_number}-${school.ss_no}` : '—'}
                      </TableCell>
                      <TableCell>{transaction.payment_date}</TableCell>
                      <TableCell className={refund ? 'text-red-600 font-medium' : undefined}>
                        {refund
                          ? `− ₹${Math.abs(transaction.payment_amount).toLocaleString()}`
                          : `₹${transaction.payment_amount.toLocaleString()}`}
                      </TableCell>
                      <TableCell>
                        {refund
                          ? <span className="text-red-600 text-xs font-semibold uppercase tracking-wide">Refund</span>
                          : transaction.payment_mode}
                      </TableCell>
                      <TableCell>{transaction.transaction_reference || '—'}</TableCell>
                      <TableCell>{transaction.notes || '—'}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {!refund && (
                            <Button variant="ghost" size="sm" onClick={() => handleSendPaymentEmail(transaction)} title="Send payment confirmation email">
                              <Mail className="h-4 w-4" />
                            </Button>
                          )}
                          {transaction.receipt_number && !refund && (
                            <Button variant="ghost" size="sm" onClick={() => handleDownloadReceipt(transaction)} disabled={downloadingReceipt === transaction.id}>
                              <Download className="h-4 w-4" />
                            </Button>
                          )}
                          {profile?.role === 'superadmin' && (
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive">
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>Delete {refund ? 'Refund' : 'Payment'}</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    Delete this {refund ? `refund of ₹${Math.abs(transaction.payment_amount).toLocaleString()}` : `payment of ₹${transaction.payment_amount.toLocaleString()}`}? This cannot be undone.
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                                  <AlertDialogAction
                                    onClick={() => handleDeletePayment(transaction.id, transaction.payment_amount)}
                                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                  >
                                    Delete
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {selectedTransaction && (
        <EmailConfirmationDialog
          open={emailDialogOpen}
          onOpenChange={setEmailDialogOpen}
          school={{ id: school.id, school_name: school.school_name, email: school.email, mobile1: school.mobile1, ss_no: school.ss_no }}
          templateType={paymentTemplateKey}
          templateName={paymentTemplateKey === 'payment_partial' ? 'Payment Partial' : 'Payment Confirmation'}
          emailPreview={emailPreview}
          willAlsoSendWhatsApp={waTemplateActive}
          onConfirm={handleConfirmSendEmail}
        />
      )}
    </div>
  );
};
