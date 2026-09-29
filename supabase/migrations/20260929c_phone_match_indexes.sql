-- get_whatsapp_conversations timed out for real users (8s authenticated
-- statement_timeout) — root cause: it LATERAL-joins match_phone_all() once
-- per distinct conversation phone (~185 today), and that function does an
-- unindexed sequential scan of prospect_schools (55,733 rows, confirmed via
-- EXPLAIN ANALYZE: 44.5ms per call, Seq Scan, "Rows Removed by Filter: 55733")
-- plus schools (167 rows, cheap already) for every single call. ~185 calls x
-- ~45ms just for the prospect half alone is already past the timeout on its
-- own. These expression indexes turn each call into an index scan instead.
CREATE INDEX IF NOT EXISTS idx_prospect_schools_phone_last10
  ON prospect_schools (right(regexp_replace(COALESCE(mobile, ''), '\D', '', 'g'), 10));

CREATE INDEX IF NOT EXISTS idx_schools_mobile1_last10
  ON schools (right(regexp_replace(COALESCE(mobile1, ''), '\D', '', 'g'), 10));

CREATE INDEX IF NOT EXISTS idx_schools_mobile2_last10
  ON schools (right(regexp_replace(COALESCE(mobile2, ''), '\D', '', 'g'), 10));

-- Same normalized-phone pattern is used directly in get_whatsapp_conversations/
-- get_whatsapp_thread's own UNION branches (small tables today, but this
-- keeps them index-backed as they grow instead of degrading the same way).
CREATE INDEX IF NOT EXISTS idx_communications_mobile_last10
  ON communications (right(regexp_replace(COALESCE(contacted_mobile_no, ''), '\D', '', 'g'), 10));

CREATE INDEX IF NOT EXISTS idx_wa_replies_phone_last10
  ON wa_replies (right(regexp_replace(COALESCE(phone, ''), '\D', '', 'g'), 10));

CREATE INDEX IF NOT EXISTS idx_wa_reply_responses_phone_last10
  ON wa_reply_responses (right(regexp_replace(COALESCE(phone, ''), '\D', '', 'g'), 10));
