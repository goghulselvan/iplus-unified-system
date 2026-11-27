import { Link, useParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useStudentResult } from "@/hooks/results/useEvaluations";
import { useClasses } from "@/hooks/results/usePapers";
import { OLYMPIAD_NAMES, type OlympiadCode } from "@/lib/results/paperRules";
import { studentGrade } from "@/lib/results/grading";
import { formatReg } from "@/lib/results/regNumber";
import { AnswerReview } from "@/components/results/students/AnswerReview";
import { StudentExports } from "@/components/results/exports/StudentExports";
import { ChangeHistory } from "@/components/results/students/ChangeHistory";
import { useResultsProject } from "@/hooks/results/useResultsProject";
import { otherProjectNotice } from "@/lib/results/projectScope";
import { omrCounts } from "@/lib/results/omrCounts";

const Tile = ({ label, value, hint }: { label: string; value: string; hint?: string }) => (
  <div className="rounded-lg border bg-card p-4">
    <p className="text-sm text-muted-foreground">{label}</p>
    <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
    {hint && <p className="text-sm text-muted-foreground">{hint}</p>}
  </div>
);

const Message = ({ children }: { children: React.ReactNode }) => (
  <Card><CardContent className="py-8 text-base">{children}</CardContent></Card>
);

export default function StudentResultPage() {
  const { enrollmentId } = useParams();
  const { data, isLoading, isError } = useStudentResult(enrollmentId);
  const { data: classes } = useClasses();
  const { data: active } = useResultsProject();

  if (isLoading) return <Skeleton className="h-64 w-full" />;
  if (isError) return <Message>We could not open this student. Please refresh and try again.</Message>;
  if (!data) return <Message>This student could not be found.</Message>;

  const className = classes?.find((c) => c.code === data.classCode)?.display_name ?? data.classCode;
  const { score, totals, evaluation } = data;
  const rank = (r: number | null, n?: number) => (r && n ? `${r} of ${n}` : "–");
  const notice = otherProjectNotice(active?.id, data.projectId, data.projectName, "student");
  const grade = score ? { grade: score.grade, label: studentGrade(score.percentage).label } : null;
  const counts = evaluation?.answers && data.paper
    ? omrCounts(evaluation.answers, data.questions, data.paper.total_questions) : null;

  return (
    <div className="space-y-6">
      <Link to="/results/students" className="inline-flex min-h-11 items-center gap-2 text-sm font-medium hover:underline">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back to students
      </Link>
      <header>
        <h2 className="text-2xl font-bold">{data.name}</h2>
        <p className="mt-1 text-base text-muted-foreground">
          {data.registrationNumber ? formatReg(data.registrationNumber) : "No registration number"} · {data.schoolName ?? "No school"} · {className} · {OLYMPIAD_NAMES[data.olympiadCode as OlympiadCode] ?? data.olympiadCode}
        </p>
      </header>

      {notice && <p role="status" className="rounded-md border border-amber-600 bg-amber-50 p-3 text-base text-amber-950">{notice}</p>}

      {!evaluation && <Message>This student has no result yet. Their answers have not been uploaded.</Message>}
      {evaluation?.status === "evaluated" && !score && (
        <Message>Answers saved, waiting for the answer key. This student is marked as soon as every question on their paper has an answer key.</Message>
      )}
      {evaluation?.status === "absent" && <Message>This student was marked absent. There is no score or rank.</Message>}

      {evaluation?.status === "evaluated" && score && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Tile label="Score" value={`${score.total} / ${score.max_marks}`} />
            <Tile label="Percentage" value={`${score.percentage}%`} />
            <Tile label="Grade" value={grade!.grade} hint={grade!.label} />
            <Tile label="School rank" value={rank(score.rank_school, totals?.school)} />
            <Tile label="District rank" value={rank(score.rank_district, totals?.district)} />
            <Tile label="State rank" value={rank(score.rank_state, totals?.state)} />
            <Tile label="All-India rank" value={rank(score.rank_national, totals?.national)} />
            {counts && (
              <>
                <Tile label="Correct" value={String(counts.correct)} />
                <Tile label="Wrong" value={String(counts.wrong)} hint="MULTIPLE counts as wrong" />
                <Tile label="Unanswered" value={String(counts.unanswered)} />
              </>
            )}
          </div>
          <StudentExports data={data} className={className} />
          <section aria-labelledby="review-h" className="space-y-3">
            <h3 id="review-h" className="text-lg font-semibold">Answer review</h3>
            <AnswerReview result={data} />
          </section>
        </>
      )}

      {evaluation && (
        <section aria-labelledby="history-h" className="space-y-3">
          <h3 id="history-h" className="text-lg font-semibold">Change history</h3>
          <ChangeHistory evaluationId={evaluation.id} />
        </section>
      )}
    </div>
  );
}
