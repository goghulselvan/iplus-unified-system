-- Update the check constraint to remove courier_sent
ALTER TABLE public.communication_templates 
DROP CONSTRAINT IF EXISTS communication_templates_template_type_check;

ALTER TABLE public.communication_templates
ADD CONSTRAINT communication_templates_template_type_check 
CHECK (template_type IN (
  'registration_confirmation',
  'name_list_received',
  'payment_confirmation',
  'question_paper_sent',
  'answer_sheet_received',
  'results_sent',
  'courier_sent'  -- Keep for backward compatibility with existing records
));