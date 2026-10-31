import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.55.0";
import { ALLOWED_UPLOAD_TYPES, isAllowedKey } from "./keys.ts";
import { deleteObject, EXPIRES_IN, presign, R2Config } from "./sign.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    if (req.method !== "POST") return json({ error: "Please send a POST request." }, 405);

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Please sign in to manage results files." }, 401);

    // Role check via RPC with the caller's JWT (auth.getUser() has 401'd real logins).
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: allowed, error: roleError } = await supabase.rpc("is_manager_or_superadmin");
    if (roleError) return json({ error: "We could not check your permissions. Please sign in again." }, 401);
    if (allowed !== true) return json({ error: "You don't have permission to manage results files." }, 403);

    let body: { action?: string; key?: string; contentType?: string };
    try {
      body = await req.json();
    } catch {
      return json({ error: "The request was not valid. Please try again." }, 400);
    }
    const { action, key, contentType } = body;

    if (!key || !isAllowedKey(key)) return json({ error: "That file location is not allowed." }, 400);
    if (action !== "upload" && action !== "download" && action !== "delete") {
      return json({ error: "Unknown action. Use upload, download or delete." }, 400);
    }
    if (action === "upload" && (!contentType || !ALLOWED_UPLOAD_TYPES.includes(contentType))) {
      return json({ error: "Only PDF, ZIP and CSV files can be uploaded." }, 400);
    }

    // Secrets resolved lazily, inside the handler.
    const cfg: R2Config = {
      accountId: Deno.env.get("R2_ACCOUNT_ID") ?? "",
      accessKeyId: Deno.env.get("R2_ACCESS_KEY_ID") ?? "",
      secretAccessKey: Deno.env.get("R2_SECRET_ACCESS_KEY") ?? "",
      bucket: Deno.env.get("R2_BUCKET") ?? "",
    };
    if (!cfg.accountId || !cfg.accessKeyId || !cfg.secretAccessKey || !cfg.bucket) {
      return json({ error: "File storage is not set up yet. Please contact the administrator." }, 500);
    }

    if (action === "delete") {
      const res = await deleteObject(cfg, key);
      if (!res.ok && res.status !== 404) {
        return json({ error: "The file could not be deleted. Please try again." }, 502);
      }
      return json({ ok: true });
    }

    const url = action === "upload"
      ? await presign(cfg, "PUT", key, contentType)
      : await presign(cfg, "GET", key);
    return json({ url, expiresIn: EXPIRES_IN });
  } catch (_e) {
    return json({ error: "Something went wrong with file storage. Please try again." }, 500);
  }
});
