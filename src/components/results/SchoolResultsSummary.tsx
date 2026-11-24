import { Link } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Trophy } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useResultsProject } from "@/hooks/results/useResultsProject";
import { useClassOlympiadSummary } from "@/hooks/results/useResultsReads";
import { schoolGrade } from "@/lib/results/grading";

interface Props {
  schoolId: string;
}

export const SchoolResultsSummary = ({ schoolId }: Props) => {
  const { profile } = useAuth();
  const allowed = profile?.role === "manager" || profile?.role === "superadmin";
  const { data: project } = useResultsProject();
  const { data: groups, isLoading } = useClassOlympiadSummary(allowed ? project?.id : undefined, schoolId);

  const enrolled = (groups ?? []).reduce((a, g) => a + Number(g.enrolled), 0);
  const evaluated = (groups ?? []).reduce((a, g) => a + Number(g.evaluated), 0);
  const weighted = (groups ?? []).reduce((a, g) => a + (g.avg_percentage == null ? 0 : Number(g.avg_percentage) * Number(g.evaluated)), 0);
  const avg = evaluated > 0 ? Math.round((weighted / evaluated) * 10) / 10 : null;

  let text: React.ReactNode = "Results for this year will appear here after evaluation.";
  if (allowed && isLoading) text = <Skeleton className="h-5 w-48" />;
  else if (allowed && evaluated > 0 && avg != null) {
    text = (
      <span>
        {evaluated} of {enrolled} students evaluated · Average {avg}% · Grade {schoolGrade(avg).grade} ({schoolGrade(avg).label})
      </span>
    );
  } else if (allowed && enrolled > 0) text = `${enrolled} students enrolled. None evaluated yet.`;

  return (
    <Card>
      <CardContent className="flex flex-col items-start gap-3 py-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Trophy className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
          <p className="text-sm">{text}</p>
        </div>
        <Button asChild variant="outline">
          <Link to={`/results/schools/${schoolId}`}>Open full results</Link>
        </Button>
      </CardContent>
    </Card>
  );
};
