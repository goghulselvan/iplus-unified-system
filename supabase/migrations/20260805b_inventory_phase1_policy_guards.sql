-- Idempotency fix: add DROP POLICY IF EXISTS guards so this can be safely re-run,
-- matching the convention already used in 20260728_sales_module.sql.
DROP POLICY IF EXISTS "crm_users_read_product_categories" ON public.product_categories;
CREATE POLICY "crm_users_read_product_categories" ON public.product_categories
  FOR SELECT USING (is_crm_user());

DROP POLICY IF EXISTS "crm_users_write_product_categories" ON public.product_categories;
CREATE POLICY "crm_users_write_product_categories" ON public.product_categories
  FOR ALL USING (is_crm_user()) WITH CHECK (is_crm_user());
