// reg-number-alert — emails ops when registration-number assignment is stuck.
// Called only by the pg_cron job `reg-number-alert` (server-to-server). Reads the
// failure/health tables and sends ONE email if there is an unresolved failure or a
// backlog older than 15 minutes. Sends nothing when everything is clean.
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.55.0";
import { Resend } from "npm:resend@2.0.0";

const RECIPIENTS = ["ragulselvan@iplusedu.in", "goghulselvan@gmail.com"];

serve(async (): Promise<Response> => {
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: fails } = await supabase
      .from("registration_number_failures")
      .select("enrollment_id, school_id, sqlstate, err_message, recoverable, failed_at")
      .is("resolved_at", null)
      .order("failed_at", { ascending: false })
      .limit(50);

    const { data: health } = await supabase
      .from("registration_number_health")
      .select("stuck_total, stuck_over_15min, oldest_stuck_at, checked_at")
      .order("checked_at", { ascending: false })
      .limit(1);

    const unresolved = fails ?? [];
    const h = health?.[0];
    const persistentBacklog = (h?.stuck_over_15min ?? 0) > 0;

    if (unresolved.length === 0 && !persistentBacklog) {
      return json({ ok: true, alerted: false });
    }

    const badData = unresolved.filter((f) => !f.recoverable);
    const rows = unresolved
      .map(
        (f) =>
          `<tr><td>${f.failed_at}</td><td>${f.recoverable ? "transient" : "<b>BAD DATA</b>"}</td>` +
          `<td>${f.sqlstate ?? ""}</td><td>${f.enrollment_id}</td><td>${(f.err_message ?? "").slice(0, 240)}</td></tr>`,
      )
      .join("");

    const resend = new Resend(Deno.env.get("RESEND_API_KEY"));
    const { error: sendError } = await resend.emails.send({
      from: "iPlus Olympiads <noreply@iplusedu.in>",
      to: RECIPIENTS,
      subject:
        `[iPlus] Registration numbers need attention — ` +
        `${badData.length} bad-data, ${unresolved.length - badData.length} transient` +
        `${persistentBacklog ? `, ${h?.stuck_over_15min} stuck >15m` : ""}`,
      html: `
        <p>The registration-number system has issues that are not clearing on their own.</p>
        ${
          persistentBacklog
            ? `<p><b>${h?.stuck_over_15min}</b> enrolment(s) have had no number for over 15 minutes ` +
              `(oldest: ${h?.oldest_stuck_at}). The 5-minute auto-retry sweeper is NOT clearing them.</p>`
            : ""
        }
        ${
          unresolved.length
            ? `<table border="1" cellpadding="5" style="border-collapse:collapse;font-size:13px">
                 <tr><th>when</th><th>type</th><th>code</th><th>enrolment id</th><th>error</th></tr>
                 ${rows}
               </table>`
            : ""
        }
        <p style="margin-top:14px">
          <b>Transient</b> rows self-clear on the next sweeper run. <b>BAD DATA</b> rows will not —
          fix the underlying record (district / olympiad code / class), then run
          <code>select retry_registration_numbers(array[...])</code> on the listed enrolment ids.
        </p>
        <p style="color:#6b7280;font-size:12px">Automated — pg_cron job <code>reg-number-alert</code>, every 30 min while the condition holds.</p>
      `,
    });
    if (sendError) {
      return json({ ok: false, error: `Resend rejected: ${JSON.stringify(sendError)}` }, 500);
    }

    return json({ ok: true, alerted: true, unresolved: unresolved.length, bad_data: badData.length });
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
