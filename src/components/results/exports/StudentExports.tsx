import { useState } from "react";
import { Link } from "react-router-dom";
import { FileText } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { StudentResult } from "@/hooks/results/useEvaluations";
import { fetchStudentSkills, useStudentFeedback } from "@/hooks/results/useSkills";
import { generateScoreSheet, generateSkillReport, lossyText } from "@/lib/results/pdf";
import { buildQuestionRows, fileSafe, rankOf, studentBlock } from "@/lib/results/pdfData";
import { downloadBlob } from "@/lib/results/downloadBlob";

export function StudentExports({ data, className }: { data: StudentResult; className: string }) {
  const [busy, setBusy] = useState<"score" | "skill" | null>(null);
  const { data: fb } = useStudentFeedback(data.enrollmentId, data.paper?.project_id, data.schoolId);
  const score = data.score;
  if (!score || !data.evaluation) return null;

  const block = studentBlock({ name: data.name, reg: data.registrationNumber, className, olympiad: data.olympiadCode, school: data.schoolName ?? "" });
  const warnName = lossyText(data.name);

  const run = (kind: "score" | "skill") => async () => {
    setBusy(kind);
    try {
      if (kind === "score") {
        const blob = await generateScoreSheet({
          student: block,
          score: {
            total: score.total, max: score.max_marks, percentage: score.percentage, grade: score.grade,
            ranks: {
              school: rankOf(score.rank_school, data.totals?.school), district: rankOf(score.rank_district, data.totals?.district),
              state: rankOf(score.rank_state, data.totals?.state), allIndia: rankOf(score.rank_national, data.totals?.national),
            },
          },
          questions: buildQuestionRows(data.questions, data.evaluation!.answers, data.evaluation!.marks),
        });
        downloadBlob(`${fileSafe(data.name)} - Score sheet.pdf`, blob);
      } else {
        const skills = await fetchStudentSkills(data.enrollmentId);
        const blob = await generateSkillReport({ student: block, skills, feedback: fb && !fb.outdated ? fb.feedback : null });
        downloadBlob(`${fileSafe(data.name)} - Skill report.pdf`, blob);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "That did not work. Please try again.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <section aria-labelledby="pdf-h" className="space-y-2">
      <h3 id="pdf-h" className="text-lg font-semibold">Reports</h3>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="outline" className="min-h-11" disabled={!!busy} onClick={run("score")}>
          <FileText className="mr-2 h-4 w-4" aria-hidden="true" />{busy === "score" ? "Making the score sheet…" : "Score sheet PDF"}
        </Button>
        <Button type="button" variant="outline" className="min-h-11" disabled={!!busy} onClick={run("skill")}>
          <FileText className="mr-2 h-4 w-4" aria-hidden="true" />{busy === "skill" ? "Making the skill report…" : "Skill report PDF"}
        </Button>
        {fb?.outdated && (
          <Badge variant="outline" className="border-amber-600 bg-amber-50 text-sm text-amber-950">Outdated — regenerate</Badge>
        )}
      </div>
      {fb?.outdated && (
        <p className="text-sm">The score changed after the AI feedback was written, so the skill report shows skills only. <Link className="underline" to="/results/skills">Regenerate on the Skill Analysis page.</Link></p>
      )}
      {!fb && <p className="text-sm text-muted-foreground">No AI feedback yet. The skill report will show skills only.</p>}
      {warnName && <p className="text-sm text-amber-900">This name has letters the PDF cannot print. They will show as a question mark (?).</p>}
    </section>
  );
}
