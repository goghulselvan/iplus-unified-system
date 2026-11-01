import { Sparkles } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useSchoolAnalysis, writeSchoolAnalysis } from "@/hooks/results/useSkills";

const List = ({ title, items }: { title: string; items: string[] }) =>
  items.length === 0 ? null : (
    <div>
      <p className="text-sm font-medium">{title}</p>
      <ul className="list-disc pl-5 text-base">{items.map((t, i) => <li key={i}>{t}</li>)}</ul>
    </div>
  );

/** Shows the school's AI analysis (if any) and the button that writes or rewrites it. */
export function SchoolAnalysisCard({ projectId, schoolId, hasResults = true }: { projectId: string; schoolId: string; hasResults?: boolean }) {
  const qc = useQueryClient();
  const { data: a, isLoading } = useSchoolAnalysis(projectId, schoolId);
  const gen = useMutation({
    mutationFn: () => writeSchoolAnalysis(projectId, schoolId),
    onSuccess: () => { toast.success("The school analysis is ready."); void qc.invalidateQueries({ queryKey: ["results", "school-analysis", projectId, schoolId] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <section aria-labelledby={`ai-${schoolId}`} className="space-y-3 rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-center gap-3">
        <h4 id={`ai-${schoolId}`} className="text-lg font-semibold">AI analysis of this school</h4>
        {a?.outdated && <Badge variant="outline" className="border-amber-600 bg-amber-50 text-sm text-amber-950">Outdated — regenerate</Badge>}
        <Button type="button" variant="outline" className="ml-auto min-h-11" disabled={gen.isPending || !hasResults} onClick={() => gen.mutate()}>
          <Sparkles className="mr-2 h-4 w-4" aria-hidden="true" />
          {gen.isPending ? "Claude is writing… this takes about half a minute" : "Generate AI analysis (this school)"}
        </Button>
      </div>
      <div aria-live="polite">
        {isLoading ? <p className="text-sm text-muted-foreground">Checking for an analysis…</p>
          : !a ? <p className="text-base">No analysis has been written for this school yet.</p>
          : (
            <div className="space-y-3">
              <p className="text-base">{a.analysis.overview}</p>
              <List title="Strengths" items={a.analysis.strengths} />
              <List title="Areas to improve" items={a.analysis.focus_areas} />
              <List title="Suggestions" items={a.analysis.suggestions} />
              <p className="text-sm text-muted-foreground">Written {new Date(a.created_at).toLocaleDateString("en-IN")}</p>
            </div>
          )}
      </div>
    </section>
  );
}
