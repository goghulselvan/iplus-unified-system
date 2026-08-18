-- Reject an ENTIRE book order in one action (superadmin-only), for cases like a
-- school miscounting their order. Distinct from the existing reject_order_items
-- (per-line, any CRM user, no notification) — this rejects every currently-pending
-- line on the order and is meant to be paired with a WA+email notification so the
-- school knows their order was rejected and why.
CREATE OR REPLACE FUNCTION public.reject_entire_order(p_order_id uuid, p_reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  IF NOT is_superadmin(auth.uid()) THEN
    RAISE EXCEPTION 'Only iPlus superadmins can reject an entire order';
  END IF;
  IF p_reason IS NULL OR trim(p_reason) = '' THEN
    RAISE EXCEPTION 'A reason is required';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM product_orders WHERE id = p_order_id) THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  SELECT count(*) INTO v_count
  FROM product_order_items
  WHERE order_id = p_order_id AND line_status = 'pending';
  IF v_count = 0 THEN
    RAISE EXCEPTION 'No pending items on this order to reject — items already invoiced, paid or dispatched cannot be rejected this way';
  END IF;

  UPDATE product_order_items
  SET line_status = 'rejected',
      rejected_reason = trim(p_reason),
      rejected_by = auth.uid(),
      rejected_at = now()
  WHERE order_id = p_order_id AND line_status = 'pending';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.reject_entire_order(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reject_entire_order(uuid, text) TO authenticated, service_role;

-- Email notification template — fires immediately, no external approval needed.
INSERT INTO communication_templates
  (project_id, template_type, template_name, subject, email_body, template_category, is_active, created_by)
SELECT
  'dd5de83d-64f8-4113-a231-27024058396b',
  'book_order_rejected',
  'Book Order Rejected',
  'Order Rejected — #{order_ref} — iPlus Olympiads',
  '<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="margin:0;padding:0;background:#f0f0f5;font-family:''Helvetica Neue'',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:40px 16px;">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 8px 40px rgba(220,38,38,.12);">
<tr><td style="background:linear-gradient(135deg,#dc2626 0%,#b91c1c 100%);padding:44px 48px;text-align:center;">
<div style="font-size:11px;font-weight:700;color:rgba(255,255,255,.6);letter-spacing:3px;text-transform:uppercase;margin-bottom:12px;">𝓲Plus Olympiads</div>
<div style="font-size:30px;font-weight:800;color:#ffffff;letter-spacing:-1px;line-height:1.2;">Order<br>Rejected</div>
<div style="font-size:13px;color:rgba(255,255,255,.75);margin-top:10px;">Order #{order_ref}</div>
</td></tr>
<tr><td style="padding:0;text-align:center;background:#fef2f2;">
<div style="padding:14px 24px;font-size:12px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#991b1b;">&#10007;&nbsp;&nbsp;ORDER REJECTED</div>
</td></tr>
<tr><td style="padding:40px 48px;">
<p style="margin:0 0 20px;font-size:16px;color:#111827;font-weight:600;">Dear {school_name},</p>
<p style="margin:0 0 20px;font-size:15px;color:#374151;line-height:1.8;">Your book order <strong>#{order_ref}</strong> could not be processed and has been rejected.</p>
<table width="100%" cellpadding="0" cellspacing="0" style="background:#fef2f2;border:1px solid #fecaca;border-left:4px solid #dc2626;border-radius:0 10px 10px 0;margin:24px 0;">
<tr><td style="padding:20px 24px;">
<div style="font-size:11px;font-weight:700;color:#991b1b;letter-spacing:2px;text-transform:uppercase;margin-bottom:10px;">Reason</div>
<div style="font-size:14px;color:#111827;line-height:1.7;">{reason}</div>
</td></tr></table>
<p style="margin:0 0 12px;font-size:15px;color:#374151;line-height:1.8;">Please review your order and get in touch with us to place a corrected order. We''re happy to help.</p>
</td></tr>
<tr><td style="padding:0 48px;"><hr style="border:none;border-top:1px solid #f3f4f6;margin:0;"></td></tr>
<tr><td style="padding:28px 48px;text-align:center;background:#fafafa;">
<p style="margin:0 0 6px;font-size:14px;font-weight:800;color:#4f46e5;">𝓲Plus Olympiads</p>
<p style="margin:0 0 4px;font-size:11px;color:#9ca3af;">Ivar Pro Learn for Universal Success Pvt. Ltd.</p>
<p style="margin:0 0 16px;font-size:12px;"><a href="mailto:contact@iplusedu.in" style="color:#4f46e5;text-decoration:none;font-weight:600;">contact@iplusedu.in</a>&nbsp;&nbsp;|&nbsp;&nbsp;<span style="color:#6b7280;">+91 81110 66556</span></p>
<p style="margin:0;font-size:10px;color:#d1d5db;">&copy; 2026 𝓲Plus Olympiads. All rights reserved.</p>
</td></tr>
</table></td></tr></table></body></html>',
  'marketing',
  true,
  '8dd2a8b7-1349-4e7e-b821-3171bd6bf2cc'
WHERE NOT EXISTS (
  SELECT 1 FROM communication_templates
  WHERE project_id = 'dd5de83d-64f8-4113-a231-27024058396b' AND template_type = 'book_order_rejected'
);

-- WhatsApp notification template — inserted INACTIVE. AskEVA/Meta templates need
-- separate approval before they can send (unlike email, this can't just be turned
-- on by inserting a row) — see feedback_notification_template_gotchas memory.
-- Submit "book_order_rejected" for approval via Template Management, confirm the
-- askeva_template_name Meta actually approves it under, then flip is_active true.
INSERT INTO whatsapp_templates
  (project_id, template_key, template_name, askeva_template_name, template_type, language_code, body_variables, template_category, is_active, created_by)
SELECT
  'dd5de83d-64f8-4113-a231-27024058396b',
  'book_order_rejected',
  'Book Order Rejected',
  'book_order_rejected',
  'text_with_vars',
  'en',
  '[{"index":1,"source":"school_name"},{"index":2,"source":"order_ref"},{"index":3,"source":"reason"}]'::jsonb,
  'marketing',
  false,
  '8dd2a8b7-1349-4e7e-b821-3171bd6bf2cc'
WHERE NOT EXISTS (
  SELECT 1 FROM whatsapp_templates
  WHERE project_id = 'dd5de83d-64f8-4113-a231-27024058396b' AND template_key = 'book_order_rejected'
);
