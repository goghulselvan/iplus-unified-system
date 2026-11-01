import { Badge } from "@/components/ui/badge";

const STYLES: Record<string, { label: string; cls: string }> = {
  evaluated: { label: "Evaluated", cls: "border-green-700/40 bg-green-50 text-green-900" },
  absent: { label: "Absent", cls: "border-amber-600/50 bg-amber-50 text-amber-950" },
  pending: { label: "Pending", cls: "border-input bg-muted text-foreground" },
  deleted: { label: "Deleted", cls: "border-destructive/40 bg-red-50 text-red-900" },
};

export function StatusBadge({ status }: { status: string }) {
  const s = STYLES[status] ?? STYLES.pending;
  return <Badge variant="outline" className={`text-sm font-medium ${s.cls}`}>{s.label}</Badge>;
}
