-- Update the view to only show registrations for schools with name list received
DROP VIEW IF EXISTS accountant_payment_view;

CREATE VIEW accountant_payment_view AS
SELECT 
  s.id,
  s.ss_no,
  s.school_name,
  s.district,
  s.state,
  s.payment_date,
  s.payment_amount,
  s.payment_mode,
  s.created_at,
  s.updated_at,
  CASE 
    WHEN s.name_list_status = 'Received' THEN COALESCE((
      SELECT COUNT(*) 
      FROM student_registrations sr 
      WHERE sr.school_id = s.id
    ), 0)
    ELSE 0
  END as registration_count
FROM schools s
WHERE s.payment_status = 'Received'
ORDER BY s.payment_date DESC, s.ss_no;

-- Update the metrics function to only count registrations from schools with name list received
CREATE OR REPLACE FUNCTION public.get_accountant_dashboard_metrics()
 RETURNS TABLE(total_paid_schools bigint, total_registrations bigint, total_payment_amount numeric)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT 
    COUNT(*) as total_paid_schools,
    COALESCE(SUM(
      CASE 
        WHEN s.name_list_status = 'Received' THEN (
          SELECT COUNT(*) 
          FROM student_registrations sr 
          WHERE sr.school_id = s.id
        )
        ELSE 0
      END
    ), 0) as total_registrations,
    COALESCE(SUM(s.payment_amount), 0) as total_payment_amount
  FROM schools s
  WHERE s.payment_status = 'Received';
$function$;