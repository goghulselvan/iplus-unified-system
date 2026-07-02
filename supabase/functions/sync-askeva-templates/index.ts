import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function toTitleCase(s: string) {
  return s.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

function deriveTemplateType(components: any[]): string {
  const header = components?.find((c: any) => c.type === "HEADER");
  if (!header) return "text";
  const fmt = (header.format || "").toUpperCase();
  if (fmt === "IMAGE") return "image";
  if (fmt === "DOCUMENT") return "document";
  if (fmt === "VIDEO") return "video";
  return "text";
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const authHeader = req.headers.get("authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token);
    if (authErr || !user) {
      return new Response(JSON.stringify({ success: false, error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { projectId } = await req.json() as { projectId: string };
    if (!projectId) {
      return new Response(JSON.stringify({ success: false, error: "projectId required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const ASKEVA_API_TOKEN = Deno.env.get("ASKEVA_API_TOKEN");
    if (!ASKEVA_API_TOKEN) throw new Error("ASKEVA_API_TOKEN not configured");

    // Fetch all templates from Askeva (paginate to get all)
    const askevaTpls: any[] = [];
    let cursor: string | null = null;

    do {
      const url = new URL("https://backend.askeva.io/v1/templates");
      url.searchParams.set("token", ASKEVA_API_TOKEN);
      url.searchParams.set("fields", "id,category,components,language,name,quality_score,rejected_reason,status");
      url.searchParams.set("limit", "100");
      if (cursor) url.searchParams.set("after", cursor);

      const res = await fetch(url.toString());
      if (!res.ok) {
        const err = await res.text();
        throw new Error(`Askeva API error ${res.status}: ${err}`);
      }
      const body = await res.json();
      const page: any[] = body?.data ?? [];
      askevaTpls.push(...page);
      cursor = body?.paging?.cursors?.after ?? null;
      // Stop if we got fewer than 100 (no more pages)
      if (page.length < 100) cursor = null;
    } while (cursor);

    // Fetch existing DB templates for this project
    const { data: existing } = await supabaseAdmin
      .from("whatsapp_templates")
      .select("id, askeva_template_name, template_name, template_category")
      .eq("project_id", projectId);

    const existingByName: Record<string, any> = {};
    for (const row of existing ?? []) {
      if (!existingByName[row.askeva_template_name]) {
        existingByName[row.askeva_template_name] = row;
      }
    }

    let inserted = 0, updated = 0;

    for (const tpl of askevaTpls) {
      const askevaName: string = tpl.name;
      const metaCategory: string = (tpl.category ?? "").toUpperCase();
      const category: "marketing" | "workflow" = metaCategory === "MARKETING" ? "marketing" : "workflow";
      const lang: string = (tpl.language ?? "en").toLowerCase().replace(/-/g, "_");
      const components: any[] = tpl.components ?? [];
      const tplType = deriveTemplateType(components);
      const displayName = toTitleCase(askevaName);

      const existingRow = existingByName[askevaName];
      if (existingRow) {
        // Update category + type only (preserve user-set display name)
        await supabaseAdmin.from("whatsapp_templates")
          .update({ template_category: category, language_code: lang, template_type: tplType, raw_payload_template: components })
          .eq("id", existingRow.id);
        updated++;
      } else {
        // Insert new
        await supabaseAdmin.from("whatsapp_templates").insert({
          project_id: projectId,
          template_key: askevaName,
          template_name: displayName,
          askeva_template_name: askevaName,
          language_code: lang,
          template_type: tplType,
          body_variables: [],
          raw_payload_template: components,
          is_active: tpl.status === "APPROVED",
          template_category: category,
          created_by: user.id,
        });
        inserted++;
        // Track to avoid duplicate inserts in same sync
        existingByName[askevaName] = { askeva_template_name: askevaName };
      }
    }

    return new Response(JSON.stringify({
      success: true,
      total_from_askeva: askevaTpls.length,
      inserted,
      updated,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err: any) {
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
