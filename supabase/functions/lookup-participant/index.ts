import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-api-key',
};

// Rate limiting: track requests per API key - INCREASED to handle bulk operations
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();
const RATE_LIMIT = 1000; // requests per minute (increased from 100)
const RATE_WINDOW = 60 * 1000; // 1 minute in ms

function checkRateLimit(apiKeyHash: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(apiKeyHash);
  
  if (!entry || now > entry.resetTime) {
    rateLimitMap.set(apiKeyHash, { count: 1, resetTime: now + RATE_WINDOW });
    return true;
  }
  
  if (entry.count >= RATE_LIMIT) {
    return false;
  }
  
  entry.count++;
  return true;
}

// SHA-256 hash function matching the frontend ApiKeyManager
async function hashApiKeySHA256(key: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(key);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// Extract only digits from any input - FORMAT PROOF
function extractDigits(input: any): string {
  // Handle any input type: string, number, etc.
  const str = String(input ?? '');
  // Remove ALL non-digit characters
  return str.replace(/\D/g, '');
}

// Format a 14-digit string into display format: X-XX-XXX-XXX-XX-XXX
function formatRegistrationNumber(digits: string): string {
  if (digits.length !== 14) {
    return digits; // Return as-is if not 14 digits
  }
  return `${digits[0]}-${digits.slice(1, 3)}-${digits.slice(3, 6)}-${digits.slice(6, 9)}-${digits.slice(9, 11)}-${digits.slice(11, 14)}`;
}

// Validate API key against database
async function validateApiKey(supabase: any, apiKey: string): Promise<{ valid: boolean; keyId?: string; keyHash?: string; keyName?: string }> {
  const keyHash = await hashApiKeySHA256(apiKey);
  
  const { data, error } = await supabase
    .from('api_keys')
    .select('id, name, is_active, expires_at')
    .eq('key_hash', keyHash)
    .single();
  
  if (error || !data) {
    console.log('API key not found in database');
    return { valid: false, keyHash };
  }
  
  // Check if key is active
  if (!data.is_active) {
    console.log('API key is inactive:', data.name);
    return { valid: false, keyHash, keyName: data.name };
  }
  
  // Check if key is expired
  if (data.expires_at && new Date(data.expires_at) < new Date()) {
    console.log('API key is expired:', data.name);
    return { valid: false, keyHash, keyName: data.name };
  }
  
  console.log('API key validated:', data.name);
  return { valid: true, keyId: data.id, keyHash, keyName: data.name };
}

// Log API request (for all outcomes, not just success)
async function logApiRequest(
  supabase: any,
  keyHash: string,
  keyId: string | null,
  status: number,
  count: number,
  startTime: number,
  req: Request
) {
  try {
    const clientIP = req.headers.get('x-forwarded-for') || req.headers.get('cf-connecting-ip') || 'unknown';
    const userAgent = req.headers.get('user-agent') || 'unknown';
    
    await supabase.from('api_request_logs').insert({
      api_key_hash: keyHash || 'unknown',
      api_key_id: keyId,
      endpoint: 'lookup-participant',
      registration_numbers_count: count,
      ip_address: clientIP,
      user_agent: userAgent.substring(0, 255),
      response_status: status,
      response_time_ms: Date.now() - startTime,
    });
  } catch (e) {
    console.error('Failed to log request:', e);
  }
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  let keyHash: string | undefined;
  let keyId: string | undefined;
  let supabase: any;
  
  try {
    // Initialize Supabase client early for logging
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    supabase = createClient(supabaseUrl, supabaseKey);

    // Only allow POST requests
    if (req.method !== 'POST') {
      return new Response(
        JSON.stringify({ success: false, error: 'Method not allowed' }),
        { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get API key from header
    const apiKey = req.headers.get('X-API-Key') || req.headers.get('x-api-key');
    
    if (!apiKey) {
      console.log('Missing API key');
      return new Response(
        JSON.stringify({ success: false, error: 'Missing API key' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate API key against database
    const validation = await validateApiKey(supabase, apiKey);
    keyHash = validation.keyHash;
    keyId = validation.keyId;
    
    if (!validation.valid) {
      await logApiRequest(supabase, keyHash!, null, 401, 0, startTime, req);
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid or inactive API key' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check rate limit using key hash
    if (!checkRateLimit(keyHash!)) {
      console.log(`Rate limit exceeded for key ${keyId}`);
      await logApiRequest(supabase, keyHash!, keyId!, 429, 0, startTime, req);
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: `Rate limit exceeded. Max ${RATE_LIMIT} requests per minute.`,
          retry_after_seconds: 60
        }),
        { 
          status: 429, 
          headers: { 
            ...corsHeaders, 
            'Content-Type': 'application/json',
            'Retry-After': '60'
          } 
        }
      );
    }

    // Parse request body
    let body: any;
    try {
      body = await req.json();
    } catch (e) {
      console.log('Invalid JSON body');
      await logApiRequest(supabase, keyHash!, keyId!, 400, 0, startTime, req);
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid JSON body' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    const { registration_number, registration_numbers } = body;

    // Validate input
    if (!registration_number && !registration_numbers) {
      await logApiRequest(supabase, keyHash!, keyId!, 400, 0, startTime, req);
      return new Response(
        JSON.stringify({ success: false, error: 'Missing registration_number or registration_numbers in request body' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Build list of digit-only registration numbers to query
    // Map: original input -> digits-only version
    const originalToDigits: Map<string, string> = new Map();

    if (registration_number !== undefined && registration_number !== null) {
      const original = String(registration_number);
      const digits = extractDigits(original);
      if (digits.length === 14) {
        originalToDigits.set(original, digits);
      } else {
        console.log(`Invalid registration number format: "${original}" -> "${digits}" (${digits.length} digits)`);
      }
    } else if (Array.isArray(registration_numbers)) {
      // Limit bulk queries to 500 records
      if (registration_numbers.length > 500) {
        await logApiRequest(supabase, keyHash!, keyId!, 400, registration_numbers.length, startTime, req);
        return new Response(
          JSON.stringify({ success: false, error: 'Maximum 500 registration numbers per request' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      for (const num of registration_numbers) {
        const original = String(num);
        const digits = extractDigits(original);
        if (digits.length === 14) {
          originalToDigits.set(original, digits);
        } else {
          console.log(`Skipping invalid registration number: "${original}" -> "${digits}" (${digits.length} digits)`);
        }
      }
    }

    if (originalToDigits.size === 0) {
      console.log('No valid 14-digit registration numbers provided');
      await logApiRequest(supabase, keyHash!, keyId!, 400, 0, startTime, req);
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'No valid registration numbers provided. Each must contain exactly 14 digits.' 
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const digitsList = Array.from(new Set(originalToDigits.values()));
    console.log(`Looking up ${digitsList.length} unique registration numbers (from ${originalToDigits.size} inputs)`);

    // Query database using registration_number_digits for format-proof matching
    // Fall back to registration_number_generated if digits column is not populated yet
    let data: any[] = [];
    let queryError: any = null;
    
    // First, try querying by registration_number_digits
    const { data: digitsData, error: digitsError } = await supabase
      .from('student_registrations')
      .select('registration_number_generated, registration_number_digits, student_name, student_class, schools(school_name)')
      .in('registration_number_digits', digitsList);

    if (digitsError) {
      console.error('Database query error (digits):', digitsError);
      queryError = digitsError;
    } else {
      data = digitsData || [];
    }

    // If no results found via digits column, try legacy query by formatted number
    // This handles the transition period before backfill is complete
    if (data.length === 0 && !queryError) {
      console.log('No results via digits column, trying formatted lookup...');
      const formattedNumbers = digitsList.map(d => formatRegistrationNumber(d));
      const { data: legacyData, error: legacyError } = await supabase
        .from('student_registrations')
        .select('registration_number_generated, registration_number_digits, student_name, student_class, schools(school_name)')
        .in('registration_number_generated', formattedNumbers);
      
      if (legacyError) {
        console.error('Database query error (legacy):', legacyError);
        queryError = legacyError;
      } else {
        data = legacyData || [];
      }
    }

    if (queryError) {
      await logApiRequest(supabase, keyHash!, keyId!, 500, originalToDigits.size, startTime, req);
      return new Response(
        JSON.stringify({ success: false, error: 'Database query failed' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Build a map from digits -> record data
    const digitsToRecord = new Map<string, any>();
    for (const record of data) {
      // Use the digits column if available, otherwise extract from formatted
      const recordDigits = record.registration_number_digits || extractDigits(record.registration_number_generated);
      digitsToRecord.set(recordDigits, record);
    }

    // Build response map (keyed by original input format for backward compatibility)
    const resultMap: Record<string, { student_name: string; student_class: string; registration_number: string; school_name: string | null } | null> = {};

    for (const [original, digits] of originalToDigits) {
      const record = digitsToRecord.get(digits);
      if (record) {
        resultMap[original] = {
          student_name: record.student_name,
          student_class: record.student_class,
          registration_number: record.registration_number_generated, // Always return canonical formatted version
          school_name: record.schools?.school_name || null,
        };
      } else {
        resultMap[original] = null;
      }
    }

    // Update last_used_at on the API key
    await supabase
      .from('api_keys')
      .update({ last_used_at: new Date().toISOString() })
      .eq('id', keyId);

    const foundCount = Object.values(resultMap).filter(v => v !== null).length;
    const notFoundCount = originalToDigits.size - foundCount;
    
    console.log(`Found ${foundCount}/${originalToDigits.size} participants in ${Date.now() - startTime}ms`);

    // Log the successful request
    await logApiRequest(supabase, keyHash!, keyId!, 200, originalToDigits.size, startTime, req);

    // Build participants array for compatibility with external systems
    const participants = Object.entries(resultMap)
      .filter(([_, value]) => value !== null)
      .map(([regNum, value]) => ({
        registration_number: value!.registration_number, // Canonical formatted version
        input_registration_number: regNum, // What the caller sent
        student_name: value!.student_name,
        name: value!.student_name, // Alias for compatibility
        student_class: value!.student_class,
        school_name: value!.school_name,
      }));

    return new Response(
      JSON.stringify({
        success: true,
        participants: participants, // Array format for external systems
        data: resultMap, // Keep existing format for backward compatibility
        meta: {
          requested: originalToDigits.size,
          found: foundCount,
          not_found: notFoundCount,
        },
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Unexpected error:', error);
    // Try to log the error if we have supabase client
    if (supabase && keyHash) {
      await logApiRequest(supabase, keyHash, keyId || null, 500, 0, startTime, req);
    }
    return new Response(
      JSON.stringify({ success: false, error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
