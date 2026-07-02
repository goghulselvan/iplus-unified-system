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

    const TEMPLATE_NAME = Deno.env.get("EBROCHURE_TEMPLATE_NAME") ?? "iplus_ebrochure_2026";

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

    const { schoolId, phone, schoolName, district, state, saveContact, contactName, contactRole } = await req.json() as {
      schoolId: string;
      phone: string;
      schoolName: string;
      district?: string;
      state?: string;
      saveContact?: boolean;
      contactName?: string;
      contactRole?: string;
    };

    if (!schoolId || !phone || !schoolName) {
      return new Response(JSON.stringify({ success: false, error: "schoolId, phone, and schoolName are required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const mobile = normalizeMobile(phone);
    if (!mobile) {
      return new Response(JSON.stringify({ success: false, error: "Invalid phone number" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get active project's brochure URL
    const { data: project } = await supabaseAdmin
      .from("olympiad_projects")
      .select("id, brochure_url, project_name, project_year")
      .eq("is_active", true)
      .maybeSingle();

    if (!project?.brochure_url) {
      return new Response(JSON.stringify({ success: false, error: "No brochure uploaded for the active project. Please upload one in Project Management." }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Build Askeva payload — document header + body with school_name variable
    const payload = {
      messaging_product: "whatsapp",
      to: mobile,
      type: "template",
      template: {
        name: TEMPLATE_NAME,
        language: { code: "en" },
        components: [
          {
            type: "header",
            parameters: [
              {
                type: "document",
                document: {
                  link: project.brochure_url,
                  filename: `iPlus Olympiads ${project.project_year} Brochure.pdf`,
                },
              },
            ],
          },
          {
            type: "body",
            parameters: [
              { type: "text", text: schoolName },
            ],
          },
        ],
      },
    };

    const res = await fetch(`${ASKEVA_URL}?token=${encodeURIComponent(ASKEVA_API_TOKEN)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const body = await res.json().catch(() => ({}));

    if (!res.ok) {
      return new Response(JSON.stringify({ success: false, error: body?.error?.message ?? "WhatsApp send failed" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Update brochure_delivery_status: NULL/Digital Sent → Digital Sent; Physical Only → Both Physical & Digital
    const { data: schoolStatus } = await supabaseAdmin
      .from("schools").select("brochure_delivery_status").eq("id", schoolId).single();
    const current = schoolStatus?.brochure_delivery_status;
    const newStatus = current === "Physical Only" ? "Both Physical & Digital" : "Digital Sent";
    await supabaseAdmin.from("schools").update({ brochure_delivery_status: newStatus }).eq("id", schoolId);

    // Log communication
    await supabaseAdmin.from("communications").insert({
      school_id: schoolId,
      communication_type: "WhatsApp",
      message: `E-Brochure sent to ${phone}${contactName ? ` (${contactName})` : ""}`,
      contacted_person_name: contactName ?? null,
      contacted_mobile_no: phone,
      user_id: user.id,
      project_id: project.id ?? null,
    }).then(({ error }) => { if (error) console.error("Failed to log communication:", error); });

    // Save contact to school's additional_contacts if requested
    if (saveContact && contactName) {
      const { data: schoolData } = await supabaseAdmin
        .from("schools")
        .select("additional_contacts")
        .eq("id", schoolId)
        .single();

      const existing: any[] = schoolData?.additional_contacts ?? [];
      const alreadyExists = existing.some((c: any) => c.mobile === phone);

      if (!alreadyExists && existing.length < 5) {
        const updated = [...existing, { name: contactName, mobile: phone, role: contactRole ?? "" }];
        await supabaseAdmin
          .from("schools")
          .update({ additional_contacts: updated })
          .eq("id", schoolId);
      }
    }

    return new Response(JSON.stringify({ success: true, message: "E-Brochure sent successfully" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err: any) {
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
