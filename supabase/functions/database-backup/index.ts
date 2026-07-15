import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Function to clean up old automatic backups only (manual backups are kept forever)
async function cleanupOldBackups(supabase: any) {
  try {
    console.log('Starting cleanup of old automatic backups...')
    
    // Retention policy:
    // - Keep last 30 days of automatic (daily) backups
    // - Manual backups are kept FOREVER (only deleted explicitly by superadmin)

    const retentionCutoff = new Date()
    retentionCutoff.setDate(retentionCutoff.getDate() - 30)

    // Get automatic backups older than 30 days
    const { data: oldAutomaticBackups, error: autoError } = await supabase
      .from('database_backups')
      .select('*')
      .eq('backup_type', 'daily')
      .lt('created_at', retentionCutoff.toISOString())

    if (autoError) {
      console.error('Error fetching old automatic backups:', autoError)
    } else if (oldAutomaticBackups && oldAutomaticBackups.length > 0) {
      console.log(`Found ${oldAutomaticBackups.length} automatic backups older than 30 days to clean up`)
      
      for (const backup of oldAutomaticBackups) {
        try {
          // Delete from storage
          const { error: storageError } = await supabase.storage
            .from('database-backups')
            .remove([backup.storage_path])
          
          if (storageError) {
            console.error(`Failed to delete storage file ${backup.storage_path}:`, storageError)
            continue
          }
          
          // Delete from database
          const { error: dbError } = await supabase
            .from('database_backups')
            .delete()
            .eq('id', backup.id)
          
          if (dbError) {
            console.error(`Failed to delete backup record ${backup.id}:`, dbError)
            continue
          }
          
          console.log(`Cleaned up old automatic backup: ${backup.filename}`)
        } catch (err) {
          console.error(`Failed to cleanup automatic backup ${backup.filename}:`, err)
        }
      }
    } else {
      console.log('No automatic backup cleanup needed (all within 30 days)')
    }
    
    // NOTE: Manual backups are NEVER auto-deleted - only superadmins can delete them explicitly
    console.log('Manual backups are preserved indefinitely (no auto-cleanup)')
    
    console.log('Cleanup completed successfully')
  } catch (error) {
    console.error('Error during backup cleanup:', error)
  }
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!
    
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
    
    let userId: string | null = null
    let backupType = 'manual'
    let username = 'scheduled-system'
    let supabaseAuth: any = null

    if (isScheduledBackup) {
      // Scheduled automatic backup - skip authentication and rate limiting
      console.log('⏰ Processing scheduled automatic daily backup...')
      backupType = 'daily'
      // Use a system placeholder UUID for scheduled backups (required by NOT NULL constraint)
      userId = '00000000-0000-0000-0000-000000000000'
    } else {
      // Manual backup - apply all security checks
      console.log('👤 Processing manual backup request...')
      
      // ===== SECURITY CHECK 1: Verify JWT Token =====
      const authHeaderRaw = req.headers.get('authorization') ?? req.headers.get('Authorization')
      if (!authHeaderRaw) {
        console.error('Backup attempt without authorization header')
        return new Response(
          JSON.stringify({
            success: false,
            error: 'Missing authorization. Please authenticate to perform backups.'
          }),
          {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 401
          }
        )
      }

      // Extract token safely (avoid session-based methods in Edge runtime)
      const match = authHeaderRaw.match(/^Bearer\s+(.+)$/i)
      const token = (match?.[1] ?? '').trim()

      console.log(`Auth header received (len=${authHeaderRaw.length}), token len=${token.length}`)
      console.log(`Token looksLikeJwt=${token.split('.').length === 3}`)

      if (!token) {
        return new Response(
          JSON.stringify({
            success: false,
            error: 'Invalid authorization header format.'
          }),
          {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 401
          }
        )
      }

      // Create service role client for JWT verification (can verify any token)
      const supabaseService = createClient(supabaseUrl, supabaseServiceKey)

      // Verify the JWT token by passing it directly to getUser
      const { data: { user }, error: userError } = await supabaseService.auth.getUser(token)
      
      if (userError || !user) {
        console.error('Invalid or expired JWT token:', userError)
        return new Response(
          JSON.stringify({ 
            success: false, 
            error: 'Invalid or expired authentication token.' 
          }),
          { 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 401 
          }
        )
      }

      // Create authenticated client for user operations (RLS-aware queries)
      supabaseAuth = createClient(supabaseUrl, supabaseAnonKey, {
        global: { headers: { Authorization: authHeaderRaw } }
      })

      console.log(`Backup requested by user: ${user.id}`)
      userId = user.id

      // ===== SECURITY CHECK 2: Verify User is Superadmin =====
      const { data: profile, error: profileError } = await supabaseAuth
        .from('profiles')
        .select('role, username')
        .eq('user_id', user.id)
        .single()

      if (profileError || !profile) {
        console.error('Failed to fetch user profile:', profileError)
        return new Response(
          JSON.stringify({ 
            success: false, 
            error: 'Unable to verify user permissions.' 
          }),
          { 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 403 
          }
        )
      }

      if (profile.role !== 'superadmin') {
        console.error(`Unauthorized backup attempt by user ${user.id} with role ${profile.role}`)
        
        return new Response(
          JSON.stringify({ 
            success: false, 
            error: 'Insufficient permissions. Only superadmins can perform database backups.' 
          }),
          { 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 403 
          }
        )
      }

      // ===== SECURITY CHECK 3: Rate Limiting Check (only for manual backups) =====
      // Check if user has triggered a manual backup in the last hour
      const oneHourAgo = new Date()
      oneHourAgo.setHours(oneHourAgo.getHours() - 1)

      const { data: recentBackups, error: recentError } = await supabaseAuth
        .from('database_backups')
        .select('created_at')
        .eq('created_by', user.id)
        .eq('backup_type', 'manual')
        .gte('created_at', oneHourAgo.toISOString())

      if (recentError) {
        console.error('Failed to check recent backups:', recentError)
      } else if (recentBackups && recentBackups.length > 0) {
        console.warn(`Rate limit: User ${user.id} attempted backup within 1 hour`)
        return new Response(
          JSON.stringify({ 
            success: false, 
            error: 'Rate limit exceeded. Please wait at least 1 hour between manual backups.' 
          }),
          { 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 429 
          }
        )
      }

      username = profile.username
      console.log(`✅ Authentication and authorization verified for user: ${profile.username} (${user.id})`)
    }
    
    // Create service role client for backup operations (bypasses RLS)
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    console.log('Starting database backup process...')

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

    // Record backup in database
    const { error: recordError } = await supabase
      .from('database_backups')
      .insert({
        filename,
        file_size: fileSize,
        backup_type: backupType,
        created_by: userId, // Null for scheduled backups, user ID for manual backups
        storage_path: storagePath,
        status: 'completed'
      })

    if (recordError) {
      console.error('Failed to record backup metadata:', recordError)
    }

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

    // Clean up old backups (keep only last 30 days)
    await cleanupOldBackups(supabase)

    console.log(`Backup completed successfully: ${filename}`)
    console.log(`Total records backed up: ${totalRecords}`)

    return new Response(
      JSON.stringify({ 
        success: true, 
        filename,
        total_records: totalRecords,
        file_size: fileSize 
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200 
      }
    )

  } catch (error) {
    console.error('Backup failed:', error)
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500 
      }
    )
  }
})