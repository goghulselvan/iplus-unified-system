import type { KeyboardEvent } from "react";
import { Check, CircleCheck, Image as ImageIcon, KeyRound, ShieldAlert, TriangleAlert, CircleHelp } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { ANSWERS, COGNITIVE_LEVELS, type QuestionRow } from "@/lib/results/paperRules";
import { checkStatus } from "@/lib/results/keyCheck";
import { LETTERS, type CheckStatus, type Letter } from "@/lib/results/questionRow";
import { QuestionPicture, type PdfSource } from "./QuestionPicture";

export type QuestionEdit = Partial<Pick<QuestionRow, "correct_answer" | "is_grace" | "skill_category" | "cognitive_level" | "check_status">>;

interface Props {
  question: QuestionRow;
  edit?: QuestionEdit;
  skills: string[];
  pdf: PdfSource | null;
  onChange: (questionNumber: number, patch: QuestionEdit) => void;
  /** +1 for the next visible card, -1 for the previous one. */
  onNav: (questionNumber: number, direction: 1 | -1) => void;
}

const selectClass =
  "h-11 w-full min-w-36 rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function needsCheck(q: Pick<QuestionRow, "ai_confidence" | "has_figure">) {
  return q.has_figure || (q.ai_confidence !== null && Number(q.ai_confidence) < 0.7);
}

const STATUS: Record<CheckStatus, { label: string; tone: string; border: string; Icon: typeof Check }> = {
  confirmed: { label: "Confirmed", tone: "bg-green-100 text-green-900", border: "border-l-green-700", Icon: CircleCheck },
  key_only: { label: "Key only", tone: "bg-sky-100 text-sky-900", border: "border-l-sky-700", Icon: KeyRound },
  mismatch: { label: "Please check", tone: "bg-amber-100 text-amber-950", border: "border-l-amber-600", Icon: TriangleAlert },
  mismatch_strong: { label: "AI strongly disagrees", tone: "bg-red-100 text-red-900", border: "border-l-red-700", Icon: ShieldAlert },
  resolved: { label: "Resolved", tone: "bg-indigo-100 text-indigo-900", border: "border-l-indigo-700", Icon: Check },
  unchecked: { label: "No key yet", tone: "bg-muted text-foreground", border: "border-l-border", Icon: CircleHelp },
};

export const statusLabel = (s: CheckStatus) => STATUS[s].label;

const optionText = (q: QuestionRow, l: Letter) => q[`option_${l.toLowerCase()}` as "option_a"];
const pct = (n: unknown) => `${Math.round(Number(n) * 100)}%`;

export function QuestionCard({ question, edit, skills, pdf, onChange, onNav }: Props) {
  const q = question;
  const m = { ...q, ...edit } as QuestionRow;
  const n = q.question_number;
  const status = checkStatus(m);
  const s = STATUS[status];
  const grace = !!m.is_grace;
  const aiPick = (m.recheck_answer ?? m.ai_answer) as Letter | null;
  const open = status === "mismatch" || status === "mismatch_strong";
  const skillOptions = m.skill_category && !skills.includes(m.skill_category) ? [m.skill_category, ...skills] : skills;
  const checkHint = status === "unchecked" && needsCheck(q) && !q.human_edited && !edit;
  const hasPicture = m.figure_page != null;

  const resolvedHow = grace ? "Marked as grace: every student gets this mark"
    : m.correct_answer && m.correct_answer === m.key_answer ? "You kept the answer key's answer"
    : "You used the AI's answer";

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const t = e.target as HTMLElement;
    if (["SELECT", "INPUT", "TEXTAREA"].includes(t.tagName)) return;
    const k = e.key.length === 1 ? e.key.toUpperCase() : e.key;
    if ((ANSWERS as readonly string[]).includes(k)) {
      e.preventDefault();
      if (!grace) onChange(n, { correct_answer: k });
    } else if (k === "G") {
      e.preventDefault();
      onChange(n, grace ? { is_grace: false } : { is_grace: true, correct_answer: null });
    } else if (k === "ArrowDown" || (k === "Enter" && t === e.currentTarget)) {
      e.preventDefault();
      onNav(n, 1);
    } else if (k === "ArrowUp") {
      e.preventDefault();
      onNav(n, -1);
    }
  };

  const decide = (patch: QuestionEdit) => onChange(n, { ...patch, check_status: "resolved" });

  return (
    <article id={`q-card-${n}`} tabIndex={0} aria-label={`Question ${n}, ${s.label}`} onKeyDown={onKeyDown}
      className={`rounded-lg border border-l-8 bg-card p-4 text-card-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:p-5 ${s.border}`}>
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h4 className="text-2xl font-semibold tabular-nums">Question {n}</h4>
        <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold ${s.tone}`}>
          <s.Icon className="h-4 w-4" aria-hidden="true" />{s.label}
        </span>
        <span className="rounded-md border px-2 py-1 text-sm">
          Key: {m.key_answer ?? "not uploaded"}
        </span>
        <span className="rounded-md border px-2 py-1 text-sm">
          AI: {m.ai_answer ?? "no answer"}{m.ai_confidence !== null && m.ai_answer ? ` (${pct(m.ai_confidence)} sure)` : ""}
        </span>
        {hasPicture && (
          <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">
            <ImageIcon className="h-4 w-4" aria-hidden="true" />Has a picture
          </span>
        )}
      </header>

      <div className={`mt-4 grid gap-5 ${hasPicture ? "lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]" : ""}`}>
        {hasPicture && <QuestionPicture questionNumber={n} page={m.figure_page!} box={m.figure_box} pdf={pdf} />}
        <div className="space-y-3">
          <p className="whitespace-pre-wrap text-base leading-relaxed">
            {q.question_text || <span className="text-muted-foreground">No text read yet</span>}
          </p>
          <ul className="space-y-2" aria-label={`Options for question ${n}`}>
            {LETTERS.map((l) => {
              const correct = !grace && m.correct_answer === l;
              const text = optionText(m, l);
              const tags = [
                open && m.key_answer === l ? "Key" : null,
                open && aiPick === l ? "AI" : null,
              ].filter(Boolean).join(" and ");
              return (
                <li key={l} data-testid={`option-${n}-${l}`} data-correct={correct ? "true" : "false"}
                  className={`flex items-start gap-3 rounded-md border px-3 py-2 ${correct ? "border-green-700 bg-green-50 text-green-950" : "bg-background"}`}>
                  <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-base font-semibold ${correct ? "border-green-700 bg-green-700 text-white" : ""}`}>{l}</span>
                  <span className="min-w-0 flex-1 pt-0.5 text-base">
                    {text === null ? <span className="text-muted-foreground">Not read yet</span>
                      : text === "" ? <span className="text-muted-foreground">Shown in the picture</span> : text}
                  </span>
                  {tags && <span className="shrink-0 pt-1 text-sm font-medium text-muted-foreground">{tags}</span>}
                  {correct && (
                    <span className="flex shrink-0 items-center gap-1 pt-1 text-sm font-semibold text-green-900">
                      <Check className="h-4 w-4" aria-hidden="true" />Correct answer
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
          {grace && <p className="text-sm font-medium">Grace: every student gets this mark, whatever they answered.</p>}
        </div>
      </div>

      {open && (
        <section aria-label={`Decision for question ${n}`}
          className={`mt-4 rounded-md border p-4 ${status === "mismatch_strong" ? "border-red-700 bg-red-50 text-red-950" : "border-amber-600 bg-amber-50 text-amber-950"}`}>
          <p className="text-base font-semibold">
            {status === "mismatch_strong"
              ? `The AI is ${pct(m.recheck_confidence)} sure the answer is ${m.recheck_answer}, but the answer key says ${m.key_answer}. The key may have a printing error, or the question may be faulty. Please decide before this paper can be Ready.`
              : `The answer key says ${m.key_answer} but the AI says ${aiPick ?? "something else"}. Please look at the question and decide.`}
          </p>
          {m.ai_reason && <p className="mt-2 text-sm"><span className="font-semibold">AI's reason:</span> {m.ai_reason}</p>}
          {m.recheck_reason && <p className="mt-1 text-sm"><span className="font-semibold">After a second look:</span> {m.recheck_reason}</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button type="button" variant="outline" className="min-h-11 bg-background"
              onClick={() => decide({ correct_answer: m.key_answer, is_grace: false })}>Keep key ({m.key_answer})</Button>
            <Button type="button" variant="outline" className="min-h-11 bg-background" disabled={!aiPick}
              onClick={() => decide({ correct_answer: aiPick, is_grace: false })}>Use AI's answer{aiPick ? ` (${aiPick})` : ""}</Button>
            <Button type="button" variant="outline" className="min-h-11 bg-background"
              onClick={() => decide({ is_grace: true, correct_answer: null })}>Mark grace</Button>
          </div>
        </section>
      )}
      {status === "confirmed" && m.recheck_answer && m.recheck_answer === m.key_answer && m.ai_answer !== m.key_answer && (
        <p className="mt-3 text-sm font-medium text-green-900">AI rechecked: the key is right.</p>
      )}
      {status === "resolved" && <p className="mt-3 text-sm font-medium text-indigo-900">{resolvedHow}</p>}
      {checkHint && (
        <p className="mt-3 flex items-center gap-1 text-sm font-semibold text-amber-900">
          <TriangleAlert className="h-4 w-4" aria-hidden="true" />Please check this answer
        </p>
      )}

      <div className="mt-4 grid gap-4 border-t pt-4 sm:grid-cols-2 lg:grid-cols-[auto_auto_1fr_1fr]">
        <div>
          <p className="mb-1 text-sm font-medium" id={`ans-label-${n}`}>Answer</p>
          <div role="group" aria-label={`Answer for question ${n}`} className="flex gap-1">
            {ANSWERS.map((a) => (
              <button key={a} type="button" aria-pressed={!grace && m.correct_answer === a} disabled={grace}
                onClick={() => onChange(n, { correct_answer: m.correct_answer === a ? null : a })}
                className={`h-11 w-11 rounded-md border text-base font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40 ${
                  !grace && m.correct_answer === a ? "border-primary bg-primary text-primary-foreground" : "bg-background hover:bg-muted"}`}>
                {a}
              </button>
            ))}
          </div>
        </div>
        <div>
          <p className="mb-1 text-sm font-medium">Grace</p>
          <div className="flex min-h-11 items-center gap-2">
            <Switch checked={grace} aria-label={`Grace for question ${n}`}
              onCheckedChange={(v) => onChange(n, v ? { is_grace: true, correct_answer: null } : { is_grace: false })} />
            <span className="text-sm">{grace ? "Every student gets this mark" : "Off"}</span>
          </div>
        </div>
        <label className="block text-sm font-medium">
          <span className="mb-1 block">Skill</span>
          <select aria-label={`Skill for question ${n}`} className={selectClass} value={m.skill_category ?? ""}
            onChange={(e) => onChange(n, { skill_category: e.target.value || null })}>
            <option value="">Choose a skill</option>
            {skillOptions.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
        </label>
        <label className="block text-sm font-medium">
          <span className="mb-1 block">Thinking level</span>
          <select aria-label={`Thinking level for question ${n}`} className={selectClass} value={m.cognitive_level ?? ""}
            onChange={(e) => onChange(n, { cognitive_level: (e.target.value || null) as QuestionRow["cognitive_level"] })}>
            <option value="">Choose a level</option>
            {COGNITIVE_LEVELS.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
      </div>
    </article>
  );
}
