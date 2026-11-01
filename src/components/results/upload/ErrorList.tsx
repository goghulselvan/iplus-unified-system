import { AlertTriangle, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { downloadText, csvCell } from "./download";
import type { UploadError } from "@/hooks/results/useEvaluations";

interface Props { errors: UploadError[]; moreErrors?: number; title?: string }

export function ErrorList({ errors, moreErrors = 0, title = "We couldn't accept this file. Nothing was saved." }: Props) {
  const shown = errors.slice(0, 100);
  const hidden = errors.length - shown.length + moreErrors;
  const save = () =>
    downloadText("error-list.csv", ["Row,Problem", ...errors.map((e) => `${e.row},${csvCell(e.message)}`)].join("\n") + "\n");
  return (
    <div role="alert" className="rounded-lg border border-destructive/50 bg-red-50 p-4 text-red-950">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" aria-hidden="true" />
        <div className="min-w-0 flex-1 space-y-3">
          <p className="text-base font-semibold">{title}</p>
          <p className="text-sm">Fix these problems in the file, then choose it again.</p>
          <ul className="max-h-80 space-y-1 overflow-y-auto rounded-md border border-red-200 bg-white p-3 text-sm">
            {shown.map((e, i) => <li key={i}>{e.message}</li>)}
          </ul>
          {hidden > 0 && <p className="text-sm font-medium">and {hidden} more</p>}
          <Button type="button" variant="outline" onClick={save} className="min-h-11 bg-white">
            <Download className="mr-2 h-4 w-4" aria-hidden="true" /> Download error list
          </Button>
        </div>
      </div>
    </div>
  );
}
