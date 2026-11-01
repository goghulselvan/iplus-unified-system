import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatReg } from "@/lib/results/regNumber";
import { OLYMPIAD_NAMES, type OlympiadCode } from "@/lib/results/paperRules";
import type { StudentListRow } from "@/hooks/results/useEvaluations";
import { StatusBadge } from "./statusBadge";

interface Props {
  rows: StudentListRow[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  onToggleAll: (all: boolean) => void;
  maxByPaper: Record<string, number>;
  onRestore: (row: StudentListRow) => void;
  restoring?: string | null;
  classNames: Record<string, string>;
}

const DAY = 24 * 60 * 60 * 1000;

export function StudentsTable({ rows, selected, onToggle, onToggleAll, onRestore, restoring, classNames, maxByPaper }: Props) {
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.enrollment_id));
  const someSelected = rows.some((r) => selected.has(r.enrollment_id));
  return (
    <div className="overflow-x-auto rounded-md border">
      <Table className="text-sm">
        <TableHeader>
          <TableRow>
            <TableHead className="w-12">
              <Checkbox
                aria-label="Select all students on this page" className="h-5 w-5"
                checked={allSelected ? true : someSelected ? "indeterminate" : false}
                onCheckedChange={(v) => onToggleAll(v === true)}
              />
            </TableHead>
            <TableHead>Reg no</TableHead><TableHead>Name</TableHead><TableHead>School</TableHead>
            <TableHead>Class</TableHead><TableHead>Olympiad</TableHead><TableHead>Status</TableHead>
            <TableHead className="text-right">Score</TableHead><TableHead className="text-right">%</TableHead>
            <TableHead>Grade</TableHead><TableHead className="sr-only">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => {
            const canRestore = r.deleted_at && Date.now() - new Date(r.deleted_at).getTime() <= 30 * DAY;
            return (
              <TableRow key={`${r.enrollment_id}-${r.evaluation_id ?? ""}`} data-state={selected.has(r.enrollment_id) ? "selected" : undefined}>
                <TableCell>
                  <Checkbox
                    aria-label={`Select ${r.student_name}`} className="h-5 w-5"
                    checked={selected.has(r.enrollment_id)} onCheckedChange={() => onToggle(r.enrollment_id)}
                  />
                </TableCell>
                <TableCell className="whitespace-nowrap tabular-nums">{r.registration_number ? formatReg(r.registration_number) : "–"}</TableCell>
                <TableCell className="font-medium">
                  <Link to={`/results/students/${r.enrollment_id}`} className="underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    {r.student_name}
                  </Link>
                </TableCell>
                <TableCell>{r.school_name ?? "–"}</TableCell>
                <TableCell className="whitespace-nowrap">{classNames[r.class_code] ?? r.class_code}</TableCell>
                <TableCell className="whitespace-nowrap">{OLYMPIAD_NAMES[r.olympiad_code as OlympiadCode] ?? r.olympiad_code}</TableCell>
                <TableCell><StatusBadge status={r.status} /></TableCell>
                <TableCell className="whitespace-nowrap text-right tabular-nums">{r.total !== null ? `${r.total}${r.paper_id && maxByPaper[r.paper_id] ? `/${maxByPaper[r.paper_id]}` : ""}` : "–"}</TableCell>
                <TableCell className="text-right tabular-nums">{r.percentage !== null ? `${r.percentage}%` : "–"}</TableCell>
                <TableCell>{r.grade ?? "–"}</TableCell>
                <TableCell className="text-right">
                  {r.status === "deleted" && (
                    canRestore ? (
                      <Button size="sm" variant="outline" className="min-h-11" disabled={restoring === r.evaluation_id} onClick={() => onRestore(r)}>
                        Restore
                      </Button>
                    ) : <span className="text-sm text-muted-foreground">Too old to restore</span>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
