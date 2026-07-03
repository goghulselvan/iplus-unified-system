-- Extend update_school_with_manual_edit to include contact and teacher fields
-- Previously these fields were silently ignored, causing saves to fail
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
  PERFORM set_config('app.manual_edit_mode', 'true', true);

  UPDATE public.schools SET
    -- Protected core fields
    ss_no           = COALESCE((p_updates->>'ss_no')::integer, ss_no),
    school_name     = COALESCE(p_updates->>'school_name', school_name),
    school_address  = COALESCE(p_updates->>'school_address', school_address),
    district        = COALESCE(p_updates->>'district', district),
    state           = COALESCE(p_updates->>'state', state),
    board           = COALESCE(p_updates->>'board', board),
    pincode         = COALESCE(p_updates->>'pincode', pincode),
    email           = CASE WHEN p_updates ? 'email'    THEN NULLIF(p_updates->>'email', '')    ELSE email    END,
    mobile1         = CASE WHEN p_updates ? 'mobile1'  THEN NULLIF(p_updates->>'mobile1', '')  ELSE mobile1  END,
    mobile2         = CASE WHEN p_updates ? 'mobile2'  THEN NULLIF(p_updates->>'mobile2', '')  ELSE mobile2  END,
    contact_person_name = CASE WHEN p_updates ? 'contact_person_name' THEN NULLIF(p_updates->>'contact_person_name', '') ELSE contact_person_name END,

    -- Address lines
    address1        = CASE WHEN p_updates ? 'address1' THEN NULLIF(p_updates->>'address1', '') ELSE address1 END,
    address2        = CASE WHEN p_updates ? 'address2' THEN NULLIF(p_updates->>'address2', '') ELSE address2 END,

    -- Contact persons
    corr_name       = CASE WHEN p_updates ? 'corr_name'       THEN NULLIF(p_updates->>'corr_name', '')       ELSE corr_name       END,
    corr_mobile     = CASE WHEN p_updates ? 'corr_mobile'     THEN NULLIF(p_updates->>'corr_mobile', '')     ELSE corr_mobile     END,
    principal_name  = CASE WHEN p_updates ? 'principal_name'  THEN NULLIF(p_updates->>'principal_name', '')  ELSE principal_name  END,
    principal_mobile= CASE WHEN p_updates ? 'principal_mobile'THEN NULLIF(p_updates->>'principal_mobile', '')ELSE principal_mobile END,
    iplus_coordinator=CASE WHEN p_updates ? 'iplus_coordinator'THEN NULLIF(p_updates->>'iplus_coordinator','')ELSE iplus_coordinator END,
    coord_mobile    = CASE WHEN p_updates ? 'coord_mobile'    THEN NULLIF(p_updates->>'coord_mobile', '')    ELSE coord_mobile    END,

    -- Teachers
    teacher_epo      = CASE WHEN p_updates ? 'teacher_epo'      THEN NULLIF(p_updates->>'teacher_epo', '')      ELSE teacher_epo      END,
    teacher_epo_mob  = CASE WHEN p_updates ? 'teacher_epo_mob'  THEN NULLIF(p_updates->>'teacher_epo_mob', '')  ELSE teacher_epo_mob  END,
    teacher_mpo      = CASE WHEN p_updates ? 'teacher_mpo'      THEN NULLIF(p_updates->>'teacher_mpo', '')      ELSE teacher_mpo      END,
    teacher_mpo_mob  = CASE WHEN p_updates ? 'teacher_mpo_mob'  THEN NULLIF(p_updates->>'teacher_mpo_mob', '')  ELSE teacher_mpo_mob  END,
    teacher_spo      = CASE WHEN p_updates ? 'teacher_spo'      THEN NULLIF(p_updates->>'teacher_spo', '')      ELSE teacher_spo      END,
    teacher_spo_mob  = CASE WHEN p_updates ? 'teacher_spo_mob'  THEN NULLIF(p_updates->>'teacher_spo_mob', '')  ELSE teacher_spo_mob  END,
    teacher_gksspo   = CASE WHEN p_updates ? 'teacher_gksspo'   THEN NULLIF(p_updates->>'teacher_gksspo', '')   ELSE teacher_gksspo   END,
    teacher_gksspo_mob=CASE WHEN p_updates ? 'teacher_gksspo_mob'THEN NULLIF(p_updates->>'teacher_gksspo_mob','')ELSE teacher_gksspo_mob END,
    teacher_lrpo     = CASE WHEN p_updates ? 'teacher_lrpo'     THEN NULLIF(p_updates->>'teacher_lrpo', '')     ELSE teacher_lrpo     END,
    teacher_lrpo_mob = CASE WHEN p_updates ? 'teacher_lrpo_mob' THEN NULLIF(p_updates->>'teacher_lrpo_mob', '') ELSE teacher_lrpo_mob END,
    teacher_kidspo   = CASE WHEN p_updates ? 'teacher_kidspo'   THEN NULLIF(p_updates->>'teacher_kidspo', '')   ELSE teacher_kidspo   END,
    teacher_kidspo_mob=CASE WHEN p_updates ? 'teacher_kidspo_mob'THEN NULLIF(p_updates->>'teacher_kidspo_mob','')ELSE teacher_kidspo_mob END,

    -- Workflow status fields
    courier_status            = COALESCE((p_updates->>'courier_status')::courier_status, courier_status),
    contacted                 = COALESCE((p_updates->>'contacted')::contacted_status, contacted),
    registration_interest     = COALESCE((p_updates->>'registration_interest')::interest_status, registration_interest),
    registration_interest_comment = CASE WHEN p_updates ? 'registration_interest_comment' THEN NULLIF(p_updates->>'registration_interest_comment','') ELSE registration_interest_comment END,
    consent_form_requested    = COALESCE((p_updates->>'consent_form_requested')::consent_status, consent_form_requested),
    consent_form_comment      = CASE WHEN p_updates ? 'consent_form_comment' THEN NULLIF(p_updates->>'consent_form_comment','') ELSE consent_form_comment END,
    consent_form_sent         = COALESCE(p_updates->>'consent_form_sent', consent_form_sent),
    registration_status       = COALESCE((p_updates->>'registration_status')::registration_status, registration_status),
    name_list_status          = COALESCE((p_updates->>'name_list_status')::name_list_status, name_list_status),
    payment_status            = COALESCE((p_updates->>'payment_status')::payment_status, payment_status),
    payment_date              = COALESCE((p_updates->>'payment_date')::date, payment_date),
    payment_amount            = COALESCE((p_updates->>'payment_amount')::numeric, payment_amount),
    payment_mode              = COALESCE(p_updates->>'payment_mode', payment_mode),
    question_paper_sent       = COALESCE((p_updates->>'question_paper_sent')::question_paper_status, question_paper_sent),
    answer_sheet_status       = COALESCE((p_updates->>'answer_sheet_status')::answer_sheet_status, answer_sheet_status),
    result_status             = COALESCE((p_updates->>'result_status')::result_status, result_status),
    total_participants        = COALESCE((p_updates->>'total_participants')::integer, total_participants),
    brochure_delivery_status  = COALESCE((p_updates->>'brochure_delivery_status')::brochure_delivery_status, brochure_delivery_status),
    current_project_id        = COALESCE((p_updates->>'current_project_id')::uuid, current_project_id),
    updated_at                = now()
  WHERE id = p_school_id;

  PERFORM set_config('app.manual_edit_mode', 'false', true);

  PERFORM public.log_security_action('MANUAL_SCHOOL_EDIT', 'schools', p_school_id, NULL, p_updates);
END;
$$;
