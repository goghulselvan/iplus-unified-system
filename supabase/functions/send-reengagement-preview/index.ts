import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { Resend } from "npm:resend@2.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

// One-off: sends a copy of the exact re-engagement email (see
// send-reengagement-batch/index.ts) to Goghul for review. Not a reusable feature.
function emailHtml(schoolName: string, prospectId: string) {
  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#f4f4f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background-color:#f4f4f7;">
  <tr><td align="center" style="padding:20px 10px;">
    <table width="600" cellpadding="0" cellspacing="0" role="presentation" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">

      <tr><td style="background:linear-gradient(135deg,#7C3AED 0%,#4F46E5 100%);padding:40px 32px 36px;text-align:center;">
        <div style="font-size:11px;font-weight:600;letter-spacing:3px;color:rgba(255,255,255,0.7);text-transform:uppercase;margin-bottom:16px;">iPlus Olympiads 2026</div>
        <div style="font-size:28px;font-weight:700;color:#ffffff;line-height:1.3;margin-bottom:12px;">Still thinking about<br/>registering?</div>
        <div style="font-size:13px;color:rgba(255,255,255,0.8);font-style:italic;">Ignite Genius. Inspire Excellence.</div>
      </td></tr>

      <tr><td style="padding:32px 32px 24px;">
        <p style="margin:0 0 16px;font-size:16px;font-weight:700;color:#1a1a2e;">Dear ${schoolName} Team,</p>
        <p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#374151;">We noticed you checked out the iPlus Olympiads 2026 registration details recently — great to see your interest! Registrations are filling up fast, and we'd love to have your students take part.</p>
        <p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#374151;">If you have any questions about the process, subjects, or fees, just reply to this email or call us — we're happy to walk you through it.</p>
      </td></tr>

      <tr><td style="padding:0 32px 32px;text-align:center;">
        <a href="https://iplusedu.in/school/register" style="display:inline-block;background:linear-gradient(135deg,#7C3AED 0%,#4F46E5 100%);color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;padding:14px 32px;border-radius:8px;">Complete Your Registration &rarr;</a>
      </td></tr>

      <tr><td style="background:#f9fafb;border-top:1px solid #e5e7eb;padding:24px 32px;text-align:center;">
        <div style="font-size:14px;font-weight:600;color:#4F46E5;margin-bottom:6px;">iPlus Olympiads</div>
        <div style="font-size:12px;color:#6b7280;line-height:1.8;">
          Ivar Pro Learn for Universal Success Pvt. Ltd.<br/>
          115, GST Road, Guduvancheri, Chennai 603 202<br/>
          <a href="mailto:contact@iplusedu.in" style="color:#4F46E5;text-decoration:none;">contact@iplusedu.in</a>&nbsp;|&nbsp;<a href="tel:+918111066556" style="color:#4F46E5;text-decoration:none;">+91 81110 66556</a>
        </div>
        <div style="font-size:11px;color:#9ca3af;margin-top:10px;">&copy; 2026 iPlus Olympiads. All rights reserved.<br/>
          <a href="https://eucjeggfclztkbbupaav.supabase.co/functions/v1/campaign-unsubscribe?id=${prospectId}" style="color:#9ca3af;text-decoration:underline;">Unsubscribe from these emails</a>
        </div>
      </td></tr>

    </table>
  </td></tr>
</table>
</body>
</html>`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const res = await resend.emails.send({
      from: "iPlus Olympiads <noreply@iplusedu.in>",
      replyTo: "contact@iplusedu.in",
      to: ["goghulselvan@gmail.com"],
      subject: "[COPY FOR REVIEW] Still thinking about iPlus Olympiads 2026?",
      html: emailHtml("Sample School", "00000000-0000-0000-0000-000000000000"),
    });

    if ((res as any)?.error) {
      return new Response(JSON.stringify({ success: false, error: (res as any).error.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ success: true, message_id: (res as any)?.data?.id ?? null }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
