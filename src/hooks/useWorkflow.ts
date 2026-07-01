import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { School, WorkflowHistory, ActivityLog } from '@/types/database';
import { useToast } from '@/hooks/use-toast';

export const useWorkflow = () => {
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const getWorkflowStages = () => [
    { key: 'courier_status', label: 'Courier Status', options: ['Sent', 'Returned'] },
    { key: 'contacted', label: 'Contacted', options: ['Yes', 'No'] },
    { key: 'brochure_delivery_status', label: 'Brochure Delivery', options: ['Physical Only', 'Digital Sent', 'Both Physical & Digital'] },
    { key: 'registration_interest', label: 'Registration Interest', options: ['Interested', 'Not Interested'] },
    { key: 'consent_form_requested', label: 'Consent Form Requested', options: ['Yes', 'No'] },
    { key: 'consent_form_sent', label: 'Consent Form Sent', options: ['Sent', 'Sent Digitally', 'Not Sent'] },
    { key: 'registration_status', label: 'Registration Status', options: ['Pending', 'In Progress', 'Confirmed'] },
    { key: 'name_list_status', label: 'Name List Status', options: ['Pending', 'Received', 'Uploaded'] },
    { key: 'payment_status', label: 'Payment Status', options: ['Pending', 'Partial', 'Received', 'Overpaid'] },
    { key: 'question_paper_sent', label: 'Question Paper Sent', options: ['Sent', 'Not Sent'] },
    { key: 'answer_sheet_status', label: 'Answer Sheet Status', options: ['Waiting', 'Received'] },
    { key: 'result_status', label: 'Result Status', options: ['Sent', 'Not Sent'] }
  ];

  const getCurrentStatus = (school: School) => {
    const stages = getWorkflowStages();
    for (let i = stages.length - 1; i >= 0; i--) {
      const stage = stages[i];
      const value = school[stage.key as keyof School];
      if (value && value !== 'Pending' && value !== 'No' && value !== 'Waiting' && value !== 'Not Sent' && value !== 'Physical Only') {
        return `${stage.label}: ${value}`;
      }
    }
    return 'Courier Status: Sent';
  };

  const canProgressToQuestionPaper = (school: School) => {
    return school.registration_status === 'Confirmed' &&
           (school.name_list_status === 'Received' || school.name_list_status === 'Uploaded') &&
           school.payment_status === 'Received';
  };

  const updateWorkflowStatus = async (
    schoolId: string,
    stage: string,
    newStatus: string,
    oldStatus?: string,
    additionalUpdates?: Partial<School>
  ) => {
    setLoading(true);
    try {
      // Prepare the update object - only include workflow status and payment details
      const updateData: Partial<School> = { [stage]: newStatus };
      
      // Add payment details for payment status updates only
      if (additionalUpdates && stage === 'payment_status') {
        // Filter out undefined, null, or empty string values to prevent data corruption
        const cleanedUpdates = Object.entries(additionalUpdates).reduce((acc, [key, value]) => {
          // Only include values that are not null, undefined, or empty strings
          if (value !== null && value !== undefined && value !== '') {
            acc[key] = value;
          }
          return acc;
        }, {} as Record<string, any>);
        
        Object.assign(updateData, cleanedUpdates);
      }

      // Update school record directly for workflow updates
      const { error: schoolError } = await supabase
        .from('schools')
        .update(updateData)
        .eq('id', schoolId);

      if (schoolError) throw schoolError;

      // Log workflow history
      const { error: historyError } = await supabase
        .from('workflow_history')
        .insert({
          school_id: schoolId,
          workflow_stage: stage,
          old_status: oldStatus,
          new_status: newStatus,
          changed_by: (await supabase.auth.getUser()).data.user?.id || ''
        });

      if (historyError) throw historyError;

      // Log activity
      const { error: activityError } = await supabase
        .from('activity_logs')
        .insert({
          school_id: schoolId,
          user_id: (await supabase.auth.getUser()).data.user?.id || '',
          activity_type: 'status_update',
          field_name: stage,
          old_value: oldStatus,
          new_value: newStatus,
          description: `Updated ${stage} from ${oldStatus || 'null'} to ${newStatus}`
        });

      if (activityError) throw activityError;

      toast({
        title: 'Success',
        description: 'Workflow status updated successfully'
      });

      return { success: true, data: updateData };
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to update workflow status',
        variant: 'destructive'
      });
      return { success: false, error };
    } finally {
      setLoading(false);
    }
  };

  const getWorkflowHistory = async (schoolId: string): Promise<WorkflowHistory[]> => {
    const { data, error } = await supabase
      .from('workflow_history')
      .select(`
        *,
        profiles:changed_by(username, full_name)
      `)
      .eq('school_id', schoolId)
      .order('changed_at', { ascending: false });

    if (error) {
      console.error('Error fetching workflow history:', error);
      return [];
    }

    return data || [];
  };

  return {
    loading,
    getWorkflowStages,
    getCurrentStatus,
    canProgressToQuestionPaper,
    updateWorkflowStatus,
    getWorkflowHistory
  };
};