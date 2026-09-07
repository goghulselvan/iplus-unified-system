-- Surface the advance-payment columns on credit_notes_with_balance so the
-- Credit Notes page and the credit-note PDF can read them in one query.
-- New columns are appended after remaining_balance (CREATE OR REPLACE VIEW rule).

CREATE OR REPLACE VIEW public.credit_notes_with_balance AS
  SELECT
    cn.id,
    cn.credit_note_number,
    cn.fy,
    cn.school_id,
    cn.source_return_id,
    cn.amount,
    cn.note,
    cn.created_by,
    cn.created_at,
    cn.amount - COALESCE((
      SELECT sum(ca.amount) FROM credit_note_applications ca WHERE ca.credit_note_id = cn.id
    ), 0::numeric) AS remaining_balance,
    cn.source,
    cn.payment_mode,
    cn.payment_date,
    cn.payment_reference,
    cn.payment_screenshot_url
  FROM public.credit_notes cn;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260907b', 'credit_notes_view_source')
ON CONFLICT (version) DO NOTHING;
