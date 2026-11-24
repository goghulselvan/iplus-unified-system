import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowDown, ArrowUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useResultsProject } from "@/hooks/results/useResultsProject";
import { useSchoolSummary, type SchoolSummaryRow } from "@/hooks/results/useResultsReads";
import { schoolGrade } from "@/lib/results/grading";
import { vsStateDiff, vsStateText } from "@/lib/results/schoolResults";

type SortKey = "name" | "state" | "enrolled" | "evaluated" | "avg" | "vs";

const sortValue = (s: SchoolSummaryRow, k: SortKey): string | number | null => {
  switch (k) {
    case "name": return (s.school_name ?? "").toLowerCase();
    case "state": return (s.state_name ?? "").toLowerCase();
    case "enrolled": return Number(s.enrolled);
    case "evaluated": return Number(s.evaluated);
    case "avg": return s.avg_percentage == null ? null : Number(s.avg_percentage);
    case "vs": return vsStateDiff(s.avg_percentage, s.state_avg_percentage);
  }
};

export function VsState({ avg, stateAvg }: { avg: number | null; stateAvg: number | null }) {
  const d = vsStateDiff(avg, stateAvg);
  if (d == null) return <span className="text-muted-foreground">—</span>;
  const cls = Math.round(d) > 0 ? "text-green-800" : Math.round(d) < 0 ? "text-amber-800" : "text-foreground";
  const sign = Math.round(d) > 0 ? "+" : Math.round(d) < 0 ? "−" : "";
  return (
    <span className={`font-medium ${cls}`} title={vsStateText(d)}>
      {sign}{Math.abs(Math.round(d))}%
    </span>
  );
}

export default function SchoolResultsPage() {
  const { data: project, isLoading: loadingProject } = useResultsProject();
  const { data, isLoading, isError } = useSchoolSummary(project?.id);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "name", dir: 1 });

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = (data ?? []).filter((s) => !q || (s.school_name ?? "").toLowerCase().includes(q));
    return [...list].sort((a, b) => {
      const x = sortValue(a, sort.key), y = sortValue(b, sort.key);
      if (x == null && y == null) return 0;
      if (x == null) return 1;
      if (y == null) return -1;
      if (typeof x === "string" && typeof y === "string") return x.localeCompare(y) * sort.dir;
      return (x < y ? -1 : x > y ? 1 : 0) * sort.dir;
    });
  }, [data, search, sort]);

  if (loadingProject || isLoading) return <Skeleton className="h-64 w-full" />;
  if (!project) return <Card><CardContent className="py-10 text-base">There is no active olympiad year right now.</CardContent></Card>;
  if (isError) return <Card><CardContent className="py-10 text-base">We could not load the school results. Please refresh and try again.</CardContent></Card>;
  if (!data?.length) return <Card><CardContent className="py-10 text-base">No schools have registered students yet.</CardContent></Card>;

  const head = (key: SortKey, label: string, right = false) => {
    const active = sort.key === key;
    return (
      <TableHead className={right ? "text-right" : undefined} aria-sort={active ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
        <button
          type="button"
          onClick={() => setSort({ key, dir: active && sort.dir === 1 ? -1 : 1 })}
          className="inline-flex min-h-9 items-center gap-1 whitespace-nowrap rounded font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {label}
          {active && (sort.dir === 1 ? <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" /> : <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />)}
        </button>
      </TableHead>
    );
  };

  return (
    <div className="space-y-4">
      <div className="max-w-md space-y-1.5">
        <Label htmlFor="sr-search" className="text-sm">Search for a school</Label>
        <Input id="sr-search" className="min-h-11" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="School name" />
      </div>
      <p className="text-sm text-muted-foreground" aria-live="polite">{rows.length} of {data.length} schools</p>
      <div className="overflow-x-auto rounded-md border">
        <Table className="text-sm">
          <TableHeader>
            <TableRow>
              {head("name", "School")}
              {head("state", "State")}
              {head("enrolled", "Enrolled", true)}
              {head("evaluated", "Evaluated", true)}
              <TableHead className="text-right">Absent</TableHead>
              <TableHead className="text-right">Pending</TableHead>
              {head("avg", "Average %", true)}
              <TableHead>Grade</TableHead>
              {head("vs", "Compared with state", true)}
              <TableHead>Released</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((s) => (
              <TableRow key={s.school_id}>
                <TableCell className="font-medium">
                  <Link className="underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" to={`/results/schools/${s.school_id}`}>
                    {s.school_name ?? "Unnamed school"}
                  </Link>
                </TableCell>
                <TableCell>{s.state_name ?? "—"}</TableCell>
                <TableCell className="text-right tabular-nums">{s.enrolled}</TableCell>
                <TableCell className="text-right tabular-nums">{s.evaluated}</TableCell>
                <TableCell className="text-right tabular-nums">{s.absent}</TableCell>
                <TableCell className="text-right tabular-nums">{s.pending}</TableCell>
                <TableCell className="text-right tabular-nums">{s.avg_percentage == null ? "—" : `${s.avg_percentage}%`}</TableCell>
                <TableCell className="whitespace-nowrap">{s.avg_percentage == null || !s.school_grade ? "—" : `${s.school_grade} (${schoolGrade(Number(s.avg_percentage)).label})`}</TableCell>
                <TableCell className="text-right"><VsState avg={s.avg_percentage} stateAvg={s.state_avg_percentage} /></TableCell>
                <TableCell>
                  <span className="flex items-center gap-2 whitespace-nowrap">
                    {s.released ? "Yes" : "No"}
                    {s.resend_flag && <Badge variant="outline" className="border-amber-600 bg-amber-50 text-sm text-amber-950">Resend needed</Badge>}
                  </span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
