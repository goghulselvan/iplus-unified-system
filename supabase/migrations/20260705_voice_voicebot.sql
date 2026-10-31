-- Voice campaign: add voicebot support + AI call logging columns

-- 1. campaign_type: 'tts' (existing) or 'voicebot' (AI live conversation)
ALTER TABLE voice_campaigns
  ADD COLUMN IF NOT EXISTS campaign_type text DEFAULT 'tts'
  CHECK (campaign_type IN ('tts', 'voicebot'));

-- 2. AI transcript + summary stored per call log
ALTER TABLE bonvoice_call_logs
  ADD COLUMN IF NOT EXISTS transcript       text,
  ADD COLUMN IF NOT EXISTS ai_summary       text,
  ADD COLUMN IF NOT EXISTS outcome          text,
  ADD COLUMN IF NOT EXISTS direction        text DEFAULT 'outbound',
  ADD COLUMN IF NOT EXISTS language_used    text,
  ADD COLUMN IF NOT EXISTS transfer_reason  text;

-- 3. Inbound call logs (direction = 'inbound') need no school ID initially
-- prospect_school_id is already nullable — no change needed.

-- 4. Index on direction for inbound call queries
CREATE INDEX IF NOT EXISTS idx_bcl_direction ON bonvoice_call_logs(direction);
CREATE INDEX IF NOT EXISTS idx_bcl_outcome   ON bonvoice_call_logs(outcome);
