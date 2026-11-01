import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatReg } from "@/lib/results/regNumber";
import type { RankRow } from "@/hooks/results/useResultsReads";

const n = (v: number | null) => (v == null ? "—" : v);

export function RankTable({ rows }: { rows: RankRow[] }) {
  return (
    <div className="overflow-x-auto rounded-md border">
      <Table className="text-sm">
        <TableHeader>
          <TableRow>
            <TableHead className="whitespace-nowrap">All-India rank</TableHead>
            <TableHead className="whitespace-nowrap">State rank</TableHead>
            <TableHead className="whitespace-nowrap">District rank</TableHead>
            <TableHead className="whitespace-nowrap">School rank</TableHead>
            <TableHead>Name</TableHead>
            <TableHead className="whitespace-nowrap">Registration number</TableHead>
            <TableHead>School</TableHead>
            <TableHead>District</TableHead>
            <TableHead>State</TableHead>
            <TableHead className="text-right">Score</TableHead>
            <TableHead className="text-right">%</TableHead>
            <TableHead>Grade</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.enrollment_id}>
              <TableCell className="font-semibold tabular-nums">{n(r.rank_national)}</TableCell>
              <TableCell className="tabular-nums">{n(r.rank_state)}</TableCell>
              <TableCell className="tabular-nums">{n(r.rank_district)}</TableCell>
              <TableCell className="tabular-nums">{n(r.rank_school)}</TableCell>
              <TableCell className="whitespace-nowrap font-medium">{r.student_name}</TableCell>
              <TableCell className="whitespace-nowrap tabular-nums">{formatReg(r.registration_number)}</TableCell>
              <TableCell>{r.school_name ?? "—"}</TableCell>
              <TableCell>{r.district_name ?? "—"}</TableCell>
              <TableCell>{r.state_name ?? "—"}</TableCell>
              <TableCell className="whitespace-nowrap text-right tabular-nums">{r.total} / {r.max_marks}</TableCell>
              <TableCell className="text-right tabular-nums">{r.percentage}%</TableCell>
              <TableCell className="font-medium">{r.grade}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
