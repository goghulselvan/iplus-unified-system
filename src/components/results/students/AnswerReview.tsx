import { useState } from "react";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { StudentResult } from "@/hooks/results/useEvaluations";
import { CorrectDialog } from "./CorrectDialog";

export function AnswerReview({ result }: { result: StudentResult }) {
  const ev = result.evaluation!;
  const kind: "omr" | "manual" = ev.answers ? "omr" : "manual";
  const values = (ev.answers ?? ev.marks ?? []) as (string | number | null)[];
  const [editing, setEditing] = useState<number | null>(null);

  const rows = Array.from({ length: result.paper?.total_questions ?? values.length }, (_, i) => {
    const q = result.questions.find((x) => x.question_number === i + 1);
    const v = values[i] ?? null;
    let outcome: "right" | "wrong" | "half" = "wrong";
    if (q?.is_grace) outcome = "right";
    else if (kind === "omr") outcome = v !== null && v === q?.correct_answer ? "right" : "wrong";
    else outcome = Number(v) === 1 ? "right" : Number(v) === 0.5 ? "half" : "wrong";
    return { n: i + 1, v, q, outcome };
  });

  return (
    <>
      <div className="overflow-x-auto rounded-md border">
        <Table className="text-sm">
          <TableHeader>
            <TableRow>
              <TableHead>Q</TableHead>
              <TableHead>{kind === "omr" ? "Student's answer" : "Mark given"}</TableHead>
              <TableHead>{kind === "omr" ? "Correct answer" : "Full marks"}</TableHead>
              <TableHead>Result</TableHead><TableHead>Skill</TableHead><TableHead className="sr-only">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.n}>
                <TableCell className="tabular-nums">{r.n}</TableCell>
                <TableCell>{r.v === null ? "–" : String(r.v)}</TableCell>
                <TableCell>{r.q?.is_grace ? "Grace" : kind === "omr" ? r.q?.correct_answer ?? "–" : "1"}</TableCell>
                <TableCell>
                  {r.outcome === "right" && <span className="inline-flex items-center gap-1 text-green-800"><Check className="h-4 w-4" aria-hidden="true" /><span className="sr-only">Correct</span></span>}
                  {r.outcome === "half" && <span className="font-medium text-amber-800"><span className="sr-only">Half mark</span><span aria-hidden="true">½</span></span>}
                  {r.outcome === "wrong" && <span className="inline-flex items-center gap-1 text-red-800"><X className="h-4 w-4" aria-hidden="true" /><span className="sr-only">Wrong</span></span>}
                </TableCell>
                <TableCell>{r.q?.skill_category ?? "–"}</TableCell>
                <TableCell className="text-right">
                  <Button type="button" size="sm" variant="outline" className="min-h-11" onClick={() => setEditing(r.n)} aria-label={`Correct this answer, question ${r.n}`}>
                    Correct this answer
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {editing !== null && (
        <CorrectDialog
          open evaluationId={ev.id} question={editing} kind={kind}
          current={String(values[editing - 1] ?? "")} onOpenChange={(o) => !o && setEditing(null)}
        />
      )}
    </>
  );
}
