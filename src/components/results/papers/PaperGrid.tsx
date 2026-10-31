import { Check, Plus } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { OLYMPIAD_NAMES, olympiadsForClass, type OlympiadCode } from "@/lib/results/paperRules";
import type { ClassRow, PaperSummary, SlotTemplate } from "@/hooks/results/usePapers";

export interface CreateDefaults {
  classCode: string;
  olympiad: OlympiadCode;
  slotId: string;
}

interface Props {
  papers: PaperSummary[];
  classes: ClassRow[];
  slots: SlotTemplate[];
  onOpen: (paper: PaperSummary) => void;
  onCreate: (defaults: CreateDefaults) => void;
}

const chipBase =
  "flex min-h-11 w-full items-center justify-between gap-2 rounded-md border px-3 py-1.5 text-left text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function Chip({
  slotLabel, paper, total, onClick, aria,
}: { slotLabel: string; paper?: PaperSummary; total: number; onClick: () => void; aria: string }) {
  if (!paper) {
    return (
      <button type="button" onClick={onClick} aria-label={`${aria}: Not created. Create it`}
        className={`${chipBase} border-dashed text-muted-foreground hover:bg-muted`}>
        <span>{slotLabel}: Not created</span>
        <Plus className="h-4 w-4 shrink-0" aria-hidden="true" />
      </button>
    );
  }
  const ready = paper.status === "ready";
  return (
    <button type="button" onClick={onClick}
      aria-label={`${aria}: ${ready ? "Ready" : `Draft, ${paper.answered} of ${total} answered`}`}
      className={`${chipBase} ${ready ? "border-green-700/40 bg-green-50 text-green-900 hover:bg-green-100" : "border-amber-600/40 bg-amber-50 text-amber-950 hover:bg-amber-100"}`}>
      <span>
        {slotLabel}: {ready ? "Ready" : `Draft (${paper.answered} of ${total} answered)`}
      </span>
      {ready && <Check className="h-4 w-4 shrink-0" aria-hidden="true" />}
    </button>
  );
}

export function PaperGrid({ papers, classes, slots, onOpen, onCreate }: Props) {
  const classByCode = new Map(classes.map((c) => [c.code, c]));
  const shownSlots = slots.slice(0, 2);

  const cell = (classCode: string, olympiad: OlympiadCode) => {
    const cls = classByCode.get(classCode);
    const total = cls?.question_count ?? 0;
    return (
      <div className="flex flex-col gap-2">
        {shownSlots.map((slot, i) => {
          const paper = papers.find(
            (p) => p.class_code === classCode && p.olympiad_code === olympiad && p.slot_template_id === slot.id,
          );
          const label = `Slot ${i + 1}`;
          return (
            <Chip key={slot.id} slotLabel={label} paper={paper} total={paper?.total_questions ?? total}
              aria={`${cls?.display_name ?? classCode} ${OLYMPIAD_NAMES[olympiad]} ${label}`}
              onClick={() => (paper ? onOpen(paper) : onCreate({ classCode, olympiad, slotId: slot.id }))} />
          );
        })}
      </div>
    );
  };

  const groups: { title: string; codes: string[]; cols: OlympiadCode[] }[] = [
    { title: "LKG and UKG", codes: ["14", "15"], cols: olympiadsForClass("14") },
    { title: "Classes 1 to 8", codes: ["01", "02", "03", "04", "05", "06", "07", "08"], cols: olympiadsForClass("01") },
  ];

  return (
    <div className="space-y-6">
      {groups.map((g) => (
        <Card key={g.title}>
          <CardContent className="overflow-x-auto pt-6">
            <h3 className="mb-3 text-lg font-semibold">{g.title}</h3>
            <table className="w-full min-w-[640px] border-separate border-spacing-y-2 text-sm">
              <thead>
                <tr>
                  <th scope="col" className="w-28 pb-1 text-left text-sm font-semibold">Class</th>
                  {g.cols.map((c) => (
                    <th key={c} scope="col" className="min-w-44 px-2 pb-1 text-left text-sm font-semibold">
                      {OLYMPIAD_NAMES[c]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {g.codes.map((code) => (
                  <tr key={code}>
                    <th scope="row" className="pr-2 text-left align-top text-base font-medium">
                      <span className="inline-block pt-2">{classByCode.get(code)?.display_name ?? code}</span>
                    </th>
                    {g.cols.map((c) => (
                      <td key={c} className="px-2 align-top">{cell(code, c)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
