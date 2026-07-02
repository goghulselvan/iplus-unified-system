import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Maps each courier's raw status string → our courier_status enum value
const STATUS_MAP: Record<string, string> = {
  // Generic / normalized
  sent: "Sent", dispatched: "Sent", shipped: "Sent", "out for delivery": "Sent",
  delivered: "Delivered", "delivery confirmed": "Delivered",
  returned: "Returned", "return to sender": "Returned", undelivered: "Returned",
  // India Post
  "item dispatched": "Sent", "item delivered": "Delivered", "item returned": "Returned",
  // DTDC
  "shipment booked": "Sent", "delivered to addressee": "Delivered",
  // BlueDart
  "consignment booked": "Sent", "delivered": "Delivered",
};

function normalizeStatus(raw: string): string | null {
  return STATUS_MAP[raw.toLowerCase().trim()] ?? null;
}

Deno.serve(async (req: Request) => {
  // Token auth
  const WEBHOOK_TOKEN = Deno.env.get("COURIER_WEBHOOK_TOKEN");
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
  try { body = await req.json(); } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400, headers: { "Content-Type": "application/json" } });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const url = new URL(req.url);
  // courier name can come from URL param or body (allows different couriers to use same endpoint)
  const courierName: string = (url.searchParams.get("courier") ?? body.courier ?? "Unknown").trim();

  // Accept array of updates or single update
  const updates: any[] = Array.isArray(body.updates) ? body.updates : [body];

  const results: any[] = [];

  for (const update of updates) {
    // Identify school — accept ss_no, school_id, or tracking_no
    const ssNo: number | null = update.ss_no ? Number(update.ss_no) : null;
    const schoolId: string | null = update.school_id ?? null;
    const trackingNo: string | null = update.tracking_no ?? update.awb ?? update.consignment_no ?? null;
    const rawStatus: string = update.status ?? "";
    const courierStatus = normalizeStatus(rawStatus);

    if (!courierStatus) {
      results.push({ error: `Unknown status: ${rawStatus}`, update });
      continue;
    }

    // Find the school
    let query = supabase.from("schools").select("id, brochure_delivery_status");
    if (schoolId) query = query.eq("id", schoolId);
    else if (ssNo) query = query.eq("ss_no", ssNo);
    else if (trackingNo) query = query.eq("courier_tracking_no", trackingNo);
    else { results.push({ error: "No school identifier provided", update }); continue; }

    const { data: school } = await (query.maybeSingle() as any);
    if (!school) { results.push({ error: "School not found", update }); continue; }

    // Update courier_status + brochure_delivery_status
    const current = school.brochure_delivery_status;
    let newBrochureStatus = current;

    if (courierStatus === "Sent") {
      // Physical brochure just dispatched
      newBrochureStatus = current === "Digital Sent" ? "Both Physical & Digital" : "Physical Only";
    } else if (courierStatus === "Delivered" && current === null) {
      // Delivered without prior Sent update (courier skipped that event)
      newBrochureStatus = "Physical Only";
    } else if (courierStatus === "Delivered" && current === "Digital Sent") {
      newBrochureStatus = "Both Physical & Digital";
    } else if (courierStatus === "Returned") {
      // Physical returned — if was "Both" → back to "Digital Sent"; if "Physical Only" → NULL
      newBrochureStatus = current === "Both Physical & Digital" ? "Digital Sent" : null;
    }

    const schoolUpdate: any = {
      courier_status: courierStatus,
      brochure_delivery_status: newBrochureStatus,
      courier_name: courierName,
    };
    if (trackingNo) schoolUpdate.courier_tracking_no = trackingNo;
    if (courierStatus === "Sent") schoolUpdate.courier_dispatched_at = new Date().toISOString();

    await supabase.from("schools").update(schoolUpdate).eq("id", school.id);
    console.log(`Courier ${courierName}: school ${school.id} → ${courierStatus}, brochure=${newBrochureStatus}`);
    results.push({ school_id: school.id, courier_status: courierStatus, brochure_delivery_status: newBrochureStatus });
  }

  return new Response(JSON.stringify({ ok: true, processed: results.length, results }), {
    status: 200, headers: { "Content-Type": "application/json" },
  });
});
