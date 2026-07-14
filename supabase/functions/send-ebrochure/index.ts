import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "npm:resend@2.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ASKEVA_URL = "https://backend.askeva.io/v1/message/send-message";
const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

function normalizeMobile(raw: string): string | null {
  const digits = String(raw).replace(/\D/g, "");
  if (digits.length === 10) return `91${digits}`;
  if (digits.length >= 11 && digits.length <= 15) return digits;
  return null;
}

// Matches the exact brand system used by every other CRM email
// (see communication_templates.email_body for 'interest_acknowledged').
// {school_name}, {brochure_url}, {project_year} are substituted before sending.
const EBROCHURE_EMAIL_HTML = `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#f4f4f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background-color:#f4f4f7;">
  <tr><td align="center" style="padding:20px 10px;">
    <table width="600" cellpadding="0" cellspacing="0" role="presentation" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">

      <!-- Header -->
      <tr><td style="background:linear-gradient(135deg,#7C3AED 0%,#4F46E5 100%);padding:40px 32px 36px;text-align:center;">
        <div style="font-size:11px;font-weight:600;letter-spacing:3px;color:rgba(255,255,255,0.7);text-transform:uppercase;margin-bottom:16px;">iPlus Olympiads {project_year}</div>
        <div style="font-size:30px;font-weight:700;color:#ffffff;line-height:1.25;margin-bottom:12px;">iPlus Olympiads<br/>Brochure</div>
        <div style="font-size:13px;color:rgba(255,255,255,0.8);font-style:italic;">Ignite Genius. Inspire Excellence.</div>
      </td></tr>

      <!-- Status banner -->
      <tr><td style="background:#f5f3ff;border-bottom:1px solid #ede9fe;padding:12px 32px;text-align:center;">
        <span style="font-size:11px;font-weight:700;letter-spacing:2px;color:#4F46E5;text-transform:uppercase;">&#10003;&nbsp;&nbsp;E-BROCHURE</span>
      </td></tr>

      <!-- Body -->
      <tr><td style="padding:32px 32px 24px;">
        <p style="margin:0 0 16px;font-size:16px;font-weight:700;color:#1a1a2e;">Dear {school_name} Team,</p>
        <p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#374151;">Please find the iPlus Olympiads {project_year} brochure below, with complete details on olympiad subjects, exam schedule, fee structure, and how to register your school.</p>
      </td></tr>

      <!-- CTAs -->
      <tr><td style="padding:0 32px 16px;text-align:center;">
        <a href="{brochure_url}" style="display:inline-block;background:linear-gradient(135deg,#7C3AED 0%,#4F46E5 100%);color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;padding:14px 32px;border-radius:8px;">View Brochure &rarr;</a>
      </td></tr>
      <tr><td style="padding:0 32px 32px;text-align:center;">
        <a href="https://iplusedu.in/school/register" style="display:inline-block;background:transparent;border:2px solid #7C3AED;color:#7C3AED;text-decoration:none;font-size:14px;font-weight:600;padding:11px 28px;border-radius:8px;">Register Your School &rarr;</a>
      </td></tr>

      <!-- Footer -->
      <tr><td style="background:#f9fafb;border-top:1px solid #e5e7eb;padding:24px 32px;text-align:center;">
        <div style="font-size:14px;font-weight:600;color:#4F46E5;margin-bottom:6px;">iPlus Olympiads</div>
        <div style="font-size:12px;color:#6b7280;line-height:1.8;">
          Ivar Pro Learn for Universal Success Pvt. Ltd.<br/>
          115, GST Road, Guduvancheri, Chennai 603 202<br/>
          <a href="mailto:support@iplusedu.in" style="color:#4F46E5;text-decoration:none;">support@iplusedu.in</a>&nbsp;|&nbsp;<a href="tel:+918111066556" style="color:#4F46E5;text-decoration:none;">+91 81110 66556</a>
        </div>
        <div style="font-size:11px;color:#9ca3af;margin-top:10px;">&copy; 2026 iPlus Olympiads. All rights reserved.</div>
      </td></tr>

    </table>
  </td></tr>
</table>
</body>
</html>`;

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
    // The gateway (verify_jwt) has already verified the JWT signature. getUser()
    // additionally requires a live GoTrue session and can reject otherwise-valid
    // staff logins, so fall back to the verified JWT claims when it fails.
    let userId: string | null = null;
    const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token);
    if (user) {
      userId = user.id;
    } else {
      try {
        const b64 = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
        const payload = JSON.parse(atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4)));
        if (payload.role === "authenticated" && payload.sub) userId = payload.sub;
        console.log("getUser failed, JWT-claims fallback used:", authErr?.message, "role:", payload.role);
      } catch (_) { /* not a decodable JWT */ }
    }
    if (!userId) {
      return new Response(JSON.stringify({ success: false, error: `Unauthorized${authErr?.message ? `: ${authErr.message}` : ""}` }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { schoolId, prospectSchoolId, phone, email, schoolName, district, state, saveContact, contactName, contactRole } = await req.json() as {
      schoolId?: string;
      prospectSchoolId?: string;
      phone?: string;
      email?: string;
      schoolName: string;
      district?: string;
      state?: string;
      saveContact?: boolean;
      contactName?: string;
      contactRole?: string;
    };

    if ((!schoolId && !prospectSchoolId) || (!phone && !email) || !schoolName) {
      return new Response(JSON.stringify({ success: false, error: "schoolId or prospectSchoolId, schoolName, and phone or email are required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get active project's brochure URL — needed by both channels
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

    // Resolve CRM school id up front — direct, or via the prospect link — used by
    // both channels below for delivery-status + communication logging.
    let effectiveSchoolId = schoolId ?? null;
    if (!effectiveSchoolId && prospectSchoolId) {
      const { data: linked } = await supabaseAdmin
        .from("schools").select("id").eq("prospect_school_id", prospectSchoolId).maybeSingle();
      effectiveSchoolId = linked?.id ?? null;
    }

    async function markDigitalSent() {
      if (!effectiveSchoolId) return;
      const { data: schoolStatus } = await supabaseAdmin
        .from("schools").select("brochure_delivery_status").eq("id", effectiveSchoolId).single();
      const current = schoolStatus?.brochure_delivery_status;
      const newStatus = current === "Physical Only" ? "Both Physical & Digital" : "Digital Sent";
      await supabaseAdmin.from("schools").update({ brochure_delivery_status: newStatus }).eq("id", effectiveSchoolId);
    }

    if (phone) {
      const mobile = normalizeMobile(phone);
      if (!mobile) {
        return new Response(JSON.stringify({ success: false, error: "Invalid phone number" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

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
      const wamid: string | null = body?.messages?.[0]?.id ?? null;

      if (!res.ok) {
        return new Response(JSON.stringify({ success: false, error: body?.error?.message ?? "WhatsApp send failed" }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (effectiveSchoolId) {
        await markDigitalSent();

        await supabaseAdmin.from("communications").insert({
          school_id: effectiveSchoolId,
          communication_type: "WhatsApp",
          message: `E-Brochure sent to ${phone}${contactName ? ` (${contactName})` : ""}`,
          contacted_person_name: contactName ?? null,
          contacted_mobile_no: phone,
          user_id: userId,
          project_id: project.id ?? null,
          wamid,
          delivery_status: wamid ? "sent" : null,
        }).then(({ error }) => { if (error) console.error("Failed to log communication:", error); });

        if (saveContact && contactName) {
          const { data: schoolData } = await supabaseAdmin
            .from("schools")
            .select("additional_contacts")
            .eq("id", effectiveSchoolId)
            .single();

          const existing: any[] = schoolData?.additional_contacts ?? [];
          const alreadyExists = existing.some((c: any) => c.mobile === phone);

          if (!alreadyExists && existing.length < 5) {
            const updated = [...existing, { name: contactName, mobile: phone, role: contactRole ?? "" }];
            await supabaseAdmin
              .from("schools")
              .update({ additional_contacts: updated })
              .eq("id", effectiveSchoolId);
          }
        }
      }
    }

    if (email) {
      if (!email.includes("@")) {
        return new Response(JSON.stringify({ success: false, error: "Invalid email address" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const html = EBROCHURE_EMAIL_HTML
        .replaceAll("{school_name}", schoolName)
        .replaceAll("{brochure_url}", project.brochure_url)
        .replaceAll("{project_year}", String(project.project_year ?? ""));
      const subject = `iPlus Olympiads ${project.project_year ?? ""} — Brochure for ${schoolName}`;

      try {
        await resend.emails.send({
          from: "iPlus Olympiads <noreply@iplusedu.in>",
          replyTo: "contact@iplusedu.in",
          to: [email],
          subject,
          html,
        });
      } catch (err: any) {
        return new Response(JSON.stringify({ success: false, error: err.message ?? "Email send failed" }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (effectiveSchoolId) {
        await markDigitalSent();

        await supabaseAdmin.from("communications").insert({
          school_id: effectiveSchoolId,
          communication_type: "Email",
          message: `E-Brochure emailed to ${email}`,
          user_id: userId,
          project_id: project.id ?? null,
          email_status: "sent",
        }).then(({ error }) => { if (error) console.error("Failed to log communication:", error); });
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
