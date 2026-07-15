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
