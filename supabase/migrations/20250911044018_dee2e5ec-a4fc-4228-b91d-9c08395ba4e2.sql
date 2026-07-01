-- Create function to enable manual edit mode and update school
CREATE OR REPLACE FUNCTION public.update_school_with_manual_edit(
  p_school_id UUID,
  p_updates JSONB
) RETURNS TABLE(id UUID, school_name TEXT, ss_no INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result_record RECORD;
BEGIN
  -- Set manual edit mode
  PERFORM set_config('app.manual_edit_mode', 'true', true);
  
  -- Update the school record
  UPDATE public.schools 
  SET 
    ss_no = COALESCE((p_updates->>'ss_no')::INTEGER, schools.ss_no),
    school_name = COALESCE(p_updates->>'school_name', schools.school_name),
    school_address = COALESCE(p_updates->>'school_address', schools.school_address),
    district = COALESCE(p_updates->>'district', schools.district),
    state = COALESCE(p_updates->>'state', schools.state),
    board = COALESCE(p_updates->>'board', schools.board),
    mobile1 = COALESCE(p_updates->>'mobile1', schools.mobile1),
    mobile2 = COALESCE(p_updates->>'mobile2', schools.mobile2),
    email = COALESCE(p_updates->>'email', schools.email),
    contact_person_name = COALESCE(p_updates->>'contact_person_name', schools.contact_person_name),
    pincode = COALESCE(p_updates->>'pincode', schools.pincode),
    registration_interest_comment = COALESCE(p_updates->>'registration_interest_comment', schools.registration_interest_comment),
    consent_form_comment = COALESCE(p_updates->>'consent_form_comment', schools.consent_form_comment),
    updated_at = now()
  WHERE schools.id = p_school_id
  RETURNING schools.id, schools.school_name, schools.ss_no INTO result_record;
  
  -- Reset manual edit mode
  PERFORM set_config('app.manual_edit_mode', 'false', true);
  
  -- Return the updated record
  RETURN QUERY SELECT result_record.id, result_record.school_name, result_record.ss_no;
END;
$$;