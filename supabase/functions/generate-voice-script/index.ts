const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const CLAUDE_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;

const LANGUAGE_MAP: Record<string, string> = {
  ENGLISH:  "English",
  HINDI:    "Hindi",
  TAMIL:    "Tamil",
  TELUGU:   "Telugu",
  KANNADA:  "Kannada",
  MALAYALAM: "Malayalam",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const { language = "ENGLISH", purpose = "registration", tone = "formal" } = await req.json();
    const langName = LANGUAGE_MAP[language] || "English";

    const prompt = `Write a short, natural TTS phone call script for iPlus Olympiads in ${langName}.

Context:
- Caller: "Arya" from iPlus Olympiads
- Audience: School principals and teachers in India
- Purpose: ${purpose === "registration" ? "Invite school to register for iPlus Olympiads 2026" : purpose}
- Tone: ${tone} — warm, respectful, not salesy
- Length: 4-6 sentences max (must fit in a 30-second TTS call)

Key facts to include (pick the most relevant 2-3):
- 6 olympiads: Maths, Science, English, Logical Reasoning, GK, Kids Plus
- Classes 1 to 8 (Kids Plus: LKG & UKG)
- Fee: ₹200 per student
- Exam: October–November 2026
- Registration deadline: 30 August 2026
- Benefits: National ranking, certificates, ISRO visit for winners

Rules:
- Write ONLY the spoken script, no stage directions or labels
- If language is not English, write entirely in that language (natural, spoken style — not formal written)
- End with a clear call to action (call us / visit website)
- Phone: +91 81110 66556 | Website: iplusedu.in

Output ONLY the script text, nothing else.`;

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": CLAUDE_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 300,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!res.ok) throw new Error(`Claude error: ${await res.text()}`);
    const data = await res.json();
    const script = data.content?.[0]?.text?.trim() || "";

    return new Response(JSON.stringify({ script }), {
      headers: { ...CORS, "Content-Type": "application/json" },
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "Script generation failed" }), {
      status: 500, headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});
