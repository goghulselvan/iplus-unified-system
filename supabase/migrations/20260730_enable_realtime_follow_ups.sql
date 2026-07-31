-- follow_ups was never added to the supabase_realtime publication, so the
-- postgres_changes subscription in useFollowUps.ts silently never fired.
-- The Follow-ups list only ever updated via its 60s poll or a manual page
-- refresh. Adding it here makes list updates live.
alter publication supabase_realtime add table public.follow_ups;
