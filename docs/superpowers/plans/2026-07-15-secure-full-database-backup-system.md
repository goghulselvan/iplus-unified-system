# Secure Full Database Backup System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the daily automatic database backup actually run on the live project, cover every table in full (no 1000-row cap, no hardcoded table list), make manual backups truly undeletable by anyone including superadmin, extend automatic retention to 30 days, and email the daily backup to `iplusbackups@gmail.com`.

**Architecture:** The existing `database-backup` edge function and `database_backups`/`database-backups` storage bucket are kept, but hardened: table discovery becomes dynamic (`information_schema` via a new `SECURITY DEFINER` RPC), per-table fetch is paginated to bypass PostgREST's 1000-row cap, RLS is added from scratch (it does not currently exist on the live project) with SELECT-only grants — no DELETE policy is ever created for any client-facing role, so deletion is physically impossible outside the service-role cleanup job. The daily backup is additionally gzip-compressed and emailed via Resend (already used elsewhere in this codebase), falling back to a signed download link if the compressed file is too large to attach. A fresh pg_cron job replaces the dead ones (which target an abandoned Supabase project) and authenticates via a dedicated shared secret instead of a spoofable header.

**Tech Stack:** Deno edge function (Supabase), PostgreSQL/pg_cron/pg_net, Resend email SDK (`npm:resend@2.0.0`), React/TypeScript frontend (existing `useDatabaseBackups.ts` / `DatabaseBackupManager.tsx`).

## Global Constraints

- Live Supabase project: `eucjeggfclztkbbupaav` (URL `https://eucjeggfclztkbbupaav.supabase.co`). Never target `fydtsyawtimoypnekvma` (old/abandoned project) — this is the root cause of the current dead cron job.
- No Supabase CLI access to Docker/local dev in this environment and no browser session for the CRM. Apply SQL via `supabase db query --linked` (piped stdin), not `supabase db push` — `supabase migration list --linked` shows the local/remote migration history has already drifted (many rows with blank Local or blank Remote columns), so a blind `db push` risks applying or skipping unrelated migrations. Deploy the edge function via `supabase functions deploy database-backup --project-ref eucjeggfclztkbbupaav`.
- Never embed the Supabase **service role** key in any new migration file (git-committed, and this repo's `unified` remote — `goghulselvan/iplus-unified-system` — is **public**; the old backup-cron migrations already did this and it's a live exposure, separate from the already-known "rotate the key" item — do not repeat it). The anon/publishable key is fine to embed (it's already public in `src/integrations/supabase/client.ts`).
- Retention: automatic (`backup_type='daily'`) backups kept 30 days, then deleted by the service-role cleanup job only. Manual (`backup_type='manual'`) backups are permanent — no code path, RLS policy, or UI control may ever delete them.
- "A to Z" means every table in the `public` schema, discovered dynamically — no hardcoded table allowlist, no exclusions.
- Every table fetch must page in batches of 1000 rows via `.range()` regardless of table size — this is the fix for the cap the user explicitly flagged.
- Daily backup email goes only to the `BACKUP_EMAIL_TO` secret (`iplusbackups@gmail.com`), only for `backup_type='daily'`, never for manual backups.
- `is_superadmin()` on the live project is the **no-arg** form (confirmed via `pg_proc` on `eucjeggfclztkbbupaav`) — do not use `is_superadmin(auth.uid())`, that overload does not exist on this project.
- Backups are stored gzip-compressed (`.json.gz`), format NDJSON (one JSON line per table page, first line a `__meta__` marker) — not a single parseable JSON document. This is a deliberate v2.0 format change from the original plan, made after a live `WORKER_RESOURCE_LIMIT` failure proved the original single-JSON-blob approach unsafe at current data volume (see Task 4's revision note). Never reintroduce an all-in-memory, single-`JSON.stringify()` backup approach — peak memory must stay bounded to one page (≤1000 rows) regardless of total table size.

---

### Task 1: Lock down RLS so manual backups become physically undeletable (also fixes the currently-broken admin UI)

The live `database_backups` table has RLS **enabled** but **zero policies** — confirmed via `pg_policies` on `eucjeggfclztkbbupaav`. Same for the `database-backups` storage bucket (confirmed `public: false`, zero matching rows in `storage.objects` policies). This means, today, the `DatabaseBackupManager.tsx` admin page silently shows an **empty list** to a real superadmin (RLS default-denies all client-role access; only the service-role edge function can see anything) — the 5 existing manual backups are invisible in the app right now. It also means the edge function's own rate-limit check (which queries `database_backups` through the user's session, not service-role) always sees 0 rows, so the "1 backup per hour" limit currently never actually triggers.

**Files:**
- Create: `supabase/migrations/20260715_lock_backup_immutability.sql`

**Interfaces:**
- Consumes: `is_superadmin()` (no-arg, existing function on live DB)
- Produces: SELECT-only RLS policies on `public.database_backups` and `storage.objects` (bucket `database-backups`) — no INSERT/UPDATE/DELETE grants exist for any client role after this task. Task 4's edge function relies on these existing so the admin UI can list backups.

- [ ] **Step 1: Write the migration**

```sql
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
```

- [ ] **Step 2: Apply directly against the live project (not `db push` — see Global Constraints)**

Run:
```bash
supabase db query --linked < supabase/migrations/20260715_lock_backup_immutability.sql
```
Expected: no error output; the two `CREATE POLICY` statements succeed.

- [ ] **Step 3: Verify the policies exist and there is still no DELETE anywhere**

Run:
```bash
echo "SELECT tablename, policyname, cmd FROM pg_policies WHERE (tablename='database_backups') OR (tablename='objects' AND schemaname='storage' AND qual ILIKE '%database-backups%');" | supabase db query --linked
```
Expected: exactly two rows, both `cmd = 'SELECT'` — one for `database_backups`, one for `objects`. No `DELETE`/`INSERT`/`UPDATE`/`ALL` rows for either.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260715_lock_backup_immutability.sql
git commit -m "fix: lock manual database backups as permanently undeletable via RLS"
```

---

### Task 2: Fix the automatic backup cron job (currently pointed at an abandoned project) and stop trusting a spoofable header

`cron.job` on the live project (`eucjeggfclztkbbupaav`) currently has **zero** rows matching `%backup%` — confirmed via direct query. Every backup cron job in this repo's migration history targets `fydtsyawtimoypnekvma` (the old, abandoned Supabase project), dated Sept–Oct 2025, before the May 2026 unification. Nobody re-created it for the live project, so the daily 11:59 PM IST backup has never run against real data.

Separately: the edge function currently treats `X-Scheduled-Backup: true` as sufficient proof a request came from the cron job. That header has no secret behind it — anyone who discovers the function's public URL could send it and skip the superadmin/rate-limit checks entirely, triggering unlimited full-database exports. Task 4 replaces this with a real shared-secret check; this task generates that secret and wires it into both the cron job and the function's environment.

**Files:**
- Create: `supabase/migrations/20260715_fix_backup_cron_job.sql`

**Interfaces:**
- Produces: pg_cron job `daily-database-backup-11-59-pm-ist` on `eucjeggfclztkbbupaav`, firing `29 18 * * *` UTC (11:59 PM IST). Sends header `X-Scheduled-Backup-Token` whose value must exactly match the `BACKUP_CRON_SECRET` edge function secret set in Step 2 below (consumed by Task 4's auth check).

- [ ] **Step 1: Generate the shared secret**

Run:
```bash
openssl rand -hex 32
```
Copy the output (64 hex chars) — call it `<SECRET>` below. Use the same literal value in both Step 2 and Step 3.

- [ ] **Step 2: Set it as an edge function secret**

Run:
```bash
supabase secrets set BACKUP_CRON_SECRET=<SECRET> --project-ref eucjeggfclztkbbupaav
```
Expected: CLI confirms the secret was set.

- [ ] **Step 3: Write the migration, embedding the same secret and the live project's anon key**

The anon key below is already public (shipped in the browser bundle at `src/integrations/supabase/client.ts:6`) — safe to embed. The `<SECRET>` value must match Step 1/2 exactly.

```sql
-- 20260715_fix_backup_cron_job.sql
-- Remove every existing backup cron job — the old ones all point at the
-- abandoned project fydtsyawtimoypnekvma and have never run against the
-- live database.
DO $$
DECLARE
  job_record RECORD;
BEGIN
  FOR job_record IN
    SELECT jobid FROM cron.job WHERE jobname ILIKE '%backup%'
  LOOP
    PERFORM cron.unschedule(job_record.jobid);
  END LOOP;
END $$;

-- Recreate, pointed at the live project, authenticated via a shared
-- secret header (checked in database-backup/index.ts) instead of a
-- spoofable boolean header. The Authorization bearer is the public
-- anon key — the gateway just needs a valid Supabase JWT to let the
-- request through; the actual privilege check is the secret header.
SELECT cron.schedule(
  'daily-database-backup-11-59-pm-ist',
  '29 18 * * *',
  $$
  SELECT
    net.http_post(
        url := 'https://eucjeggfclztkbbupaav.supabase.co/functions/v1/database-backup',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV1Y2plZ2dmY2x6dGtiYnVwYWF2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk0Nzk1NzIsImV4cCI6MjA5NTA1NTU3Mn0.nVHEPuXB5cKzD8OiFu1TIVyC6m4nfovw_nUJOZt5TA4',
          'X-Scheduled-Backup', 'true',
          'X-Scheduled-Backup-Token', '<SECRET>'
        ),
        body := '{"scheduled": true}'::jsonb
    ) as request_id;
  $$
);
```

- [ ] **Step 4: Apply against the live project**

Run:
```bash
supabase db query --linked < supabase/migrations/20260715_fix_backup_cron_job.sql
```
Expected: no error.

- [ ] **Step 5: Verify the job is scheduled correctly**

Run:
```bash
echo "SELECT jobname, schedule, active FROM cron.job WHERE jobname ILIKE '%backup%';" | supabase db query --linked
```
Expected: exactly one row — `daily-database-backup-11-59-pm-ist`, schedule `29 18 * * *`, `active = true`.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260715_fix_backup_cron_job.sql
git commit -m "fix: recreate daily backup cron on the live project with secret-based auth"
```

---

### Task 3: Dynamic table discovery — replace the hardcoded 22-table list

The edge function currently hardcodes 22 table names. The live project has **79** tables in `public`, including the two largest tables in the entire database — `campaign_schools` (57,382 rows) and `prospect_schools` (55,508 rows) — which are completely absent from every backup taken so far. `information_schema.tables` isn't reachable through PostgREST directly, so this needs a small `SECURITY DEFINER` RPC.

**Files:**
- Create: `supabase/migrations/20260715_list_backup_tables_fn.sql`

**Interfaces:**
- Produces: `public.list_backup_tables()` — `SECURITY DEFINER` SQL function returning `setof text`, one row per base table name in `public`, alphabetically. Consumed by Task 4's edge function via `supabase.rpc('list_backup_tables')`.

- [ ] **Step 1: Write the migration**

```sql
-- 20260715_list_backup_tables_fn.sql
CREATE OR REPLACE FUNCTION public.list_backup_tables()
RETURNS SETOF text
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT table_name
  FROM information_schema.tables
  WHERE table_schema = 'public'
    AND table_type = 'BASE TABLE'
  ORDER BY table_name;
$$;

REVOKE EXECUTE ON FUNCTION public.list_backup_tables() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_backup_tables() TO service_role;
```

- [ ] **Step 2: Apply against the live project**

Run:
```bash
supabase db query --linked < supabase/migrations/20260715_list_backup_tables_fn.sql
```
Expected: no error.

- [ ] **Step 3: Verify it returns all 79 tables**

Run:
```bash
echo "SELECT count(*) FROM list_backup_tables();" | supabase db query --linked
```
Expected: `count` matches the live table count (79 as of this session — re-check with `SELECT count(*) FROM pg_stat_user_tables WHERE schemaname='public';` if this has drifted since planning).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260715_list_backup_tables_fn.sql
git commit -m "feat: add list_backup_tables() RPC for dynamic A-to-Z backup coverage"
```

---

### Task 4: Rewrite the edge function — pagination, dynamic tables, secret-based scheduled auth, 30-day retention

This is the core fix. Replaces the hardcoded table array and unpaginated `select('*')` (which silently truncates any table over 1000 rows via PostgREST's default cap) with dynamic discovery + explicit `.range()` pagination. Also swaps the spoofable `X-Scheduled-Backup` header check for the secret from Task 2, and extends automatic retention from 7 to 30 days.

**Revision note (post-first-attempt):** the first version of this task (build one big in-memory object across all tables, then `JSON.stringify` it whole) was implemented, deployed, and failed against live production with `WORKER_RESOURCE_LIMIT` — `prospect_schools` (55k+ rows, ~62MB) and `campaign_schools` (57k+ rows, ~25MB) alone exceed the edge function's memory ceiling when materialized raw. Step 3 below is redesigned around a single continuous gzip stream: each page (≤1000 rows, one table at a time) is written into the stream and immediately discarded from memory, so **peak raw memory is always bounded to one page (≤1000 rows) regardless of how large any table grows** — this holds at today's scale and at the user's stated target scale (500k prospect schools, 5M+ students) equally, not just today. A side effect: backups are now stored gzip-compressed at rest (`.json.gz`, NDJSON — newline-delimited JSON — instead of one parseable JSON document), which also shrinks storage cost ~5-10x. Task 5 no longer needs to compress anything itself — it just attaches or links the already-compressed file. Task 6 gains one small addition (client-side decompression) to keep the browser "Download" UX unchanged.

**Files:**
- Modify: `supabase/functions/database-backup/index.ts` (full replacement of the table-backup section, auth-check section, and retention constant)

**Interfaces:**
- Consumes: `public.list_backup_tables()` (Task 3), `BACKUP_CRON_SECRET` env secret (Task 2)
- Produces: unchanged HTTP response shape `{ success, filename, total_records, file_size }` on success. `filename` now ends `.json.gz`; `file_size` is now the compressed byte size. Task 5 consumes `compressedBuf` (the finished gzip bytes, already in scope) as an additional block inside this same file, after the storage upload succeeds — no re-compression needed.

- [ ] **Step 1: Replace the scheduled-backup auth check**

In `index.ts`, replace:
```ts
    // Check if this is a scheduled backup
    const isScheduledBackup = req.headers.get('X-Scheduled-Backup') === 'true'
```
with:
```ts
    // Check if this is a scheduled backup — verified via shared secret,
    // not just the presence of a header (which is spoofable by anyone
    // who knows the function's public URL).
    const scheduledToken = req.headers.get('X-Scheduled-Backup-Token') ?? ''
    const expectedScheduledToken = Deno.env.get('BACKUP_CRON_SECRET') ?? ''
    const isScheduledBackup =
      req.headers.get('X-Scheduled-Backup') === 'true' &&
      expectedScheduledToken.length > 0 &&
      scheduledToken === expectedScheduledToken

    if (req.headers.get('X-Scheduled-Backup') === 'true' && !isScheduledBackup) {
      console.error('Rejected scheduled-backup request with invalid or missing token')
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid scheduled backup token' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 401 }
      )
    }
```

- [ ] **Step 2: Replace the retention window**

In `cleanupOldBackups`, replace:
```ts
    const sevenDaysAgo = new Date()
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)
```
with:
```ts
    const retentionCutoff = new Date()
    retentionCutoff.setDate(retentionCutoff.getDate() - 30)
```
And update every subsequent reference to `sevenDaysAgo` in that function (the `.lt('created_at', ...)` call and the log lines) to `retentionCutoff`, and the comment above it from "Keep last 7 days" to "Keep last 30 days".

- [ ] **Step 3 (REVISED — supersedes any first-attempt version already in the file): Stream every table straight into one gzip file, bounded to one page in memory at a time**

If `index.ts` currently contains a prior attempt at this step (an all-in-memory `backupData: any = {}` object populated via a `fetchAllRows`/`list_backup_tables` dynamic-discovery pass, followed by a single `JSON.stringify(backupContent)` and one `.upload()` call using the pre-existing `filename`/`jsonContent`/`fileSize`/`storagePath` variables from the original file) — **that version is the one that caused the live `WORKER_RESOURCE_LIMIT` failure. Replace it entirely with the code below.** If the file is still in its original (pre-plan) state instead, replace the same block the earlier version of this step described (the hardcoded 22-table array through the end of the original unpaginated `.upload()` call, i.e. everything from `// Get all tables to backup` through the `if (uploadError) { throw ... }` block, stopping right before the `// Record backup in database` comment — that part of the file, and everything after it, is unchanged by this task).

Replace with:
```ts
    // Discover every table dynamically — no hardcoded list, so newly
    // added tables are automatically included (true A-to-Z coverage).
    const { data: tableRows, error: tablesError } = await supabase.rpc('list_backup_tables')
    if (tablesError || !tableRows) {
      throw new Error(`Failed to list tables for backup: ${tablesError?.message ?? 'unknown error'}`)
    }
    const tables: string[] = (tableRows as any[]).map((row: any) =>
      typeof row === 'string' ? row : row.list_backup_tables
    )
    console.log(`Discovered ${tables.length} tables to back up: ${tables.join(', ')}`)

    // Stream the entire backup into a single gzip file, one page (max
    // 1000 rows) at a time. Peak raw memory is always bounded to one
    // page regardless of total table size — this is what makes the
    // backup safe at any future scale, not just today's ~118k total
    // rows. A prior version of this function built one big in-memory
    // object across all 81 tables before stringifying it whole, and
    // failed in production (WORKER_RESOURCE_LIMIT) once prospect_schools
    // (55k+ rows) and campaign_schools (57k+ rows) were included.
    //
    // Output format: NDJSON (newline-delimited JSON), not one parseable
    // JSON document — the first line is a metadata marker, then one
    // line per (table, page). This is a deliberate format change from
    // v1.0 backups; anything reading these files must decompress with
    // gzip then parse line-by-line.
    const PAGE_SIZE = 1000
    const gzip = new CompressionStream('gzip')
    const gzipWriter = gzip.writable.getWriter()
    const compressedPromise = new Response(gzip.readable).arrayBuffer()
    const encoder = new TextEncoder()

    let totalRecords = 0
    const tableRecordCounts: Record<string, number> = {}

    for (const table of tables) {
      let from = 0
      let page = 0
      let tableTotal = 0
      try {
        while (true) {
          const { data, error } = await supabase
            .from(table)
            .select('*')
            .range(from, from + PAGE_SIZE - 1)
          if (error) {
            console.error(`Error backing up ${table} at offset ${from}:`, error)
            break
          }
          if (!data || data.length === 0) break
          await gzipWriter.write(
            encoder.encode(JSON.stringify({ table, page, rows: data }) + '\n')
          )
          tableTotal += data.length
          totalRecords += data.length
          if (data.length < PAGE_SIZE) break
          from += PAGE_SIZE
          page += 1
        }
      } catch (err) {
        console.error(`Failed to backup table ${table}:`, err)
      }
      tableRecordCounts[table] = tableTotal
      console.log(`Backed up ${tableTotal} records from ${table}`)
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const filename = `database-backup-${timestamp}.json.gz`
    await gzipWriter.write(
      encoder.encode(JSON.stringify({
        __meta__: true,
        created_at: new Date().toISOString(),
        total_tables: tables.length,
        total_records: totalRecords,
        table_record_counts: tableRecordCounts,
        backup_version: '2.0',
      }) + '\n')
    )
    await gzipWriter.close()
    const compressedBuf = new Uint8Array(await compressedPromise)
    const fileSize = compressedBuf.byteLength

    const storagePath = `backups/${filename}`
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('database-backups')
      .upload(storagePath, compressedBuf, {
        contentType: 'application/gzip',
        upsert: false
      })

    if (uploadError) {
      throw new Error(`Failed to upload backup: ${uploadError.message}`)
    }
```
`filename`, `fileSize`, `storagePath`, and `totalRecords` keep the same names the rest of the (untouched) function already expects — the `// Record backup in database` insert and the final JSON response work unchanged. `compressedBuf` is new and is what Task 5 attaches/links directly (no re-compression needed there).

- [ ] **Step 4: Deploy**

Run:
```bash
supabase functions deploy database-backup --project-ref eucjeggfclztkbbupaav
```
Expected: deploy succeeds.

- [ ] **Step 5: Verify no more 1000-row cap — trigger a real backup and check `prospect_schools`/`campaign_schools` counts**

Run (uses the anon key + the new secret from Task 2 to simulate the cron call):
```bash
curl -s -X POST 'https://eucjeggfclztkbbupaav.supabase.co/functions/v1/database-backup' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV1Y2plZ2dmY2x6dGtiYnVwYWF2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk0Nzk1NzIsImV4cCI6MjA5NTA1NTU3Mn0.nVHEPuXB5cKzD8OiFu1TIVyC6m4nfovw_nUJOZt5TA4' \
  -H 'X-Scheduled-Backup: true' \
  -H 'X-Scheduled-Backup-Token: <SECRET from Task 2>' \
  -d '{"scheduled": true}'
```
Expected: JSON response `{"success":true, "filename": "...", "total_records": <well over 100000>, "file_size": ...}`. Cross-check: `total_records` should be roughly `sum(n_live_tup)` across all 79 tables (~115,000+ at time of planning — re-check current total via the `pg_stat_user_tables` query from the investigation above, since row counts grow over time).

Then confirm no truncation directly — the file is now gzip-compressed NDJSON (one JSON line per table page, see Step 3), not a single parseable JSON document, so decompress and grep for the two largest tables' page lines and sum their row counts:
```bash
echo "SELECT filename, storage_path FROM database_backups WHERE backup_type='daily' ORDER BY created_at DESC LIMIT 1;" | supabase db query --linked
```
Download that file from the `database-backups` bucket (Supabase Studio → Storage, or `supabase storage` CLI), then:
```bash
gunzip -c <downloaded-file>.json.gz | grep '"table":"prospect_schools"' | python3 -c "import sys,json; print(sum(len(json.loads(l)['rows']) for l in sys.stdin))"
gunzip -c <downloaded-file>.json.gz | grep '"table":"campaign_schools"' | python3 -c "import sys,json; print(sum(len(json.loads(l)['rows']) for l in sys.stdin))"
```
Expected: both counts match the live `pg_stat_user_tables` counts for those tables (roughly 55,000+ and 57,000+ respectively — re-check current counts, they grow over time), not capped at 1000. Also spot-check the last line of the decompressed file is the `__meta__` line and its `total_records` matches the curl response's `total_records`.

- [ ] **Step 6: Verify the spoofed-header attack is closed**

Run:
```bash
curl -s -X POST 'https://eucjeggfclztkbbupaav.supabase.co/functions/v1/database-backup' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV1Y2plZ2dmY2x6dGtiYnVwYWF2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk0Nzk1NzIsImV4cCI6MjA5NTA1NTU3Mn0.nVHEPuXB5cKzD8OiFu1TIVyC6m4nfovw_nUJOZt5TA4' \
  -H 'X-Scheduled-Backup: true' \
  -d '{"scheduled": true}'
```
(No `X-Scheduled-Backup-Token` header this time.)
Expected: HTTP 401, `{"success":false,"error":"Invalid scheduled backup token"}` — confirms the old spoofable path no longer works.

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/database-backup/index.ts
git commit -m "fix: dynamic A-to-Z table discovery, paginate past PostgREST 1000-row cap, secret-based scheduled auth, 30-day retention"
```

**Known limitation, accepted 2026-07-15 (not fixed in this plan):** the paginated per-table fetches in Step 3 have no `ORDER BY`. A row written concurrently with that specific table's fetch window could theoretically be skipped or duplicated across a page boundary. User reviewed and accepted this as a documented fast-follow rather than blocking — narrow blast radius (at most one row, one table, one day), unlike the systemic 1000-row-cap bug this plan fixes. Fast-follow: extend `list_backup_tables()` to also report each table's primary-key column, then `.order()` paginated fetches by it.

---

### Task 5: Email the daily backup via a separate `send-backup-email` function, with a signed-link fallback for oversized files

Only fires for `backup_type === 'daily'`. Manual backups are never emailed (per explicit instruction). Threshold for "too big to attach" is set conservatively at 15MB of **compressed** bytes — base64 encoding (required for email attachments) inflates size by ~37%, so 15MB compressed becomes ~20.5MB encoded, safely under both Gmail's 25MB message-size cap and Resend's attachment limit, leaving headroom for the HTML body/headers.

**Revision note (second attempt — first attempt caused a second live production incident today):** the first version of this task added the email-sending code (base64-encode + `resend.emails.send`) directly inline in `database-backup/index.ts`, right after the streaming backup upload, in the SAME function invocation. Deployed and run for real, it hit `WORKER_RESOURCE_LIMIT` twice in a row on an 11.6MB file — well under the 15MB threshold. Root cause: the 15MB threshold was sized against email-provider attachment limits (Gmail/Resend), a completely different constraint from the edge function's own runtime memory ceiling, which is much tighter and was already under some pressure from the heavy 81-table streaming/pagination work that had just run in the same invocation (V8/Deno doesn't necessarily reclaim everything instantly). The implementer correctly rolled the deployed function back to Task 4's last known-good commit before the live 11:59 PM IST cron could fire on the broken code, and confirmed with a real run that production was safe again — nothing was left broken.

The fix: **split emailing into its own edge function** (`send-backup-email`), invoked as a fresh, lightweight HTTP call from `database-backup` right after the backup completes. It downloads the already-uploaded file directly from storage and sends it, starting with a clean memory budget completely uncontaminated by the pagination/streaming work that just happened in the other function's invocation. `database-backup` itself never touches base64 or the Resend SDK again — its only new addition is a small `fetch()` call with a tiny JSON body.

**Files:**
- Create: `supabase/functions/send-backup-email/index.ts` (new function — downloads the backup file, emails it or a signed link)
- Modify: `supabase/functions/database-backup/index.ts` (add a lightweight fire-off `fetch()` call after the `database_backups` insert, before `cleanupOldBackups` — no Resend/base64 imports needed here)

**Interfaces:**
- Consumes (in `send-backup-email`): `RESEND_API_KEY` (existing secret), `BACKUP_EMAIL_TO` (new secret, set in Step 1), `BACKUP_CRON_SECRET` (existing secret from Task 2, reused here as the inter-function auth token — no new secret needed for that), `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` (platform-provided, always available in edge functions). Request body: `{ storagePath, filename, fileSize, totalRecords, tableCount }`.
- Consumes (in `database-backup`'s new fetch call): `storagePath`/`filename`/`fileSize`/`totalRecords`/`tables.length` (already in scope from Task 4), plus the already-declared `supabaseUrl`/`supabaseAnonKey`/`BACKUP_CRON_SECRET`.
- Produces: nothing new consumed elsewhere — this is the terminal step of the daily flow. Response shape of `database-backup` itself is unchanged.

- [ ] **Step 1: Set the recipient secret**

Run:
```bash
export SUPABASE_ACCESS_TOKEN=$(security find-generic-password -s "Supabase CLI" -w | sed 's/^go-keyring-base64://' | base64 -d) && supabase secrets set BACKUP_EMAIL_TO=iplusbackups@gmail.com --project-ref eucjeggfclztkbbupaav
```
Expected: CLI confirms the secret was set. (Skip this if it was already set successfully by a prior attempt — check with `supabase secrets list --project-ref eucjeggfclztkbbupaav` first, same access-token export pattern.)

- [ ] **Step 2: Create the new `send-backup-email` function**

Create `supabase/functions/send-backup-email/index.ts`:
```ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { Resend } from "npm:resend@2.0.0"
import { encode as base64Encode } from "https://deno.land/std@0.168.0/encoding/base64.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-backup-email-token',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    // Server-to-server only (called by database-backup, never a browser)
    // — authenticated via the same shared secret Task 2 already set up.
    const token = req.headers.get('X-Backup-Email-Token') ?? ''
    const expected = Deno.env.get('BACKUP_CRON_SECRET') ?? ''
    if (!expected || token !== expected) {
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const { storagePath, filename, fileSize, totalRecords, tableCount } = await req.json()

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    const resendApiKey = Deno.env.get('RESEND_API_KEY')
    const backupEmailTo = Deno.env.get('BACKUP_EMAIL_TO')
    if (!resendApiKey || !backupEmailTo) {
      throw new Error('RESEND_API_KEY or BACKUP_EMAIL_TO not set')
    }
    const resend = new Resend(resendApiKey)
    const dateStr = new Date().toISOString().split('T')[0]
    const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024 // 15MB compressed (~20.5MB base64-encoded)

    if (fileSize <= MAX_ATTACHMENT_BYTES) {
      // Fresh invocation, fresh memory budget — this function has done
      // nothing else before this download, unlike the old inline design.
      const { data, error } = await supabase.storage.from('database-backups').download(storagePath)
      if (error || !data) {
        throw new Error(`Failed to download backup for email: ${error?.message ?? 'no data'}`)
      }
      const buf = new Uint8Array(await data.arrayBuffer())
      await resend.emails.send({
        from: "iPlus Olympiads <noreply@iplusedu.in>",
        to: [backupEmailTo],
        subject: `iPlus DB Backup — ${dateStr}`,
        html: `<p>Automated daily database backup for ${dateStr}.</p><p>Tables: ${tableCount}, Records: ${totalRecords}, Size: ${fileSize} bytes gzipped.</p>`,
        attachments: [{ filename, content: base64Encode(buf) }],
      })
      console.log(`Backup emailed to ${backupEmailTo} as attachment (${fileSize} bytes)`)
    } else {
      const { data: signedUrlData, error: signedUrlError } = await supabase.storage
        .from('database-backups')
        .createSignedUrl(storagePath, 60 * 60 * 24 * 30) // 30 days — matches retention; can't outlive the file
      if (signedUrlError || !signedUrlData) {
        throw new Error(`Failed to create signed URL: ${signedUrlError?.message ?? 'unknown error'}`)
      }
      await resend.emails.send({
        from: "iPlus Olympiads <noreply@iplusedu.in>",
        to: [backupEmailTo],
        subject: `iPlus DB Backup — ${dateStr} (download link — too large to attach)`,
        html: `<p>Automated daily database backup for ${dateStr}.</p><p>Tables: ${tableCount}, Records: ${totalRecords}, Size: ${fileSize} bytes.</p><p>This backup is too large to email as an attachment. Download it here (valid up to 30 days, until this backup is cleaned up): <a href="${signedUrlData.signedUrl}">${signedUrlData.signedUrl}</a></p>`,
      })
      console.log(`Backup too large to attach (${fileSize} bytes) — emailed signed link instead`)
    }

    return new Response(
      JSON.stringify({ success: true }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    console.error('send-backup-email failed:', err)
    return new Response(
      JSON.stringify({ success: false, error: err instanceof Error ? err.message : 'unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
```

- [ ] **Step 3: Add the fire-off call in `database-backup/index.ts`**

Immediately after the existing `database_backups` insert (`recordError` block) and **before** the `await cleanupOldBackups(supabase)` call, add (no new imports needed — `supabaseUrl`/`supabaseAnonKey` are already declared earlier in this same file):
```ts
    // Email the daily backup only — manual backups are never emailed.
    // Delegates to a separate function (send-backup-email) so the
    // base64/Resend work runs in its own fresh invocation, not sharing
    // memory pressure with the heavy table-streaming work above.
    if (backupType === 'daily') {
      try {
        const emailResp = await fetch(`${supabaseUrl}/functions/v1/send-backup-email`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${supabaseAnonKey}`,
            'X-Backup-Email-Token': Deno.env.get('BACKUP_CRON_SECRET') ?? '',
          },
          body: JSON.stringify({
            storagePath, filename, fileSize, totalRecords, tableCount: tables.length,
          }),
        })
        if (!emailResp.ok) {
          console.error('send-backup-email call failed:', await emailResp.text())
        }
      } catch (emailErr) {
        // Email failure must never fail the backup itself — the backup
        // already succeeded and is safely stored.
        console.error('Failed to trigger backup email:', emailErr)
      }
    }
```

- [ ] **Step 4: Deploy both functions**

Run:
```bash
supabase functions deploy send-backup-email --project-ref eucjeggfclztkbbupaav
supabase functions deploy database-backup --project-ref eucjeggfclztkbbupaav
```
Expected: both deploys succeed.

- [ ] **Step 5: Verify end-to-end by simulating a real scheduled run**

Run the same curl command from Task 4 Step 5 (with the real `X-Scheduled-Backup-Token`). Expected: `{"success":true, ...}` response from `database-backup`, and within a couple of minutes an email arrives at `iplusbackups@gmail.com` from `noreply@iplusedu.in` with either a `.json.gz` attachment or a signed-link body. This CLI version has no `functions logs` subcommand (confirmed in a prior task) — read logs via the Management API instead:
```bash
export SUPABASE_ACCESS_TOKEN=$(security find-generic-password -s "Supabase CLI" -w | sed 's/^go-keyring-base64://' | base64 -d) && curl -s "https://api.supabase.com/v1/projects/eucjeggfclztkbbupaav/analytics/endpoints/logs.all?sql=select%20timestamp%2Cevent_message%20from%20function_edge_logs%20cross%20join%20unnest(metadata)%20as%20m%20cross%20join%20unnest(m.response)%20as%20r%20where%20m.function_id%20is%20not%20null%20order%20by%20timestamp%20desc%20limit%2050" -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN"
```
If that query shape doesn't work against this project (log schemas vary by Supabase platform version), fall back to checking `database_backups` for the new row (proves the backup half worked) and rely on the user's own inbox check for the email half — say so explicitly in your report rather than guessing at log output.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/send-backup-email/index.ts supabase/functions/database-backup/index.ts
git commit -m "feat: email the daily backup via a separate send-backup-email function (fixes 2nd WORKER_RESOURCE_LIMIT incident from inline base64 encoding)"
```

---

### Task 6: Frontend — decompress downloads (backups are now stored gzipped), remove the manual-backup delete capability, update retention copy to 30 days

The UI currently has a working Delete button + `deleteBackup()` function for manual backups. Task 1 already makes the underlying DELETE fail at the database level (no policy grants it), but leaving a button that always fails is a bad, misleading experience — remove it outright so the UI matches the actual (and intended) permanent-by-design behavior.

**Revision note:** Task 4's redesign now stores every backup gzip-compressed (`.json.gz`) instead of plain JSON, to stay memory-safe. Without a change here, clicking "Download"/"Restore" would hand the user a `.gz` file instead of readable JSON — a new Step 1 below decompresses client-side (`DecompressionStream`, the browser-native counterpart to the edge function's `CompressionStream`) so the downloaded file stays plain, readable `.json`, exactly matching the pre-existing UX.

**Files:**
- Modify: `src/hooks/useDatabaseBackups.ts`
- Modify: `src/components/admin/DatabaseBackupManager.tsx`

**Interfaces:**
- Produces: `useDatabaseBackups()` no longer exposes `deleteBackup`; `downloadBackup` now decompresses before triggering the browser download. `DatabaseBackupManager` no longer renders a delete control for any backup.

- [ ] **Step 1: Decompress on download**

In `src/hooks/useDatabaseBackups.ts`, replace the `downloadBackup` function body between the successful storage `.download()` call and the `toast.success` line:
```ts
      // Create download link
      const blob = new Blob([data], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = backup.filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
```
with:
```ts
      // Backups are stored gzip-compressed (see database-backup edge
      // function) — decompress client-side so the downloaded file is
      // plain readable JSON, matching the pre-compression UX.
      const decompressedStream = data.stream().pipeThrough(new DecompressionStream('gzip'));
      const decompressedBlob = await new Response(decompressedStream).blob();

      const url = URL.createObjectURL(decompressedBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = backup.filename.replace(/\.gz$/, '');
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
```

- [ ] **Step 2: Remove `deleteBackup` from the hook**

In `src/hooks/useDatabaseBackups.ts`, delete the entire `deleteBackup` function (originally lines 73–104) and remove `deleteBackup` from the returned object (originally line 171):
```ts
  return {
    backups,
    loading,
    fetchBackups,
    downloadBackup,
    triggerBackup
  };
```

- [ ] **Step 3: Remove the delete button and its dialog from the component**

In `src/components/admin/DatabaseBackupManager.tsx`:
- Remove `deleteBackup` from the destructured hook result (line 12): `const { backups, loading, downloadBackup, triggerBackup } = useDatabaseBackups();`
- Remove the unused imports now that the delete dialog is gone: `Trash2` from the `lucide-react` import (line 7), and the full `AlertDialog*` import (line 6) since it was only used for the delete confirmation.
- Change `renderBackupTable`'s signature to drop the now-unused `showDeleteButton` parameter, and delete the entire `{showDeleteButton && (...)}` block (lines 100–125), including the `AlertDialog` JSX inside it.
- Update both call sites (lines 177 and 206) to drop the second argument: `renderBackupTable(recentAutomaticBackups)` and `renderBackupTable(manualBackups)`.

- [ ] **Step 4: Update retention copy and filter window**

In `DatabaseBackupManager.tsx`:
- Line 39: `const sevenDaysAgo = subDays(new Date(), 7);` → `const thirtyDaysAgo = subDays(new Date(), 30);`, and update line 40–41's reference from `sevenDaysAgo` to `thirtyDaysAgo`.
- Line 168 copy: `Daily backups at 11:59 PM IST. <strong>Retention:</strong> Last 7 days only (older backups are auto-deleted).` → `Daily backups at 11:59 PM IST. <strong>Retention:</strong> Last 30 days only (older backups are auto-deleted).`
- Line 191 copy: `On-demand backups created by superadmins. <strong>Retention:</strong> Stored forever until explicitly deleted.` → `On-demand backups created by superadmins. <strong>Retention:</strong> Stored forever — cannot be deleted by anyone, including superadmins.`

- [ ] **Step 5: Typecheck**

Run:
```bash
npx tsc --noEmit
```
Expected: no new errors introduced by these two files.

- [ ] **Step 6: Commit**

```bash
git add src/hooks/useDatabaseBackups.ts src/components/admin/DatabaseBackupManager.tsx
git commit -m "fix: decompress downloads (backups now stored gzipped), remove manual-backup delete UI, update retention copy to 30 days"
```

- [ ] **Step 7: Push and deploy**

```bash
git push unified main
```
Confirm GitHub Actions is green at `github.com/goghulselvan/iplus-unified-system/actions`, then tell the user the build is in staging (`cms.iplus.vaima.in/unified_deployment/`) and they need to move it to live themselves (consent gate) before the Database Backup Manager page reflects these changes in the browser.

---

### Task 7: Final end-to-end verification

Everything up to here has been verified piece-by-piece. This task confirms the whole system together, since no browser/CRM login is available in this environment (see project convention — CLI/curl verification, then explicit user click-through ask).

**Files:** none (verification only)

- [ ] **Step 1: Confirm the cron job fires for real (do not wait until 11:59 PM IST to find out)**

Reuse the exact anon key embedded in Task 2 Step 3's migration, and the exact secret value generated in Task 2 Step 1 (the same one already set as `BACKUP_CRON_SECRET` and already baked into the live cron job). Substitute both literally into this one-off throwaway test job:
```bash
echo "SELECT cron.schedule('manual-test-run', '* * * * *', \$\$ SELECT net.http_post(url:='https://eucjeggfclztkbbupaav.supabase.co/functions/v1/database-backup', headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV1Y2plZ2dmY2x6dGtiYnVwYWF2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk0Nzk1NzIsImV4cCI6MjA5NTA1NTU3Mn0.nVHEPuXB5cKzD8OiFu1TIVyC6m4nfovw_nUJOZt5TA4','X-Scheduled-Backup','true','X-Scheduled-Backup-Token','<same value generated in Task 2 Step 1>'), body:='{\"scheduled\":true}'::jsonb) as request_id; \$\$);" | supabase db query --linked
```
Wait 90 seconds, then check it actually ran and unschedule the test job immediately after:
```bash
echo "SELECT * FROM cron.job_run_details WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname='manual-test-run') ORDER BY start_time DESC LIMIT 1;" | supabase db query --linked
echo "SELECT cron.unschedule((SELECT jobid FROM cron.job WHERE jobname='manual-test-run'));" | supabase db query --linked
```
Expected: `cron.job_run_details` shows `status = 'succeeded'`. This is a throwaway per-minute test job — always unschedule it in the same step, don't leave it running.

- [ ] **Step 2: Confirm total record count sanity**

Run:
```bash
echo "SELECT sum(n_live_tup) FROM pg_stat_user_tables WHERE schemaname='public';" | supabase db query --linked
```
Compare against the `total_records` field from the most recent `database_backups` row (`echo "SELECT total_records FROM database_backups ORDER BY created_at DESC LIMIT 1;"` — note: this column doesn't exist yet on the table; instead re-run the curl from Task 4 Step 5 and read `total_records` from its JSON response directly). The two numbers should be in the same ballpark (exact match isn't guaranteed — `n_live_tup` is an estimate that can lag slightly behind actual row count).

- [ ] **Step 3: Confirm immutability holds even for a superadmin-equivalent request**

Attempt a DELETE using the service-role key is expected to still work (that's the cleanup job's own path and must keep working); the test that matters is that no **RLS-governed** role can delete. Since there's no browser session available, confirm this by policy inspection instead (already done in Task 1 Step 3) plus asking the user to try clicking delete in the CRM UI after Task 6 is live — the button will already be gone, which is itself the confirmation.

- [ ] **Step 4: Tell the user what's verified vs. what needs their own check**

Report explicitly:
- Verified via CLI/curl: cron job runs on the correct project, all 79 tables included with no 1000-row truncation, RLS blocks all client-role writes/deletes on backups, spoofed scheduled-header attack is closed, email send path executes and logs which branch (attachment vs. link) fired.
- Needs the user's own confirmation: the actual email arriving and looking right in `iplusbackups@gmail.com`, and the Database Backup Manager page in the live CRM (after Task 6 is deployed and moved to live) showing the 5 existing manual backups now visible with no delete button.
