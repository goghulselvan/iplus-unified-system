import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.55.0";
import { Resend } from "npm:resend@2.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

    const { event_type, school_name, school_id, amount } = await req.json();

    // Fetch superadmin + coordinator profile IDs
    const { data: staffProfiles } = await supabase
      .from("profiles")
      .select("id")
      .in("role", ["superadmin", "coordinator"]);

    if (!staffProfiles?.length) {
      return new Response(JSON.stringify({ success: true, skipped: "no staff profiles" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Resolve emails from auth.users using service role
    const staffIds = staffProfiles.map((p: { id: string }) => p.id);
    const { data: { users } } = await supabase.auth.admin.listUsers({ perPage: 200 });
    const staffEmails = users
      .filter((u) => staffIds.includes(u.id) && u.email)
      .map((u) => u.email!);

    if (!staffEmails.length) {
      return new Response(JSON.stringify({ success: true, skipped: "no staff emails" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let subject = "";
    let html = "";

    if (event_type === "payment_submitted") {
      subject = `[Portal] Payment Submitted — ${school_name}`;
      html = `
        <p>Hello,</p>
        <p><strong>${school_name}</strong> has submitted a payment proof via the school portal.</p>
        ${amount ? `<p>Amount: <strong>₹${Number(amount).toLocaleString("en-IN")}</strong></p>` : ""}
        <p>Please review and acknowledge the payment in the <strong>Payment Queue</strong>.</p>
        <p style="color:#6366f1;font-size:12px">iPlus CRM — automated notification</p>
      `;
    } else if (event_type === "registration_submitted") {
      subject = `[Portal] New School Registration — ${school_name}`;
      html = `
        <p>Hello,</p>
        <p><strong>${school_name}</strong> has submitted a portal registration request.</p>
        <p>Please review and approve or reject in <strong>Portal Access</strong>.</p>
        <p style="color:#6366f1;font-size:12px">iPlus CRM — automated notification</p>
      `;
    } else if (event_type === "slot_booked") {
      subject = `[Portal] Exam Slot Selected — ${school_name}`;
      html = `
        <p>Hello,</p>
        <p><strong>${school_name}</strong> has selected an exam slot via the school portal.</p>
        <p style="color:#6366f1;font-size:12px">iPlus CRM — automated notification</p>
      `;
    } else {
      return new Response(JSON.stringify({ success: false, error: "Unknown event_type" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    await resend.emails.send({
      from: "iPlus CRM <noreply@iplusedu.in>",
      to: staffEmails,
      subject,
      html,
    });

    return new Response(JSON.stringify({ success: true, notified: staffEmails.length }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("notify-staff-portal-event error:", error);
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
