-- Public storage bucket for pre-recorded FAQ audio files
-- Files: faq-audio/{lang}/{intent}.mulaw
-- Populated by calling generate-faq-audio edge function once.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'faq-audio',
  'faq-audio',
  true,
  524288, -- 512 KB max per file (mulaw audio is small)
  ARRAY['audio/x-mulaw', 'audio/basic', 'application/octet-stream']
)
ON CONFLICT (id) DO UPDATE SET
  public             = true,
  file_size_limit    = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Allow public reads (voicebot server fetches without auth)
CREATE POLICY "Public read faq-audio"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'faq-audio');

-- Only service role can upload (generate-faq-audio uses service role key)
CREATE POLICY "Service role upload faq-audio"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'faq-audio');

CREATE POLICY "Service role update faq-audio"
  ON storage.objects FOR UPDATE
  USING (bucket_id = 'faq-audio');
