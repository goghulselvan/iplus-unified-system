-- Call logs for Click2Call and TTS individual calls
CREATE TABLE IF NOT EXISTS bonvoice_call_logs (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  prospect_school_id uuid REFERENCES prospect_schools(id),
  event_id text UNIQUE,
  call_id text,
  staff_phone text,
  school_phone text,
  call_mode text,         -- 'click2call' | 'tts' | 'voicebot'
  speech_content text,
  status text DEFAULT 'initiated',  -- initiated | ringing | answered | completed | no_answer | failed
  start_time timestamptz,
  end_time timestamptz,
  call_duration int,      -- seconds
  dtmf text,
  resource_url text,      -- recording URL
  created_at timestamptz DEFAULT now(),
  created_by uuid REFERENCES auth.users(id)
);

-- Bulk TTS voice campaigns
CREATE TABLE IF NOT EXISTS voice_campaigns (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  speech_content text NOT NULL,
  speech_language text DEFAULT 'ENGLISH',
  caller_id text,
  status text DEFAULT 'draft',  -- draft | sending | sent | paused
  total_count int DEFAULT 0,
  sent_count int DEFAULT 0,
  answered_count int DEFAULT 0,
  failed_count int DEFAULT 0,
  audience_filters jsonb,
  created_at timestamptz DEFAULT now(),
  created_by uuid REFERENCES auth.users(id)
);

-- Schools enrolled in a voice campaign
CREATE TABLE IF NOT EXISTS voice_campaign_schools (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  campaign_id uuid REFERENCES voice_campaigns(id) ON DELETE CASCADE,
  prospect_school_id uuid REFERENCES prospect_schools(id),
  phone text NOT NULL,
  event_id text UNIQUE,
  status text DEFAULT 'pending',  -- pending | calling | answered | no_answer | failed
  call_duration int,
  dtmf text,
  sent_at timestamptz,
  created_at timestamptz DEFAULT now()
);

-- RLS
ALTER TABLE bonvoice_call_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE voice_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE voice_campaign_schools ENABLE ROW LEVEL SECURITY;

CREATE POLICY "crm_read_call_logs"    ON bonvoice_call_logs    FOR SELECT USING (is_crm_user());
CREATE POLICY "crm_insert_call_logs"  ON bonvoice_call_logs    FOR INSERT WITH CHECK (is_crm_user());
CREATE POLICY "crm_read_vc"           ON voice_campaigns        FOR SELECT USING (is_crm_user());
CREATE POLICY "crm_manage_vc"         ON voice_campaigns        FOR ALL    USING (is_crm_user());
CREATE POLICY "crm_read_vcs"          ON voice_campaign_schools FOR SELECT USING (is_crm_user());
CREATE POLICY "crm_manage_vcs"        ON voice_campaign_schools FOR ALL    USING (is_crm_user());

CREATE INDEX IF NOT EXISTS idx_bcl_event_id  ON bonvoice_call_logs(event_id);
CREATE INDEX IF NOT EXISTS idx_bcl_school    ON bonvoice_call_logs(prospect_school_id);
CREATE INDEX IF NOT EXISTS idx_vcs_event     ON voice_campaign_schools(event_id);
CREATE INDEX IF NOT EXISTS idx_vcs_campaign  ON voice_campaign_schools(campaign_id);

-- Atomic counter update for voice campaigns
CREATE OR REPLACE FUNCTION increment_voice_campaign_counts(
  p_campaign_id uuid,
  p_sent int DEFAULT 0,
  p_failed int DEFAULT 0
) RETURNS void LANGUAGE sql SECURITY DEFINER AS $$
  UPDATE voice_campaigns
  SET sent_count   = sent_count   + p_sent,
      failed_count = failed_count + p_failed
  WHERE id = p_campaign_id;
$$;

-- Populate voice campaign audience from prospect_schools (mobile only, active only)
CREATE OR REPLACE FUNCTION populate_voice_campaign_audience(p_campaign_id uuid)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_filters  jsonb;
  v_state    text;
  v_district text;
  v_board    text;
  v_count    int;
BEGIN
  SELECT audience_filters INTO v_filters
  FROM voice_campaigns WHERE id = p_campaign_id;

  v_state    := v_filters->>'state';
  v_district := v_filters->>'district';
  v_board    := v_filters->>'board';

  INSERT INTO voice_campaign_schools (campaign_id, prospect_school_id, phone)
  SELECT p_campaign_id, ps.id, ps.mobile
  FROM prospect_schools ps
  WHERE ps.mobile IS NOT NULL
    AND length(ps.mobile) = 10
    AND COALESCE(ps.is_active, true) = true
    AND (v_state    IS NULL OR ps.state    = v_state)
    AND (v_district IS NULL OR ps.district = v_district)
    AND (v_board    IS NULL OR ps.board    = v_board)
  ON CONFLICT DO NOTHING;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  UPDATE voice_campaigns SET total_count = v_count WHERE id = p_campaign_id;

  RETURN v_count;
END;
$$;
