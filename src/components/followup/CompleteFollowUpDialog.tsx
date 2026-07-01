import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { useCommunications } from '@/hooks/useCommunications';
import { useFollowUps } from '@/hooks/useFollowUps';
import CommunicationWorkflowEditor from '@/components/communication/CommunicationWorkflowEditor';
import { useWorkflow } from '@/hooks/useWorkflow';

interface CompleteFollowUpDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  followUp: any;
  school: any;
}

const CompleteFollowUpDialog = ({ isOpen, onOpenChange, followUp, school }: CompleteFollowUpDialogProps) => {
  const { toast } = useToast();
  const { addCommunication } = useCommunications();
  const { updateFollowUpStatus, createFollowUp } = useFollowUps();
  const { updateWorkflowStatus } = useWorkflow();
  
  const [form, setForm] = useState({
    communicationType: 'Phone' as 'Phone' | 'Email' | 'WhatsApp',
    message: '',
    nextFollowUpDate: '',
    nextFollowUpTime: '',
    status: 'completed' as 'completed' | 'rescheduled'
  });
  
  const [workflowUpdates, setWorkflowUpdates] = useState<any>(null);
  
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!form.message.trim()) {
      toast({
        title: 'Error',
        description: 'Communication message is required',
        variant: 'destructive',
      });
      return;
    }

    setIsSubmitting(true);
    
    try {
      // Log the communication
      const commResult = await addCommunication(
        school.id,
        form.communicationType,
        form.message
      );
      
      if (commResult.error) {
        throw new Error('Failed to log communication');
      }

      // Handle workflow updates if provided
      if (workflowUpdates) {
        const { stage, status, comment, paymentDetails } = workflowUpdates;
        const currentStageValue = school[stage as keyof typeof school] as string;
        
        const additionalUpdates: any = {};
        
        // Add comment if provided
        if (comment) {
          if (stage === 'registration_interest') {
            additionalUpdates.registration_interest_comment = comment;
          } else if (stage === 'consent_form_sent') {
            additionalUpdates.consent_form_comment = comment;
          }
        }

        // Add payment details if provided
        if (paymentDetails && stage === 'payment_status' && status === 'Received') {
          additionalUpdates.payment_mode = paymentDetails.mode;
          additionalUpdates.payment_date = paymentDetails.date;
          additionalUpdates.payment_amount = parseFloat(paymentDetails.amount) || null;
          additionalUpdates.total_participants = parseInt(paymentDetails.participants) || null;
        }

        await updateWorkflowStatus(
          school.id,
          stage,
          status,
          currentStageValue,
          additionalUpdates
        );
      }

      // Create next follow-up if provided
      if (form.nextFollowUpDate && form.nextFollowUpTime) {
        const followUpResult = await createFollowUp(
          school.id,
          form.nextFollowUpDate,
          form.nextFollowUpTime
        );
        
        if (followUpResult.error) {
          console.error('Failed to create next follow-up:', followUpResult.error);
          // Don't fail the whole operation for this
        }
      }

      // Update the current follow-up status
      await updateFollowUpStatus(followUp.id, form.status);
      
      toast({
        title: 'Success',
        description: 'Follow-up completed and communication logged successfully'
      });
      
      // Reset form and close dialog
      setForm({
        communicationType: 'Phone',
        message: '',
        nextFollowUpDate: '',
        nextFollowUpTime: '',
        status: 'completed'
      });
      setWorkflowUpdates(null);
      onOpenChange(false);
      
    } catch (error: any) {
      console.error('Error completing follow-up:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to complete follow-up',
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancel = () => {
    setForm({
      communicationType: 'Phone',
      message: '',
      nextFollowUpDate: '',
      nextFollowUpTime: '',
      status: 'completed'
    });
    setWorkflowUpdates(null);
    onOpenChange(false);
  };

  const handleWorkflowUpdate = (updates: any) => {
    setWorkflowUpdates(updates);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Complete Follow-up</DialogTitle>
          <p className="text-sm text-muted-foreground">
            Complete follow-up for {school?.school_name} (SS No: {school?.ss_no})
          </p>
        </DialogHeader>
        
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Communication Type */}
          <div>
            <Label htmlFor="communication_type">Communication Type *</Label>
            <Select 
              value={form.communicationType} 
              onValueChange={(value: 'Phone' | 'Email' | 'WhatsApp') => 
                setForm({...form, communicationType: value})
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Select communication type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Phone">Phone</SelectItem>
                <SelectItem value="Email">Email</SelectItem>
                <SelectItem value="WhatsApp">WhatsApp</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Communication Message */}
          <div>
            <Label htmlFor="message">Communication Notes *</Label>
            <Textarea
              id="message"
              placeholder="Enter details about the communication (what was discussed, outcome, etc.)"
              value={form.message}
              onChange={(e) => setForm({...form, message: e.target.value})}
              rows={4}
              required
            />
          </div>

          {/* Status */}
          <div>
            <Label htmlFor="status">Follow-up Status</Label>
            <Select 
              value={form.status} 
              onValueChange={(value: 'completed' | 'rescheduled') => 
                setForm({...form, status: value})
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="completed">Completed</SelectItem>
                <SelectItem value="rescheduled">Rescheduled</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Workflow Editor */}
          <CommunicationWorkflowEditor
            school={school}
            onWorkflowUpdate={handleWorkflowUpdate}
          />

          {/* Next Follow-up Section */}
          <div className="space-y-4 pt-4 border-t">
            <Label className="text-sm font-medium">Schedule Next Follow-up (Optional)</Label>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="next_follow_up_date" className="text-sm">Follow-up Date</Label>
                <Input
                  id="next_follow_up_date"
                  type="date"
                  value={form.nextFollowUpDate}
                  onChange={(e) => setForm({...form, nextFollowUpDate: e.target.value})}
                  min={new Date().toISOString().split('T')[0]}
                />
              </div>
              <div>
                <Label htmlFor="next_follow_up_time" className="text-sm">Follow-up Time</Label>
                <Input
                  id="next_follow_up_time"
                  type="time"
                  value={form.nextFollowUpTime}
                  onChange={(e) => setForm({...form, nextFollowUpTime: e.target.value})}
                />
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex justify-end space-x-2">
            <Button 
              type="button" 
              variant="outline" 
              onClick={handleCancel}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button 
              type="submit"
              disabled={isSubmitting || !form.message.trim()}
            >
              {isSubmitting ? 'Processing...' : 'Complete Follow-up'}
              {workflowUpdates && (
                <span className="ml-2 text-xs">& Update Status</span>
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default CompleteFollowUpDialog;