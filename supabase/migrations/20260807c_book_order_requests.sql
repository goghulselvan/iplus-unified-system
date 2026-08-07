-- Book Order Requests: schools order books via the portal (separate, not-yet-written spec);
-- this migration is the shared schema both the portal and the Sales module read/write through.

CREATE TABLE IF NOT EXISTS public.product_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id),
  notes text,
  payment_amount numeric NOT NULL,
  payment_mode text NOT NULL,
  payment_date date NOT NULL,
  payment_utr_reference text,
  payment_account_holder_name text,
  payment_screenshot_url text NOT NULL,
  payment_status text NOT NULL DEFAULT 'pending' CHECK (payment_status IN ('pending','confirmed','resubmit_requested')),
  payment_review_note text,
  payment_reviewed_by uuid,
  payment_reviewed_at timestamptz,
  confirmed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.product_orders ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.product_order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.product_orders(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id),
  quantity integer NOT NULL CHECK (quantity > 0),
  unit_price numeric NOT NULL CHECK (unit_price >= 0),
  line_status text NOT NULL DEFAULT 'pending' CHECK (line_status IN ('pending','invoiced_unpaid','paid','dispatched','rejected')),
  invoice_id uuid REFERENCES public.invoices(id),
  rejected_reason text,
  rejected_by uuid,
  rejected_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.product_order_items ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_product_order_items_order_id ON public.product_order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_product_order_items_invoice_id ON public.product_order_items(invoice_id);

ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS dispatched_at timestamptz;

-- Staff (CRM) can read every order.
DROP POLICY IF EXISTS "product_orders_select_staff" ON public.product_orders;
CREATE POLICY "product_orders_select_staff" ON public.product_orders FOR SELECT USING (is_crm_user());
DROP POLICY IF EXISTS "product_order_items_select_staff" ON public.product_order_items;
CREATE POLICY "product_order_items_select_staff" ON public.product_order_items FOR SELECT USING (is_crm_user());

-- School (portal) can read only its own orders — for the not-yet-written portal side.
DROP POLICY IF EXISTS "product_orders_select_school" ON public.product_orders;
CREATE POLICY "product_orders_select_school" ON public.product_orders FOR SELECT USING (school_id = get_portal_school_id());
DROP POLICY IF EXISTS "product_order_items_select_school" ON public.product_order_items;
CREATE POLICY "product_order_items_select_school" ON public.product_order_items FOR SELECT USING (
  order_id IN (SELECT id FROM public.product_orders WHERE school_id = get_portal_school_id())
);
-- No direct INSERT/UPDATE policies for either role — every write goes through a SECURITY DEFINER RPC.
