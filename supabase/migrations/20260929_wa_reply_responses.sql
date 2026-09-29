-- Logs freeform WhatsApp replies staff send back from the Message Centre's
-- "Needs Reply" tab. Deliberately NOT the `communications` table — that
-- table requires a real school_id + project_id (NOT NULL), but most
-- wa_replies rows come from prospect campaigns or unmatched numbers with no
-- resolvable CRM school. This stays scoped to what's actually known: the
-- phone number and the wa_replies thread it answers.
CREATE TABLE IF NOT EXISTS wa_reply_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wa_reply_id uuid REFERENCES wa_replies(id) ON DELETE SET NULL,
  phone text NOT NULL,
  message_text text NOT NULL,
  wamid text,
  sent_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wa_reply_responses_wa_reply_id ON wa_reply_responses(wa_reply_id);
CREATE INDEX IF NOT EXISTS idx_wa_reply_responses_phone ON wa_reply_responses(phone);

ALTER TABLE wa_reply_responses ENABLE ROW LEVEL SECURITY;

-- Staff-only, matching every other internal comms table's access pattern.
CREATE POLICY "CRM staff can view reply responses" ON wa_reply_responses
  FOR SELECT USING (is_crm_user());
