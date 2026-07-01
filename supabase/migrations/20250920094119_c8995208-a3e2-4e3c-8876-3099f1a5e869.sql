-- Drop and recreate the dashboard metrics function with new return type
DROP FUNCTION IF EXISTS public.get_dashboard_metrics();

CREATE OR REPLACE FUNCTION public.get_dashboard_metrics()
RETURNS TABLE(
  total_schools bigint, 
  courier_sent bigint, 
  courier_returned bigint, 
  contacted_yes bigint, 
  contacted_no bigint, 
  registration_interested bigint, 
  registration_not_interested bigint, 
  consent_requested bigint, 
  consent_form_sent_total bigint, 
  consent_form_sent_physical bigint, 
  consent_form_sent_digital bigint, 
  registration_confirmed bigint, 
  registration_in_progress bigint, 
  name_list_received bigint, 
  name_list_uploaded bigint,
  payment_received bigint, 
  question_paper_sent bigint, 
  answer_sheet_received bigint, 
  result_sent bigint, 
  brochure_physical_only bigint, 
  brochure_digital_sent bigint, 
  brochure_both_physical_digital bigint
)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT 
    COUNT(*) as total_schools,
    COUNT(*) FILTER (WHERE courier_status = 'Sent') as courier_sent,
    COUNT(*) FILTER (WHERE courier_status = 'Returned') as courier_returned,
    COUNT(*) FILTER (WHERE contacted = 'Yes') as contacted_yes,
    COUNT(*) FILTER (WHERE contacted = 'No') as contacted_no,
    COUNT(*) FILTER (WHERE registration_interest = 'Interested') as registration_interested,
    COUNT(*) FILTER (WHERE registration_interest = 'Not Interested') as registration_not_interested,
    COUNT(*) FILTER (WHERE consent_form_requested = 'Yes') as consent_requested,
    COUNT(*) FILTER (WHERE consent_form_sent IN ('Sent', 'Sent Digitally')) as consent_form_sent_total,
    COUNT(*) FILTER (WHERE consent_form_sent = 'Sent') as consent_form_sent_physical,
    COUNT(*) FILTER (WHERE consent_form_sent = 'Sent Digitally') as consent_form_sent_digital,
    COUNT(*) FILTER (WHERE registration_status = 'Confirmed') as registration_confirmed,
    COUNT(*) FILTER (WHERE registration_status = 'In Progress') as registration_in_progress,
    COUNT(*) FILTER (WHERE name_list_status = 'Received') as name_list_received,
    COUNT(*) FILTER (WHERE name_list_status = 'Uploaded') as name_list_uploaded,
    COUNT(*) FILTER (WHERE payment_status = 'Received') as payment_received,
    COUNT(*) FILTER (WHERE question_paper_sent = 'Sent') as question_paper_sent,
    COUNT(*) FILTER (WHERE answer_sheet_status = 'Received') as answer_sheet_received,
    COUNT(*) FILTER (WHERE result_status = 'Sent') as result_sent,
    COUNT(*) FILTER (WHERE brochure_delivery_status = 'Physical Only') as brochure_physical_only,
    COUNT(*) FILTER (WHERE brochure_delivery_status = 'Digital Sent') as brochure_digital_sent,
    COUNT(*) FILTER (WHERE brochure_delivery_status = 'Both Physical & Digital') as brochure_both_physical_digital
  FROM public.schools;
$function$;

-- Create function to update school name list status based on student registrations
CREATE OR REPLACE FUNCTION public.update_school_namelist_status(p_school_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  registration_count INTEGER;
  current_status name_list_status;
BEGIN
  -- Get current name list status
  SELECT name_list_status INTO current_status
  FROM public.schools
  WHERE id = p_school_id;
  
  -- Count student registrations for this school
  SELECT COUNT(*) INTO registration_count
  FROM public.student_registrations
  WHERE school_id = p_school_id;
  
  -- Update status based on registration count
  IF registration_count > 0 AND current_status = 'Received' THEN
    -- Change from Received to Uploaded when registrations exist
    UPDATE public.schools
    SET name_list_status = 'Uploaded', updated_at = now()
    WHERE id = p_school_id;
    
    -- Log the automatic status change
    PERFORM public.log_security_action(
      'AUTO_NAMELIST_STATUS_UPDATE',
      'schools',
      p_school_id,
      jsonb_build_object('old_status', current_status),
      jsonb_build_object('new_status', 'Uploaded', 'registration_count', registration_count)
    );
  ELSIF registration_count = 0 AND current_status = 'Uploaded' THEN
    -- Change from Uploaded back to Received when no registrations exist
    UPDATE public.schools
    SET name_list_status = 'Received', updated_at = now()
    WHERE id = p_school_id;
    
    -- Log the automatic status change
    PERFORM public.log_security_action(
      'AUTO_NAMELIST_STATUS_UPDATE',
      'schools',
      p_school_id,
      jsonb_build_object('old_status', current_status),
      jsonb_build_object('new_status', 'Received', 'registration_count', registration_count)
    );
  END IF;
END;
$function$;

-- Create trigger function for student registrations
CREATE OR REPLACE FUNCTION public.trigger_namelist_status_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Update school status when registrations are inserted or deleted
  IF TG_OP = 'INSERT' THEN
    PERFORM public.update_school_namelist_status(NEW.school_id);
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM public.update_school_namelist_status(OLD.school_id);
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$function$;

-- Create triggers on student_registrations table
DROP TRIGGER IF EXISTS trigger_namelist_status_on_insert ON public.student_registrations;
CREATE TRIGGER trigger_namelist_status_on_insert
  AFTER INSERT ON public.student_registrations
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_namelist_status_update();

DROP TRIGGER IF EXISTS trigger_namelist_status_on_delete ON public.student_registrations;
CREATE TRIGGER trigger_namelist_status_on_delete
  AFTER DELETE ON public.student_registrations
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_namelist_status_update();