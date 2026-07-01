// CRM-side proxy that wraps the source iPlus Olympiad `crm-proxy` edge function.
// - Validates JWT (must be authenticated CRM user)
// - Read actions allowed for managers+; write actions restricted to superadmins
// - Logs every call to security_audit_logs
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SOURCE_URL =
  "https://eucjeggfclztkbbupaav.supabase.co/functions/v1/crm-proxy";

const READ_ACTIONS = new Set(["schema", "select", "rpc"]);
const WRITE_ACTIONS = new Set(["insert", "update", "delete"]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const apiKey = Deno.env.get("CRM_PROXY_API_KEY");
    if (!apiKey) {
      return json({ error: "CRM_PROXY_API_KEY not configured" }, 500);
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return json({ error: "Unauthorized" }, 401);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await supabase.auth
      .getClaims(token);
    if (claimsError || !claimsData?.claims) {
      return json({ error: "Unauthorized" }, 401);
    }
    const userId = claimsData.claims.sub;

    // Load profile to check role
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data: profile } = await admin
      .from("profiles")
      .select("role")
      .eq("user_id", userId)
      .single();

    if (!profile) return json({ error: "Profile not found" }, 403);
    const role = profile.role as string;
    const isManagerOrAbove = role === "manager" || role === "superadmin";
    const isSuperadmin = role === "superadmin";

    if (!isManagerOrAbove) {
      return json({ error: "Insufficient permissions" }, 403);
    }

    const body = await req.json();
    const action = body?.action;

    if (!action || (!READ_ACTIONS.has(action) && !WRITE_ACTIONS.has(action))) {
      return json({ error: "Invalid action" }, 400);
    }

    if (WRITE_ACTIONS.has(action) && !isSuperadmin) {
      return json({ error: "Write actions require superadmin role" }, 403);
    }

    // Forward to source proxy
    const startMs = Date.now();
    const sourceRes = await fetch(SOURCE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
      },
      body: JSON.stringify(body),
    });

    const elapsedMs = Date.now() - startMs;
    const sourceText = await sourceRes.text();
    let sourceJson: unknown;
    try {
      sourceJson = JSON.parse(sourceText);
    } catch {
      sourceJson = { raw: sourceText };
    }

    // Audit log (best effort)
    admin.from("security_audit_logs").insert({
      user_id: userId,
      action: `olympiad_proxy:${action}`,
      table_name: body?.table || body?.fn || "unknown",
      new_values: {
        action,
        table: body?.table,
        fn: body?.fn,
        status: sourceRes.status,
        elapsed_ms: elapsedMs,
      },
    }).then(() => {});

    return new Response(JSON.stringify(sourceJson), {
      status: sourceRes.status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[olympiad-proxy] error", err);
    const msg = err instanceof Error ? err.message : "Unknown error";
    return json({ error: msg }, 500);
  }
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
