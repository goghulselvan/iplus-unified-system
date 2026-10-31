/**
 * One-time (or on-demand) FAQ audio generator.
 * Translates each FAQ answer to 6 Indian languages using GPT-4o mini,
 * generates mulaw audio via Sarvam TTS, uploads to Supabase Storage.
 *
 * Storage path: faq-audio/{lang}/{intent}.mulaw  (public bucket)
 *
 * Call with POST {} to generate all FAQs × all languages.
 * Call with POST { intents: ["fee"], langs: ["ta-IN"] } to regenerate specific ones.
 * This function is admin-only — no public exposure needed.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const OPENAI_KEY  = Deno.env.get("OPENAI_API_KEY")!;
const SARVAM_KEY  = Deno.env.get("SARVAM_API_KEY")!;
const SB_URL      = Deno.env.get("SUPABASE_URL")!;
const SB_KEY      = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ── iPlus FAQ content (English master — iPlus-controlled, factually accurate) ─
const FAQ_EN: Record<string, string> = {
  fee: "The fee for iPlus Olympiads 2026 is ₹200 per student per olympiad. Your school collects ₹200 from each student and retains ₹50 per student as your school's incentive. You remit ₹150 per student to iPlus. Each student receives a participation certificate and a personalised rank report.",
  deadline: "The last date to register your school is 30th August 2026. Please ensure your student name list is submitted before this date to confirm your school's participation.",
  subjects: "iPlus Olympiads offers six subjects: Maths Plus, Science Plus, English Plus, Logical Reasoning Plus, GK and Social Science Plus, and Kids Plus for LKG and UKG students.",
  exam_date: "The olympiad examinations are scheduled for October and November 2026. Your school can choose a convenient date slot from the options available.",
  how_to_register: "To register your school, please visit iplusedu.in slash school slash register on your browser. You can fill your school details and upload the student name list directly on the website.",
  classes: "iPlus Olympiads is open to students from Class 1 to Class 8. The Kids Plus olympiad is specially designed for LKG and UKG students.",
  contact: "For any assistance, please call us at +91 81110 66556. You can also email us at info@iplusedu.in. Our team is happy to help you.",
  results: "Results and rank cards will be published after the examinations. Each participating student will receive a merit certificate and a detailed rank report.",
};

const LANGUAGES: Array<{ code: string; name: string; sarvam: string }> = [
  { code: "en-IN", name: "English",   sarvam: "en-IN" },
  { code: "ta-IN", name: "Tamil",     sarvam: "ta-IN" },
  { code: "te-IN", name: "Telugu",    sarvam: "te-IN" },
  { code: "kn-IN", name: "Kannada",   sarvam: "kn-IN" },
  { code: "ml-IN", name: "Malayalam", sarvam: "ml-IN" },
  { code: "hi-IN", name: "Hindi",     sarvam: "hi-IN" },
];

// ── Translate English text to target language via GPT-4o mini ─────────────────
async function translate(text: string, targetLang: string, targetName: string): Promise<string> {
  if (targetLang === "en-IN") return text;

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Authorization": `Bearer ${OPENAI_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      max_tokens: 300,
      temperature: 0.1,
      messages: [
        {
          role: "system",
          content: `Translate the following text to ${targetName}.
Rules:
- Keep it natural for spoken voice (this will be converted to audio)
- Keep proper nouns in English: "iPlus Olympiads", "iplusedu.in", "+91 81110 66556", "₹200", specific dates
- Do NOT translate URLs, phone numbers, or currency symbols
- Output ONLY the translated text, nothing else`,
        },
        { role: "user", content: text },
      ],
    }),
  });

  if (!res.ok) { console.error("Translate failed:", await res.text()); return text; }
  const d = await res.json();
  return d.choices?.[0]?.message?.content?.trim() || text;
}

// ── Sarvam TTS → mulaw binary ─────────────────────────────────────────────────
async function generateAudio(text: string, lang: string): Promise<{ audio: Uint8Array | null; error?: string }> {
  const res = await fetch("https://api.sarvam.ai/text-to-speech", {
    method: "POST",
    headers: { "api-subscription-key": SARVAM_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      inputs: [text],
      target_language_code: lang,
      speaker: "anushka",
      model: "bulbul:v2",
      speech_sample_rate: 8000,
      output_audio_codec: "mulaw",
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error(`TTS failed [${lang}]:`, errText);
    return { audio: null, error: errText };
  }
  const d = await res.json();
  const b64 = d.audios?.[0];
  return { audio: b64 ? Uint8Array.from(atob(b64), c => c.charCodeAt(0)) : null };
}

// ── Upload to Supabase Storage ────────────────────────────────────────────────
async function uploadAudio(
  supabase: ReturnType<typeof createClient>,
  intent: string,
  lang: string,
  audio: Uint8Array
): Promise<boolean> {
  const path = `${lang}/${intent}.mulaw`;
  const { error } = await supabase.storage
    .from("faq-audio")
    .upload(path, audio, {
      contentType: "audio/x-mulaw",
      upsert: true,
    });

  if (error) { console.error(`Upload failed ${path}:`, error); return false; }
  console.log(`✓ Uploaded faq-audio/${path}`);
  return true;
}

// ── Main handler ──────────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const body = await req.json().catch(() => ({}));
    const intentsToGenerate: string[]  = body.intents ?? Object.keys(FAQ_EN);
    const langsToGenerate:   string[]  = body.langs   ?? LANGUAGES.map(l => l.code);

    // Validate inputs
    const unknownIntents = intentsToGenerate.filter(i => !FAQ_EN[i]);
    if (unknownIntents.length > 0) {
      return new Response(JSON.stringify({ error: `Unknown intents: ${unknownIntents.join(", ")}` }), {
        status: 400, headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(SB_URL, SB_KEY);

    // Ensure bucket exists
    const { error: bucketErr } = await supabase.storage.createBucket("faq-audio", { public: true });
    if (bucketErr && !bucketErr.message.includes("already exists")) {
      throw new Error(`Bucket error: ${bucketErr.message}`);
    }

    const results: Array<{ intent: string; lang: string; status: string; error?: string }> = [];
    let generated = 0, failed = 0;

    for (const intent of intentsToGenerate) {
      const englishText = FAQ_EN[intent];

      for (const langCode of langsToGenerate) {
        const langMeta = LANGUAGES.find(l => l.code === langCode);
        if (!langMeta) { results.push({ intent, lang: langCode, status: "unknown_lang" }); continue; }

        console.log(`Generating: ${intent} / ${langCode}`);

        // 1. Translate
        const translated = await translate(englishText, langCode, langMeta.name);
        console.log(`  Translated [${langCode}]: "${translated.slice(0, 60)}..."`);

        // 2. TTS
        const { audio, error: ttsError } = await generateAudio(translated, langMeta.sarvam);
        if (!audio) { results.push({ intent, lang: langCode, status: "tts_failed", error: ttsError }); failed++; continue; }

        // 3. Upload
        const ok = await uploadAudio(supabase, intent, langCode, audio);
        results.push({ intent, lang: langCode, status: ok ? "ok" : "upload_failed" });
        if (ok) generated++; else failed++;

        // Small delay to avoid Sarvam rate limits
        await new Promise(r => setTimeout(r, 300));
      }
    }

    const summary = {
      total: intentsToGenerate.length * langsToGenerate.length,
      generated,
      failed,
      results,
    };

    console.log(`FAQ audio generation complete: ${generated} ok, ${failed} failed`);
    return new Response(JSON.stringify(summary), {
      headers: { ...CORS, "Content-Type": "application/json" },
    });

  } catch (err) {
    console.error("generate-faq-audio error:", err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "Internal error" }), {
      status: 500, headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});
