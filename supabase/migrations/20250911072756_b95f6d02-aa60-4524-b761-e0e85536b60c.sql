-- Add safeguards to prevent accidental data wiping during manual edits
-- Update the manual edit function to preserve existing values when updates contain empty strings

CREATE OR REPLACE FUNCTION public.update_school_with_manual_edit(
  p_school_id uuid,
  p_updates jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_school RECORD;
BEGIN
  -- First get the current school data to preserve existing values
  SELECT * INTO current_school FROM public.schools WHERE id = p_school_id;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'School with ID % not found', p_school_id;
  END IF;
  
  -- Set manual edit mode for this session
  PERFORM set_config('app.manual_edit_mode', 'true', true);
  
  -- Helper function to preserve existing values when update value is null or empty
  -- Only update if the new value is meaningful (not null, not empty string)
  UPDATE public.schools 
  SET 
    ss_no = CASE 
      WHEN p_updates ? 'ss_no' AND p_updates->>'ss_no' IS NOT NULL AND p_updates->>'ss_no' != '' 
      THEN (p_updates->>'ss_no')::integer 
      ELSE ss_no 
    END,
    school_name = CASE 
      WHEN p_updates ? 'school_name' AND p_updates->>'school_name' IS NOT NULL AND p_updates->>'school_name' != '' 
      THEN p_updates->>'school_name' 
      ELSE school_name 
    END,
    school_address = CASE 
      WHEN p_updates ? 'school_address' AND p_updates->>'school_address' IS NOT NULL AND p_updates->>'school_address' != '' 
      THEN p_updates->>'school_address' 
      ELSE school_address 
    END,
    district = CASE 
      WHEN p_updates ? 'district' AND p_updates->>'district' IS NOT NULL AND p_updates->>'district' != '' 
      THEN p_updates->>'district' 
      ELSE district 
    END,
    state = CASE 
      WHEN p_updates ? 'state' AND p_updates->>'state' IS NOT NULL AND p_updates->>'state' != '' 
      THEN p_updates->>'state' 
      ELSE state 
    END,
    board = CASE 
      WHEN p_updates ? 'board' AND p_updates->>'board' IS NOT NULL AND p_updates->>'board' != '' 
      THEN p_updates->>'board' 
      ELSE board 
    END,
    pincode = CASE 
      WHEN p_updates ? 'pincode' AND p_updates->>'pincode' IS NOT NULL AND p_updates->>'pincode' != '' 
      THEN p_updates->>'pincode' 
      ELSE pincode 
    END,
    contact_person_name = CASE 
      WHEN p_updates ? 'contact_person_name' AND p_updates->>'contact_person_name' IS NOT NULL AND p_updates->>'contact_person_name' != '' 
      THEN p_updates->>'contact_person_name' 
      ELSE contact_person_name 
    END,
    -- For contact fields, allow explicit setting to null if the update specifically passes null
    email = CASE 
      WHEN p_updates ? 'email' THEN 
        CASE 
          WHEN p_updates->>'email' = '' THEN NULL 
          ELSE p_updates->>'email' 
        END
      ELSE email 
    END,
    mobile1 = CASE 
      WHEN p_updates ? 'mobile1' THEN 
        CASE 
          WHEN p_updates->>'mobile1' = '' THEN NULL 
          ELSE p_updates->>'mobile1' 
        END
      ELSE mobile1 
    END,
    mobile2 = CASE 
      WHEN p_updates ? 'mobile2' THEN 
        CASE 
          WHEN p_updates->>'mobile2' = '' THEN NULL 
          ELSE p_updates->>'mobile2' 
        END
      ELSE mobile2 
    END,
    -- Handle other fields with proper null handling
    courier_status = CASE 
      WHEN p_updates ? 'courier_status' AND p_updates->>'courier_status' IS NOT NULL 
      THEN (p_updates->>'courier_status')::courier_status 
      ELSE courier_status 
    END,
    contacted = CASE 
      WHEN p_updates ? 'contacted' AND p_updates->>'contacted' IS NOT NULL 
      THEN (p_updates->>'contacted')::contacted_status 
      ELSE contacted 
    END,
    registration_interest = CASE 
      WHEN p_updates ? 'registration_interest' AND p_updates->>'registration_interest' IS NOT NULL 
      THEN (p_updates->>'registration_interest')::interest_status 
      ELSE registration_interest 
    END,
    registration_interest_comment = CASE 
      WHEN p_updates ? 'registration_interest_comment' THEN 
        CASE 
          WHEN p_updates->>'registration_interest_comment' = '' THEN NULL 
          ELSE p_updates->>'registration_interest_comment' 
        END
      ELSE registration_interest_comment 
    END,
    consent_form_requested = CASE 
      WHEN p_updates ? 'consent_form_requested' AND p_updates->>'consent_form_requested' IS NOT NULL 
      THEN (p_updates->>'consent_form_requested')::consent_status 
      ELSE consent_form_requested 
    END,
    consent_form_comment = CASE 
      WHEN p_updates ? 'consent_form_comment' THEN 
        CASE 
          WHEN p_updates->>'consent_form_comment' = '' THEN NULL 
          ELSE p_updates->>'consent_form_comment' 
        END
      ELSE consent_form_comment 
    END,
    consent_form_sent = CASE 
      WHEN p_updates ? 'consent_form_sent' AND p_updates->>'consent_form_sent' IS NOT NULL 
      THEN p_updates->>'consent_form_sent' 
      ELSE consent_form_sent 
    END,
    registration_status = CASE 
      WHEN p_updates ? 'registration_status' AND p_updates->>'registration_status' IS NOT NULL 
      THEN (p_updates->>'registration_status')::registration_status 
      ELSE registration_status 
    END,
    name_list_status = CASE 
      WHEN p_updates ? 'name_list_status' AND p_updates->>'name_list_status' IS NOT NULL 
      THEN (p_updates->>'name_list_status')::name_list_status 
      ELSE name_list_status 
    END,
    payment_status = CASE 
      WHEN p_updates ? 'payment_status' AND p_updates->>'payment_status' IS NOT NULL 
      THEN (p_updates->>'payment_status')::payment_status 
      ELSE payment_status 
    END,
    payment_date = CASE 
      WHEN p_updates ? 'payment_date' AND p_updates->>'payment_date' IS NOT NULL 
      THEN (p_updates->>'payment_date')::date 
      ELSE payment_date 
    END,
    payment_amount = CASE 
      WHEN p_updates ? 'payment_amount' AND p_updates->>'payment_amount' IS NOT NULL 
      THEN (p_updates->>'payment_amount')::numeric 
      ELSE payment_amount 
    END,
    payment_mode = CASE 
      WHEN p_updates ? 'payment_mode' AND p_updates->>'payment_mode' IS NOT NULL 
      THEN p_updates->>'payment_mode' 
      ELSE payment_mode 
    END,
    question_paper_sent = CASE 
      WHEN p_updates ? 'question_paper_sent' AND p_updates->>'question_paper_sent' IS NOT NULL 
      THEN (p_updates->>'question_paper_sent')::question_paper_status 
      ELSE question_paper_sent 
    END,
    answer_sheet_status = CASE 
      WHEN p_updates ? 'answer_sheet_status' AND p_updates->>'answer_sheet_status' IS NOT NULL 
      THEN (p_updates->>'answer_sheet_status')::answer_sheet_status 
      ELSE answer_sheet_status 
    END,
    result_status = CASE 
      WHEN p_updates ? 'result_status' AND p_updates->>'result_status' IS NOT NULL 
      THEN (p_updates->>'result_status')::result_status 
      ELSE result_status 
    END,
    total_participants = CASE 
      WHEN p_updates ? 'total_participants' AND p_updates->>'total_participants' IS NOT NULL 
      THEN (p_updates->>'total_participants')::integer 
      ELSE total_participants 
    END,
    brochure_delivery_status = CASE 
      WHEN p_updates ? 'brochure_delivery_status' AND p_updates->>'brochure_delivery_status' IS NOT NULL 
      THEN (p_updates->>'brochure_delivery_status')::brochure_delivery_status 
      ELSE brochure_delivery_status 
    END,
    current_project_id = CASE 
      WHEN p_updates ? 'current_project_id' AND p_updates->>'current_project_id' IS NOT NULL 
      THEN (p_updates->>'current_project_id')::uuid 
      ELSE current_project_id 
    END,
    updated_at = now()
  WHERE id = p_school_id;
  
  -- Reset manual edit mode
  PERFORM set_config('app.manual_edit_mode', 'false', true);
  
  -- Log the manual edit with better context
  PERFORM public.log_security_action(
    'MANUAL_SCHOOL_EDIT_SAFE',
    'schools',
    p_school_id,
    jsonb_build_object('previous_data', to_jsonb(current_school)),
    jsonb_build_object('updates_requested', p_updates, 'timestamp', now())
  );
END;
$$;