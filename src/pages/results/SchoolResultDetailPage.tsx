import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useActiveProject } from "@/hooks/useOlympiadProjects";
import { useClassOlympiadSummary, useSchoolStudents, useSchoolSummary } from "@/hooks/results/useResultsReads";
import { OLYMPIAD_NAMES, type OlympiadCode } from "@/lib/results/paperRules";
import { formatReg } from "@/lib/results/regNumber";
import { schoolGrade, studentGrade } from "@/lib/results/grading";
import { vsStateDiff, vsStateText } from "@/lib/results/schoolResults";
import { VsState } from "./SchoolResultsPage";

const PAGE = 50;
const LATER = "Available after skill reports are built";
const LATER_BUTTONS = ["AI analysis", "School PDFs", "Download zips"];

const Tile = ({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) => (
  <Card>
    <CardContent className="pt-6">
      <p className="text-3xl font-bold tabular-nums">{value}</p>
      <p className="mt-1 text-sm text-muted-foreground">{label}</p>
      {sub && <p className="mt-0.5 text-sm">{sub}</p>}
    </CardContent>
  </Card>
);

export default function SchoolResultDetailPage() {
  const { schoolId } = useParams();
  const { data: project, isLoading: loadingProject } = useActiveProject();
  const { data: schools, isLoading: loadingSchools } = useSchoolSummary(project?.id);
  const { data: groups, isLoading: loadingGroups, isError } = useClassOlympiadSummary(project?.id, schoolId);
  const [page, setPage] = useState(0);
  const { data: students, isLoading: loadingStudents } = useSchoolStudents(project?.id, schoolId, page, PAGE);

  if (loadingProject || loadingSchools || loadingGroups) return <Skeleton className="h-64 w-full" />;
  const school = schools?.find((s) => s.school_id === schoolId);
  if (isError || !school)
    return (
      <Card><CardContent className="space-y-3 py-10 text-base">
        <p>We could not find results for this school. It may have no registered students this year.</p>
        <Button asChild variant="outline"><Link to="/results/schools">Back to School Results</Link></Button>
      </CardContent></Card>
    );

  const diff = vsStateDiff(school.avg_percentage, school.state_avg_percentage);
  const total = Number(students?.[0]?.total_count ?? 0);
  const lastPage = Math.max(0, Math.ceil(total / PAGE) - 1);

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Button asChild variant="ghost" className="-ml-3 min-h-11">
          <Link to="/results/schools"><ArrowLeft className="mr-2 h-4 w-4" aria-hidden="true" />All schools</Link>
        </Button>
        <div className="flex flex-wrap items-center gap-3">
          <h3 className="text-xl font-semibold">{school.school_name}</h3>
          <span className="text-sm text-muted-foreground">{school.state_name}</span>
          {school.released && <Badge variant="outline" className="text-sm">Released</Badge>}
          {school.resend_flag && <Badge variant="outline" className="border-amber-600 bg-amber-50 text-sm text-amber-950">Resend needed</Badge>}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6">
        <Tile label="Enrolled" value={school.enrolled} />
        <Tile label="Evaluated" value={school.evaluated} />
        <Tile label="Absent" value={school.absent} />
        <Tile label="Pending" value={school.pending} />
        <Tile label="School average" value={school.avg_percentage == null ? "—" : `${school.avg_percentage}%`} sub={school.school_grade && school.avg_percentage != null ? `Grade ${school.school_grade} (${schoolGrade(Number(school.avg_percentage)).label})` : undefined} />
        <Tile label="Compared with state average" value={<VsState avg={school.avg_percentage} stateAvg={school.state_avg_percentage} />} sub={diff == null ? undefined : vsStateText(diff)} />
      </div>

      <TooltipProvider delayDuration={100}>
        <div className="flex flex-wrap gap-3">
          {LATER_BUTTONS.map((b) => (
            <Tooltip key={b}>
              <TooltipTrigger asChild>
                <span tabIndex={0} className="inline-block rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <Button type="button" variant="outline" disabled className="min-h-11 pointer-events-none" aria-describedby={undefined}>{b}</Button>
                </span>
              </TooltipTrigger>
              <TooltipContent>{LATER}</TooltipContent>
            </Tooltip>
          ))}
        </div>
      </TooltipProvider>

      <section aria-labelledby="co-h" className="space-y-2">
        <h4 id="co-h" className="text-lg font-semibold">Class and olympiad</h4>
        {!groups?.length ? (
          <p className="text-base">This school has no registered students for any olympiad yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <Table className="text-sm">
              <TableHeader>
                <TableRow>
                  <TableHead>Class</TableHead><TableHead>Olympiad</TableHead>
                  <TableHead className="text-right">Enrolled</TableHead><TableHead className="text-right">Evaluated</TableHead>
                  <TableHead className="text-right">Absent</TableHead><TableHead className="text-right">Pending</TableHead>
                  <TableHead className="text-right">Average %</TableHead><TableHead className="text-right">Compared with state</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {groups.map((g) => (
                  <TableRow key={`${g.class_code}-${g.olympiad_code}`}>
                    <TableCell className="font-medium">{g.class_name ?? `Class ${g.class_code}`}</TableCell>
                    <TableCell>{OLYMPIAD_NAMES[g.olympiad_code as OlympiadCode] ?? g.olympiad_code}</TableCell>
                    <TableCell className="text-right tabular-nums">{g.enrolled}</TableCell>
                    <TableCell className="text-right tabular-nums">{g.evaluated}</TableCell>
                    <TableCell className="text-right tabular-nums">{g.absent}</TableCell>
                    <TableCell className="text-right tabular-nums">{g.pending}</TableCell>
                    <TableCell className="text-right tabular-nums">{g.avg_percentage == null ? "—" : `${g.avg_percentage}%`}</TableCell>
                    <TableCell className="text-right"><VsState avg={g.avg_percentage} stateAvg={g.state_avg_percentage} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      <section aria-labelledby="st-h" className="space-y-2">
        <h4 id="st-h" className="text-lg font-semibold">Students</h4>
        {loadingStudents ? (
          <Skeleton className="h-40 w-full" />
        ) : !students?.length ? (
          <p className="text-base">No students to show.</p>
        ) : (
          <>
            <div className="overflow-x-auto rounded-md border">
              <Table className="text-sm">
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead><TableHead>Registration number</TableHead><TableHead>Class</TableHead>
                    <TableHead>Olympiad</TableHead><TableHead>Status</TableHead>
                    <TableHead className="text-right">Score</TableHead><TableHead className="text-right">%</TableHead><TableHead>Grade</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {students.map((s) => (
                    <TableRow key={s.enrollment_id}>
                      <TableCell className="font-medium">
                        <Link className="underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" to={`/results/students/${s.enrollment_id}`}>{s.student_name}</Link>
                      </TableCell>
                      <TableCell className="whitespace-nowrap tabular-nums">{formatReg(s.registration_number)}</TableCell>
                      <TableCell>{groups?.find((g) => g.class_code === s.class_code)?.class_name ?? `Class ${s.class_code}`}</TableCell>
                      <TableCell>{OLYMPIAD_NAMES[s.olympiad_code as OlympiadCode] ?? s.olympiad_code}</TableCell>
                      <TableCell>{s.status.charAt(0).toUpperCase() + s.status.slice(1)}</TableCell>
                      <TableCell className="text-right tabular-nums">{s.total ?? "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{s.percentage == null ? "—" : `${s.percentage}%`}</TableCell>
                      <TableCell className="whitespace-nowrap">{s.grade && s.percentage != null ? `${s.grade} (${studentGrade(s.percentage).label})` : "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <div className="flex items-center justify-between gap-3">
              <Button type="button" variant="outline" className="min-h-11" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</Button>
              <span className="text-sm">Page {page + 1} of {lastPage + 1}</span>
              <Button type="button" variant="outline" className="min-h-11" disabled={page >= lastPage} onClick={() => setPage(page + 1)}>Next</Button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
