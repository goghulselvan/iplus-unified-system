import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ASKEVA_URL = "https://backend.askeva.io/v1/message/send-message";

function normalizeMobile(raw: string): string | null {
  const digits = String(raw).replace(/\D/g, "");
  if (digits.length === 10) return `91${digits}`;
  if (digits.length >= 11 && digits.length <= 15) return digits;
  return null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const ASKEVA_API_TOKEN = Deno.env.get("ASKEVA_API_TOKEN");
    if (!ASKEVA_API_TOKEN) throw new Error("ASKEVA_API_TOKEN not configured");

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Verify caller is authenticated
    const authHeader = req.headers.get("authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token);
    if (authErr || !user) {
      return new Response(JSON.stringify({ success: false, error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { templateKey, schools } = await req.json() as {
      templateKey: string;
      // Each item: { id, school_name, mobile, district, state }
      schools: Array<{ id: string; school_name: string; mobile: string; district?: string; state?: string }>;
    };

    if (!templateKey || !Array.isArray(schools) || schools.length === 0) {
      return new Response(JSON.stringify({ success: false, error: "templateKey and schools[] required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch template from DB
    const { data: tmpl } = await supabaseAdmin
      .from("whatsapp_templates")
      .select("*")
      .eq("template_name", templateKey)
      .single();

    const results: Array<{ school_name: string; mobile: string; success: boolean; error?: string }> = [];

    for (const school of schools) {
      const mobile = normalizeMobile(school.mobile);
      if (!mobile) {
        results.push({ school_name: school.school_name, mobile: school.mobile, success: false, error: "Invalid mobile" });
        continue;
      }

      // Build components — if template has components, fill school_name as first variable
      const components = tmpl?.components ?? [];
      const filledComponents = components.map((comp: any) => {
        if (comp.type === "body" && Array.isArray(comp.parameters)) {
          return {
            ...comp,
            parameters: comp.parameters.map((p: any) => {
              if (p.type === "text" && p.text === "{{school_name}}") return { ...p, text: school.school_name };
              if (p.type === "text" && p.text === "{{district}}")    return { ...p, text: school.district ?? "" };
              if (p.type === "text" && p.text === "{{state}}")       return { ...p, text: school.state ?? "" };
              return p;
            }),
          };
        }
        return comp;
      });

      const payload = {
        messaging_product: "whatsapp",
        to: mobile,
        type: "template",
        template: {
          name: templateKey,
          language: { code: tmpl?.language ?? "en" },
          components: filledComponents.length > 0 ? filledComponents : undefined,
        },
      };

      try {
        const res = await fetch(`${ASKEVA_URL}?token=${encodeURIComponent(ASKEVA_API_TOKEN)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const body = await res.json().catch(() => ({}));
        if (res.ok) {
          results.push({ school_name: school.school_name, mobile, success: true });
        } else {
          results.push({ school_name: school.school_name, mobile, success: false, error: body?.error?.message ?? "Send failed" });
        }
      } catch (e: any) {
        results.push({ school_name: school.school_name, mobile, success: false, error: e.message });
      }
    }

    const sent  = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;

    return new Response(JSON.stringify({ success: true, sent, failed, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err: any) {
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
