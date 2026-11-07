import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.55.0";
import { Resend } from "npm:resend@2.0.0";
import { presign, type R2Config } from "../results-files/sign.ts";
import { isAllowedKey, resultsKeyPrefix } from "../results-files/keys.ts";
import { closeStuck, MSG, runSend, SendError, type Batch, type Item, type Store, type WhatsAppConfig } from "./handler.ts";

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

const ITEM_COLS = "id, batch_id, school_id, target, payload, status, error, attempts";

function makeStore(db: SupabaseClient): Store & {
  setUnknown(ids: string[], msg: string): Promise<void>;
  failPending(ids: string[], msg: string): Promise<void>;
} {
  return {
    async getBatch(id) {
      const { data } = await db.from("result_send_batches").select("id, project_id, channel, test_target, status, approved_by, approved_at").eq("id", id).maybeSingle();
      return (data as Batch | null) ?? null;
    },
    async claim(id, from, userId) {
      const { data } = await db.from("result_send_batches")
        .update({ status: "sending", approved_by: userId, approved_at: new Date().toISOString() })
        .eq("id", id).eq("status", from).select("id");
      return (data?.length ?? 0) === 1;
    },
    async items(batchId) {
      const { data, error } = await db.from("result_send_items").select(ITEM_COLS).eq("batch_id", batchId);
      if (error) throw new SendError(500, "The list of schools could not be loaded.");
      return (data ?? []) as Item[];
    },
    async claimItem(id, from) {
      // Compare-and-set: the UPDATE only matches while the row is still in `from` with the
      // attempts value we read, so exactly one caller gets a row back. attempts is bumped here.
      const { data: cur } = await db.from("result_send_items").select("attempts").eq("id", id).eq("status", from).maybeSingle();
      if (!cur) return null;
      const { data } = await db.from("result_send_items")
        .update({ status: "sending", attempts: (cur.attempts as number) + 1, error: null })
        .eq("id", id).eq("status", from).eq("attempts", cur.attempts).select(ITEM_COLS);
      return ((data ?? [])[0] as Item | undefined) ?? null;
    },
    async isReleased(projectId, schoolId) {
      const { data, error } = await db.from("school_result_release").select("id").eq("project_id", projectId).eq("school_id", schoolId).maybeSingle();
      if (error) throw new Error("release check failed"); // fails closed: the item is recorded as failed
      return !!data;
    },
    async markItem(id, patch) {
      const { data, error } = await db.from("result_send_items")
        .update({ status: patch.status, error: patch.error, sent_at: patch.status === "sent" ? new Date().toISOString() : null })
        .eq("id", id).eq("status", "sending").select("id");
      if (error) throw new Error("The result of this message could not be saved.");
      return (data?.length ?? 0) === 1;
    },
    async finish(id) {
      await db.from("result_send_batches").update({ status: "done" }).eq("id", id);
    },
    async logCommunication(r) {
      await db.from("communications").insert(r.channel === "email"
        ? { school_id: r.school_id, project_id: r.project_id, user_id: r.user_id, communication_type: "Email", message: r.message, template_type: "results_released", email_status: r.ok ? "sent" : "failed" }
        : { school_id: r.school_id, project_id: r.project_id, user_id: r.user_id, communication_type: "WhatsApp", template_type: "results_released", message: r.message, contacted_mobile_no: r.mobile, email_status: r.ok ? "sent" : "failed", wamid: r.wamid, delivery_status: r.ok ? (r.wamid ? "sent" : null) : "failed" });
    },
    async setUnknown(ids, msg) {
      if (ids.length) await db.from("result_send_items").update({ status: "unknown", error: msg }).in("id", ids).eq("status", "sending");
    },
    async failPending(ids, msg) {
      if (ids.length) await db.from("result_send_items").update({ status: "failed", error: msg }).in("id", ids).eq("status", "pending");
    },
  };
}

serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    if (req.method !== "POST") return json({ error: "Please send a POST request." }, 405);
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Please sign in to send results." }, 401);

    // Role check with the caller's own JWT (PostgREST verifies the signature; is_superadmin reads
    // profiles.user_id = auth.uid() AND role = 'superadmin'). Same pattern as results-files.
    const caller = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });
    const { data: isSuper, error: roleErr } = await caller.rpc("is_superadmin");
    if (roleErr) return json({ error: "We could not check your permissions. Please sign in again." }, 401);
    if (isSuper !== true) return json({ error: NOT_SUPERADMIN }, 403);
    const userId = userIdFromJwt(authHeader); // only read after the signature-checked call above
    if (!userId) return json({ error: "Please sign in again." }, 401);
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

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
      // Snapshot the greeting and project name now, so the preview and the send use the same text.
      const { data: proj } = await db.from("olympiad_projects").select("project_name").eq("id", batch.project_id).maybeSingle();
      const snapProject = (proj as { project_name?: string } | null)?.project_name ?? null;
      let attached = 0;
      for (const [schoolId, files] of Object.entries(body.files ?? {})) {
        const item = items.find((i) => i.school_id === schoolId);
        if (!item || !Array.isArray(files)) continue;
        const prefix = resultsKeyPrefix(batch.project_id, item.payload.ssNo);
        const clean = files
          .filter((f) => f && typeof f.key === "string" && f.key.startsWith(prefix) && isAllowedKey(f.key))
          .map((f) => ({ key: f.key, label: String(f.label ?? "Results").slice(0, 120) }));
        if (clean.length === 0) continue;
        const { data: sch } = await db.from("schools").select("contact_person_name, principal_name").eq("id", schoolId).maybeSingle();
        const snapContact = (sch?.contact_person_name as string) || (sch?.principal_name as string) || null;
        const { error } = await db.from("result_send_items").update({ payload: { ...item.payload, files: clean, contactName: snapContact, projectName: snapProject } }).eq("id", item.id).eq("batch_id", batch.id);
        if (error) return json({ error: "The result files could not be attached. Please try again." }, 500);
        attached++;
      }
      return json({ ok: true, attached });
    }

    if (body.action === "close") {
      const r = await closeStuck(store, batch.id);
      return json(r);
    }

    if (body.action !== "send") return json({ error: "Unknown action. Use attach, send or close." }, 400);

    const cfg: R2Config = {
      accountId: Deno.env.get("R2_ACCOUNT_ID") ?? "", accessKeyId: Deno.env.get("R2_ACCESS_KEY_ID") ?? "",
      secretAccessKey: Deno.env.get("R2_SECRET_ACCESS_KEY") ?? "", bucket: Deno.env.get("R2_BUCKET") ?? "",
    };
    if (!cfg.accountId || !cfg.accessKeyId || !cfg.secretAccessKey || !cfg.bucket) {
      return json({ error: "File storage is not set up yet. Please contact the administrator." }, 500);
    }

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
        if (!resend) return { error: MSG.email };
        try {
          // resend.emails.send never throws: always check { error }.
          const { data, error } = await resend.emails.send({
            from: "iPlus Olympiads <noreply@iplusedu.in>", reply_to: "contact@iplusedu.in",
            to: [m.to], subject: m.subject, html: m.html, text: m.text,
          });
          if (error) return { error: MSG.email, rateLimited: /rate_limit/i.test(String((error as { name?: string }).name ?? "")) };
          return { error: null, id: (data as { id?: string } | null)?.id ?? null };
        } catch (_e) {
          return { error: MSG.email };
        }
      },
      async whatsapp(m) {
        if (!askevaToken) return { error: MSG.whatsapp };
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
          if (res.ok && !logical) {
            const wamid = (b as { messages?: { id?: string }[] }).messages?.[0]?.id ?? null;
            return { error: null, id: wamid };
          }
          // Provider text is never kept (the fetch URL carries the token).
          return { error: MSG.whatsapp, rateLimited: res.status === 429 };
        } catch (_e) {
          return { error: MSG.whatsapp };
        }
      },
    }, { batchId: batch.id, userId, retryItemIds: Array.isArray(body.retryItemIds) ? body.retryItemIds : undefined, whatsapp });
    return json(summary);
  } catch (e) {
    if (e instanceof SendError) return json({ error: e.message }, e.status);
    return json({ error: "Something went wrong while sending. Nothing was sent twice; check the history." }, 500);
  }
});
