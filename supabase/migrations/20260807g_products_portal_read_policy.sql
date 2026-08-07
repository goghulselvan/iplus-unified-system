-- Portal schools need to browse the product catalog to place book orders.
-- products currently only has SELECT policies for is_crm_user() (staff) —
-- this adds read access for an authenticated, school-linked portal session,
-- scoped to active products only.

DROP POLICY IF EXISTS "products_select_portal" ON public.products;
CREATE POLICY "products_select_portal" ON public.products
  FOR SELECT USING (is_active = true AND get_portal_school_id() IS NOT NULL);
