-- Returns & Exchanges: return tracking, credit notes, and the ledger of how
-- each credit note gets used. See docs/superpowers/specs/2026-08-21-returns-exchanges-design.md.

CREATE TABLE public.product_returns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_line_item_id uuid NOT NULL REFERENCES public.invoice_line_items(id),
  quantity integer NOT NULL CHECK (quantity > 0),
  reason_category text NOT NULL CHECK (reason_category IN (
    'wrong_item_shipped', 'wrong_item_ordered_by_staff', 'damaged_in_transit', 'other'
  )),
  reason_note text,
  status text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'received')),
  condition_on_receipt text CHECK (condition_on_receipt IN ('resellable', 'damaged')),
  requested_by uuid NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  received_by uuid,
  received_at timestamptz,
  CONSTRAINT product_returns_condition_set_on_receipt CHECK (
    (status = 'requested' AND condition_on_receipt IS NULL) OR
    (status = 'received' AND condition_on_receipt IS NOT NULL)
  )
);
ALTER TABLE public.product_returns ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_product_returns_invoice_line_item_id ON public.product_returns(invoice_line_item_id);
CREATE INDEX idx_product_returns_status ON public.product_returns(status);

DROP POLICY IF EXISTS "product_returns_select" ON public.product_returns;
CREATE POLICY "product_returns_select" ON public.product_returns FOR SELECT USING (is_crm_user());
-- No insert/update policy — all writes go through report_return/confirm_return_received.

CREATE TABLE public.credit_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  credit_note_number integer,
  fy smallint,
  school_id uuid NOT NULL REFERENCES public.schools(id),
  source_return_id uuid NOT NULL REFERENCES public.product_returns(id),
  amount numeric NOT NULL CHECK (amount > 0),
  note text,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.credit_notes ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_credit_notes_school_id ON public.credit_notes(school_id);

DROP POLICY IF EXISTS "credit_notes_select" ON public.credit_notes;
CREATE POLICY "credit_notes_select" ON public.credit_notes FOR SELECT USING (is_crm_user());
-- No insert/update policy — only confirm_return_received (SECURITY DEFINER) mints these.

CREATE TABLE public.credit_note_fy_counters (
  fy smallint PRIMARY KEY,
  last_no integer NOT NULL DEFAULT 0
);
ALTER TABLE public.credit_note_fy_counters ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.credit_note_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  credit_note_id uuid NOT NULL REFERENCES public.credit_notes(id),
  application_type text NOT NULL CHECK (application_type IN ('invoice', 'refund')),
  amount numeric NOT NULL CHECK (amount > 0),
  applied_to_invoice_id uuid REFERENCES public.invoices(id),
  refund_mode text,
  refund_reference text,
  note text,
  recorded_by uuid NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT credit_note_applications_shape_check CHECK (
    (application_type = 'invoice' AND applied_to_invoice_id IS NOT NULL AND refund_mode IS NULL) OR
    (application_type = 'refund' AND applied_to_invoice_id IS NULL AND refund_mode IS NOT NULL)
  )
);
ALTER TABLE public.credit_note_applications ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_credit_note_applications_credit_note_id ON public.credit_note_applications(credit_note_id);

DROP POLICY IF EXISTS "credit_note_applications_select" ON public.credit_note_applications;
CREATE POLICY "credit_note_applications_select" ON public.credit_note_applications FOR SELECT USING (is_crm_user());
-- No insert/update policy — only approve_order_items / issue_credit_refund (SECURITY DEFINER) write these.

-- Remaining balance is always computed, never stored, so it can't drift from its
-- applications. security_invoker is mandatory — see Global Constraints.
CREATE VIEW public.credit_notes_with_balance
WITH (security_invoker = true) AS
SELECT cn.*,
  cn.amount - COALESCE((
    SELECT SUM(ca.amount) FROM public.credit_note_applications ca WHERE ca.credit_note_id = cn.id
  ), 0) AS remaining_balance
FROM public.credit_notes cn;

ALTER TABLE public.product_orders
  ADD COLUMN applied_credit_note_id uuid REFERENCES public.credit_notes(id),
  ADD COLUMN applied_credit_amount numeric CHECK (applied_credit_amount IS NULL OR applied_credit_amount > 0),
  ADD COLUMN credit_applied_to_invoice boolean NOT NULL DEFAULT false;

-- Only a manual order fully covered by credit has nothing to prove. Portal intake
-- (submit_product_order) never applies credit, so its UI keeps the upload mandatory
-- in practice — this relaxes the column, not the portal's own requirement.
ALTER TABLE public.product_orders ALTER COLUMN payment_screenshot_url DROP NOT NULL;
