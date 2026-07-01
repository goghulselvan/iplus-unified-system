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
  // Logo with fallback to text - will use Supabase storage URL when available
  const logoHTML = `
    <svg width="200" height="70" viewBox="0 0 400 140" xmlns="http://www.w3.org/2000/svg" style="margin-bottom: 15px;">
      <!-- Background box -->
      <rect x="10" y="10" width="380" height="120" rx="8" fill="#1E3A8A" stroke="#FCD34D" stroke-width="4"/>

      <!-- Brain + hand icon -->
      <g transform="translate(30, 30)">
        <!-- Brain -->
        <circle cx="20" cy="20" r="15" fill="none" stroke="white" stroke-width="2"/>
        <circle cx="15" cy="15" r="3" fill="white"/>
        <circle cx="25" cy="18" r="2" fill="white"/>
        <circle cx="20" cy="25" r="2" fill="white"/>
        <!-- Hand -->
        <path d="M 35 35 L 40 20 M 40 20 L 45 22 M 40 20 L 42 28 M 40 20 L 38 30" stroke="white" stroke-width="2" fill="none"/>
        <!-- Star -->
        <path d="M 55 10 L 58 18 L 67 18 L 60 23 L 63 31 L 55 26 L 47 31 L 50 23 L 43 18 L 52 18 Z" fill="#FCD34D"/>
      </g>

      <!-- Text -->
      <text x="100" y="50" font-family="Arial, sans-serif" font-size="32" font-weight="bold" fill="white">iPlus</text>
      <text x="100" y="75" font-family="Arial, sans-serif" font-size="24" font-weight="bold" fill="white">OLYMPIADS</text>
    </svg>
  `;

  return `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            line-height: 1.6;
            color: #333;
            background-color: #f5f5f5;
            margin: 0;
            padding: 0;
        }
        .email-container {
            max-width: 600px;
            margin: 20px auto;
            background-color: white;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
            overflow: hidden;
        }
        .email-header {
            background: linear-gradient(135deg, ${BRAND_COLORS.dark_blue} 0%, ${BRAND_COLORS.primary} 100%);
            padding: 30px 20px;
            text-align: center;
            border-bottom: 4px solid ${BRAND_COLORS.accent};
        }
        .email-logo {
            max-height: 80px;
            margin-bottom: 15px;
        }
        .email-tagline {
            color: ${BRAND_COLORS.accent};
            font-size: 13px;
            font-weight: 600;
            letter-spacing: 1px;
            text-transform: uppercase;
            margin: 10px 0 0 0;
        }
        .email-content {
            padding: 40px 30px;
        }
        .email-content h1 {
            color: ${BRAND_COLORS.dark_blue};
            font-size: 24px;
            margin-top: 0;
            margin-bottom: 20px;
        }
        .email-content h2 {
            color: ${BRAND_COLORS.primary};
            font-size: 18px;
            margin-top: 25px;
            margin-bottom: 15px;
        }
        .email-content p {
            margin: 12px 0;
            color: #555;
        }
        .cta-button {
            display: inline-block;
            background: linear-gradient(135deg, ${BRAND_COLORS.primary} 0%, ${BRAND_COLORS.secondary} 100%);
            color: white;
            padding: 12px 30px;
            border-radius: 4px;
            text-decoration: none;
            font-weight: 600;
            margin: 20px 0;
        }
        .school-name {
            color: ${BRAND_COLORS.secondary};
            font-weight: 600;
        }
        .email-footer {
            background-color: #f9f9f9;
            border-top: 1px solid #e0e0e0;
            padding: 25px 30px;
            font-size: 12px;
            color: #888;
            text-align: center;
        }
        .divider {
            height: 2px;
            background: linear-gradient(90deg, transparent, ${BRAND_COLORS.accent}, transparent);
            margin: 25px 0;
        }
        @media only screen and (max-width: 600px) {
            .email-container {
                margin: 0;
                border-radius: 0;
            }
            .email-content {
                padding: 20px 15px;
            }
            .email-content h1 {
                font-size: 20px;
            }
        }
    </style>
</head>
<body>
    <div class="email-container">
        <div class="email-header">
            ${logoHTML}
            <div class="email-tagline">${BRAND_TAGLINE}</div>
        </div>
        <div class="email-content">
            ${schoolName ? `<p style="text-align: center; color: ${BRAND_COLORS.secondary}; font-size: 14px; margin-bottom: 20px;">Dear <span class="school-name">${schoolName}</span>,</p>` : ''}
            ${contentHTML}
        </div>
        <div class="email-footer">
            <div class="divider"></div>
            <p style="margin: 10px 0;">
                <strong>iPlus Olympiads</strong><br>
                Igniting Genius, Inspiring Excellence, Impacting the Future
            </p>
            <p style="margin: 10px 0; color: #999;">
                115, GST Road, Guduvancheri, Chennai 603 202<br>
                📞 +91 81110 66556 | 📧 contact@iplusedu.in
            </p>
            <p style="margin: 15px 0 0 0; font-size: 11px; color: #bbb;">
                This is an automated message from iPlus Olympiads. Please do not reply to this email.
            </p>
        </div>
    </div>
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

    // Wrap email body in branded HTML template
    const brandedEmailHTML = wrapBrandedEmail(emailBody, school.school_name);

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
