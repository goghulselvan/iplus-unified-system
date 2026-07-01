import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

    const authHeader = req.headers.get('authorization') ?? req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(
        JSON.stringify({ success: false, error: 'Missing authorization header' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 401 }
      )
    }

    const match = authHeader.match(/^Bearer\s+(.+)$/i)
    const token = (match?.[1] ?? '').trim()
    if (!token) {
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid authorization header format' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 401 }
      )
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey)

    // Verify the requesting user is superadmin
    const { data: { user: requestingUser }, error: userError } = await supabaseAdmin.auth.getUser(token)
    if (userError || !requestingUser) {
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid or expired authentication token' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 401 }
      )
    }

    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('role')
      .eq('user_id', requestingUser.id)
      .single()

    if (profileError || !profile || profile.role !== 'superadmin') {
      return new Response(
        JSON.stringify({ success: false, error: 'Only superadmins can create users' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 403 }
      )
    }

    const { email, password, username, fullName, role, dataAccessLevel, assignedDistricts } = await req.json()

    if (!email || !password || !username) {
      return new Response(
        JSON.stringify({ success: false, error: 'email, password and username are required' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      )
    }

    if (!email.toLowerCase().endsWith('@iplusedu.in')) {
      return new Response(
        JSON.stringify({ success: false, error: 'Only @iplusedu.in email addresses are allowed' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      )
    }

    // Create auth user — email_confirm: true skips the confirmation email
    const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { username, full_name: fullName ?? '' },
    })

    if (createError || !newUser.user) {
      return new Response(
        JSON.stringify({ success: false, error: createError?.message ?? 'Failed to create user' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
      )
    }

    // Insert profile row (no DB trigger exists for admin-created users)
    const { error: profileInsertError } = await supabaseAdmin
      .from('profiles')
      .insert({
        user_id: newUser.user.id,
        email,
        username,
        full_name: fullName ?? '',
        role: role ?? 'manager',
        data_access_level: dataAccessLevel ?? 'limited',
        ...(Array.isArray(assignedDistricts) && assignedDistricts.length > 0 ? { assigned_districts: assignedDistricts } : {}),
      })

    if (profileInsertError) {
      console.error('Profile insert failed:', profileInsertError)
    }

    await supabaseAdmin.from('security_audit_logs').insert({
      user_id: requestingUser.id,
      action: 'USER_CREATED',
      table_name: 'auth.users',
      record_id: newUser.user.id,
      new_values: {
        created_user_email: email,
        created_user_role: role ?? 'manager',
        created_at: new Date().toISOString(),
      },
    })

    return new Response(
      JSON.stringify({ success: true, userId: newUser.user.id }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )

  } catch (error) {
    console.error('Create user failed:', error)
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    )
  }
})
