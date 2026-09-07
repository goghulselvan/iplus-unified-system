-- ============================================================================
-- Advance-payment credit notes                                      2026-09-07
--
-- A credit note could previously only be born from a product return
-- (credit_notes.source_return_id was NOT NULL, FK -> product_returns, and the
-- only writer was issue_credit_for_return). Schools sometimes pay a lump sum
-- in advance (e.g. one NEFT covering books + more); the unspent part needs to
-- live as store credit, independent of any order or return.
--
-- This makes source_return_id nullable, tags every credit note with a `source`
-- ('return' | 'advance_payment'), records the incoming payment's details, and
-- adds create_advance_payment_credit_note() as the standalone creation path.
-- Consumption is unchanged: credit_notes_with_balance, create_manual_product_order's
-- p_credit_note_id path, and issue_credit_refund all work as-is regardless of source.
-- ============================================================================

BEGIN;

ALTER TABLE public.credit_notes ALTER COLUMN source_return_id DROP NOT NULL;

ALTER TABLE public.credit_notes
  ADD COLUMN source text NOT NULL DEFAULT 'return'
    CHECK (source IN ('return', 'advance_payment')),
  ADD COLUMN payment_mode text,
  ADD COLUMN payment_date date,
  ADD COLUMN payment_reference text,
  ADD COLUMN payment_screenshot_url text;

ALTER TABLE public.credit_notes
  ADD CONSTRAINT credit_notes_source_shape CHECK (
    (source = 'return'          AND source_return_id IS NOT NULL) OR
    (source = 'advance_payment' AND source_return_id IS NULL)
  );

CREATE OR REPLACE FUNCTION public.create_advance_payment_credit_note(
  p_school_id         uuid,
  p_amount            numeric,
  p_note              text,
  p_payment_mode      text,
  p_payment_date      date,
  p_payment_reference text,
  p_screenshot_url    text
) RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $function$
DECLARE
  v_ist  timestamp := (now() AT TIME ZONE 'Asia/Kolkata');
  v_fy   smallint;
  v_next integer;
  v_id   uuid;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM profiles WHERE user_id = auth.uid() AND role IN ('superadmin', 'accountant')
  ) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Credit note amount must be positive';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM schools WHERE id = p_school_id) THEN
    RAISE EXCEPTION 'School not found';
  END IF;
  IF p_screenshot_url IS NULL OR trim(p_screenshot_url) = '' THEN
    RAISE EXCEPTION 'Payment proof is required';
  END IF;

  v_fy := (EXTRACT(YEAR FROM v_ist)::int % 100);
  IF EXTRACT(MONTH FROM v_ist)::int < 4 THEN
    v_fy := v_fy - 1;
  END IF;

  INSERT INTO credit_note_fy_counters AS c (fy, last_no)
  VALUES (v_fy, 1)
  ON CONFLICT (fy) DO UPDATE SET last_no = c.last_no + 1
  RETURNING c.last_no INTO v_next;

  INSERT INTO credit_notes (
    credit_note_number, fy, school_id, source_return_id, amount, note,
    source, payment_mode, payment_date, payment_reference, payment_screenshot_url,
    created_by
  ) VALUES (
    v_next, v_fy, p_school_id, NULL, p_amount, NULLIF(trim(p_note), ''),
    'advance_payment', NULLIF(trim(p_payment_mode), ''), p_payment_date,
    NULLIF(trim(p_payment_reference), ''), trim(p_screenshot_url),
    auth.uid()
  ) RETURNING id INTO v_id;

  PERFORM log_security_action(
    'ADVANCE_PAYMENT_CREDIT_NOTE_CREATED', 'credit_notes', v_id, NULL,
    jsonb_build_object(
      'school_id', p_school_id, 'amount', p_amount,
      'payment_mode', p_payment_mode, 'payment_date', p_payment_date,
      'payment_reference', p_payment_reference
    )
  );

  RETURN v_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_advance_payment_credit_note(uuid,numeric,text,text,date,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_advance_payment_credit_note(uuid,numeric,text,text,date,text,text) TO authenticated;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260907', 'advance_payment_credit_notes')
ON CONFLICT (version) DO NOTHING;

COMMIT;
