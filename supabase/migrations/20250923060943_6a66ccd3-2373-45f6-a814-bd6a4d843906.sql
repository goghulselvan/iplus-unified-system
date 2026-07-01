-- Run the recalculation function to update all existing schools with new payment status logic
SELECT public.recalculate_all_school_payment_totals();