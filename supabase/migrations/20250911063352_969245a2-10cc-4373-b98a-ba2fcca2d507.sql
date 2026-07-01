-- Grant execute permission to managers for the manual edit function
GRANT EXECUTE ON FUNCTION public.update_school_with_manual_edit(uuid, jsonb) TO authenticated;

-- Also ensure the function handles all role types properly
CREATE OR REPLACE FUNCTION public.update_school_with_manual_edit(p_school_id uuid, p_updates jsonb)
RETURNS TABLE(id uuid, school_name text, ss_no integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  result_record RECORD;
  user_role user_role;
BEGIN
  -- Get the current user's role
  SELECT role INTO user_role 
  FROM public.profiles 
  WHERE user_id = auth.uid();

  -- Allow both superadmins and managers to perform manual edits
  IF user_role NOT IN ('superadmin', 'manager') THEN
    RAISE EXCEPTION 'Insufficient permissions to perform manual school edits';
  END IF;

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
$function$;

-- Also update the validation trigger to allow managers
CREATE OR REPLACE FUNCTION public.validate_school_basic_details_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  protected_fields text[] := ARRAY['ss_no', 'school_name', 'school_address', 'district', 'state', 'board', 'mobile1', 'mobile2', 'email', 'contact_person_name', 'pincode'];
  field_name text;
  user_role user_role;
  is_manual_edit boolean := false;
BEGIN
  -- Get the current user's role
  SELECT role INTO user_role 
  FROM public.profiles 
  WHERE user_id = auth.uid();

  -- Check if this is a manual edit (we'll use a session variable to indicate this)
  SELECT COALESCE(current_setting('app.manual_edit_mode', true), 'false')::boolean INTO is_manual_edit;

  -- Allow both superadmins and managers to update basic details when in manual edit mode
  IF user_role IN ('superadmin', 'manager') AND is_manual_edit THEN
    -- Log the manual edit
    PERFORM public.log_security_action(
      'MANUAL_SCHOOL_EDIT',
      'schools',
      NEW.id,
      to_jsonb(OLD),
      to_jsonb(NEW)
    );
    RETURN NEW;
  END IF;

  -- For non-privileged users or non-manual edits, check if any protected fields are being changed
  FOREACH field_name IN ARRAY protected_fields
  LOOP
    -- Check if field is being modified
    IF OLD IS NULL OR 
       (field_name = 'ss_no' AND OLD.ss_no IS DISTINCT FROM NEW.ss_no) OR
       (field_name = 'school_name' AND OLD.school_name IS DISTINCT FROM NEW.school_name) OR
       (field_name = 'school_address' AND OLD.school_address IS DISTINCT FROM NEW.school_address) OR
       (field_name = 'district' AND OLD.district IS DISTINCT FROM NEW.district) OR
       (field_name = 'state' AND OLD.state IS DISTINCT FROM NEW.state) OR
       (field_name = 'board' AND OLD.board IS DISTINCT FROM NEW.board) OR
       (field_name = 'mobile1' AND OLD.mobile1 IS DISTINCT FROM NEW.mobile1) OR
       (field_name = 'mobile2' AND OLD.mobile2 IS DISTINCT FROM NEW.mobile2) OR
       (field_name = 'email' AND OLD.email IS DISTINCT FROM NEW.email) OR
       (field_name = 'contact_person_name' AND OLD.contact_person_name IS DISTINCT FROM NEW.contact_person_name) OR
       (field_name = 'pincode' AND OLD.pincode IS DISTINCT FROM NEW.pincode) THEN
      
      -- If not a manual edit or insufficient permissions, prevent the update
      IF NOT is_manual_edit OR user_role NOT IN ('superadmin', 'manager') THEN
        RAISE EXCEPTION 'Protected field "%" cannot be modified automatically. Manual edit required. Use the edit button to modify basic school details.', field_name;
      END IF;
    END IF;
  END LOOP;

  RETURN NEW;
END;
$function$;