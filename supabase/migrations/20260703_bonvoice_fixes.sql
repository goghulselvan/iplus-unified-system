-- Add unique constraint to prevent duplicate schools in a campaign
ALTER TABLE voice_campaign_schools
  ADD CONSTRAINT vcs_campaign_school_unique UNIQUE (campaign_id, prospect_school_id);

-- Extend increment function to support answered_count
CREATE OR REPLACE FUNCTION increment_voice_campaign_counts(
  p_campaign_id uuid,
  p_sent      int DEFAULT 0,
  p_failed    int DEFAULT 0,
  p_answered  int DEFAULT 0
) RETURNS void LANGUAGE sql SECURITY DEFINER AS $$
  UPDATE voice_campaigns
  SET sent_count     = sent_count     + p_sent,
      failed_count   = failed_count   + p_failed,
      answered_count = answered_count + p_answered
  WHERE id = p_campaign_id;
$$;
