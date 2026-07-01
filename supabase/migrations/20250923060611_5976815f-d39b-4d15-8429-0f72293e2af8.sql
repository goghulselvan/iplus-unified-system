-- Check if the auto_recalculate_payment_totals trigger exists and create it if not
-- This trigger will automatically recalculate payment totals when payment transactions change

-- First, let's ensure the trigger exists on payment_transactions table
DROP TRIGGER IF EXISTS auto_recalculate_payment_totals ON public.payment_transactions;

CREATE TRIGGER auto_recalculate_payment_totals
  AFTER INSERT OR UPDATE OR DELETE ON public.payment_transactions
  FOR EACH ROW EXECUTE FUNCTION public.auto_recalculate_payment_totals();

-- Also add a function to recalculate all schools' payment totals (for existing data)
CREATE OR REPLACE FUNCTION public.recalculate_all_school_payment_totals()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  school_record RECORD;
BEGIN
  -- Recalculate for all schools that have payment transactions or expected amounts
  FOR school_record IN 
    SELECT DISTINCT id 
    FROM public.schools 
    WHERE id IN (
      SELECT school_id FROM public.payment_transactions
      UNION
      SELECT id FROM public.schools WHERE expected_amount > 0
    )
  LOOP
    PERFORM public.recalculate_school_payment_totals(school_record.id);
  END LOOP;
  
  -- Log the bulk recalculation
  PERFORM public.log_security_action(
    'BULK_PAYMENT_TOTALS_RECALCULATED',
    'schools',
    NULL,
    NULL,
    jsonb_build_object('recalculated_at', now())
  );
END;
$function$;