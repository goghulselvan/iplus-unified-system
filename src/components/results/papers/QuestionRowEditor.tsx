import { useState } from "react";
import { Image as ImageIcon, TriangleAlert } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { ANSWERS, COGNITIVE_LEVELS, type QuestionRow } from "@/lib/results/paperRules";

export type QuestionEdit = Partial<Pick<QuestionRow, "correct_answer" | "is_grace" | "skill_category" | "cognitive_level">>;

interface Props {
  question: QuestionRow;
  edit?: QuestionEdit;
  skills: string[];
  onChange: (questionNumber: number, patch: QuestionEdit) => void;
}

const selectClass =
  "h-11 w-full min-w-36 rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function needsCheck(q: Pick<QuestionRow, "ai_confidence" | "has_figure">) {
  return q.has_figure || (q.ai_confidence !== null && Number(q.ai_confidence) < 0.7);
}

export function QuestionRowEditor({ question, edit, skills, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const q = question;
  const merged = { ...q, ...edit };
  const n = q.question_number;
  const check = needsCheck(q) && !q.human_edited && !edit;
  const skillOptions = merged.skill_category && !skills.includes(merged.skill_category)
    ? [merged.skill_category, ...skills] : skills;

  return (
    <tr className={`border-b align-top ${check ? "bg-amber-50" : ""}`}>
      <th scope="row" className="px-3 py-3 text-left text-base font-semibold tabular-nums">{n}</th>
      <td className="max-w-md px-3 py-3 text-sm">
        <p className={open ? "" : "line-clamp-2"}>{q.question_text || <span className="text-muted-foreground">No text read yet</span>}</p>
        {q.question_text && q.question_text.length > 90 && (
          <button type="button" onClick={() => setOpen(!open)} aria-expanded={open}
            className="mt-1 text-sm font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {open ? "Show less" : "Show more"}
          </button>
        )}
        {check && (
          <p className="mt-1 flex items-center gap-1 text-sm font-semibold text-amber-900">
            <TriangleAlert className="h-4 w-4" aria-hidden="true" />Please check
          </p>
        )}
      </td>
      <td className="px-2 py-3">
        {q.has_figure && (
          <span title="This question has a picture or diagram" className="inline-flex">
            <ImageIcon className="h-5 w-5 text-amber-800" aria-label="This question has a picture or diagram" />
          </span>
        )}
      </td>
      <td className="px-3 py-3">
        <div role="group" aria-label={`Answer for question ${n}`} className="flex gap-1">
          {ANSWERS.map((a) => (
            <button key={a} type="button" aria-pressed={!merged.is_grace && merged.correct_answer === a}
              disabled={!!merged.is_grace}
              onClick={() => onChange(n, { correct_answer: merged.correct_answer === a ? null : a })}
              className={`h-11 w-11 rounded-md border text-base font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40 ${
                !merged.is_grace && merged.correct_answer === a
                  ? "border-primary bg-primary text-primary-foreground" : "bg-background hover:bg-muted"}`}>
              {a}
            </button>
          ))}
        </div>
      </td>
      <td className="px-3 py-3">
        <div className="flex items-center gap-2">
          <Switch checked={!!merged.is_grace} aria-label={`Grace for question ${n}`}
            onCheckedChange={(v) => onChange(n, v ? { is_grace: true, correct_answer: null } : { is_grace: false })} />
          <span className="text-sm">Grace</span>
        </div>
        {merged.is_grace && <p className="mt-1 text-sm text-muted-foreground">Every student gets this mark</p>}
      </td>
      <td className="px-3 py-3">
        <select aria-label={`Skill for question ${n}`} className={selectClass} value={merged.skill_category ?? ""}
          onChange={(e) => onChange(n, { skill_category: e.target.value || null })}>
          <option value="">Choose a skill</option>
          {skillOptions.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </td>
      <td className="px-3 py-3">
        <select aria-label={`Thinking level for question ${n}`} className={selectClass} value={merged.cognitive_level ?? ""}
          onChange={(e) => onChange(n, { cognitive_level: (e.target.value || null) as QuestionRow["cognitive_level"] })}>
          <option value="">Choose a level</option>
          {COGNITIVE_LEVELS.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </td>
      <td className="px-3 py-3 text-sm tabular-nums">
        {q.ai_confidence === null ? <span className="text-muted-foreground">Not read</span> : `${Math.round(Number(q.ai_confidence) * 100)}% sure`}
      </td>
    </tr>
  );
}
