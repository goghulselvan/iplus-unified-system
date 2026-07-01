import React, { useState, useEffect } from 'react';
import { School } from '@/types/database';
import { useWorkflow } from '@/hooks/useWorkflow';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';

interface CommunicationWorkflowEditorProps {
  school: School;
  onWorkflowUpdate: (updates: {
    stage: string;
    status: string;
    comment?: string;
    paymentDetails?: {
      mode: string;
      date: string;
      amount: string;
      participants: string;
    };
  } | null) => void;
}

const CommunicationWorkflowEditor = ({ school, onWorkflowUpdate }: CommunicationWorkflowEditorProps) => {
  const { getWorkflowStages } = useWorkflow();
  const [isOpen, setIsOpen] = useState(false);
  const [selectedStage, setSelectedStage] = useState<string>('');
  const [selectedStatus, setSelectedStatus] = useState<string>('');
  const [comment, setComment] = useState('');
  const [paymentDetails, setPaymentDetails] = useState({
    mode: '',
    date: '',
    amount: '',
    participants: ''
  });

  const stages = getWorkflowStages();
  const selectedStageData = stages.find(s => s.key === selectedStage);

  const handleStageChange = (stage: string) => {
    setSelectedStage(stage);
    setSelectedStatus('');
    setComment('');
    setPaymentDetails({ mode: '', date: '', amount: '', participants: '' });
  };

  const handleStatusChange = (status: string) => {
    setSelectedStatus(status);
    if (status !== 'Not Interested') {
      setComment('');
    }
  };

  // Auto-update workflow data whenever selections change
  useEffect(() => {
    if (selectedStage && selectedStatus) {
      const updates: any = {
        stage: selectedStage,
        status: selectedStatus
      };

      if (comment) {
        updates.comment = comment;
      }

      if (selectedStage === 'payment_status' && selectedStatus === 'Received') {
        updates.paymentDetails = paymentDetails;
      }

      onWorkflowUpdate(updates);
    } else {
      onWorkflowUpdate(null);
    }
  }, [selectedStage, selectedStatus, comment, paymentDetails, onWorkflowUpdate]);

  const getCurrentStageValue = (stageKey: string) => {
    return school[stageKey as keyof School] as string;
  };

  // Business rule functions from main WorkflowEditor
  const isQuestionPaperStage = (stageKey: string) => {
    return ['question_paper_sent', 'answer_sheet_status', 'result_status'].includes(stageKey);
  };

  const isConsentFormSentStage = (stageKey: string) => {
    return stageKey === 'consent_form_sent';
  };

  const canAccessConsentFormSent = (school: School) => {
    return school.consent_form_requested === 'Yes';
  };

  const canProgressToQuestionPaper = (school: School) => {
    return school.registration_status === 'Confirmed' &&
           school.name_list_status === 'Received' &&
           school.payment_status === 'Received';
  };

  // Apply business rules to determine if stage is accessible
  const isStageDisabled = (stageKey: string) => {
    const isQuestionPaperDisabled = isQuestionPaperStage(stageKey) && !canProgressToQuestionPaper(school);
    const isConsentFormDisabled = isConsentFormSentStage(stageKey) && !canAccessConsentFormSent(school);
    return isQuestionPaperDisabled || isConsentFormDisabled;
  };

  const showCommentField = selectedStatus === 'Not Interested' || 
                          (selectedStage === 'consent_form_sent' && selectedStatus !== 'Not Sent');

  const showPaymentFields = selectedStage === 'payment_status' && selectedStatus === 'Received';

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen} className="mt-4">
      <CollapsibleTrigger asChild>
        <Button variant="ghost" className="flex items-center gap-2 p-0 h-auto font-normal text-sm">
          {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          Update School Status (Optional)
        </Button>
      </CollapsibleTrigger>
      
      <CollapsibleContent className="space-y-4 mt-4 p-4 border rounded-lg bg-muted/20">
        {/* Current Status Summary */}
        <div>
          <Label className="text-xs font-medium text-muted-foreground">Current Status</Label>
          <div className="flex flex-wrap gap-2 mt-2">
            <Badge variant="outline" className="text-xs">
              Contacted: {school.contacted || 'No'}
            </Badge>
            <Badge variant="outline" className="text-xs">
              Brochure: {school.brochure_delivery_status || 'Physical Only'}
            </Badge>
            <Badge variant="outline" className="text-xs">
              Interest: {school.registration_interest || 'Unknown'}
            </Badge>
            <Badge variant="outline" className="text-xs">
              Registration: {school.registration_status || 'Pending'}
            </Badge>
          </div>
        </div>

        {/* Business Rule Notices */}
        {selectedStage && isStageDisabled(selectedStage) && (
          <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
            <p className="text-sm text-yellow-800">
              <strong>Prerequisites Required:</strong>
              {isQuestionPaperStage(selectedStage) && (
                <span> Registration must be confirmed, name list received, and payment received to access question paper stages.</span>
              )}
              {isConsentFormSentStage(selectedStage) && (
                <span> Consent form must be requested before it can be sent.</span>
              )}
            </p>
          </div>
        )}

        {/* Workflow Stage Selector */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label htmlFor="workflow-stage">Workflow Stage</Label>
            <Select value={selectedStage} onValueChange={handleStageChange}>
              <SelectTrigger>
                <SelectValue placeholder="Select stage to update" />
              </SelectTrigger>
              <SelectContent>
                {stages.map((stage) => {
                  const isDisabled = isStageDisabled(stage.key);
                  return (
                    <SelectItem 
                      key={stage.key} 
                      value={stage.key}
                      disabled={isDisabled}
                    >
                      {stage.label} ({getCurrentStageValue(stage.key) || 'Not Set'})
                      {isDisabled && ' - Requires Prerequisites'}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label htmlFor="workflow-status">New Status</Label>
            <Select 
              value={selectedStatus} 
              onValueChange={handleStatusChange}
              disabled={!selectedStage || isStageDisabled(selectedStage)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select new status" />
              </SelectTrigger>
              <SelectContent>
                {selectedStageData?.options.map((option) => (
                  <SelectItem key={option} value={option}>
                    {option}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Comment Field */}
        {showCommentField && (
          <div>
            <Label htmlFor="workflow-comment">
              Comment {selectedStatus === 'Not Interested' ? '(Required)' : '(Optional)'}
            </Label>
            <Textarea
              id="workflow-comment"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Enter comment..."
              className="h-20"
            />
          </div>
        )}

        {/* Payment Details */}
        {showPaymentFields && (
          <div className="space-y-3">
            <Label className="text-sm font-medium">Payment Details</Label>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="payment-mode" className="text-xs">Payment Mode</Label>
                <Select 
                  value={paymentDetails.mode} 
                  onValueChange={(value) => setPaymentDetails(prev => ({ ...prev, mode: value }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select mode" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Cash">Cash</SelectItem>
                    <SelectItem value="Cheque">Cheque</SelectItem>
                    <SelectItem value="Online">Online</SelectItem>
                    <SelectItem value="DD">DD</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              
              <div>
                <Label htmlFor="payment-date" className="text-xs">Payment Date</Label>
                <Input
                  id="payment-date"
                  type="date"
                  value={paymentDetails.date}
                  onChange={(e) => setPaymentDetails(prev => ({ ...prev, date: e.target.value }))}
                />
              </div>
              
              <div>
                <Label htmlFor="payment-amount" className="text-xs">Amount</Label>
                <Input
                  id="payment-amount"
                  type="number"
                  placeholder="0.00"
                  value={paymentDetails.amount}
                  onChange={(e) => setPaymentDetails(prev => ({ ...prev, amount: e.target.value }))}
                />
              </div>
              
              <div>
                <Label htmlFor="payment-participants" className="text-xs">Participants</Label>
                <Input
                  id="payment-participants"
                  type="number"
                  placeholder="0"
                  value={paymentDetails.participants}
                  onChange={(e) => setPaymentDetails(prev => ({ ...prev, participants: e.target.value }))}
                />
              </div>
            </div>
          </div>
        )}

        {/* Status Preview */}
        {selectedStage && selectedStatus && (
          <div className="flex justify-between items-center p-3 bg-muted rounded-md text-sm">
            <span>Status will be updated: <strong>{selectedStage.replace(/_/g, ' ')} → {selectedStatus}</strong></span>
            {selectedStatus === 'Not Interested' && !comment && (
              <span className="text-destructive text-xs">Comment required</span>
            )}
          </div>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
};

export default CommunicationWorkflowEditor;