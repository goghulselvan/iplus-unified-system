import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SARVAM_API_KEY = Deno.env.get("SARVAM_API_KEY")!;
const CLAUDE_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const SUPPORTED_LANGUAGES: Record<string, string> = {
  "ta-IN": "Tamil",
  "en-IN": "English",
  "ml-IN": "Malayalam",
  "te-IN": "Telugu",
  "hi-IN": "Hindi",
};

const IPLUS_SYSTEM_PROMPT = `You are an AI voice agent for iPlus Olympiads — a prestigious academic olympiad for school students across India. Your name is "Arya" from iPlus.

ROLE: You represent iPlus Olympiads professionally on phone calls with school principals and teachers.

TONE: Formal, respectful, warm, and concise. Address principals as "Sir" or "Madam". Keep responses under 3 sentences for voice clarity.

KNOWLEDGE BASE — only answer from this:
- iPlus Olympiads 2026 covers 6 subjects: Mathematics, Science, English, Logical Reasoning, General Knowledge, Tamil
- Class range: Class 1 to Class 12
- Registration fee: ₹150 per student
- Exam schedule: Flexible — October and November 2026, school chooses date
- Registration: Online at iplusedu.in/school/register
- Olympiad benefits: Subject mastery assessment, national ranking, participation certificate

CRM ACTIONS — you can perform these by returning structured JSON in <action> tags:
- Log outcome: <action>{"type":"log_outcome","outcome":"interested|not_interested|callback_requested|registered|no_answer|transferred_to_human"}</action>
- Collect email: <action>{"type":"collect_email","email":"..."}</action>
- Schedule callback: <action>{"type":"schedule_callback","date":"YYYY-MM-DD","time":"HH:MM"}</action>
- Transfer to human: <action>{"type":"transfer_to_human","reason":"..."}</action>

ESCALATE TO HUMAN when:
- School has a complaint or legal query
- Question is outside your knowledge
- Principal insists on speaking to a person
- Payment disputes

OUTBOUND SCRIPT (data collection):
"Good morning/afternoon Sir/Madam. This is Arya calling from iPlus Olympiads. I'm reaching out to share details about our 2026 Olympiad registrations and collect your school's contact information for our records. May I speak with the Principal or the teacher in charge of olympiad activities?"

Stay strictly within iPlus Olympiads topics. If asked anything unrelated, politely redirect: "I can only assist with iPlus Olympiads queries. Is there anything I can help you with regarding our 2026 Olympiad?"`;

async function transcribeAudio(audioBase64: string, languageCode?: string): Promise<{ transcript: string; detectedLanguage: string }> {
  // Convert base64 to blob
  const audioBytes = Uint8Array.from(atob(audioBase64), c => c.charCodeAt(0));
  const audioBlob = new Blob([audioBytes], { type: "audio/wav" });

  const formData = new FormData();
  formData.append("file", audioBlob, "audio.wav");
  formData.append("model", "saarika:v2.5");
  formData.append("language_code", languageCode || "unknown");

  const response = await fetch("https://api.sarvam.ai/speech-to-text", {
    method: "POST",
    headers: { "api-subscription-key": SARVAM_API_KEY },
    body: formData,
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Sarvam STT error: ${err}`);
  }

  const data = await response.json();
  return {
    transcript: data.transcript || "",
    detectedLanguage: data.language_code || languageCode || "en-IN",
  };
}

async function generateSpeech(text: string, languageCode: string): Promise<string> {
  // Strip action tags from TTS text
  const cleanText = text.replace(/<action>[\s\S]*?<\/action>/g, "").trim();

  const response = await fetch("https://api.sarvam.ai/text-to-speech", {
    method: "POST",
    headers: {
      "api-subscription-key": SARVAM_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      inputs: [cleanText],
      target_language_code: languageCode,
      speaker: "meera", // warm female voice, works across Indic languages
      model: "bulbul:v2",
      speech_sample_rate: 8000, // telephony-optimized
      output_audio_codec: "wav",
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Sarvam TTS error: ${err}`);
  }

  const data = await response.json();
  return data.audios?.[0] || "";
}

async function generateResponse(
  transcript: string,
  conversationHistory: Array<{ role: string; content: string }>,
  languageCode: string
): Promise<string> {
  const languageName = SUPPORTED_LANGUAGES[languageCode] || "English";

  const messages = [
    ...conversationHistory,
    { role: "user", content: transcript },
  ];

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": CLAUDE_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 300,
      system: `${IPLUS_SYSTEM_PROMPT}\n\nIMPORTANT: Respond in ${languageName}. Keep your spoken response under 2-3 sentences for voice clarity.`,
      messages,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Claude API error: ${err}`);
  }

  const data = await response.json();
  return data.content?.[0]?.text || "";
}

function extractActions(responseText: string): Array<Record<string, unknown>> {
  const actions: Array<Record<string, unknown>> = [];
  const actionRegex = /<action>([\s\S]*?)<\/action>/g;
  let match;
  while ((match = actionRegex.exec(responseText)) !== null) {
    try {
      actions.push(JSON.parse(match[1]));
    } catch { /* skip malformed */ }
  }
  return actions;
}

async function processCrmActions(
  actions: Array<Record<string, unknown>>,
  schoolId: string,
  projectId: string,
  callContext: {
    direction: string;
    languageUsed: string;
    bonvoiceCallId?: string;
    transcript: string;
    aiResponse: string;
  }
) {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  for (const action of actions) {
    switch (action.type) {
      case "log_outcome": {
        await supabase.from("communications").insert({
          school_id: schoolId,
          project_id: projectId,
          user_id: "00000000-0000-0000-0000-000000000000", // system user placeholder
          communication_type: "AI Call",
          message: callContext.transcript,
          ai_summary: callContext.aiResponse.replace(/<action>[\s\S]*?<\/action>/g, "").trim(),
          direction: callContext.direction,
          language_used: callContext.languageUsed,
          outcome: action.outcome as string,
          bonvoice_call_id: callContext.bonvoiceCallId,
        });
        break;
      }

      case "collect_email": {
        await supabase
          .from("schools")
          .update({ email: action.email })
          .eq("id", schoolId);
        break;
      }

      case "schedule_callback": {
        await supabase.from("follow_ups").insert({
          school_id: schoolId,
          project_id: projectId,
          follow_up_date: action.date,
          follow_up_time: action.time,
          status: "pending",
          assigned_to: "ai",
          follow_up_type: "ai_call",
          notes: `AI callback requested during ${callContext.direction} call`,
          created_by: "00000000-0000-0000-0000-000000000000",
        });
        break;
      }

      case "transfer_to_human": {
        // Log the transfer and notify staff via existing notify-staff function
        await supabase.from("communications").insert({
          school_id: schoolId,
          project_id: projectId,
          user_id: "00000000-0000-0000-0000-000000000000",
          communication_type: "AI Call",
          message: callContext.transcript,
          ai_summary: `Transfer to human requested. Reason: ${action.reason}`,
          direction: callContext.direction,
          language_used: callContext.languageUsed,
          outcome: "transferred_to_human",
          bonvoice_call_id: callContext.bonvoiceCallId,
        });
        break;
      }
    }
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json();
    const {
      action,
      schoolId,
      projectId,
      audioBase64,
      languageCode,
      conversationHistory = [],
      direction = "outbound",
      bonvoiceCallId,
    } = body;

    // ── 1. Initiate outbound call greeting ──────────────────────────────
    if (action === "greet") {
      const greetLanguage = languageCode || "en-IN";
      const greetText = await generateResponse(
        "[CALL_STARTED] Generate the opening greeting for an outbound call to this school.",
        [],
        greetLanguage
      );
      const audioOut = await generateSpeech(greetText, greetLanguage);
      return new Response(
        JSON.stringify({ success: true, text: greetText, audioBase64: audioOut, languageCode: greetLanguage }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── 2. Process caller audio turn ────────────────────────────────────
    if (action === "respond" && audioBase64) {
      const { transcript, detectedLanguage } = await transcribeAudio(audioBase64, languageCode);

      if (!transcript.trim()) {
        return new Response(
          JSON.stringify({ success: true, text: "", audioBase64: "", transcript: "" }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const aiResponse = await generateResponse(transcript, conversationHistory, detectedLanguage);
      const audioOut = await generateSpeech(aiResponse, detectedLanguage);
      const actions = extractActions(aiResponse);

      // Process CRM actions asynchronously
      if (actions.length > 0 && schoolId && projectId) {
        await processCrmActions(actions, schoolId, projectId, {
          direction,
          languageUsed: SUPPORTED_LANGUAGES[detectedLanguage] || detectedLanguage,
          bonvoiceCallId,
          transcript,
          aiResponse,
        });
      }

      const shouldTransfer = actions.some(a => a.type === "transfer_to_human");

      return new Response(
        JSON.stringify({
          success: true,
          transcript,
          text: aiResponse.replace(/<action>[\s\S]*?<\/action>/g, "").trim(),
          audioBase64: audioOut,
          languageCode: detectedLanguage,
          actions,
          shouldTransfer,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── 3. Log completed call ────────────────────────────────────────────
    if (action === "log_call" && schoolId && projectId) {
      const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
      await supabase.from("communications").insert({
        school_id: schoolId,
        project_id: projectId,
        user_id: "00000000-0000-0000-0000-000000000000",
        communication_type: "AI Call",
        message: body.transcript || "",
        ai_summary: body.summary || "",
        direction: body.direction || "outbound",
        language_used: body.languageUsed || "English",
        duration_seconds: body.durationSeconds,
        recording_url: body.recordingUrl,
        outcome: body.outcome,
        bonvoice_call_id: bonvoiceCallId,
      });

      return new Response(
        JSON.stringify({ success: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ error: "Invalid action" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err) {
    console.error("ai-voice-agent error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Internal error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
