import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "npm:resend@2.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

// One-off targeted re-engagement send — the 48 prospect schools who clicked a link in
// the Jun29-Jul21 bulk warm-up campaign (opened AND clicked through, well above the
// ~45k recipient pool) but have never been formally contacted. Excludes the 3 schools
// already CRM-linked/mid-registration (those get a phone call, not another email) and
// anyone with email_unsubscribed=true as of send time.
const TARGETS: { email: string; school_name: string; prospect_school_id: string }[] = [
  { email: "abrartamboli65@gmai.com", school_name: "Thafizul Qurana Lower Primary School Athani", prospect_school_id: "e352642e-6979-41e2-862a-f05f8b051909" },
  { email: "admingnssouth@gopalanschool.com", school_name: "Gopalan National School", prospect_school_id: "0ff85151-ed39-4775-8203-b1803062d0da" },
  { email: "administrator.kerurbgkt@rvkcbse.in", school_name: "Rashtrottana Vidya Kendra Kerur", prospect_school_id: "2c573c48-afe0-4f15-9361-e43b7d660582" },
  { email: "bharathischool.prl@gmail.com", school_name: "Bharathi Nursery And Primary School, Velliyanai", prospect_school_id: "522d6a23-8e12-4b36-9594-417e341307e0" },
  { email: "brcranebennur@gmail.com", school_name: "Has Little Star English Medium School Ranebennur", prospect_school_id: "f7d08143-8ba6-49a2-8d6b-7f88a6328dff" },
  { email: "christosemhschool22@gmai.com", school_name: "Christo Em School", prospect_school_id: "b61d10b3-29d7-4225-b339-fa2be1e89a7e" },
  { email: "devupdesai@gmail.com", school_name: "Icon Future International School", prospect_school_id: "aa5ecab3-97f9-41db-ac96-2cff5b4c2489" },
  { email: "husnakouser7898@gmil.com", school_name: "Pine Hall English School", prospect_school_id: "6aa37057-d7aa-4a21-93e0-d35e609caaa3" },
  { email: "hydcm.etechno@narayanagroup.com", school_name: "Naryana High School, Charminar", prospect_school_id: "f2d71548-a5f1-4f39-916e-65274b867d92" },
  { email: "indraindrasen853@gmai.com", school_name: "Indrasen School E/M", prospect_school_id: "1cc25479-dce5-4551-ad42-62b747b39896" },
  { email: "info@jainheritageschool.com", school_name: "Jain Heritage School", prospect_school_id: "47f06a7a-e46f-4f2a-94e1-e6de3e823b1d" },
  { email: "josalayamschool@gmail.com", school_name: "Josalayam Emlps Cheranelloor", prospect_school_id: "f13df112-cf24-4f9b-a0f4-58da0f7d08f2" },
  { email: "jpvrmd@gmai.com", school_name: "Jnan Prabodhini Vidyalaya Kannada Higher Primary School Ramdurg", prospect_school_id: "de095007-024e-4a73-bdec-3c4c250c49b5" },
  { email: "kalaimagalschool87@gmail.com", school_name: "Kalaimagal N&P Scl - Boothipuram", prospect_school_id: "6a0ce800-80dc-45ed-877a-2016695f94e6" },
  { email: "kistappa1975@gmai.com", school_name: "National Em High School Pedda Thumbalam", prospect_school_id: "a297e284-d52f-45cb-a835-582bb2827146" },
  { email: "linges@123gmail.com", school_name: "Shree Lingeshwar Hps Tellur", prospect_school_id: "50b10583-25a8-4447-a39f-48a83a16d062" },
  { email: "madhi.kumarsan@gmai.com", school_name: "Kalaimagal Middle School", prospect_school_id: "3ab5eb39-f7a4-4c54-9be7-b2b6bc1cec05" },
  { email: "manoji@123gmail.com", school_name: "Khps Sant Shivaramdada", prospect_school_id: "466b5a05-1403-4d9d-ab7b-ede0ea73f458" },
  { email: "mariadasschool@gmail.com", school_name: "M/S Mariyadas High School", prospect_school_id: "56dc5823-666b-4685-8a5b-b149d4f8d284" },
  { email: "meomaripeda123@gmai.com", school_name: "Sri Sai Sandeepani Voc Jr College Maripeda", prospect_school_id: "e4a661b8-97a4-4747-9dde-99072f5f1fc2" },
  { email: "meoraikode@gmil.com", school_name: "Sri Vivekananda High School", prospect_school_id: "2c793810-4f64-4890-ab30-7e0be7a34def" },
  { email: "mgs@smis.edu.in", school_name: "Marian Global School", prospect_school_id: "8611ae25-b0e2-4c56-adad-d23e4dc3b6fe" },
  { email: "mmkpuccnn0383@gmai.com", school_name: "Mmk Independent P U College", prospect_school_id: "ed3828fd-a765-4f3c-ab41-6fcc40ce4377" },
  { email: "mrsmariadasschool@gmail.com", school_name: "Mariadas School, Sriharipuram", prospect_school_id: "63c2b52c-af1d-4f35-a10a-c725d61acfb7" },
  { email: "newsharadaoublicschool@gmai.com", school_name: "New Sharadha Public School", prospect_school_id: "e4d86bea-f058-4507-894c-9cbfd4b5b4eb" },
  { email: "nicemission@gmai.com", school_name: "Vidya Jyothi Upper Primary School (Em)", prospect_school_id: "927fa03e-f77d-4751-b748-83bc071f74f0" },
  { email: "nobleschool2003@gmail.com", school_name: "Noble Matriculation Higher Secondary School, Aruppukottai", prospect_school_id: "904b5742-2ebc-4d9b-9b1f-f54a17d44582" },
  { email: "pakkuganu@gmail.com", school_name: "Vidyaranya Kan Medium Hs Anklagi", prospect_school_id: "b7961fce-dc84-4e7b-a21c-c78a85ffb2db" },
  { email: "pggavade@gmain.com", school_name: "Mahalaxmi Highschool (Unaided) Basrikatti", prospect_school_id: "1d1ffb79-b443-4b4a-b89c-8f528d1be29c" },
  { email: "principal.hangalhvr@rvkcbse.in", school_name: "Rashtrotthana Vidya Kendra", prospect_school_id: "71fe01de-850c-46da-ad3e-32eb30e6dd8e" },
  { email: "punithavidhyalaya@gmai.com", school_name: "Punitha Vidyalaya Nursery & Primary School", prospect_school_id: "06fd76b6-3215-467c-abac-3a60fe7e7376" },
  { email: "qishighschool@gmail.com", school_name: "Qis High School", prospect_school_id: "cc14cffc-46b7-4bb1-b36b-5e85ad9cfceb" },
  { email: "rosheeroshan@gmai.com", school_name: "Dr.Shi.Mu.Sha P.U College-Virakthamatha Doddapete", prospect_school_id: "d630b7c7-08a6-4bd9-be34-d5ba84b0575b" },
  { email: "saimadhava402@gmai.com", school_name: "Sai Madhava Vdlayam Namidio", prospect_school_id: "5dfadaeb-b669-49f5-beb8-4735f462bbdd" },
  { email: "samskrutisystem123@gmai.com", school_name: "Samskruti Hs, Kandukur", prospect_school_id: "bba2b31c-a190-4f8d-a272-9cd41a61a18a" },
  { email: "shabu335@gmail.com", school_name: "Gitam Up School Balgera", prospect_school_id: "511780f8-34cc-4d4c-8df4-a6a88751ffb1" },
  { email: "slsenglishmedium@gmail.com", school_name: "St Lasalle Nursury And Primary School, Suranam", prospect_school_id: "0188eb9c-1a92-497a-a039-69037b7b52ad" },
  { email: "smioreprimaryschool1955@gmailm.com", school_name: "Lps Smiore Devagiri", prospect_school_id: "546c76c6-b66d-4605-94ac-4161d7184e5c" },
  { email: "spschool@gmai.com", school_name: "Shanthinikethan Public School Koppal", prospect_school_id: "4000d5ff-5dd4-4bf1-b403-914cf6ebca30" },
  { email: "sribharathiemschool@gmai.com", school_name: "Sri Bharathi Em School Pippara", prospect_school_id: "15e60dcc-0a38-43e8-8c45-157b68e9baae" },
  { email: "sritrikoteswaravidyalayam@gmai.com", school_name: "Sri Trikoteswara Vidyalayam, Adurupalli", prospect_school_id: "2125050c-64a4-4166-be39-0f672ba80ae0" },
  { email: "srvskolur@gmai.com", school_name: "Lps Sri Ramalingeshwara Kolur", prospect_school_id: "b2b127ec-e5d0-45a8-97d9-1f44e9cf33d5" },
  { email: "stmarysnpschool1993@gmil.com", school_name: "St. Mary'S Nps Vettoornimadam", prospect_school_id: "4c55d905-7c7d-471c-b53b-907fb91288a5" },
  { email: "svmmschool2017@gmail.com", school_name: "Shree Vidya Mandir Matric. Hr. Sec. School Pallikaranai", prospect_school_id: "3c8e85fe-fe78-44fc-aca6-4b2db610e1f2" },
  { email: "unitedhighschoolhsn@gmail.com", school_name: "United High School", prospect_school_id: "85181285-781e-42de-a798-a1244365c7e5" },
  { email: "veereshnavali@gmail.com", school_name: "Unaid-S L V V S Makkalmane Ilkal", prospect_school_id: "e5ae0b20-ff8b-42da-8003-abb786e356d5" },
  { email: "vijayakumtakar64@gmai.com", school_name: "K P C L Model Kannada Medium Higher Primary School Ambikanagar, Haliyal", prospect_school_id: "39fa9b35-04d1-4839-b7b8-30a7465647bd" },
  { email: "wisdom656527@gmai.com", school_name: "Wisdom Hs", prospect_school_id: "ff7aa876-aa2a-439a-9c73-215d5c90886c" },
];

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
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: activeProject } = await supabaseAdmin
      .from("olympiad_projects").select("id").eq("is_active", true).maybeSingle();

    const { data: campaign, error: campErr } = await supabaseAdmin
      .from("campaigns")
      .insert({
        name: "Warm re-engagement — clicked but unregistered (2026-07-22)",
        description: "Targeted send to 48 prospects who opened + clicked the Jun-Jul bulk warm-up email but never registered. Not part of the general bulk campaign.",
        channel: "email",
        status: "sending",
        audience_filters: {},
        audience_count: TARGETS.length,
        target_count: TARGETS.length,
        project_id: activeProject?.id ?? null,
      })
      .select("id")
      .single();
    if (campErr) throw campErr;

    let sent = 0, skipped = 0, failed = 0;
    const errors: string[] = [];

    for (const t of TARGETS) {
      const { data: prospect } = await supabaseAdmin
        .from("prospect_schools")
        .select("email_unsubscribed")
        .eq("id", t.prospect_school_id)
        .maybeSingle();

      if (prospect?.email_unsubscribed) {
        skipped++;
        await supabaseAdmin.from("campaign_schools").insert({
          campaign_id: campaign.id, prospect_school_id: t.prospect_school_id,
          status: "skipped", error_message: "unsubscribed",
        });
        continue;
      }

      try {
        const res = await resend.emails.send({
          from: "iPlus Olympiads <noreply@iplusedu.in>",
          replyTo: "contact@iplusedu.in",
          to: [t.email],
          subject: "Still thinking about iPlus Olympiads 2026?",
          html: emailHtml(t.school_name, t.prospect_school_id),
        });

        if ((res as any)?.error) {
          failed++;
          errors.push(`${t.email}: ${(res as any).error.message}`);
          await supabaseAdmin.from("campaign_schools").insert({
            campaign_id: campaign.id, prospect_school_id: t.prospect_school_id,
            status: "failed", error_message: (res as any).error.message,
          });
        } else {
          sent++;
          await supabaseAdmin.from("campaign_schools").insert({
            campaign_id: campaign.id, prospect_school_id: t.prospect_school_id,
            status: "sent", sent_at: new Date().toISOString(), message_id: (res as any)?.data?.id ?? null,
          });
        }
      } catch (err: any) {
        failed++;
        errors.push(`${t.email}: ${err.message}`);
        await supabaseAdmin.from("campaign_schools").insert({
          campaign_id: campaign.id, prospect_school_id: t.prospect_school_id,
          status: "failed", error_message: err.message,
        });
      }
    }

    await supabaseAdmin.from("campaigns").update({
      status: "sent", completed_at: new Date().toISOString(),
      sent_count: sent, failed_count: failed,
    }).eq("id", campaign.id);

    return new Response(JSON.stringify({ success: true, campaign_id: campaign.id, sent, skipped, failed, errors }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
