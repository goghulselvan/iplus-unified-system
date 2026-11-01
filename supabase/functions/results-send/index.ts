import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.55.0";
import { Resend } from "npm:resend@2.0.0";
import { presign, type R2Config } from "../results-files/sign.ts";
import { isAllowedKey, resultsKeyPrefix } from "../results-files/keys.ts";
import { runSend, SendError, type Batch, type Item, type SchoolInfo, type Store, type WhatsAppConfig } from "./handler.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const SEVEN_DAYS = 7 * 24 * 60 * 60;
const ASKEVA_URL = "https://backend.askeva.io/v1/message/send-message";
const WA_TEMPLATE_KEY = "results_released";
const NOT_SUPERADMIN = "Only a superadmin can release or send results.";

/** The gateway has already verified the JWT; read the user id from it (auth.getUser() has 401'd real logins). */
function userIdFromJwt(authHeader: string): string | null {
  try {
    const part = authHeader.replace(/^Bearer\s+/i, "").split(".")[1];
    const claims = JSON.parse(atob(part.replace(/-/g, "+").replace(/_/g, "/")));
    return typeof claims.sub === "string" ? claims.sub : null;
  } catch {
    return null;
  }
}

function makeStore(db: SupabaseClient): Store {
  return {
    async getBatch(id) {
      const { data } = await db.from("result_send_batches").select("id, project_id, channel, test_target, status").eq("id", id).maybeSingle();
      return (data as Batch | null) ?? null;
    },
    async claim(id, from, userId) {
      const { data } = await db.from("result_send_batches")
        .update({ status: "sending", approved_by: userId, approved_at: new Date().toISOString() })
        .eq("id", id).eq("status", from).select("id");
      return (data?.length ?? 0) === 1;
    },
    async items(batchId) {
      const { data, error } = await db.from("result_send_items")
        .select("id, batch_id, school_id, target, payload, status, error, attempts").eq("batch_id", batchId);
      if (error) throw new SendError(500, "The list of schools could not be loaded.");
      return (data ?? []) as Item[];
    },
    async isReleased(projectId, schoolId) {
      const { data } = await db.from("school_result_release").select("id").eq("project_id", projectId).eq("school_id", schoolId).maybeSingle();
      return !!data;
    },
    async school(schoolId) {
      const { data } = await db.from("schools").select("school_name, contact_person_name, principal_name").eq("id", schoolId).maybeSingle();
      return (data as SchoolInfo | null) ?? null;
    },
    async markItem(id, patch) {
      const { error } = await db.from("result_send_items")
        .update({ status: patch.status, error: patch.error, attempts: patch.attempts, sent_at: patch.status === "sent" ? new Date().toISOString() : null })
        .eq("id", id);
      if (error) throw new Error("The result of this message could not be saved.");
    },
    async finish(id) {
      await db.from("result_send_batches").update({ status: "done" }).eq("id", id);
    },
  };
}

serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    if (req.method !== "POST") return json({ error: "Please send a POST request." }, 405);
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Please sign in to send results." }, 401);
    const userId = userIdFromJwt(authHeader);
    if (!userId) return json({ error: "Please sign in again." }, 401);

    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    // Server-side superadmin check: profiles.user_id = auth user AND role = 'superadmin'.
    const { data: prof, error: profErr } = await db.from("profiles").select("role").eq("user_id", userId).eq("role", "superadmin").maybeSingle();
    if (profErr) return json({ error: "We could not check your permissions. Please sign in again." }, 401);
    if (!prof) return json({ error: NOT_SUPERADMIN }, 403);

    let body: { action?: string; batchId?: string; files?: Record<string, { key: string; label: string }[]>; retryItemIds?: string[] };
    try { body = await req.json(); } catch { return json({ error: "The request was not valid. Please try again." }, 400); }
    if (!body.batchId || typeof body.batchId !== "string") return json({ error: "Choose a send first." }, 400);
    const store = makeStore(db);
    const batch = await store.getBatch(body.batchId);
    if (!batch) return json({ error: "This send could not be found." }, 404);

    // Attach the uploaded zip files to the items of a STAGED batch (nothing is sent).
    if (body.action === "attach") {
      if (batch.status !== "staged") return json({ error: "Files can only be added before a send starts." }, 409);
      const items = await store.items(batch.id);
      let attached = 0;
      for (const [schoolId, files] of Object.entries(body.files ?? {})) {
        const item = items.find((i) => i.school_id === schoolId);
        if (!item || !Array.isArray(files)) continue;
        const prefix = resultsKeyPrefix(batch.project_id, item.payload.ssNo);
        const clean = files
          .filter((f) => f && typeof f.key === "string" && f.key.startsWith(prefix) && isAllowedKey(f.key))
          .map((f) => ({ key: f.key, label: String(f.label ?? "Results").slice(0, 120) }));
        if (clean.length === 0) continue;
        const { error } = await db.from("result_send_items").update({ payload: { ...item.payload, files: clean } }).eq("id", item.id).eq("batch_id", batch.id);
        if (error) return json({ error: "The result files could not be attached. Please try again." }, 500);
        attached++;
      }
      return json({ ok: true, attached });
    }

    if (body.action !== "send") return json({ error: "Unknown action. Use attach or send." }, 400);

    const cfg: R2Config = {
      accountId: Deno.env.get("R2_ACCOUNT_ID") ?? "", accessKeyId: Deno.env.get("R2_ACCESS_KEY_ID") ?? "",
      secretAccessKey: Deno.env.get("R2_SECRET_ACCESS_KEY") ?? "", bucket: Deno.env.get("R2_BUCKET") ?? "",
    };
    if (!cfg.accountId || !cfg.accessKeyId || !cfg.secretAccessKey || !cfg.bucket) {
      return json({ error: "File storage is not set up yet. Please contact the administrator." }, 500);
    }

    const { data: project } = await db.from("olympiad_projects").select("project_name").eq("id", batch.project_id).maybeSingle();
    const projectName = (project as { project_name?: string } | null)?.project_name ?? null;

    let whatsapp: WhatsAppConfig | null = null;
    let waTemplateName = "";
    let waLang = "en";
    if (batch.channel === "whatsapp") {
      const { data: t } = await db.from("whatsapp_templates").select("askeva_template_name, language_code, body_variables")
        .eq("project_id", batch.project_id).eq("template_key", WA_TEMPLATE_KEY).eq("is_active", true).maybeSingle();
      if (!t) return json({ error: "WhatsApp template not set up yet." }, 400);
      waTemplateName = t.askeva_template_name; waLang = t.language_code;
      whatsapp = { vars: (t.body_variables as WhatsAppConfig["vars"]) ?? [] };
    }

    // Secrets resolved lazily, inside the handler.
    const resendKey = Deno.env.get("RESEND_API_KEY");
    const askevaToken = Deno.env.get("ASKEVA_API_TOKEN");
    const resend = resendKey ? new Resend(resendKey) : null;

    const summary = await runSend(store, {
      presignGet: (key) => presign(cfg, "GET", key, undefined, SEVEN_DAYS),
      async email(m) {
        if (!resend) return { error: "Email sending is not set up yet." };
        // resend.emails.send never throws: always check { error }.
        const { error } = await resend.emails.send({
          from: "iPlus Olympiads <noreply@iplusedu.in>", replyTo: "contact@iplusedu.in",
          to: [m.to], subject: m.subject, html: m.html, text: m.text,
        });
        return { error: error ? (error.message || "Resend refused the message.") : null };
      },
      async whatsapp(m) {
        if (!askevaToken) return { error: "WhatsApp sending is not set up yet." };
        const payload = {
          to: `91${m.to.replace(/\D/g, "").slice(-10)}`, type: "template",
          template: {
            name: waTemplateName, language: { policy: "deterministic", code: waLang },
            ...(m.params.length ? { components: [{ type: "body", parameters: m.params.map((text) => ({ type: "text", text })) }] } : {}),
          },
        };
        try {
          const res = await fetch(`${ASKEVA_URL}?token=${encodeURIComponent(askevaToken)}`, {
            method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
          });
          const text = await res.text();
          let b: Record<string, unknown> = {};
          try { b = JSON.parse(text); } catch { b = { raw: text }; }
          const logical = b.status === "error" || b.success === false || (typeof b.error === "string" && b.error.length > 0) || (b.code != null && Number(b.code) >= 400);
          if (res.ok && !logical) return { error: null };
          return { error: String(b.message ?? b.error ?? b.raw ?? `AskEVA returned HTTP ${res.status}`) };
        } catch (e) {
          return { error: e instanceof Error ? e.message : "The WhatsApp service could not be reached." };
        }
      },
    }, { batchId: batch.id, userId, retryItemIds: Array.isArray(body.retryItemIds) ? body.retryItemIds : undefined, projectName, whatsapp });
    return json(summary);
  } catch (e) {
    if (e instanceof SendError) return json({ error: e.message }, e.status);
    return json({ error: "Something went wrong while sending. Nothing was sent twice; check the history." }, 500);
  }
});
