import { Label } from "@/components/ui/label";
import { OLYMPIAD_NAMES, CLASS_ORDER, type OlympiadCode } from "@/lib/results/paperRules";
import type { ClassRow, PaperSummary, SlotTemplate } from "@/hooks/results/usePapers";

export const MANUAL_CLASSES = ["14", "15", "01", "02"];
export const isManualClass = (code: string) => MANUAL_CLASSES.includes(code);

export function paperLabel(p: PaperSummary, classes: ClassRow[], slots: SlotTemplate[]) {
  const cls = classes.find((c) => c.code === p.class_code)?.display_name ?? `Class ${p.class_code}`;
  const slotIdx = slots.findIndex((s) => s.id === p.slot_template_id);
  return `${cls} · ${OLYMPIAD_NAMES[p.olympiad_code as OlympiadCode] ?? p.olympiad_code} · Slot ${slotIdx + 1}`;
}

interface Props {
  kind: "manual" | "omr";
  papers: PaperSummary[];
  classes: ClassRow[];
  slots: SlotTemplate[];
  value: string;
  onChange: (paperId: string) => void;
  disabled?: boolean;
}

export function PaperPicker({ kind, papers, classes, slots, value, onChange, disabled }: Props) {
  const rank = (c: string) => CLASS_ORDER.indexOf(c);
  const list = papers
    .filter((p) => isManualClass(p.class_code) === (kind === "manual"))
    .sort((a, b) =>
      rank(a.class_code) - rank(b.class_code) ||
      a.olympiad_code.localeCompare(b.olympiad_code) ||
      slots.findIndex((s) => s.id === a.slot_template_id) - slots.findIndex((s) => s.id === b.slot_template_id));
  const id = `paper-picker-${kind}`;
  return (
    <div className="space-y-2">
      <Label htmlFor={id} className="text-sm font-medium">Which paper are these answers for?</Label>
      <select
        id={id}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="h-11 w-full rounded-md border border-input bg-background px-3 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <option value="">Choose a paper</option>
        {list.map((p) => {
          const ready = p.status === "ready";
          return (
            <option key={p.id} value={p.id} disabled={!ready} className={ready ? "" : "text-muted-foreground"}>
              {paperLabel(p, classes, slots)}{ready ? "" : " (Not ready yet)"}
            </option>
          );
        })}
      </select>
      {list.length === 0 && (
        <p className="text-sm text-muted-foreground">No papers have been created for this tab yet. Create them on the Question Papers page.</p>
      )}
    </div>
  );
}
