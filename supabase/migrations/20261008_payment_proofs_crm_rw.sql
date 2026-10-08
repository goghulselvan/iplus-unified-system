-- payment-proofs granted CRM staff INSERT only (crm_staff_upload_payment_proof).
-- Superadmin was unaffected because superadmin_all_payment_proofs_bucket is an
-- ALL policy, which is why this only ever failed for other roles and looked
-- like it worked.
--
-- Two things break for a manager or accountant creating a Manual Order Request:
--
--   1. ManualOrderDialog uploads with { upsert: true }. An upsert is
--      INSERT ... ON CONFLICT DO UPDATE, so Postgres needs an UPDATE policy as
--      well. Without one the storage API returns, verbatim,
--      "new row violates row-level security policy" — which the dialog shows
--      to the user as an Upload failed toast.
--
--   2. The next line calls createSignedUrl() to get a 2-year link to store on
--      the order. Signing requires SELECT on the object. With no SELECT policy
--      the call returns nothing and the order is abandoned with
--      "Failed to prepare the uploaded file".
--
-- Both are scoped to the bucket and to is_crm_user(), matching the existing
-- upload policy. Portal schools keep their own narrower own-folder policies.

CREATE POLICY crm_staff_read_payment_proof
  ON storage.objects
  FOR SELECT
  USING (bucket_id = 'payment-proofs' AND public.is_crm_user());

CREATE POLICY crm_staff_update_payment_proof
  ON storage.objects
  FOR UPDATE
  USING (bucket_id = 'payment-proofs' AND public.is_crm_user())
  WITH CHECK (bucket_id = 'payment-proofs' AND public.is_crm_user());
