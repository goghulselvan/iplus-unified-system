import { Link } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useResultsProject } from "@/hooks/results/useResultsProject";
import { usePapers, useSlotTemplates } from "@/hooks/results/usePapers";
import { useEvaluatedPerSlot, useSchoolSummary } from "@/hooks/results/useResultsReads";
import { CLASS_ORDER, olympiadsForClass } from "@/lib/results/paperRules";

const PAPERS_PER_SLOT = CLASS_ORDER.reduce((n, c) => n + olympiadsForClass(c).length, 0);

function Tile({ label, value, sub, to }: { label: string; value: React.ReactNode; sub?: string; to?: string }) {
  const body = (
    <CardContent className="pt-6">
      <p className="text-3xl font-bold tabular-nums">{value}</p>
      <p className="mt-1 text-sm text-muted-foreground">{label}</p>
      {sub && <p className="mt-0.5 text-sm">{sub}</p>}
    </CardContent>
  );
  return (
    <Card className={to ? "transition-colors hover:bg-muted/50" : undefined}>
      {to ? <Link to={to} className="block rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{body}</Link> : body}
    </Card>
  );
}

export default function ResultsDashboard() {
  const { data: project, isLoading: loadingProject } = useResultsProject();
  const projectId = project?.id;
  const { data: papers, isLoading: lp, isError: papersError } = usePapers(projectId);
  const { data: slots } = useSlotTemplates(projectId);
  const { data: schools, isLoading: ls, isError } = useSchoolSummary(projectId);
  const { data: perSlot, isError: slotError } = useEvaluatedPerSlot(projectId, slots, papers);

  if (loadingProject || lp || ls) return <Skeleton className="h-48 w-full" />;
  if (!project) return <Card><CardContent className="py-10 text-base">There is no active olympiad year right now.</CardContent></Card>;
  if (isError || papersError) return <Card><CardContent className="py-10 text-base">We could not load the numbers. Please refresh and try again.</CardContent></Card>;

  const sum = (k: "enrolled" | "evaluated" | "absent") => (schools ?? []).reduce((a, s) => a + Number(s[k] ?? 0), 0);
  const ready = (papers ?? []).filter((p) => p.status === "ready").length;
  const expected = PAPERS_PER_SLOT * Math.max(slots?.length ?? 0, 1);
  const awaiting = (schools ?? []).filter((s) => Number(s.evaluated) > 0 && !s.released).length;
  const resend = (schools ?? []).filter((s) => s.resend_flag).length;
  const slotLine = slotError
    ? "We could not count students for each slot."
    : (slots ?? []).map((s, i) => `Slot ${i + 1}: ${perSlot?.[i] ?? "…"}`).join(" · ");

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <Tile label="Question papers ready" value={`${ready} of ${expected}`} to="/results/papers" />
        <Tile label="Students evaluated" value={sum("evaluated")} sub={slotLine || undefined} to="/results/students" />
        <Tile label="Registered and evaluated" value={`${sum("evaluated")} of ${sum("enrolled")}`} to="/results/rankings" />
        <Tile label="Marked absent" value={sum("absent")} to="/results/students" />
        <Tile label="Schools waiting to be released" value={awaiting} sub={`of ${schools?.length ?? 0} schools`} to="/results/schools" />
        <Tile label="Schools that need results sent again" value={resend} to="/results/schools" />
      </div>
      {sum("evaluated") === 0 && (
        <p className="text-sm text-muted-foreground">Numbers fill in as papers are marked ready and students' answers are uploaded.</p>
      )}
    </div>
  );
}
