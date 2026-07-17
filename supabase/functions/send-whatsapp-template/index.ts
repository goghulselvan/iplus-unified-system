import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { z } from "https://esm.sh/zod@3.23.8";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const ASKEVA_URL = "https://backend.askeva.io/v1/message/send-message";

const BodySchema = z.object({
  schoolId: z.string().uuid(),
  templateKey: z.string().min(1).max(100),
  mobileOverride: z.string().optional(),
  // Per-send document header (e.g. a school's receipt PDF) — only used when the
  // template is a document-header template; overrides the static header_media_url.
  documentUrl: z.string().url().optional(),
  documentFilename: z.string().max(200).optional(),
});

function normalizeMobile(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, "");
  if (digits.length === 10) return `91${digits}`; // assume India default
  if (digits.length >= 10 && digits.length <= 15) return digits;
  return null;
}

function resolveVariable(
  source: string,
  customText: string | undefined,
  ctx: {
    school: any; project: any; workflow: any; studentCount: number;
  }
): string {
  const { school, project, workflow, studentCount } = ctx;
  switch (source) {
    case "school_name": return school?.school_name || "";
    case "ss_no": return String(school?.ss_no ?? "");
    case "contact_person": return school?.contact_person_name || "";
    case "mobile1": return school?.mobile1 || "";
    case "district": return school?.district || "";
    case "state": return school?.state || "";
    case "board": return school?.board || "";
    case "project_name": return project?.project_name || "";
    case "project_year": return String(project?.project_year ?? "");
    case "project_name_year": return [project?.project_name, project?.project_year].filter(Boolean).join(" ");
    case "district_state": return [school?.district, school?.state].filter(Boolean).join(", ");
    case "student_count": return String(studentCount ?? 0);
    // Payment figures live on schools (maintained by the payment RPCs); the
    // workflow copies are not updated by acknowledge_portal_payment — reading
    // them showed ₹0 while the email showed the real amount.
    case "payment_amount": return String(school?.payment_received ?? workflow?.payment_received ?? 0);
    case "payment_date": return workflow?.payment_date || "";
    case "expected_amount": return String(school?.expected_amount ?? workflow?.expected_amount ?? 0);
    case "outstanding_balance": return String(school?.outstanding_balance ?? workflow?.outstanding_balance ?? 0);
    case "registration_status": return workflow?.registration_status || "";
    case "custom": return customText || "";
    default: return "";
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
  const ASKEVA_API_TOKEN = Deno.env.get("ASKEVA_API_TOKEN");

  if (!ASKEVA_API_TOKEN) {
    return new Response(JSON.stringify({ success: false, error: "ASKEVA_API_TOKEN not configured" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  // Validate JWT (or accept a trusted service-role call from another edge function)
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ success: false, error: "Missing Authorization header" }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
  let user: { id: string | null };
  if (authHeader === `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`) {
    // Trusted system call (e.g. portal registration) — attribute logs to the system account
    user = { id: "8dd2a8b7-1349-4e7e-b821-3171bd6bf2cc" }; // iPlus Super Admin's profiles.user_id (FK target on communications.user_id)
  } else {
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user: authUser }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !authUser) {
      return new Response(JSON.stringify({ success: false, error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    user = authUser;
  }

  // Validate input
  let body: unknown;
  try { body = await req.json(); } catch {
    return new Response(JSON.stringify({ success: false, error: "Invalid JSON" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return new Response(JSON.stringify({ success: false, error: parsed.error.flatten() }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
  const { schoolId, templateKey, mobileOverride, documentUrl, documentFilename } = parsed.data;

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Load school + project + workflow + student count
  const { data: school, error: schoolErr } = await admin
    .from("schools").select("*").eq("id", schoolId).maybeSingle();
  if (schoolErr || !school) {
    return new Response(JSON.stringify({ success: false, error: "School not found" }),
      { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
  const projectId = school.current_project_id;
  if (!projectId) {
    return new Response(JSON.stringify({ success: false, error: "School has no active project" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const [{ data: project }, { data: workflow }, { count: studentCount }, { data: template }] = await Promise.all([
    admin.from("olympiad_projects").select("*").eq("id", projectId).maybeSingle(),
    admin.from("school_project_workflow").select("*").eq("school_id", schoolId).eq("project_id", projectId).maybeSingle(),
    admin.from("student_registrations").select("*", { count: "exact", head: true })
      .eq("school_id", schoolId).eq("project_id", projectId),
    admin.from("whatsapp_templates").select("*")
      .eq("project_id", projectId).eq("template_key", templateKey).eq("is_active", true).maybeSingle(),
  ]);

  if (!template) {
    return new Response(JSON.stringify({ success: false, error: `No active template '${templateKey}' for this project` }),
      { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const recipient = normalizeMobile(mobileOverride || school.mobile2 || school.mobile1);
  if (!recipient) {
    return new Response(JSON.stringify({ success: false, error: "Invalid or missing recipient mobile number" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  // Build AskEVA payload
  const ctx = { school, project, workflow, studentCount: studentCount || 0 };
  const components: any[] = [];

  if (template.header_media_url && (template.template_type as string).includes("image")) {
    components.push({
      type: "header",
      parameters: [{ type: "image", image: { link: template.header_media_url } }],
    });
  } else if (template.header_media_url && (template.template_type as string).includes("video")) {
    components.push({
      type: "header",
      parameters: [{ type: "video", video: { link: template.header_media_url } }],
    });
  } else if ((documentUrl || template.header_media_url) && (template.template_type as string).includes("document")) {
    components.push({
      type: "header",
      parameters: [{
        type: "document",
        document: {
          link: documentUrl || template.header_media_url,
          filename: documentFilename || template.header_document_filename || "document.pdf",
        },
      }],
    });
  }

  const vars = (template.body_variables as Array<{ index: number; source: string; customText?: string }>) || [];
  if (vars.length > 0) {
    const sorted = [...vars].sort((a, b) => a.index - b.index);
    components.push({
      type: "body",
      parameters: sorted.map((v) => ({
        type: "text",
        text: resolveVariable(v.source, v.customText, ctx),
      })),
    });
  }

  const payload: any = {
    to: recipient,
    type: "template",
    template: {
      name: template.askeva_template_name,
      language: { policy: "deterministic", code: template.language_code },
      ...(components.length > 0 ? { components } : {}),
    },
  };

  // For carousel/authentication, prefer raw payload template if provided
  if ((template.template_type === "carousel" || template.template_type === "authentication")
      && template.raw_payload_template) {
    Object.assign(payload, { template: { ...payload.template, ...(template.raw_payload_template as object) } });
  }

  // Send to AskEVA
  console.log("[send-whatsapp-template] Sending to AskEVA", {
    url: ASKEVA_URL,
    recipient,
    templateKey,
    askevaTemplateName: template.askeva_template_name,
    languageCode: template.language_code,
    payload,
  });

  let askevaStatus = 0;
  let askevaResponse: any = null;
  let askevaRawText = "";
  try {
    const res = await fetch(`${ASKEVA_URL}?token=${encodeURIComponent(ASKEVA_API_TOKEN)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    askevaStatus = res.status;
    askevaRawText = await res.text();
    try { askevaResponse = JSON.parse(askevaRawText); } catch { askevaResponse = { raw: askevaRawText }; }
  } catch (e: any) {
    askevaResponse = { error: e?.message || "network error" };
  }

  console.log("[send-whatsapp-template] AskEVA response", {
    status: askevaStatus,
    body: askevaResponse,
  });

  // AskEVA sometimes returns HTTP 200 with a logical error in the body.
  // Treat any of the following as failure:
  const httpOk = askevaStatus >= 200 && askevaStatus < 300;
  const logicalError =
    askevaResponse?.status === "error" ||
    askevaResponse?.success === false ||
    (typeof askevaResponse?.error === "string" && askevaResponse.error.length > 0) ||
    (askevaResponse?.code && Number(askevaResponse.code) >= 400);
  const success = httpOk && !logicalError;

  const errorMessage = !success
    ? (askevaResponse?.message ||
       askevaResponse?.error ||
       askevaResponse?.raw ||
       `AskEVA returned HTTP ${askevaStatus}`)
    : null;

  // Log to communications
  const wamid: string | null = askevaResponse?.messages?.[0]?.id ?? null;
  await admin.from("communications").insert([{
    school_id: schoolId,
    project_id: projectId,
    user_id: user.id,
    communication_type: "WhatsApp" as any,
    template_type: templateKey,
    message: `[AskEVA] ${template.template_name}`,
    contacted_mobile_no: recipient,
    contacted_person_name: school.contact_person_name || null,
    email_status: success ? "sent" : "failed",
    wamid,
    delivery_status: success ? (wamid ? "sent" : null) : "failed",
  }]);

  // Activity log
  await admin.from("activity_logs").insert([{
    user_id: user.id,
    school_id: schoolId,
    project_id: projectId,
    activity_type: "whatsapp_send",
    description: `WhatsApp template '${templateKey}' ${success ? "sent" : "failed"} to ${recipient}`,
    new_value: success ? "sent" : `failed: ${JSON.stringify(askevaResponse).slice(0, 500)}`,
  }]);

  if (!success) {
    // Return HTTP 200 with success:false so the body reaches the client.
    // (supabase.functions.invoke discards the body on non-2xx.)
    return new Response(JSON.stringify({
      success: false,
      error: errorMessage,
      askevaStatus,
      askeva: askevaResponse,
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  return new Response(JSON.stringify({ success: true, askeva: askevaResponse }), {
    status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
