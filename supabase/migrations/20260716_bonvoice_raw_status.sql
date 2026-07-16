-- Capture Bonvoice's raw callee/caller statuses (ANSWERED/NOANSWER/BUSY/NOINPUT/NO_CHANNEL)
-- from the webhook's Status/AgentStatus fields — richer than the callType-derived status.
ALTER TABLE bonvoice_call_logs
  ADD COLUMN IF NOT EXISTS bonvoice_status text,
  ADD COLUMN IF NOT EXISTS agent_status text;
