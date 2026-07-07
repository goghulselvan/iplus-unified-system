import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Meta error codes that mean "recipient got too many marketing messages today"
const FREQUENCY_CAP_CODES = new Set([131049, 130472]);

function nextSevenAmIST(): string {
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000; // +5:30
  const now = new Date();
  const nowIST = new Date(now.getTime() + IST_OFFSET_MS);
  const y = nowIST.getUTCFullYear();
  const mo = nowIST.getUTCMonth();
  const d = nowIST.getUTCDate();
  // 7:00 AM IST = 01:30 UTC
  const target = new Date(Date.UTC(y, mo, d, 1, 30, 0, 0));
  if (now.getTime() >= target.getTime()) {
    target.setUTCDate(target.getUTCDate() + 1);
  }
  return target.toISOString();
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, x-webhook-token",
};

Deno.serve(async (req: Request) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  // Meta webhook verification GET (hub.challenge handshake)
  if (req.method === "GET") {
    const url = new URL(req.url);
    const challenge = url.searchParams.get("hub.challenge");
    if (challenge) return new Response(challenge, { headers: { "Content-Type": "text/plain", ...CORS_HEADERS } });
  }

  // Token auth — URL param ?token= or header x-webhook-token
  const WEBHOOK_TOKEN = Deno.env.get("WA_WEBHOOK_TOKEN");
  if (WEBHOOK_TOKEN) {
    const url = new URL(req.url);
    const token = url.searchParams.get("token") ?? req.headers.get("x-webhook-token") ?? "";
    if (token !== WEBHOOK_TOKEN) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { "Content-Type": "application/json", ...CORS_HEADERS },
      });
    }
  }

  let body: any;
  try { body = await req.json(); } catch { return new Response("ok", { status: 200, headers: CORS_HEADERS }); }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const processed: string[] = [];

  // Support both formats:
  // 1. Askeva flat format: { statuses: [...] }
  // 2. Standard Meta format: { entry: [{ changes: [{ value: { statuses: [...] } }] }] }
  const allStatuses: any[] = [];
  if (Array.isArray(body?.statuses)) {
    allStatuses.push(...body.statuses);
  }
  for (const entry of (body?.entry ?? [])) {
    for (const change of (entry?.changes ?? [])) {
      const statuses = change?.value?.statuses ?? [];
      allStatuses.push(...statuses);
    }
  }

  for (const s of allStatuses) {
        const wamid: string = s.id ?? s.wamid;
        const status: string = s.status;
        if (!wamid || !status) continue;

        if (status === "failed") {
          const errors: any[] = s.errors ?? [];
          const isFreqCap = errors.some((e: any) => FREQUENCY_CAP_CODES.has(Number(e.code)));
          const deliveryStatus = isFreqCap ? "frequency_cap" : "failed";

          const { data: row } = await supabase
            .from("campaign_schools")
            .select("id, campaign_id")
            .eq("wamid", wamid)
            .maybeSingle();

          if (!row) { processed.push(`unknown_wamid:${wamid}`); continue; }

          if (isFreqCap) {
            // Reset school to pending so it gets picked up again
            await supabase.from("campaign_schools").update({
              status: "pending",
              delivery_status: "frequency_cap",
              sent_at: null,
              wamid: null,
            }).eq("id", row.id);

            // Push the campaign to retry at 10 AM IST tomorrow
            const retryAt = nextSevenAmIST();
            await supabase.from("campaigns").update({
              scheduled_at: retryAt,
              status: "scheduled",
            })
              .eq("id", row.campaign_id)
              .in("status", ["sent", "sending", "draft", "paused"]);

            console.log(`Frequency cap on ${wamid} — rescheduled campaign ${row.campaign_id} for ${retryAt}`);
            processed.push(`retry_at_10am:${wamid}`);
          } else {
            await supabase.from("campaign_schools").update({ delivery_status: deliveryStatus }).eq("id", row.id);
            processed.push(`other_fail:${wamid}`);
          }
        } else if (status === "delivered") {
          // Never downgrade a later stage (events can arrive out of order)
          await supabase.from("campaign_schools").update({ delivery_status: "delivered" })
            .eq("wamid", wamid)
            .not("delivery_status", "in", "(read,replied)");
          processed.push(`delivered:${wamid}`);
        } else if (status === "read") {
          await supabase.from("campaign_schools").update({ delivery_status: "read" })
            .eq("wamid", wamid)
            .neq("delivery_status", "replied");
          processed.push(`read:${wamid}`);
        }
  }

  // Inbound messages (replies) — same two formats as statuses
  const allMessages: any[] = [];
  const contactNames = new Map<string, string>();
  const collectContacts = (contacts: any[]) => {
    for (const c of contacts ?? []) {
      if (c?.wa_id && c?.profile?.name) contactNames.set(String(c.wa_id), String(c.profile.name));
    }
  };
  if (Array.isArray(body?.messages)) allMessages.push(...body.messages);
  collectContacts(body?.contacts);
  for (const entry of (body?.entry ?? [])) {
    for (const change of (entry?.changes ?? [])) {
      allMessages.push(...(change?.value?.messages ?? []));
      collectContacts(change?.value?.contacts);
    }
  }

  for (const m of allMessages) {
    const from: string = m?.from ?? "";
    const msgWamid: string = m?.id ?? "";
    if (!from || !msgWamid) continue;

    const text: string | null =
      m?.text?.body ??
      m?.button?.text ??
      m?.interactive?.button_reply?.title ??
      m?.interactive?.list_reply?.title ??
      null;
    const contextWamid: string | null = m?.context?.id ?? null;

    // Match reply to a campaign send: quoted-message wamid first, else latest send to this phone
    let campaignSchoolId: string | null = null;
    if (contextWamid) {
      const { data } = await supabase.from("campaign_schools")
        .select("id").eq("wamid", contextWamid).maybeSingle();
      campaignSchoolId = data?.id ?? null;
    }
    if (!campaignSchoolId) {
      const last10 = from.replace(/\D/g, "").slice(-10);
      if (last10.length === 10) {
        const { data } = await supabase.rpc("match_campaign_school_by_phone", { p_last10: last10 });
        campaignSchoolId = (data as string | null) ?? null;
      }
    }

    await supabase.from("wa_replies").upsert({
      phone: from,
      sender_name: contactNames.get(from) ?? null,
      message_text: text,
      message_type: m?.type ?? null,
      msg_wamid: msgWamid,
      context_wamid: contextWamid,
      campaign_school_id: campaignSchoolId,
      raw: m,
    }, { onConflict: "msg_wamid", ignoreDuplicates: true });

    if (campaignSchoolId) {
      await supabase.from("campaign_schools").update({ delivery_status: "replied" }).eq("id", campaignSchoolId);
    }
    processed.push(`reply:${msgWamid}`);
  }

  if (allStatuses.length === 0 && allMessages.length === 0) {
    // Unrecognized payload shape — log it so we can adapt the parser
    console.log("Unrecognized payload:", JSON.stringify(body).slice(0, 2000));
  }
  console.log("Webhook processed:", processed.length, "events");
  return new Response(JSON.stringify({ ok: true, processed: processed.length }), {
    status: 200, headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
});
