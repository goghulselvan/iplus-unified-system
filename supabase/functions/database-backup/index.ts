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
    // - Keep last 7 days of automatic (daily) backups
    // - Manual backups are kept FOREVER (only deleted explicitly by superadmin)
    
    const sevenDaysAgo = new Date()
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)
    
    // Get automatic backups older than 7 days
    const { data: oldAutomaticBackups, error: autoError } = await supabase
      .from('database_backups')
      .select('*')
      .eq('backup_type', 'daily')
      .lt('created_at', sevenDaysAgo.toISOString())
    
    if (autoError) {
      console.error('Error fetching old automatic backups:', autoError)
    } else if (oldAutomaticBackups && oldAutomaticBackups.length > 0) {
      console.log(`Found ${oldAutomaticBackups.length} automatic backups older than 7 days to clean up`)
      
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
      console.log('No automatic backup cleanup needed (all within 7 days)')
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
    
    // Check if this is a scheduled backup
    const isScheduledBackup = req.headers.get('X-Scheduled-Backup') === 'true'
    
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
        
        // Log unauthorized attempt
        await supabaseAuth.from('security_audit_logs').insert({
          user_id: user.id,
          action: 'UNAUTHORIZED_BACKUP_ATTEMPT',
          table_name: 'database_backups',
          old_values: null,
          new_values: { 
            attempted_at: new Date().toISOString(),
            user_role: profile.role 
          }
        })

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

    // Get all tables to backup (use correct table names)
    const tables = [
      'schools', 'communications', 'follow_ups', 'workflow_history', 
      'activity_logs', 'profiles', 'student_registrations', 'student_subjects',
      'olympiad_results', 'olympiad_projects', 'olympiad_subjects',
      'consent_forms', 'boards', 'state_codes', 'district_codes', 'school_codes',
      'payment_transactions', 'receipt_numbers', 'exam_schedules',
      'communication_templates', 'registration_format_config',
      'student_registration_sequences', 'security_audit_logs'
    ]

    const backupData: any = {}
    let totalRecords = 0

    // Backup each table
    for (const table of tables) {
      try {
        console.log(`Backing up table: ${table}`)
        const { data, error } = await supabase.from(table).select('*')
        
        if (error) {
          console.error(`Error backing up ${table}:`, error)
          continue
        }

        backupData[table] = data || []
        totalRecords += (data || []).length
        console.log(`Backed up ${(data || []).length} records from ${table}`)
      } catch (err) {
        console.error(`Failed to backup table ${table}:`, err)
      }
    }

    // Create backup metadata
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const filename = `database-backup-${timestamp}.json`
    
    const backupContent = {
      metadata: {
        created_at: new Date().toISOString(),
        total_tables: tables.length,
        total_records: totalRecords,
        backup_version: '1.0'
      },
      data: backupData
    }

    // Convert to JSON string
    const jsonContent = JSON.stringify(backupContent, null, 2)
    const fileSize = new Blob([jsonContent]).size

    // Upload to storage
    const storagePath = `backups/${filename}`
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('database-backups')
      .upload(storagePath, jsonContent, {
        contentType: 'application/json',
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

    // ===== AUDIT LOGGING: Log successful backup =====
    const auditAction = isScheduledBackup ? 'SCHEDULED_DATABASE_BACKUP' : 'MANUAL_DATABASE_BACKUP_TRIGGERED'
    
    if (supabaseAuth) {
      await supabaseAuth.from('security_audit_logs').insert({
        user_id: userId,
        action: auditAction,
        table_name: 'database_backups',
        old_values: null,
        new_values: { 
          filename,
          file_size: fileSize,
          total_records: totalRecords,
          backup_type: backupType,
          timestamp: new Date().toISOString(),
          username
        }
      })
      console.log(`✅ Backup logged to security audit: ${auditAction}`)
    } else {
      // For scheduled backups, log using service role
      const supabaseService = createClient(supabaseUrl, supabaseServiceKey)
      await supabaseService.from('security_audit_logs').insert({
        user_id: userId, // Use the system UUID
        action: auditAction,
        table_name: 'database_backups',
        old_values: null,
        new_values: { 
          filename,
          file_size: fileSize,
          total_records: totalRecords,
          backup_type: backupType,
          timestamp: new Date().toISOString(),
          scheduled: true
        }
      })
      console.log(`✅ Scheduled backup logged to security audit`)
    }

    // Clean up old backups (keep only last 7 days)
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