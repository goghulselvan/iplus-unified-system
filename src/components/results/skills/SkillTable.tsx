import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { SkillSummaryRow } from "@/hooks/results/useSkills";

export function SkillTable({ rows, mode }: { rows: SkillSummaryRow[]; mode: "all" | "school" }) {
  if (rows.length === 0) return <p className="text-base">There are no skill results for this choice yet.</p>;
  const pct = (v: number | null) => (v == null ? "—" : `${v}%`);
  return (
    <div className="overflow-x-auto rounded-md border">
      <Table className="text-sm">
        <TableHeader>
          <TableRow>
            <TableHead>Skill</TableHead>
            {mode === "school" && <TableHead className="text-right">This school</TableHead>}
            <TableHead className="text-right">{mode === "school" ? "State average" : "Average across all students"}</TableHead>
            {mode === "school" && <TableHead className="text-right">Compared with state</TableHead>}
            <TableHead className="text-right">Students</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => {
            const d = r.school_pct != null && r.state_pct != null ? r.school_pct - r.state_pct : null;
            return (
              <TableRow key={r.skill}>
                <TableCell className="font-medium">{r.skill}</TableCell>
                {mode === "school" && <TableCell className="text-right tabular-nums">{pct(r.school_pct)}</TableCell>}
                <TableCell className="text-right tabular-nums">{pct(r.state_pct)}</TableCell>
                {mode === "school" && (
                  <TableCell className={`text-right font-medium tabular-nums ${d == null ? "" : d > 0 ? "text-green-800" : d < 0 ? "text-amber-800" : ""}`}>
                    {d == null ? "—" : d > 0 ? `+${d}%` : d < 0 ? `−${Math.abs(d)}%` : "Same"}
                  </TableCell>
                )}
                <TableCell className="text-right tabular-nums">{r.students}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
