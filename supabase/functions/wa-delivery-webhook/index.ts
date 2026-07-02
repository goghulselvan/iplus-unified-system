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

Deno.serve(async (req: Request) => {
  // Meta webhook verification GET (hub.challenge handshake)
  if (req.method === "GET") {
    const url = new URL(req.url);
    const challenge = url.searchParams.get("hub.challenge");
    if (challenge) return new Response(challenge, { headers: { "Content-Type": "text/plain" } });
  }

  // Token auth — Askeva passes ?token=<WA_WEBHOOK_TOKEN> in the URL
  const WEBHOOK_TOKEN = Deno.env.get("WA_WEBHOOK_TOKEN");
  if (WEBHOOK_TOKEN) {
    const url = new URL(req.url);
    const token = url.searchParams.get("token") ?? req.headers.get("x-webhook-token") ?? "";
    if (token !== WEBHOOK_TOKEN) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { "Content-Type": "application/json" },
      });
    }
  }

  let body: any;
  try { body = await req.json(); } catch { return new Response("ok", { status: 200 }); }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const processed: string[] = [];

  // Standard Meta webhook structure: entry[].changes[].value.statuses[]
  for (const entry of (body?.entry ?? [])) {
    for (const change of (entry?.changes ?? [])) {
      for (const s of (change?.value?.statuses ?? [])) {
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
          await supabase.from("campaign_schools").update({ delivery_status: "delivered" }).eq("wamid", wamid);
          processed.push(`delivered:${wamid}`);
        } else if (status === "read") {
          await supabase.from("campaign_schools").update({ delivery_status: "read" }).eq("wamid", wamid);
          processed.push(`read:${wamid}`);
        }
      }
    }
  }

  console.log("Webhook processed:", processed.length, "events");
  return new Response(JSON.stringify({ ok: true, processed: processed.length }), {
    status: 200, headers: { "Content-Type": "application/json" },
  });
});
