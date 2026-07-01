-- Drop the existing check constraint
ALTER TABLE public.communication_templates 
DROP CONSTRAINT IF EXISTS communication_templates_template_type_check;

-- Add updated check constraint with all template types (including existing ones)
ALTER TABLE public.communication_templates
ADD CONSTRAINT communication_templates_template_type_check 
CHECK (template_type IN (
  'registration_confirmation',
  'name_list_received',
  'payment_confirmation',
  'courier_sent',
  'question_paper_sent',
  'answer_sheet_received',
  'results_sent'
));