-- Rename whatsapp_templates keys to match new canonical names
UPDATE whatsapp_templates SET template_key = 'interest_acknowledged'     WHERE template_key = 'registration_interest_acknowledged';
UPDATE whatsapp_templates SET template_key = 'registration_confirmed'    WHERE template_key = 'registration_confirmation';
UPDATE whatsapp_templates SET template_key = 'payment_received'          WHERE template_key = 'payment_confirmation';
UPDATE whatsapp_templates SET template_key = 'question_paper_sent_wa'    WHERE template_key = 'question_paper_sent';
UPDATE whatsapp_templates SET template_key = 'answer_sheet_received_wa'  WHERE template_key = 'answer_sheet_received';
UPDATE whatsapp_templates SET template_key = 'result_sent_wa'            WHERE template_key = 'results_sent';

-- Rename communication_templates types to match
UPDATE communication_templates SET template_type = 'interest_acknowledged'     WHERE template_type = 'registration_interest_acknowledged';
UPDATE communication_templates SET template_type = 'registration_confirmed'    WHERE template_type = 'registration_confirmation';
UPDATE communication_templates SET template_type = 'payment_received'          WHERE template_type = 'payment_confirmation';
UPDATE communication_templates SET template_type = 'question_paper_sent_wa'    WHERE template_type = 'question_paper_sent';
UPDATE communication_templates SET template_type = 'answer_sheet_received_wa'  WHERE template_type = 'answer_sheet_received';
UPDATE communication_templates SET template_type = 'result_sent_wa'            WHERE template_type = 'results_sent';
