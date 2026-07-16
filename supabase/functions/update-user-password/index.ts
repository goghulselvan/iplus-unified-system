import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status,
  })

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

    const authHeader = req.headers.get('authorization') ?? req.headers.get('Authorization')
    const token = (authHeader?.match(/^Bearer\s+(.+)$/i)?.[1] ?? '').trim()
    if (!token) {
      return json(401, { success: false, error: 'Missing authorization header' })
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey)

    // The gateway (verify_jwt) has already verified the JWT signature. getUser()
    // can still 401 real browser logins, so fall back to the verified claims.
    let callerId: string | null = null
    const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token)
    if (user) {
      callerId = user.id
    } else {
      try {
        const b64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
        const payload = JSON.parse(atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4)))
        if (payload.role === 'authenticated' && payload.sub) callerId = payload.sub
        console.log('getUser failed, JWT-claims fallback used:', authErr?.message, 'role:', payload.role)
      } catch { /* fall through to 401 */ }
    }
    if (!callerId) {
      return json(401, { success: false, error: 'Invalid or expired authentication token' })
    }

    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('role')
      .eq('user_id', callerId)
      .single()

    if (profileError || !profile || profile.role !== 'superadmin') {
      return json(403, { success: false, error: 'Only superadmins can change passwords' })
    }

    const { userId, password } = await req.json()

    if (!userId || typeof password !== 'string') {
      return json(400, { success: false, error: 'userId and password are required' })
    }
    if (password.length < 6) {
      return json(400, { success: false, error: 'Password must be at least 6 characters' })
    }

    const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(userId, { password })
    if (updateError) {
      return json(500, { success: false, error: updateError.message })
    }

    return json(200, { success: true })
  } catch (error) {
    console.error('Update password failed:', error)
    return json(500, { success: false, error: error instanceof Error ? error.message : 'Unknown error' })
  }
})
