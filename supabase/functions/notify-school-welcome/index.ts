// Called by DB trigger trg_fn_welcome_on_registration_start when
// schools.registration_status transitions to 'In Progress'.
// Sends portal_welcome WA + email to the school.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { school_id } = await req.json();
    if (!school_id) {
      return new Response(JSON.stringify({ error: "school_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const results: Record<string, string> = {};

    // Send portal_welcome email
    const { error: emailErr } = await supabase.functions.invoke("send-template-email", {
      body: { schoolId: school_id, templateType: "portal_welcome" },
    });
    results.email = emailErr ? `failed: ${emailErr.message}` : "sent";

    // Send portal_welcome WhatsApp
    const { error: waErr } = await supabase.functions.invoke("send-whatsapp-template", {
      body: { schoolId: school_id, templateKey: "portal_welcome" },
    });
    results.whatsapp = waErr ? `failed: ${waErr.message}` : "sent";

    console.log(`notify-school-welcome school=${school_id}`, results);

    return new Response(JSON.stringify({ ok: true, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("notify-school-welcome error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
