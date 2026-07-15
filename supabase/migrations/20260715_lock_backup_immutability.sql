-- 20260715_lock_backup_immutability.sql
-- Manual backups must be undeletable by ANY role, including superadmin.
-- Only the service-role edge function (which bypasses RLS entirely) may
-- ever delete a row/object, and its cleanup logic only ever targets
-- backup_type='daily' rows older than the retention window — see
-- database-backup/index.ts cleanupOldBackups(). No DELETE policy is
-- created here on purpose: that is the enforcement mechanism.

-- ===== public.database_backups =====
-- RLS is already enabled on this table on the live project but has no
-- policies (confirmed via pg_policies), so today it silently returns
-- zero rows to any authenticated client. Add SELECT so superadmins can
-- actually see backups in the CRM UI.
DROP POLICY IF EXISTS "Superadmins can view database backup records" ON public.database_backups;
CREATE POLICY "Superadmins can view database backup records"
ON public.database_backups
FOR SELECT
TO authenticated
USING (is_superadmin());

-- No INSERT/UPDATE/DELETE policy for any client role. Row creation and
-- the 30-day automatic cleanup happen exclusively via the edge
-- function's service-role client, which bypasses RLS.

-- ===== storage.objects (bucket: database-backups) =====
DROP POLICY IF EXISTS "Superadmins can view backup files" ON storage.objects;
CREATE POLICY "Superadmins can view backup files"
ON storage.objects
FOR SELECT
TO authenticated
USING (bucket_id = 'database-backups' AND is_superadmin());

-- No INSERT/UPDATE/DELETE storage policy for any client role. Uploads
-- and the 30-day automatic cleanup happen exclusively via the edge
-- function's service-role client, which bypasses storage RLS too.
