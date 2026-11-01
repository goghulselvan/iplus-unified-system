import { useState } from "react";
import { Download } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ProgressPanel } from "@/components/results/ProgressPanel";
import { fetchClassOlympiad, useSchoolSummary } from "@/hooks/results/useResultsReads";
import { OLYMPIAD_NAMES, type OlympiadCode } from "@/lib/results/paperRules";
import { coverageCsv, downloadCsv, type CoverageRowForCsv } from "@/lib/results/rankingsCsv";

const BATCH = 6;

export function CoverageTab({ projectId }: { projectId: string }) {
  const { data: schools, isLoading, isError } = useSchoolSummary(projectId);
  const [search, setSearch] = useState("");
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  const list = (schools ?? []).filter((s) => !search.trim() || (s.school_name ?? "").toLowerCase().includes(search.trim().toLowerCase()));
  const sum = (k: "enrolled" | "evaluated" | "absent" | "pending") => (schools ?? []).reduce((a, s) => a + Number(s[k] ?? 0), 0);

  const download = async () => {
    const all = schools ?? [];
    try {
      const out: CoverageRowForCsv[] = [];
      setProgress({ done: 0, total: all.length });
      for (let i = 0; i < all.length; i += BATCH) {
        const slice = all.slice(i, i + BATCH);
        const parts = await Promise.all(slice.map((s) => fetchClassOlympiad(projectId, s.school_id)));
        parts.forEach((rows, j) => {
          const s = slice[j];
          rows.forEach((r) =>
            out.push({
              school_name: s.school_name ?? "", state_name: s.state_name ?? "",
              class_name: r.class_name ?? `Class ${r.class_code}`,
              olympiad_name: OLYMPIAD_NAMES[r.olympiad_code as OlympiadCode] ?? r.olympiad_code,
              enrolled: Number(r.enrolled), evaluated: Number(r.evaluated), absent: Number(r.absent), pending: Number(r.pending),
            }),
          );
        });
        setProgress({ done: Math.min(i + BATCH, all.length), total: all.length });
      }
      downloadCsv("registered-vs-evaluated.csv", coverageCsv(out));
      toast.success(`Report saved: ${out.length} lines.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "We could not prepare the report. Please try again.");
    } finally {
      setProgress(null);
    }
  };

  if (isLoading) return <Skeleton className="h-48 w-full" />;
  if (isError) return <Card><CardContent className="py-8 text-base">We could not load this report. Please refresh and try again.</CardContent></Card>;
  if (!schools?.length) return <Card><CardContent className="py-10 text-base">No schools have registered students yet.</CardContent></Card>;

  return (
    <div className="space-y-4">
      <p className="text-base">
        Registered {sum("enrolled")} · Evaluated {sum("evaluated")} · Absent {sum("absent")} · Pending {sum("pending")}
      </p>
      <div className="flex flex-wrap items-end gap-4">
        <div className="flex min-w-[14rem] flex-1 flex-col gap-1.5">
          <Label htmlFor="cov-search" className="text-sm">Search for a school</Label>
          <Input id="cov-search" className="min-h-11" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="School name" />
        </div>
        <Button type="button" className="min-h-11" onClick={download} disabled={!!progress}>
          <Download className="mr-2 h-4 w-4" aria-hidden="true" />
          Download by class and olympiad (CSV)
        </Button>
      </div>
      {progress && (
        <ProgressPanel stage="Preparing the report" percent={(progress.done * 100) / Math.max(progress.total, 1)} detail={`${progress.done} of ${progress.total} schools`} />
      )}
      <div className="overflow-x-auto rounded-md border">
        <Table className="text-sm">
          <TableHeader>
            <TableRow>
              <TableHead>School</TableHead><TableHead>State</TableHead>
              <TableHead className="text-right">Registered</TableHead><TableHead className="text-right">Evaluated</TableHead>
              <TableHead className="text-right">Absent</TableHead><TableHead className="text-right">Pending</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.map((s) => (
              <TableRow key={s.school_id}>
                <TableCell className="font-medium">{s.school_name}</TableCell>
                <TableCell>{s.state_name ?? "—"}</TableCell>
                <TableCell className="text-right tabular-nums">{s.enrolled}</TableCell>
                <TableCell className="text-right tabular-nums">{s.evaluated}</TableCell>
                <TableCell className="text-right tabular-nums">{s.absent}</TableCell>
                <TableCell className="text-right tabular-nums">{s.pending}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
