import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const authHeader = req.headers.get("authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token);
    if (authErr || !user) {
      return new Response(JSON.stringify({ success: false, error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { schoolId } = await req.json() as { schoolId: string };

    const results: Record<string, string> = {};

    // Send interest_acknowledged email via template system
    const { error: emailErr } = await supabaseAdmin.functions.invoke("send-template-email", {
      body: { schoolId, templateType: "interest_acknowledged", userId: user.id },
    });
    results.email = emailErr ? `failed: ${emailErr.message}` : "sent";

    // Send interest_acknowledged WhatsApp via template system
    const { error: waErr } = await supabaseAdmin.functions.invoke("send-whatsapp-template", {
      body: { schoolId, templateKey: "interest_acknowledged" },
    });
    results.whatsapp = waErr ? `failed: ${waErr.message}` : "sent";

    return new Response(JSON.stringify({ success: true, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
