import { useState, useEffect, useRef, useCallback } from "react";
import Navbar from "@/components/layout/Navbar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Mic, Plus, RefreshCw, Trash2, Languages, Volume2, Square, Edit2, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

const SUPABASE_URL = "https://eucjeggfclztkbbupaav.supabase.co";
const bucketUrl = (bucket: string, path: string) =>
  `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${encodeURIComponent(path)}`;

const LANGUAGES = [
  { code: "en-IN", name: "English" },
  { code: "ta-IN", name: "Tamil" },
  { code: "te-IN", name: "Telugu" },
  { code: "kn-IN", name: "Kannada" },
  { code: "ml-IN", name: "Malayalam" },
  { code: "hi-IN", name: "Hindi" },
];

// Sarvam bulbul:v2 speakers
const SPEAKERS = [
  { id: "anushka", label: "Anushka (female)" },
  { id: "manisha", label: "Manisha (female)" },
  { id: "vidya", label: "Vidya (female)" },
  { id: "arya", label: "Arya (female)" },
  { id: "abhilash", label: "Abhilash (male)" },
  { id: "karun", label: "Karun (male)" },
  { id: "hitesh", label: "Hitesh (male)" },
];

const FAQ_INTENTS = ["fee", "deadline", "subjects", "exam_date", "how_to_register", "classes", "contact", "results"];

type VoiceTemplate = {
  id: string; name: string; language_code: string; speaker: string;
  source_script: string | null; final_script: string;
  wav_path: string | null; mulaw_path: string | null;
  duration_seconds: number | null; created_at: string;
};

// ── Client-side G.711 mu-law player (for the voicebot FAQ .mulaw files) ───────
function useMulawPlayer() {
  const ctxRef = useRef<AudioContext | null>(null);
  const srcRef = useRef<AudioBufferSourceNode | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);

  const stop = useCallback(() => {
    srcRef.current?.stop();
    srcRef.current = null;
    setPlaying(null);
  }, []);

  const play = useCallback(async (url: string, key: string) => {
    stop();
    const ctx = (ctxRef.current ??= new AudioContext());
    const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
    const buffer = ctx.createBuffer(1, bytes.length, 8000);
    const ch = buffer.getChannelData(0);
    for (let i = 0; i < bytes.length; i++) {
      let b = ~bytes[i] & 0xff;
      const sign = b & 0x80;
      const exponent = (b >> 4) & 0x07;
      const mantissa = b & 0x0f;
      let sample = ((mantissa << 3) + 0x84) << exponent;
      sample -= 0x84;
      ch[i] = (sign ? -sample : sample) / 32768;
    }
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(ctx.destination);
    src.onended = () => setPlaying(p => (p === key ? null : p));
    src.start();
    srcRef.current = src;
    setPlaying(key);
  }, [stop]);

  return { play, stop, playing };
}

export default function VoiceTemplates() {
  const { toast } = useToast();
  const [templates, setTemplates] = useState<VoiceTemplate[]>([]);
  const [loading, setLoading] = useState(true);

  // Form state
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [language, setLanguage] = useState("en-IN");
  const [speaker, setSpeaker] = useState("anushka");
  const [sourceScript, setSourceScript] = useState("");
  const [finalScript, setFinalScript] = useState("");
  const [translating, setTranslating] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // FAQ audio browser
  const [faqLang, setFaqLang] = useState("en-IN");
  const { play, stop, playing } = useMulawPlayer();

  const fetchTemplates = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.from("voice_templates").select("*").order("created_at", { ascending: false });
    setTemplates((data as VoiceTemplate[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { fetchTemplates(); }, [fetchTemplates]);

  const resetForm = () => {
    setEditingId(null); setName(""); setLanguage("en-IN"); setSpeaker("anushka");
    setSourceScript(""); setFinalScript(""); setFormError(null);
  };

  const editTemplate = (t: VoiceTemplate) => {
    setEditingId(t.id); setName(t.name); setLanguage(t.language_code); setSpeaker(t.speaker);
    setSourceScript(t.source_script ?? ""); setFinalScript(t.final_script);
    setFormError(null); setShowForm(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const invokeFn = async (body: Record<string, unknown>) => {
    const { data, error } = await supabase.functions.invoke("generate-voice-template", { body });
    if (error) throw new Error(error.message);
    if (!data?.success) throw new Error(data?.error ?? "Unknown error");
    return data;
  };

  const translateScript = async () => {
    if (!sourceScript.trim()) return;
    setTranslating(true); setFormError(null);
    try {
      const data = await invokeFn({ action: "translate", text: sourceScript.trim(), language_code: language });
      setFinalScript(data.translated);
    } catch (e: any) {
      setFormError(e.message);
    } finally { setTranslating(false); }
  };

  const generateTemplate = async () => {
    if (!name.trim() || !finalScript.trim()) return;
    setGenerating(true); setFormError(null);
    try {
      await invokeFn({
        action: "generate",
        template_id: editingId ?? undefined,
        name: name.trim(),
        language_code: language,
        speaker,
        source_script: sourceScript.trim() || null,
        final_script: finalScript.trim(),
      });
      toast({ title: editingId ? "Template regenerated" : "Voice template created", description: "Audio is ready — play it below." });
      resetForm(); setShowForm(false);
      await fetchTemplates();
    } catch (e: any) {
      setFormError(e.message);
    } finally { setGenerating(false); }
  };

  const deleteTemplate = async (t: VoiceTemplate) => {
    if (!window.confirm(`Delete voice template "${t.name}"?`)) return;
    const paths = [t.wav_path, t.mulaw_path].filter(Boolean) as string[];
    if (paths.length) await supabase.storage.from("voice-templates").remove(paths);
    await supabase.from("voice_templates").delete().eq("id", t.id);
    setTemplates(prev => prev.filter(x => x.id !== t.id));
  };

  const langName = (code: string) => LANGUAGES.find(l => l.code === code)?.name ?? code;

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
              <Mic className="h-5 w-5 text-indigo-600" /> Voice Templates
            </h1>
            <p className="text-sm text-gray-500 mt-0.5">
              Create pre-recorded voice messages for operational school calls — type a script, pick language and voice, generate with Sarvam AI.
            </p>
          </div>
          <Button size="sm" onClick={() => { resetForm(); setShowForm(v => !v); }}>
            {showForm ? <><X className="h-4 w-4 mr-1.5" />Close</> : <><Plus className="h-4 w-4 mr-1.5" />New Template</>}
          </Button>
        </div>

        {/* Create / edit form */}
        {showForm && (
          <div className="bg-white rounded-xl border border-indigo-200 p-5 space-y-4">
            <h3 className="font-semibold text-gray-800 text-sm">
              {editingId ? "Edit & regenerate template" : "New voice template"}
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Template name</Label>
                <Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Deadline Reminder (Tamil)" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Language</Label>
                <Select value={language} onValueChange={setLanguage}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {LANGUAGES.map(l => <SelectItem key={l.code} value={l.code}>{l.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Voice (Sarvam AI)</Label>
                <Select value={speaker} onValueChange={setSpeaker}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {SPEAKERS.map(s => <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <Label className="text-xs">Script (English)</Label>
                {language !== "en-IN" && (
                  <Button variant="outline" size="sm" className="h-7 text-xs" onClick={translateScript}
                    disabled={translating || !sourceScript.trim()}>
                    {translating
                      ? <><RefreshCw className="h-3 w-3 mr-1 animate-spin" />Translating…</>
                      : <><Languages className="h-3 w-3 mr-1" />Translate to {langName(language)}</>}
                  </Button>
                )}
              </div>
              <Textarea rows={3} value={sourceScript} onChange={e => setSourceScript(e.target.value)}
                placeholder="Type your message in English. For other languages, click Translate — then review and edit the result before generating." />
            </div>

            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <Label className="text-xs">Final script — exactly what will be spoken ({langName(language)})</Label>
                <span className="text-[11px] text-gray-400">{finalScript.length} chars</span>
              </div>
              <Textarea rows={4} value={finalScript} onChange={e => setFinalScript(e.target.value)}
                placeholder={language === "en-IN"
                  ? "Same as above, or a refined version — this exact text is converted to audio."
                  : "Click Translate above, then review/edit the translation here."} />
              {language === "en-IN" && sourceScript && !finalScript && (
                <button className="text-xs text-indigo-600 hover:underline" onClick={() => setFinalScript(sourceScript)}>
                  Copy from script above
                </button>
              )}
            </div>

            {formError && <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">{formError}</p>}

            <Button onClick={generateTemplate} disabled={generating || !name.trim() || !finalScript.trim()}>
              {generating
                ? <><RefreshCw className="h-4 w-4 mr-1.5 animate-spin" />Generating audio…</>
                : <><Volume2 className="h-4 w-4 mr-1.5" />{editingId ? "Regenerate Audio" : "Generate & Save"}</>}
            </Button>
          </div>
        )}

        {/* Template list */}
        {loading ? (
          <div className="text-center py-12 text-gray-400"><RefreshCw className="h-5 w-5 animate-spin mx-auto" /></div>
        ) : templates.length === 0 ? (
          <div className="text-center py-14 bg-white rounded-xl border border-gray-200">
            <Mic className="h-9 w-9 text-gray-300 mx-auto mb-2" />
            <p className="text-gray-500 font-medium text-sm">No voice templates yet</p>
            <p className="text-gray-400 text-xs mt-1">Create your first template — it takes under a minute.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {templates.map(t => (
              <div key={t.id} className="bg-white rounded-xl border border-gray-200 p-4 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold text-sm text-gray-900 truncate">{t.name}</p>
                    <p className="text-xs text-gray-400">
                      {langName(t.language_code)} · {SPEAKERS.find(s => s.id === t.speaker)?.label ?? t.speaker}
                      {t.duration_seconds ? ` · ${t.duration_seconds}s` : ""}
                    </p>
                  </div>
                  <div className="flex gap-1 flex-shrink-0">
                    <button className="p-1.5 rounded-lg text-gray-400 hover:text-indigo-600 hover:bg-indigo-50"
                      title="Edit & regenerate" onClick={() => editTemplate(t)}>
                      <Edit2 className="h-3.5 w-3.5" />
                    </button>
                    <button className="p-1.5 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50"
                      title="Delete" onClick={() => deleteTemplate(t)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
                {t.wav_path && (
                  <audio controls preload="none" className="w-full h-9" src={bucketUrl("voice-templates", t.wav_path)} />
                )}
                <p className="text-[11.5px] text-gray-500 leading-relaxed line-clamp-3">{t.final_script}</p>
              </div>
            ))}
          </div>
        )}

        {/* Voicebot FAQ audio browser */}
        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
          <div>
            <h2 className="font-semibold text-sm text-gray-800">🤖 Voicebot FAQ audio (48 files)</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              The pre-generated answers the AI voicebot plays to callers — 8 topics × 6 languages (Sarvam anushka, telephony 8kHz).
            </p>
          </div>
          <div className="flex gap-1.5 flex-wrap">
            {LANGUAGES.map(l => (
              <button key={l.code} onClick={() => { stop(); setFaqLang(l.code); }}
                className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                  faqLang === l.code ? "bg-gray-800 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}>
                {l.name}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {FAQ_INTENTS.map(intent => {
              const key = `${faqLang}/${intent}`;
              const isPlaying = playing === key;
              return (
                <button key={intent}
                  onClick={() => isPlaying ? stop() : play(bucketUrl("faq-audio", `${faqLang}/${intent}.mulaw`).replace("%2F", "/"), key)}
                  className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border text-xs font-medium transition-colors ${
                    isPlaying ? "border-indigo-400 bg-indigo-50 text-indigo-700" : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50"}`}>
                  {isPlaying ? <Square className="h-3.5 w-3.5 flex-shrink-0" /> : <Volume2 className="h-3.5 w-3.5 flex-shrink-0 text-gray-400" />}
                  {intent.replace(/_/g, " ")}
                </button>
              );
            })}
          </div>
        </div>

        <p className="text-xs text-gray-400 bg-gray-100 rounded-xl px-4 py-3">
          ⚖️ These templates are for <b>operational</b> calls to your registered schools (status updates, deadlines, olympiad information).
          Marketing calls to prospects require the TRAI-compliant 140-series setup — pending with Bonvoice.
        </p>
      </div>
    </div>
  );
}
