import { useState } from 'react';
import { School } from '@/types/database';
import { useWorkflow } from '@/hooks/useWorkflow';
import { useCommunicationTemplates } from '@/hooks/useCommunicationTemplates';
import { useWhatsAppTemplates, useSendWhatsApp } from '@/hooks/useWhatsAppTemplates';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { EmailConfirmationDialog } from '@/components/communication/EmailConfirmationDialog';
import { AddEmailDialog } from '@/components/communication/AddEmailDialog';
import { toast } from 'sonner';

// Keys match email template_type exactly — same name = same template on both channels
const WHATSAPP_TRIGGER_MAP: Record<string, string> = {
  'registration_interest|Interested': 'interest_acknowledged',
  'registration_status|Confirmed':    'registration_confirmed',
  'payment_status|Received':          'payment_received',
  'payment_status|Partial':           'payment_partial',
  'name_list_status|Received':        'name_list_received',
  'question_paper_sent|Sent':         'question_paper_sent_wa',
  'answer_sheet_status|Received':     'answer_sheet_received_wa',
  'result_status|Sent':               'result_sent_wa',
};

interface WorkflowEditorProps {
  school: School;
  onUpdate: (updates: Partial<School>) => void;
}

const WorkflowEditor = ({ school, onUpdate }: WorkflowEditorProps) => {
  const { getWorkflowStages, updateWorkflowStatus, canProgressToQuestionPaper } = useWorkflow();
  const { getActiveTemplate, sendTemplateEmail } = useCommunicationTemplates(school.current_project_id);
  const { templates: whatsappTemplates } = useWhatsAppTemplates(school.current_project_id || undefined);
  const { send: sendWhatsapp } = useSendWhatsApp();

  const [selectedStage, setSelectedStage] = useState('');
  const [selectedStatus, setSelectedStatus] = useState('');
  const [comment, setComment] = useState('');

  const [showEmailDialog, setShowEmailDialog] = useState(false);
  const [emailPreview, setEmailPreview] = useState<{ subject: string; body: string } | null>(null);
  const [pendingUpdate, setPendingUpdate] = useState<{
    stage: string;
    status: string;
    oldValue: string;
  } | null>(null);

  const [pendingWhatsappKey, setPendingWhatsappKey] = useState<string | null>(null);

  const [showAddEmailDialog, setShowAddEmailDialog] = useState(false);
  const [temporaryEmail, setTemporaryEmail] = useState<string | null>(null);

  const [resultDeliveryMethods, setResultDeliveryMethods] = useState({
    email: true,
    whatsapp: false,
    courier: false,
  });

  const stages = getWorkflowStages();
  const selectedStageData = stages.find(s => s.key === selectedStage);

  const shouldSendEmail = (stage: string, status: string): string | null => {
    if (stage === 'registration_status' && status === 'Confirmed') return 'registration_confirmed';
    if (stage === 'name_list_status' && status === 'Received') return 'name_list_received';
    if (stage === 'payment_status' && status === 'Received') return 'payment_received';
    if (stage === 'payment_status' && status === 'Partial') return 'payment_partial';
    if (stage === 'question_paper_sent' && status === 'Sent') return 'question_paper_sent_wa';
    if (stage === 'answer_sheet_status' && status === 'Received') return 'answer_sheet_received_wa';
    if (stage === 'result_status' && status === 'Sent') return 'result_sent_wa';
    return null;
  };

  // Fires WA silently — no dialog needed
  const autoSendWhatsApp = (stage: string, status: string, waKey?: string) => {
    const key = waKey ?? WHATSAPP_TRIGGER_MAP[`${stage}|${status}`];
    if (!key) return;
    const tpl = whatsappTemplates.find(t => t.template_key === key && t.is_active);
    if (!tpl) return;
    sendWhatsapp({ schoolId: school.id, templateKey: key }).catch(console.error);
  };

  const handleStatusUpdate = async () => {
    if (!selectedStage || !selectedStatus) return;
    const oldValue = school[selectedStage as keyof School] as string;

    try {
      if (selectedStage === 'registration_interest' && selectedStatus === 'Not Interested' && comment) {
        onUpdate({ registration_interest_comment: comment });
      }
      if (selectedStage === 'consent_form_requested' && selectedStatus === 'No' && comment) {
        onUpdate({ consent_form_comment: comment });
      }

      const templateType = shouldSendEmail(selectedStage, selectedStatus);

      if (templateType) {
        if (!school.current_project_id) {
          toast.error('No project assigned to this school. Assign a project before sending communications.');
          return;
        }
        const template = await getActiveTemplate(school.current_project_id, templateType);

        if (!template) {
          toast.error(`Email template '${templateType}' not found. Please create it in Email Templates page first.`, {
            description: 'Status will be updated. WhatsApp will still be sent if template exists.',
            duration: 5000,
          });
          await performStatusUpdate(selectedStage, selectedStatus, oldValue);
          autoSendWhatsApp(selectedStage, selectedStatus);
          return;
        }

        const ssNo = school.ss_no?.toString() ?? '';
        let subject = template.subject
          .replace(/{school_name}/g, school.school_name)
          .replace(/{ss_no}/g, ssNo);

        let body = template.email_body
          .replace(/{school_name}/g, school.school_name)
          .replace(/{ss_no}/g, ssNo);

        if (templateType === 'result_sent') {
          const methods = [];
          if (resultDeliveryMethods.email) methods.push('Email');
          if (resultDeliveryMethods.whatsapp) methods.push('WhatsApp');
          if (resultDeliveryMethods.courier) methods.push('Courier');
          body = body.replace(/{delivery_methods}/g, methods.join(', '));
        }

        // Check if a matching WA template also exists
        const waKey = WHATSAPP_TRIGGER_MAP[`${selectedStage}|${selectedStatus}`];
        const hasWA = !!waKey && whatsappTemplates.some(t => t.template_key === waKey && t.is_active);

        setEmailPreview({ subject, body });
        setPendingUpdate({ stage: selectedStage, status: selectedStatus, oldValue });
        setPendingWhatsappKey(hasWA ? waKey! : null);
        setShowEmailDialog(true);
        return;
      }

      // No email trigger → update + auto-send WA if template exists
      await performStatusUpdate(selectedStage, selectedStatus, oldValue);
      autoSendWhatsApp(selectedStage, selectedStatus);
    } catch (error) {
      console.error('Error updating workflow status:', error);
      toast.error('Failed to update status');
    }
  };

  const performStatusUpdate = async (stage: string, status: string, oldValue: string) => {
    const result = await updateWorkflowStatus(school.id, stage, status, oldValue);
    if (result.success) {
      setSelectedStage('');
      setSelectedStatus('');
      setComment('');
      setResultDeliveryMethods({ email: true, whatsapp: false, courier: false });
      onUpdate({ [stage]: status });
    }
  };

  const handleEmailConfirm = async () => {
    if (!pendingUpdate) return;
    try {
      const emailToUse = temporaryEmail || school.email;
      const templateType = shouldSendEmail(pendingUpdate.stage, pendingUpdate.status);
      if (templateType) {
        await sendTemplateEmail(school.id, templateType, emailToUse || undefined);
      }
      // Auto-send WA simultaneously — no second dialog
      if (pendingWhatsappKey) {
        autoSendWhatsApp(pendingUpdate.stage, pendingUpdate.status, pendingWhatsappKey);
      }
      await performStatusUpdate(pendingUpdate.stage, pendingUpdate.status, pendingUpdate.oldValue);
      setShowEmailDialog(false);
      setPendingUpdate(null);
      setEmailPreview(null);
      setTemporaryEmail(null);
      setPendingWhatsappKey(null);
      toast.success(pendingWhatsappKey ? 'Email + WhatsApp sent, status updated' : 'Email sent, status updated');
    } catch (error) {
      console.error('Error sending email:', error);
      toast.error('Failed to send email');
    }
  };

  const handleSkipEmail = async () => {
    if (!pendingUpdate) return;
    try {
      await performStatusUpdate(pendingUpdate.stage, pendingUpdate.status, pendingUpdate.oldValue);
      setShowEmailDialog(false);
      setPendingUpdate(null);
      setEmailPreview(null);
      setPendingWhatsappKey(null);
      toast.success('Status updated without notifications');
    } catch (error) {
      console.error('Error updating status:', error);
      toast.error('Failed to update status');
    }
  };

  const handleAddEmail = async (email: string) => {
    try {
      onUpdate({ email });
      setTemporaryEmail(email);
      toast.success('Email address added successfully');
      setShowAddEmailDialog(false);
    } catch (error) {
      console.error('Error adding email:', error);
      toast.error('Failed to add email address');
      throw error;
    }
  };

  const getCurrentStageValue = (stageKey: string) => {
    return school[stageKey as keyof School] as string;
  };

  const isQuestionPaperStage = (stageKey: string) => {
    return ['question_paper_sent', 'answer_sheet_status', 'result_status'].includes(stageKey);
  };

  const isConsentFormSentStage = (stageKey: string) => stageKey === 'consent_form_sent';

  const canAccessConsentFormSent = (s: School) => s.consent_form_requested === 'Yes';

  return (
    <Card>
      <CardHeader>
        <CardTitle>Workflow Status Editor</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Current Status Display */}
        <div className="grid grid-cols-2 gap-4">
          {stages.map(stage => {
            const currentValue = getCurrentStageValue(stage.key);
            const isQuestionPaperDisabled = isQuestionPaperStage(stage.key) && !canProgressToQuestionPaper(school);
            const isConsentFormDisabled = isConsentFormSentStage(stage.key) && !canAccessConsentFormSent(school);
            const isDisabled = isQuestionPaperDisabled || isConsentFormDisabled;

            return (
              <div key={stage.key} className="flex justify-between items-center p-3 border rounded">
                <span className="font-medium text-sm">{stage.label}:</span>
                <Badge
                  variant={currentValue === 'Pending' || currentValue === 'No' || currentValue === 'Waiting' || currentValue === 'Not Sent' ? 'outline' : 'default'}
                  className={isDisabled ? 'opacity-50' : ''}
                >
                  {currentValue || 'Not Set'}
                </Badge>
              </div>
            );
          })}
        </div>

        {/* Business Rule Notices */}
        {!canProgressToQuestionPaper(school) && (
          <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg">
            <p className="text-sm text-amber-800">
              <strong>Business Rule:</strong> Question Paper, Answer Sheet, and Result stages are only available when:
              Registration = Confirmed, Name List = Received, and Payment = Received.
            </p>
          </div>
        )}

        {!canAccessConsentFormSent(school) && (
          <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
            <p className="text-sm text-blue-800">
              <strong>Business Rule:</strong> Consent Form Sent stage is only available when Consent Form Requested = Yes.
            </p>
          </div>
        )}

        {/* Status Update Form */}
        <div className="space-y-4 p-4 border rounded-lg bg-muted/30">
          <h4 className="font-medium">Update Workflow Status</h4>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Select Stage</Label>
              <Select value={selectedStage} onValueChange={setSelectedStage}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose stage to update" />
                </SelectTrigger>
                <SelectContent>
                  {stages.map(stage => {
                    const isQuestionPaperDisabled = isQuestionPaperStage(stage.key) && !canProgressToQuestionPaper(school);
                    const isConsentFormDisabled = isConsentFormSentStage(stage.key) && !canAccessConsentFormSent(school);
                    return (
                      <SelectItem
                        key={stage.key}
                        value={stage.key}
                        disabled={isQuestionPaperDisabled || isConsentFormDisabled}
                      >
                        {stage.label}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>

            {selectedStageData && (
              <div>
                <Label>Select Status</Label>
                <Select value={selectedStatus} onValueChange={setSelectedStatus}>
                  <SelectTrigger>
                    <SelectValue placeholder="Choose new status" />
                  </SelectTrigger>
                  <SelectContent>
                    {selectedStageData.options.map(option => (
                      <SelectItem key={option} value={option}>{option}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          {/* Comment fields */}
          {selectedStage === 'registration_interest' && selectedStatus === 'Not Interested' && (
            <div>
              <Label>Comment (Why not interested?)</Label>
              <Textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Enter reason for not being interested..."
              />
            </div>
          )}

          {selectedStage === 'consent_form_requested' && selectedStatus === 'No' && (
            <div>
              <Label>Comment</Label>
              <Textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Enter additional comments..."
              />
            </div>
          )}

          {/* Note for payment status — direct staff to Payment Tracking tab */}
          {selectedStage === 'payment_status' && (
            <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
              <p className="text-sm text-blue-800">
                To log a payment or refund, use the <strong>Payment Tracking</strong> tab. The payment status updates automatically when a payment is recorded.
              </p>
            </div>
          )}

          {/* Result delivery methods */}
          {selectedStage === 'result_status' && selectedStatus === 'Sent' && (
            <div className="space-y-3">
              <Label>Delivery Methods</Label>
              <div className="space-y-2">
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="email-delivery"
                    checked={resultDeliveryMethods.email}
                    onCheckedChange={(checked) =>
                      setResultDeliveryMethods(prev => ({ ...prev, email: checked as boolean }))
                    }
                  />
                  <label htmlFor="email-delivery" className="text-sm">Email</label>
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="whatsapp-delivery"
                    checked={resultDeliveryMethods.whatsapp}
                    onCheckedChange={(checked) =>
                      setResultDeliveryMethods(prev => ({ ...prev, whatsapp: checked as boolean }))
                    }
                  />
                  <label htmlFor="whatsapp-delivery" className="text-sm">WhatsApp</label>
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="courier-delivery"
                    checked={resultDeliveryMethods.courier}
                    onCheckedChange={(checked) =>
                      setResultDeliveryMethods(prev => ({ ...prev, courier: checked as boolean }))
                    }
                  />
                  <label htmlFor="courier-delivery" className="text-sm">Courier</label>
                </div>
              </div>
            </div>
          )}

          <Button
            onClick={handleStatusUpdate}
            disabled={!selectedStage || !selectedStatus}
            className="w-full"
          >
            Update Status
          </Button>
        </div>
      </CardContent>

      {emailPreview && (
        <EmailConfirmationDialog
          open={showEmailDialog}
          onOpenChange={setShowEmailDialog}
          school={{ ...school, email: temporaryEmail || school.email }}
          templateType={pendingUpdate?.stage || ''}
          templateName={shouldSendEmail(pendingUpdate?.stage || '', pendingUpdate?.status || '') || 'Status Update'}
          emailPreview={emailPreview}
          willAlsoSendWhatsApp={!!pendingWhatsappKey}
          onConfirm={handleEmailConfirm}
          onSkipEmail={handleSkipEmail}
          onAddEmail={() => setShowAddEmailDialog(true)}
        />
      )}

      <AddEmailDialog
        open={showAddEmailDialog}
        onOpenChange={setShowAddEmailDialog}
        schoolName={school.school_name}
        currentEmail={temporaryEmail || school.email}
        onSave={handleAddEmail}
      />

    </Card>
  );
};

export default WorkflowEditor;
