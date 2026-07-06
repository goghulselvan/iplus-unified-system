// Fired by trg_on_portal_registration_insert immediately after a school registers.
// Sends portal_welcome WA + email using registration data (no CRM school row needed).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { Resend } from "https://esm.sh/resend@3";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ASKEVA_URL = "https://backend.askeva.io/v1/message/send-message";

function normalizeMobile(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, "");
  if (digits.length === 10) return `91${digits}`;
  if (digits.length >= 11 && digits.length <= 15) return digits;
  return null;
}

function resolveVariable(
  source: string,
  customText: string | undefined,
  reg: Record<string, string | null>,
  project: Record<string, any> | null,
): string {
  switch (source) {
    case "school_name":     return reg.school_name ?? "";
    case "contact_person":  return reg.contact_person ?? "";
    case "district":        return reg.district ?? "";
    case "state":           return reg.state ?? "";
    case "district_state":  return [reg.district, reg.state].filter(Boolean).join(", ");
    case "project_name":    return project?.project_name ?? "";
    case "project_year":    return String(project?.project_year ?? "");
    case "project_name_year": return [project?.project_name, project?.project_year].filter(Boolean).join(" ");
    case "custom":          return customText ?? "";
    default:                return "";
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  const json = { ...CORS, "Content-Type": "application/json" };

  try {
    const { registration_id } = await req.json();
    if (!registration_id) {
      return new Response(JSON.stringify({ error: "registration_id required" }), { status: 400, headers: json });
    }

    const SUPABASE_URL            = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const ASKEVA_API_TOKEN        = Deno.env.get("ASKEVA_API_TOKEN");
    const RESEND_API_KEY          = Deno.env.get("RESEND_API_KEY");

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Fetch registration data
    const { data: reg, error: regErr } = await supabase
      .from("school_portal_registrations")
      .select("school_name, email, phone, district, city, state, contact_name, principal_name, corr_name")
      .eq("id", registration_id)
      .single();

    if (regErr || !reg) {
      throw new Error(`Registration not found: ${regErr?.message}`);
    }

    // Fetch active project
    const { data: project } = await supabase
      .from("olympiad_projects")
      .select("id, project_name, project_year")
      .eq("is_active", true)
      .single();

    const results: Record<string, string> = {};

    // ── Email ──────────────────────────────────────────────────────────────
    if (reg.email && project && RESEND_API_KEY) {
      const { data: tmpl } = await supabase
        .from("communication_templates")
        .select("subject, email_body")
        .eq("project_id", project.id)
        .eq("template_type", "portal_welcome")
        .single();

      if (tmpl) {
        const vars: Record<string, string> = {
          school_name: reg.school_name ?? "",
          district:    reg.district ?? "",
          state:       reg.state ?? "",
          city:        reg.city ?? "",
          project_name: project.project_name ?? "",
          project_year: String(project.project_year ?? ""),
        };

        const html = tmpl.email_body.replace(/\{(\w+)\}/g, (_: string, k: string) => vars[k] ?? "");

        const resend = new Resend(RESEND_API_KEY);
        const { error: emailErr } = await resend.emails.send({
          from:    "iPlus Olympiads <noreply@iplusedu.in>",
          replyTo: "contact@iplusedu.in",
          to:      [reg.email],
          subject: tmpl.subject,
          html,
        });
        results.email = emailErr ? `failed: ${JSON.stringify(emailErr)}` : "sent";
      } else {
        results.email = "no template";
      }
    } else {
      results.email = "skipped";
    }

    // ── WhatsApp ───────────────────────────────────────────────────────────
    const recipient = normalizeMobile(reg.phone);
    if (recipient && project && ASKEVA_API_TOKEN) {
      const { data: tmpl } = await supabase
        .from("whatsapp_templates")
        .select("askeva_template_name, language_code, template_type, header_media_url, header_document_filename, body_variables, raw_payload_template")
        .eq("project_id", project.id)
        .eq("template_key", "portal_welcome")
        .eq("is_active", true)
        .single();

      if (tmpl) {
        const regData: Record<string, string | null> = {
          school_name: reg.school_name,
          district:    reg.district,
          state:       reg.state,
          city:        reg.city,
          // Meta rejects empty template parameters (#131008), so never resolve to ""
          contact_person: reg.contact_name || reg.principal_name || reg.corr_name || reg.school_name,
        };

        const components: any[] = [];

        if (tmpl.header_media_url && (tmpl.template_type as string).includes("image")) {
          components.push({ type: "header", parameters: [{ type: "image", image: { link: tmpl.header_media_url } }] });
        } else if (tmpl.header_media_url && (tmpl.template_type as string).includes("video")) {
          components.push({ type: "header", parameters: [{ type: "video", video: { link: tmpl.header_media_url } }] });
        } else if (tmpl.header_media_url && (tmpl.template_type as string).includes("document")) {
          components.push({
            type: "header",
            parameters: [{ type: "document", document: { link: tmpl.header_media_url, filename: tmpl.header_document_filename || "document.pdf" } }],
          });
        }

        const vars = (tmpl.body_variables as Array<{ index: number; source: string; customText?: string }>) || [];
        if (vars.length > 0) {
          const sorted = [...vars].sort((a, b) => a.index - b.index);
          components.push({
            type: "body",
            parameters: sorted.map((v) => ({
              type: "text",
              text: resolveVariable(v.source, v.customText, regData, project),
            })),
          });
        }

        const payload: any = {
          to:   recipient,
          type: "template",
          template: {
            name:     tmpl.askeva_template_name,
            language: { policy: "deterministic", code: tmpl.language_code },
            ...(components.length > 0 ? { components } : {}),
          },
        };

        const waRes = await fetch(`${ASKEVA_URL}?token=${encodeURIComponent(ASKEVA_API_TOKEN)}`, {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify(payload),
        });

        const waBody = await waRes.json().catch(() => ({}));
        const waOk   = waRes.ok && waBody?.status !== "error" && waBody?.success !== false;
        results.whatsapp = waOk ? "sent" : `failed: ${JSON.stringify(waBody).slice(0, 200)}`;
      } else {
        results.whatsapp = "no template";
      }
    } else {
      results.whatsapp = !recipient ? "invalid phone" : !ASKEVA_API_TOKEN ? "no token" : "skipped";
    }

    console.log(`notify-registration-welcome reg=${registration_id}`, results);

    return new Response(JSON.stringify({ ok: true, results }), { headers: json });
  } catch (err: any) {
    console.error("notify-registration-welcome error:", err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: json });
  }
});
