-- Let an email template carry its own attachment, mirroring what
-- whatsapp_templates already does with header_media_url /
-- header_document_filename. The attachment belongs to the template, not to the
-- campaign: the Level 1 circular PDF goes with the Level 1 circular email every
-- time it is sent, and Slot 2's template will carry its own PDF without anyone
-- re-entering a URL.
--
-- send-template-email already accepts attachmentUrl/attachmentFilename and
-- hands the URL to Resend, which fetches it server-side — so a 2MB PDF never
-- gets base64'd inside the edge function.

ALTER TABLE public.communication_templates
  ADD COLUMN IF NOT EXISTS attachment_url text,
  ADD COLUMN IF NOT EXISTS attachment_filename text;

COMMENT ON COLUMN public.communication_templates.attachment_url IS
  'Public URL of a file to attach when this template is sent. Resend fetches it; it must be publicly readable (the downloads bucket is).';
COMMENT ON COLUMN public.communication_templates.attachment_filename IS
  'Filename the recipient sees for attachment_url. Defaults to attachment.pdf if null.';
