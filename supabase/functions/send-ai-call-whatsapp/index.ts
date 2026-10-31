/**
 * Internal-only edge function — called from ai-voice-agent and bonvoice-webhook.
 * Sends a post-call WhatsApp to school with personalised AI summary + registration CTA.
 *
 * Askeva template name: ai_call_followup
 * Template body (submit to Askeva for approval):
 *
 *   Hello {{1}},
 *
 *   Thank you for speaking with Arya from iPlus Olympiads.
 *
 *   {{2}}
 *
 *   📚 Register your school: {{3}}
 *   ⏰ Deadline: 30 August 2026
 *   📞 For queries: +91 81110 66556
 *
 *   — iPlus Olympiads Team
 *
 * Variables: 1=school_name  2=ai_summary  3=register_link
 */

const ASKEVA_URL   = "https://backend.askeva.io/v1/message/send-message";
const CLAUDE_KEY   = Deno.env.get("ANTHROPIC_API_KEY")!;
const ASKEVA_TOKEN = Deno.env.get("ASKEVA_API_TOKEN")!;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function normPhone(raw: string): string | null {
  const d = raw.replace(/\D/g, "");
  if (d.length === 10) return `91${d}`;
  if (d.length >= 11 && d.length <= 15) return d;
  return null;
}

async function generateSummary(
  schoolName: string,
  history: Array<{ role: string; content: string }>,
  outcome: string
): Promise<string> {
  if (history.length === 0) {
    return `You enquired about iPlus Olympiads 2026. We look forward to your school's participation.`;
  }

  const transcript = history
    .slice(-8)
    .map(h => `${h.role === "user" ? "School" : "Arya"}: ${h.content}`)
    .join("\n");

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": CLAUDE_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 80,
      messages: [{
        role: "user",
        content: `Write ONE friendly sentence (max 20 words) summarising this call outcome for a WhatsApp follow-up message to ${schoolName}. Outcome: ${outcome}.\n\nCall transcript:\n${transcript}\n\nOutput ONLY the sentence, nothing else.`,
      }],
    }),
  });

  if (!res.ok) return `Your conversation with Arya has been recorded. Our team will follow up shortly.`;
  const d = await res.json();
  return d.content?.[0]?.text?.trim() || `Thank you for your time. We look forward to your participation in iPlus Olympiads 2026.`;
}

// Meta rejects an empty or whitespace-only template parameter with
// "(#131008) Required parameter is missing" and fails the ENTIRE message, not
// just that placeholder. Every value below can be null for some school, so
// nothing reaches the payload without passing through here.
const safeParam = (v: unknown) => String(v ?? "").trim() || "-";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const {
      phone,
      schoolName,
      outcome       = "completed",
      conversationHistory = [],
      registerLink  = "https://iplusedu.in/school/register",
    } = await req.json();

    if (!phone || !schoolName) {
      return new Response(JSON.stringify({ error: "phone and schoolName required" }), {
        status: 400, headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    const mobile = normPhone(phone);
    if (!mobile) {
      return new Response(JSON.stringify({ error: `Invalid phone: ${phone}` }), {
        status: 400, headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    // Generate personalised 1-sentence summary
    const summary = await generateSummary(schoolName, conversationHistory, outcome);

    const payload = {
      messaging_product: "whatsapp",
      to: mobile,
      type: "template",
      template: {
        name: "ai_call_followup",
        language: { code: "en" },
        components: [{
          type: "body",
          parameters: [
            { type: "text", text: safeParam(schoolName) },
            { type: "text", text: safeParam(summary) },
            { type: "text", text: safeParam(registerLink) },
          ],
        }],
      },
    };

    const waRes = await fetch(`${ASKEVA_URL}?token=${encodeURIComponent(ASKEVA_TOKEN)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const waBody = await waRes.json().catch(() => ({}));

    if (!waRes.ok) {
      console.error("Askeva WA failed:", waBody);
      return new Response(JSON.stringify({ error: waBody?.error?.message ?? "WA send failed" }), {
        status: 502, headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    console.log(`Post-call WA sent to ${mobile} (${schoolName}): "${summary}"`);
    return new Response(JSON.stringify({ ok: true, summary, mobile }), {
      headers: { ...CORS, "Content-Type": "application/json" },
    });

  } catch (err) {
    console.error("send-ai-call-whatsapp error:", err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "Internal error" }), {
      status: 500, headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});
