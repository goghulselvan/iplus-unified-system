import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.55.0";
import { Resend } from "npm:resend@2.0.0";

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));
const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Brand colors and styling
const BRAND_COLORS = {
  primary: '#4F46E5',
  secondary: '#7C3AED',
  accent: '#FCD34D',
  dark_blue: '#1E3A8A',
  white: '#FFFFFF',
};

const BRAND_TAGLINE = 'Ignite Inspire Impact';

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Clean email address (remove spaces, extra dots, etc.)
function cleanEmail(email: string): string {
  if (!email || typeof email !== 'string') return email;

  let cleaned = email.trim();
  cleaned = cleaned.replace(/\s/g, ''); // Remove spaces
  cleaned = cleaned.replace(/\.+/g, '.'); // Fix double dots
  cleaned = cleaned.replace(/^\.+|\.+$/g, ''); // Remove boundary dots

  return cleaned;
}

// Wrap email body in branded HTML template
function wrapBrandedEmail(contentHTML: string, schoolName?: string): string {
  const preheader = schoolName
    ? `iPlus Olympiads — a message for ${schoolName}`
    : `iPlus Olympiads`;

  return `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background:#ffffff;">
    <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:#ffffff;">${preheader}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;">
        <tr>
            <td align="center" style="padding:34px 20px;">
                <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#2b2b2b;">
                    <!-- Header -->
                    <tr>
                        <td style="background:#1E3A8A;border-radius:6px 6px 0 0;padding:20px 24px 16px;">
                            <span style="font-size:20px;font-weight:700;color:#ffffff;">&#x1D4F2;Plus Olympiads</span>
                            <span style="font-size:10px;color:#FCD34D;letter-spacing:2px;display:block;margin-top:4px;">IGNITE&nbsp;&nbsp;INSPIRE&nbsp;&nbsp;IMPACT</span>
                        </td>
                    </tr>
                    <tr>
                        <td style="background:#4F46E5;height:3px;font-size:0;line-height:0;">&nbsp;</td>
                    </tr>
                    <!-- Body -->
                    <tr>
                        <td style="padding:26px 0 0;font-size:15.5px;line-height:1.72;color:#2b2b2b;">
                            ${contentHTML}
                        </td>
                    </tr>
                    <!-- Footer -->
                    <tr>
                        <td style="padding:32px 0 0;">
                            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                                <tr>
                                    <td style="border-top:1px solid #e8e8e8;padding-top:20px;font-size:12px;color:#9aa0a6;line-height:1.6;">
                                        <p style="margin:0 0 4px;"><strong style="color:#1E3A8A;">iPlus Olympiads</strong>&nbsp;&nbsp;Ignite Inspire Impact</p>
                                        <p style="margin:0 0 4px;">115, GST Road, Guduvancheri, Chennai 603 202</p>
                                        <p style="margin:0 0 10px;">📞 +91 81110 66556 &nbsp;|&nbsp; 📧 <a href="mailto:contact@iplusedu.in" style="color:#4F46E5;text-decoration:none;">contact@iplusedu.in</a></p>
                                        <p style="margin:0;font-size:11px;color:#c0c0c0;">This is an automated message. Please do not reply to this email.</p>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>`;
}

interface SendEmailRequest {
  schoolId: string;
  templateType: string;
  userId: string;
  emailOverride?: string; // Optional: use this email instead of fetching from DB
}

serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { schoolId, templateType, userId, emailOverride }: SendEmailRequest = await req.json();
    
    console.log(`Processing email request - School: ${schoolId}, Template: ${templateType}, Email override: ${emailOverride}`);

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get school data
    const { data: school, error: schoolError } = await supabase
      .from("schools")
      .select("*, olympiad_projects!current_project_id(*)")
      .eq("id", schoolId)
      .single();

    if (schoolError || !school) {
      throw new Error(`School not found: ${schoolError?.message}`);
    }

    // Use email override if provided, otherwise use school email
    let recipientEmail = emailOverride || school.email;

    if (!recipientEmail) {
      throw new Error("School email is missing");
    }

    // Auto-clean email address (remove spaces, extra dots, etc.)
    recipientEmail = cleanEmail(recipientEmail);

    if (!recipientEmail.includes('@')) {
      throw new Error(`Invalid email after cleaning: ${emailOverride || school.email}`);
    }

    // Get active template for this project and type
    const { data: template, error: templateError } = await supabase
      .from("communication_templates")
      .select("*")
      .eq("project_id", school.current_project_id)
      .eq("template_type", templateType)
      .eq("is_active", true)
      .single();

    if (templateError || !template) {
      throw new Error(`Template not found: ${templateError?.message}`);
    }

    // Get student count for this school
    const { count: studentCount } = await supabase
      .from("student_registrations")
      .select("*", { count: "exact", head: true })
      .eq("school_id", schoolId);

    // Replace template variables
    const variables: Record<string, string> = {
      "{school_name}": school.school_name || "",
      "{ss_no}": school.ss_no?.toString() || "",
      "{contact_person}": school.contact_person_name || "",
      "{project_name}": school.olympiad_projects?.project_name || "",
      "{project_year}": school.olympiad_projects?.project_year?.toString() || "",
      "{payment_amount}": school.payment_received?.toString() || school.payment_amount?.toString() || "",
      "{payment_date}": school.payment_date || "",
      "{amount_received}": school.payment_received?.toString() || "0",
      "{balance_due}": school.outstanding_balance?.toString() || "0",
      "{outstanding_balance}": school.outstanding_balance?.toString() || "0",
      "{expected_amount}": school.expected_amount?.toString() || "0",
      "{student_count}": studentCount?.toString() || "0",
      "{district}": school.district || "",
      "{state}": school.state || "",
    };

    let emailBody = template.email_body;
    let subject = template.subject;

    Object.entries(variables).forEach(([key, value]) => {
      const regex = new RegExp(key.replace(/[{}]/g, "\\$&"), "g");
      emailBody = emailBody.replace(regex, value);
      subject = subject.replace(regex, value);
    });

    // If email body is already a full HTML document, send as-is; otherwise wrap
    const isFullHTML = emailBody.trim().toLowerCase().startsWith('<!doctype') || emailBody.trim().toLowerCase().startsWith('<html');
    const brandedEmailHTML = isFullHTML ? emailBody : wrapBrandedEmail(emailBody, school.school_name);

    // Send email via Resend
    const emailResponse = await resend.emails.send({
      from: "iPlus Olympiads <noreply@iplusedu.in>",
      replyTo: "contact@iplusedu.in",
      to: [recipientEmail],
      subject: subject,
      html: brandedEmailHTML,
    });

    console.log("Email sent successfully:", emailResponse);

    // Log communication in database
    await supabase.from("communications").insert({
      school_id: schoolId,
      user_id: userId,
      communication_type: "Email",
      message: `${template.template_name}: ${subject}`,
      template_type: templateType,
      email_status: "sent",
      project_id: school.current_project_id,
    });

    // Log activity
    await supabase.from("activity_logs").insert({
      school_id: schoolId,
      user_id: userId,
      activity_type: "email_sent",
      description: `Sent ${template.template_name} to ${recipientEmail}`,
      project_id: school.current_project_id,
    });

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: "Email sent successfully",
        emailId: emailResponse.data?.id 
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error: any) {
    console.error("Error in send-template-email:", error);
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error.message 
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
