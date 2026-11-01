import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useActiveProject } from "@/hooks/useOlympiadProjects";
import { useRankCombos, useSchoolSummary } from "@/hooks/results/useResultsReads";
import { useClasses } from "@/hooks/results/usePapers";
import { useSkillSummary } from "@/hooks/results/useSkills";
import { OLYMPIAD_NAMES, type OlympiadCode } from "@/lib/results/paperRules";
import { AiFeedbackPanel, SchoolFeedbackButton } from "@/components/results/skills/AiFeedbackPanel";
import { SchoolAnalysisCard } from "@/components/results/skills/SchoolAnalysisCard";
import { SkillTable } from "@/components/results/skills/SkillTable";

const ALL = "all";

export default function SkillAnalysisPage() {
  const { data: project, isLoading } = useActiveProject();
  const { data: combos } = useRankCombos(project?.id);
  const { data: classes } = useClasses();
  const { data: schools } = useSchoolSummary(project?.id);
  const [combo, setCombo] = useState(ALL);
  const [school, setSchool] = useState(ALL);
  const [cls, ol] = combo === ALL ? [null, null] : combo.split("|");
  const schoolId = school === ALL ? null : school;
  const { data: rows, isLoading: loadingRows, isError } = useSkillSummary(project?.id, schoolId, cls, ol);

  if (isLoading) return <Skeleton className="h-64 w-full" />;
  if (!project) return <Card><CardContent className="py-10 text-base">There is no active olympiad year right now.</CardContent></Card>;
  const chosen = schools?.find((s) => s.school_id === schoolId);

  return (
    <div className="space-y-6">
      <AiFeedbackPanel projectId={project.id} />

      <section aria-labelledby="sk-h" className="space-y-4">
        <h3 id="sk-h" className="text-lg font-semibold">Skills by class and olympiad</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="sk-combo" className="text-sm">Class and olympiad</Label>
            <Select value={combo} onValueChange={setCombo}>
              <SelectTrigger id="sk-combo" className="min-h-11"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All classes and olympiads</SelectItem>
                {(combos ?? []).map(([c, o]) => (
                  <SelectItem key={`${c}|${o}`} value={`${c}|${o}`}>
                    {classes?.find((x) => x.code === c)?.display_name ?? `Class ${c}`} · {OLYMPIAD_NAMES[o as OlympiadCode] ?? o}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="sk-school" className="text-sm">School</Label>
            <Select value={school} onValueChange={setSchool}>
              <SelectTrigger id="sk-school" className="min-h-11"><SelectValue /></SelectTrigger>
              <SelectContent className="max-h-72">
                <SelectItem value={ALL}>All schools (state averages only)</SelectItem>
                {(schools ?? []).filter((s) => Number(s.evaluated) > 0).map((s) => (
                  <SelectItem key={s.school_id} value={s.school_id}>{s.school_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        {loadingRows ? <Skeleton className="h-40 w-full" /> : isError ? (
          <p className="text-base text-red-800">We could not load the skill results. Please refresh.</p>
        ) : <SkillTable rows={rows ?? []} mode={schoolId ? "school" : "all"} />}
      </section>

      {chosen && (
        <section aria-label={`${chosen.school_name} AI`} className="space-y-3">
          <SchoolFeedbackButton projectId={project.id} schoolId={chosen.school_id} />
          <SchoolAnalysisCard projectId={project.id} schoolId={chosen.school_id} />
        </section>
      )}
    </div>
  );
}
