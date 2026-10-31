import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";

interface ProgressPanelProps {
  /** Plain-English stage, e.g. "Uploading the question paper". */
  stage: string;
  /** 0-100. */
  percent: number;
  /** Optional extra line, e.g. "Questions 21 to 40 of 50". */
  detail?: string;
  onCancel?: () => void;
}

/** Shared determinate progress display for every Results upload, export and long process. */
export function ProgressPanel({ stage, percent, detail, onCancel }: ProgressPanelProps) {
  const pct = Math.max(0, Math.min(100, Math.round(Number.isFinite(percent) ? percent : 0)));
  return (
    <div className="w-full rounded-lg border bg-card p-4 text-card-foreground">
      <div className="flex items-baseline justify-between gap-4">
        <p className="text-base font-medium">{stage}</p>
        <p
          className="text-2xl font-semibold tabular-nums"
          aria-live="polite"
          aria-atomic="true"
        >
          {pct}%
        </p>
      </div>
      <Progress
        value={pct}
        aria-label={stage}
        className="mt-3 h-3"
      />
      {(detail || onCancel) && (
        <div className="mt-3 flex items-center justify-between gap-4">
          <p className="text-sm text-muted-foreground">{detail}</p>
          {onCancel && (
            <Button type="button" variant="outline" onClick={onCancel} className="min-h-11 shrink-0">
              Cancel
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
