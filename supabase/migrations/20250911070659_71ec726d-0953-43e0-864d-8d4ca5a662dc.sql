-- Drop the existing function first
DROP FUNCTION IF EXISTS public.update_school_with_manual_edit(uuid, jsonb);

-- Create the missing update_school_with_manual_edit function with correct return type
CREATE OR REPLACE FUNCTION public.update_school_with_manual_edit(
  p_school_id uuid,
  p_updates jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Set manual edit mode for this session
  PERFORM set_config('app.manual_edit_mode', 'true', true);
  
  -- Perform the update with the normalized data
  UPDATE public.schools 
  SET 
    ss_no = COALESCE((p_updates->>'ss_no')::integer, ss_no),
    school_name = COALESCE(p_updates->>'school_name', school_name),
    school_address = COALESCE(p_updates->>'school_address', school_address),
    district = COALESCE(p_updates->>'district', district),
    state = COALESCE(p_updates->>'state', state),
    board = COALESCE(p_updates->>'board', board),
    pincode = COALESCE(p_updates->>'pincode', pincode),
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
    contact_person_name = CASE 
      WHEN p_updates ? 'contact_person_name' THEN 
        CASE 
          WHEN p_updates->>'contact_person_name' = '' THEN NULL 
          ELSE p_updates->>'contact_person_name' 
        END
      ELSE contact_person_name 
    END,
    -- Also handle non-protected fields that might be included
    courier_status = COALESCE((p_updates->>'courier_status')::courier_status, courier_status),
    contacted = COALESCE((p_updates->>'contacted')::contacted_status, contacted),
    registration_interest = COALESCE((p_updates->>'registration_interest')::interest_status, registration_interest),
    registration_interest_comment = CASE 
      WHEN p_updates ? 'registration_interest_comment' THEN 
        CASE 
          WHEN p_updates->>'registration_interest_comment' = '' THEN NULL 
          ELSE p_updates->>'registration_interest_comment' 
        END
      ELSE registration_interest_comment 
    END,
    consent_form_requested = COALESCE((p_updates->>'consent_form_requested')::consent_status, consent_form_requested),
    consent_form_comment = CASE 
      WHEN p_updates ? 'consent_form_comment' THEN 
        CASE 
          WHEN p_updates->>'consent_form_comment' = '' THEN NULL 
          ELSE p_updates->>'consent_form_comment' 
        END
      ELSE consent_form_comment 
    END,
    consent_form_sent = COALESCE(p_updates->>'consent_form_sent', consent_form_sent),
    registration_status = COALESCE((p_updates->>'registration_status')::registration_status, registration_status),
    name_list_status = COALESCE((p_updates->>'name_list_status')::name_list_status, name_list_status),
    payment_status = COALESCE((p_updates->>'payment_status')::payment_status, payment_status),
    payment_date = COALESCE((p_updates->>'payment_date')::date, payment_date),
    payment_amount = COALESCE((p_updates->>'payment_amount')::numeric, payment_amount),
    payment_mode = COALESCE(p_updates->>'payment_mode', payment_mode),
    question_paper_sent = COALESCE((p_updates->>'question_paper_sent')::question_paper_status, question_paper_sent),
    answer_sheet_status = COALESCE((p_updates->>'answer_sheet_status')::answer_sheet_status, answer_sheet_status),
    result_status = COALESCE((p_updates->>'result_status')::result_status, result_status),
    total_participants = COALESCE((p_updates->>'total_participants')::integer, total_participants),
    brochure_delivery_status = COALESCE((p_updates->>'brochure_delivery_status')::brochure_delivery_status, brochure_delivery_status),
    current_project_id = COALESCE((p_updates->>'current_project_id')::uuid, current_project_id),
    updated_at = now()
  WHERE id = p_school_id;
  
  -- Reset manual edit mode
  PERFORM set_config('app.manual_edit_mode', 'false', true);
  
  -- Log the manual edit
  PERFORM public.log_security_action(
    'MANUAL_SCHOOL_EDIT',
    'schools',
    p_school_id,
    NULL,
    p_updates
  );
END;
$$;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION public.update_school_with_manual_edit(uuid, jsonb) TO authenticated;