import { Download, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { downloadText, csvCell } from "./download";
import type { ReplaceItem } from "@/hooks/results/useEvaluations";

interface Props {
  replace: ReplaceItem[];
  acknowledged: boolean;
  onAcknowledge: (v: boolean) => void;
}

export function ReplaceWarning({ replace, acknowledged, onAcknowledge }: Props) {
  if (replace.length === 0) return null;
  const n = replace.length;
  const save = () =>
    downloadText("students-to-be-replaced.csv",
      ["Registration number,Name,Current result", ...replace.map((r) => `${csvCell(r.reg)},${csvCell(r.name)},${r.was === "absent" ? "Marked absent" : "Has a result"}`)].join("\n") + "\n");
  return (
    <div className="rounded-lg border border-amber-600/50 bg-amber-50 p-4 text-amber-950">
      <div className="flex items-start gap-3">
        <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
        <div className="space-y-3">
          <p className="text-base font-semibold">
            {n} {n === 1 ? "student already has" : "students already have"} results and will be replaced
          </p>
          <p className="text-sm">The old results are kept for 30 days and can be restored from the Students page.</p>
          <Button type="button" variant="outline" onClick={save} className="min-h-11 bg-white">
            <Download className="mr-2 h-4 w-4" aria-hidden="true" /> Download list
          </Button>
          <div className="flex items-center gap-3">
            <Checkbox id="replace-ack" checked={acknowledged} onCheckedChange={(v) => onAcknowledge(v === true)} className="h-5 w-5" />
            <Label htmlFor="replace-ack" className="text-base">I understand</Label>
          </div>
        </div>
      </div>
    </div>
  );
}
