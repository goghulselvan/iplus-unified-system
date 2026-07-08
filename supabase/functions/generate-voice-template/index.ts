/**
 * generate-voice-template — self-service voice template builder.
 *
 * Actions (POST JSON):
 *  { action: "translate", text, language_code }
 *    → { success, translated }
 *  { action: "generate", template_id?, name, language_code, speaker, source_script, final_script }
 *    → Sarvam TTS (bulbul:v2, 8kHz WAV) → stores {id}.wav (browser preview) +
 *      {id}.mulaw (telephony) in the public voice-templates bucket, upserts the
 *      voice_templates row → { success, template }
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const LANG_NAMES: Record<string, string> = {
  "en-IN": "English", "ta-IN": "Tamil", "te-IN": "Telugu",
  "kn-IN": "Kannada", "ml-IN": "Malayalam", "hi-IN": "Hindi",
};

// Split long scripts into ≤450-char sentence chunks (Sarvam per-input limit)
function chunkScript(text: string): string[] {
  const sentences = text.replace(/\s+/g, " ").trim().split(/(?<=[.!?।])\s+/);
  const chunks: string[] = [];
  let cur = "";
  for (const s of sentences) {
    if ((cur + " " + s).trim().length > 450 && cur) { chunks.push(cur.trim()); cur = s; }
    else cur = (cur + " " + s).trim();
  }
  if (cur) chunks.push(cur.trim());
  return chunks;
}

// Extract PCM samples from a standard WAV (find the data chunk)
function wavToPcm(bytes: Uint8Array): Uint8Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let off = 12; // skip RIFF header
  while (off + 8 <= bytes.length) {
    const id = String.fromCharCode(bytes[off], bytes[off + 1], bytes[off + 2], bytes[off + 3]);
    const size = view.getUint32(off + 4, true);
    if (id === "data") return bytes.slice(off + 8, off + 8 + size);
    off += 8 + size + (size % 2);
  }
  throw new Error("No data chunk in WAV");
}

// G.711 mu-law encode PCM16LE
function pcmToMulaw(pcm: Uint8Array): Uint8Array {
  const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  const n = Math.floor(pcm.length / 2);
  const out = new Uint8Array(n);
  const BIAS = 0x84, CLIP = 32635;
  for (let i = 0; i < n; i++) {
    let sample = view.getInt16(i * 2, true);
    const sign = sample < 0 ? 0x80 : 0;
    if (sample < 0) sample = -sample;
    if (sample > CLIP) sample = CLIP;
    sample += BIAS;
    let exponent = 7;
    for (let mask = 0x4000; (sample & mask) === 0 && exponent > 0; mask >>= 1) exponent--;
    const mantissa = (sample >> (exponent + 3)) & 0x0f;
    out[i] = ~(sign | (exponent << 4) | mantissa) & 0xff;
  }
  return out;
}

function pcmToWav(pcm: Uint8Array, sampleRate: number): Uint8Array {
  const header = new ArrayBuffer(44);
  const v = new DataView(header);
  const write = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  write(0, "RIFF"); v.setUint32(4, 36 + pcm.length, true); write(8, "WAVE");
  write(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  write(36, "data"); v.setUint32(40, pcm.length, true);
  const out = new Uint8Array(44 + pcm.length);
  out.set(new Uint8Array(header), 0); out.set(pcm, 44);
  return out;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const SARVAM_KEY = Deno.env.get("SARVAM_API_KEY");
  const OPENAI_KEY = Deno.env.get("OPENAI_API_KEY");
  const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  if (!SARVAM_KEY || !OPENAI_KEY) return json({ success: false, error: "API keys not configured" });

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, SERVICE_ROLE);

  // Staff JWT (gateway-verified; getUser can 401 valid logins — use claims) or service-role
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  let userId: string | null = null;
  if (token === SERVICE_ROLE) {
    userId = "20d0f6a6-2e15-4882-8784-3127376911ea"; // system account
  } else {
    try {
      const b64 = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
      const payload = JSON.parse(atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4)));
      if (payload.role === "authenticated" && payload.sub) userId = payload.sub;
    } catch (_) { /* not a decodable JWT */ }
  }
  if (!userId) return json({ success: false, error: "Unauthorized" }, 401);

  let body: any;
  try { body = await req.json(); } catch { return json({ success: false, error: "Invalid JSON" }, 400); }

  try {
    if (body.action === "translate") {
      const { text, language_code } = body;
      if (!text || !language_code) return json({ success: false, error: "text and language_code required" });
      if (language_code === "en-IN") return json({ success: true, translated: text });

      // Sarvam translate first (same vendor/credits as TTS), OpenAI fallback
      const sres = await fetch("https://api.sarvam.ai/translate", {
        method: "POST",
        headers: { "api-subscription-key": SARVAM_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({
          input: text,
          source_language_code: "en-IN",
          target_language_code: language_code,
          model: "mayura:v1",
          mode: "formal",
        }),
      });
      if (sres.ok) {
        const sd = await sres.json();
        if (sd?.translated_text) return json({ success: true, translated: sd.translated_text });
      }
      const sarvamErr = sres.ok ? "empty result" : (await sres.text()).slice(0, 200);

      const langName = LANG_NAMES[language_code] ?? language_code;
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "Authorization": `Bearer ${OPENAI_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "gpt-4o-mini", max_tokens: 600, temperature: 0.1,
          messages: [
            { role: "system", content: `Translate the following text to ${langName}.\nRules:\n- Keep it natural for spoken voice (this will be converted to audio)\n- Keep proper nouns in English: "iPlus Olympiads", "iplusedu.in", phone numbers, "₹200", specific dates\n- Do NOT translate URLs, phone numbers, or currency symbols\n- Output ONLY the translated text, nothing else` },
            { role: "user", content: text },
          ],
        }),
      });
      if (!res.ok) return json({ success: false, error: `Translate failed — Sarvam: ${sarvamErr}; OpenAI: ${(await res.text()).slice(0, 200)}` });
      const d = await res.json();
      return json({ success: true, translated: d.choices?.[0]?.message?.content?.trim() ?? text });
    }

    if (body.action === "generate") {
      const { template_id, name, language_code, speaker, source_script, final_script } = body;
      if (!name || !language_code || !speaker || !final_script) {
        return json({ success: false, error: "name, language_code, speaker, final_script required" });
      }

      const pcmParts: Uint8Array[] = [];
      for (const chunk of chunkScript(final_script)) {
        const res = await fetch("https://api.sarvam.ai/text-to-speech", {
          method: "POST",
          headers: { "api-subscription-key": SARVAM_KEY, "Content-Type": "application/json" },
          body: JSON.stringify({
            inputs: [chunk],
            target_language_code: language_code,
            speaker,
            model: "bulbul:v2",
            speech_sample_rate: 8000,
          }),
        });
        if (!res.ok) return json({ success: false, error: `Sarvam TTS failed: ${(await res.text()).slice(0, 300)}` });
        const d = await res.json();
        const b64 = d.audios?.[0];
        if (!b64) return json({ success: false, error: "Sarvam returned no audio" });
        pcmParts.push(wavToPcm(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))));
      }

      const pcm = new Uint8Array(pcmParts.reduce((s, p) => s + p.length, 0));
      let off = 0;
      for (const p of pcmParts) { pcm.set(p, off); off += p.length; }

      const wav = pcmToWav(pcm, 8000);
      const mulaw = pcmToMulaw(pcm);
      const duration = Math.round(pcm.length / 2 / 8000);

      const id = template_id ?? crypto.randomUUID();
      const wavPath = `${id}.wav`;
      const mulawPath = `${id}.mulaw`;

      const up1 = await supabase.storage.from("voice-templates").upload(wavPath, wav, { contentType: "audio/wav", upsert: true });
      if (up1.error) return json({ success: false, error: `WAV upload failed: ${up1.error.message}` });
      const up2 = await supabase.storage.from("voice-templates").upload(mulawPath, mulaw, { contentType: "audio/x-mulaw", upsert: true });
      if (up2.error) return json({ success: false, error: `mulaw upload failed: ${up2.error.message}` });

      const row = {
        id, name, language_code, speaker,
        source_script: source_script ?? null,
        final_script,
        wav_path: wavPath, mulaw_path: mulawPath,
        duration_seconds: duration,
        created_by: userId,
        updated_at: new Date().toISOString(),
      };
      const { data: saved, error: dbErr } = await supabase.from("voice_templates").upsert(row).select().single();
      if (dbErr) return json({ success: false, error: `DB save failed: ${dbErr.message}` });

      return json({ success: true, template: saved });
    }

    return json({ success: false, error: "Unknown action" }, 400);
  } catch (e: any) {
    return json({ success: false, error: e.message });
  }
});
