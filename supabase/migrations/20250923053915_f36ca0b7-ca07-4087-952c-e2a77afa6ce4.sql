-- Add DELETE policy for payment_transactions (superadmin only)
CREATE POLICY "Only superadmins can delete payment transactions"
ON public.payment_transactions FOR DELETE
TO authenticated
USING (is_superadmin(auth.uid()));

-- Ensure the auto-recalculate trigger covers DELETE operations
DROP TRIGGER IF EXISTS payment_transactions_recalculate ON public.payment_transactions;
CREATE TRIGGER payment_transactions_recalculate
  AFTER INSERT OR UPDATE OR DELETE ON public.payment_transactions
  FOR EACH ROW EXECUTE FUNCTION public.auto_recalculate_payment_totals();