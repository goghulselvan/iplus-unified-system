-- Update the function to correctly count total_registrations from student_registrations table
CREATE OR REPLACE FUNCTION public.get_dashboard_metrics_by_project_with_access(p_project_id uuid DEFAULT NULL)
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
    registration_pending bigint,
    registration_in_progress bigint,
    name_list_received bigint,
    name_list_uploaded bigint,
    payment_received bigint,
    question_paper_sent bigint,
    answer_sheet_received bigint,
    result_sent bigint,
    brochure_physical_only bigint,
    brochure_digital_sent bigint,
    brochure_both_physical_digital bigint,
    total_registrations bigint
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_user_role text;
    v_assigned_districts text[];
BEGIN
    -- Get the current user's role and assigned districts
    SELECT p.role::text, p.assigned_districts 
    INTO v_user_role, v_assigned_districts
    FROM profiles p 
    WHERE p.user_id = auth.uid();

    RETURN QUERY
    WITH filtered_schools AS (
        SELECT s.* FROM schools s
        LEFT JOIN school_project_workflow spw ON s.id = spw.school_id AND spw.project_id = p_project_id
        WHERE 
            (p_project_id IS NULL OR s.current_project_id = p_project_id OR spw.project_id = p_project_id)
            AND (
                v_user_role IN ('superadmin', 'manager')
                OR (v_user_role = 'accountant' AND v_assigned_districts IS NOT NULL AND s.district = ANY(v_assigned_districts))
            )
    ),
    workflow_data AS (
        SELECT spw.* FROM school_project_workflow spw
        WHERE spw.project_id = p_project_id
    )
    SELECT
        COUNT(DISTINCT fs.id)::bigint as total_schools,
        COUNT(DISTINCT CASE WHEN COALESCE(wd.courier_status, fs.courier_status) = 'Sent' THEN fs.id END)::bigint as courier_sent,
        COUNT(DISTINCT CASE WHEN COALESCE(wd.courier_status, fs.courier_status) = 'Returned' THEN fs.id END)::bigint as courier_returned,
        COUNT(DISTINCT CASE WHEN COALESCE(wd.contacted, fs.contacted) = 'Yes' THEN fs.id END)::bigint as contacted_yes,
        COUNT(DISTINCT CASE WHEN COALESCE(wd.contacted, fs.contacted) = 'No' THEN fs.id END)::bigint as contacted_no,
        COUNT(DISTINCT CASE WHEN COALESCE(wd.registration_interest, fs.registration_interest) = 'Interested' THEN fs.id END)::bigint as registration_interested,
        COUNT(DISTINCT CASE WHEN COALESCE(wd.registration_interest, fs.registration_interest) = 'Not Interested' THEN fs.id END)::bigint as registration_not_interested,
        COUNT(DISTINCT CASE WHEN COALESCE(wd.consent_form_requested, fs.consent_form_requested) = 'Yes' THEN fs.id END)::bigint as consent_requested,
        COUNT(DISTINCT CASE WHEN COALESCE(wd.consent_form_sent, fs.consent_form_sent) IS NOT NULL THEN fs.id END)::bigint as consent_form_sent_total,
        COUNT(DISTINCT CASE WHEN COALESCE(wd.consent_form_sent, fs.consent_form_sent) = 'Sent' THEN fs.id END)::bigint as consent_form_sent_physical,
        COUNT(DISTINCT CASE WHEN COALESCE(wd.consent_form_sent, fs.consent_form_sent) = 'Sent Digitally' THEN fs.id END)::bigint as consent_form_sent_digital,
        COUNT(DISTINCT CASE WHEN COALESCE(wd.registration_status, fs.registration_status) = 'Confirmed' THEN fs.id END)::bigint as registration_confirmed,
        COUNT(DISTINCT CASE WHEN COALESCE(wd.registration_status, fs.registration_status) = 'Pending' THEN fs.id END)::bigint as registration_pending,
        COUNT(DISTINCT CASE WHEN COALESCE(wd.registration_status, fs.registration_status) = 'In Progress' THEN fs.id END)::bigint as registration_in_progress,
        COUNT(DISTINCT CASE WHEN COALESCE(wd.name_list_status, fs.name_list_status) = 'Received' THEN fs.id END)::bigint as name_list_received,
        COUNT(DISTINCT CASE WHEN COALESCE(wd.name_list_status, fs.name_list_status) = 'Uploaded' THEN fs.id END)::bigint as name_list_uploaded,
        COUNT(DISTINCT CASE WHEN COALESCE(wd.payment_status, fs.payment_status) = 'Received' THEN fs.id END)::bigint as payment_received,
        COUNT(DISTINCT CASE WHEN COALESCE(wd.question_paper_sent, fs.question_paper_sent) = 'Sent' THEN fs.id END)::bigint as question_paper_sent,
        COUNT(DISTINCT CASE WHEN COALESCE(wd.answer_sheet_status, fs.answer_sheet_status) = 'Received' THEN fs.id END)::bigint as answer_sheet_received,
        COUNT(DISTINCT CASE WHEN COALESCE(wd.result_status, fs.result_status) = 'Sent' THEN fs.id END)::bigint as result_sent,
        COUNT(DISTINCT CASE WHEN COALESCE(wd.brochure_delivery_status, fs.brochure_delivery_status) = 'Physical Only' THEN fs.id END)::bigint as brochure_physical_only,
        COUNT(DISTINCT CASE WHEN COALESCE(wd.brochure_delivery_status, fs.brochure_delivery_status) = 'Digital Sent' THEN fs.id END)::bigint as brochure_digital_sent,
        COUNT(DISTINCT CASE WHEN COALESCE(wd.brochure_delivery_status, fs.brochure_delivery_status) = 'Both Physical & Digital' THEN fs.id END)::bigint as brochure_both_physical_digital,
        -- Count actual student registrations from student_registrations table
        (SELECT COUNT(*)::bigint FROM student_registrations sr WHERE sr.project_id = p_project_id)::bigint as total_registrations
    FROM filtered_schools fs
    LEFT JOIN workflow_data wd ON fs.id = wd.school_id;
END;
$$;