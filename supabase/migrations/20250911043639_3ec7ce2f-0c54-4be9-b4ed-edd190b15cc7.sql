-- Create a function to validate school basic details updates
CREATE OR REPLACE FUNCTION public.validate_school_basic_details_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

  -- Allow superadmins to update basic details
  IF user_role = 'superadmin' THEN
    RETURN NEW;
  END IF;

  -- For non-superadmins, check if any protected fields are being changed
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
      
      -- If not a manual edit, prevent the update
      IF NOT is_manual_edit THEN
        RAISE EXCEPTION 'Protected field "%" cannot be modified automatically. Manual edit required. Use the edit button to modify basic school details.', field_name;
      END IF;
    END IF;
  END LOOP;

  -- Log the manual edit
  IF is_manual_edit THEN
    PERFORM public.log_security_action(
      'MANUAL_SCHOOL_EDIT',
      'schools',
      NEW.id,
      to_jsonb(OLD),
      to_jsonb(NEW)
    );
  END IF;

  RETURN NEW;
END;
$$;

-- Create trigger to validate school basic details updates
DROP TRIGGER IF EXISTS validate_school_basic_details_trigger ON public.schools;
CREATE TRIGGER validate_school_basic_details_trigger
  BEFORE UPDATE ON public.schools
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_school_basic_details_update();