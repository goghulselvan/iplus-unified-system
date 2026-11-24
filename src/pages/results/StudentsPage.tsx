import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useResultsProject } from "@/hooks/results/useResultsProject";
import { useClasses, usePapers, useSlotTemplates } from "@/hooks/results/usePapers";
import { PAGE_SIZE, useRestoreResult, useSchoolSearch, useStudentList, type SchoolOption, type StudentListRow } from "@/hooks/results/useEvaluations";
import { OLYMPIAD_NAMES, CLASS_ORDER, type OlympiadCode } from "@/lib/results/paperRules";
import { StudentsTable } from "@/components/results/students/StudentsTable";
import { AttendanceDialog } from "@/components/results/students/AttendanceDialog";
import { DeleteDialog } from "@/components/results/students/DeleteDialog";

const selectClass =
  "h-11 w-full rounded-md border border-input bg-background px-3 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const STATUSES = [["", "All"], ["evaluated", "Evaluated"], ["absent", "Absent"], ["pending", "Pending"], ["deleted", "Deleted"]];

export default function StudentsPage() {
  const { data: project, isLoading: loadingProject } = useResultsProject();
  const { data: classes } = useClasses();
  const { data: slots } = useSlotTemplates(project?.id);
  const { data: papers } = usePapers(project?.id);
  const maxByPaper = useMemo(() => Object.fromEntries((papers ?? []).map((p) => [p.id, p.total_questions])), [papers]);
  const restore = useRestoreResult();

  const [schoolText, setSchoolText] = useState("");
  const [school, setSchool] = useState<SchoolOption | null>(null);
  const [search, setSearch] = useState("");
  const [classCode, setClassCode] = useState("");
  const [olympiad, setOlympiad] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dialog, setDialog] = useState<null | "absent" | "present" | "delete">(null);
  const [debounced, setDebounced] = useState("");

  useEffect(() => { const t = setTimeout(() => setDebounced(search), 300); return () => clearTimeout(t); }, [search]);
  useEffect(() => { setPage(0); setSelected(new Set()); }, [school, debounced, classCode, olympiad, status]);
  useEffect(() => { setSelected(new Set()); }, [page]);

  const { data: schoolHits } = useSchoolSearch(school ? "" : schoolText);
  const { data, isLoading, isError } = useStudentList(
    { projectId: project?.id, schoolId: school?.id ?? null, classCode: classCode || null, olympiadCode: olympiad || null, status: status || null, search: debounced },
    page,
  );

  const classNames = useMemo(() => Object.fromEntries((classes ?? []).map((c) => [c.code, c.display_name])), [classes]);
  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const chosen: StudentListRow[] = rows.filter((r) => selected.has(r.enrollment_id));

  if (loadingProject) return <Skeleton className="h-64 w-full" />;
  if (!project) return <Card><CardContent className="py-10 text-base">There is no active olympiad year right now.</CardContent></Card>;

  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toggleAll = (all: boolean) => setSelected(all ? new Set(rows.map((r) => r.enrollment_id)) : new Set());
  const bulk = status !== "deleted";

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <div className="relative space-y-1.5">
          <Label htmlFor="school-search" className="text-sm">School</Label>
          <Input
            id="school-search" className="h-11 text-base" placeholder="Type a school name" autoComplete="off"
            value={schoolText}
            onChange={(e) => { setSchoolText(e.target.value); setSchool(null); }}
          />
          {!school && schoolHits && schoolHits.length > 0 && (
            <ul className="absolute z-20 mt-1 w-full rounded-md border bg-popover p-1 shadow-md">
              {schoolHits.map((s) => (
                <li key={s.id}>
                  <button type="button" className="min-h-11 w-full rounded px-3 text-left text-base hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={() => { setSchool(s); setSchoolText(s.school_name); }}>
                    {s.school_name}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="student-search" className="text-sm">Student name or registration number</Label>
          <Input id="student-search" className="h-11 text-base" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="class-filter" className="text-sm">Class</Label>
          <select id="class-filter" className={selectClass} value={classCode} onChange={(e) => setClassCode(e.target.value)}>
            <option value="">All classes</option>
            {CLASS_ORDER.map((c) => <option key={c} value={c}>{classNames[c] ?? c}</option>)}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="olympiad-filter" className="text-sm">Olympiad</Label>
          <select id="olympiad-filter" className={selectClass} value={olympiad} onChange={(e) => setOlympiad(e.target.value)}>
            <option value="">All olympiads</option>
            {Object.entries(OLYMPIAD_NAMES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="status-filter" className="text-sm">Status</Label>
          <select id="status-filter" className={selectClass} value={status} onChange={(e) => setStatus(e.target.value)}>
            {STATUSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
      </div>

      {bulk && selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-muted p-3" role="region" aria-label="Actions for selected students">
          <p className="text-base font-medium">{selected.size} selected</p>
          <Button type="button" variant="outline" className="min-h-11 bg-background" onClick={() => setDialog("absent")}>Mark absent</Button>
          <Button type="button" variant="outline" className="min-h-11 bg-background" onClick={() => setDialog("present")}>Mark present</Button>
          <Button type="button" variant="destructive" className="min-h-11" onClick={() => setDialog("delete")}>Delete result</Button>
        </div>
      )}

      {isLoading ? <Skeleton className="h-64 w-full" /> : isError ? (
        <Card><CardContent className="py-10 text-base">We could not load the students. Please refresh and try again.</CardContent></Card>
      ) : rows.length === 0 ? (
        <Card><CardContent className="py-10 text-base">No students match these filters. Clear a filter to see more.</CardContent></Card>
      ) : (
        <StudentsTable
          rows={rows} selected={selected} onToggle={toggle} onToggleAll={toggleAll} classNames={classNames} maxByPaper={maxByPaper}
          restoring={restore.isPending ? restore.variables ?? null : null}
          onRestore={async (r) => {
            try { await restore.mutateAsync(r.evaluation_id!); toast.success(`${r.student_name}'s result is back.`); }
            catch (e) { toast.error((e as Error).message); }
          }}
        />
      )}

      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">{total} {total === 1 ? "student" : "students"}</p>
        <div className="flex items-center gap-3">
          <Button type="button" variant="outline" className="min-h-11" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Previous</Button>
          <span className="text-sm tabular-nums">Page {page + 1} of {pages}</span>
          <Button type="button" variant="outline" className="min-h-11" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)}>Next</Button>
        </div>
      </div>

      {(dialog === "absent" || dialog === "present") && (
        <AttendanceDialog
          open mode={dialog} rows={chosen} projectId={project.id} slots={slots ?? []} classNames={classNames}
          onOpenChange={(o) => !o && setDialog(null)} onDone={() => setSelected(new Set())}
        />
      )}
      {dialog === "delete" && (
        <DeleteDialog open enrollmentIds={chosen.filter((r) => r.evaluation_id).map((r) => r.enrollment_id)} onOpenChange={(o) => !o && setDialog(null)} onDone={() => setSelected(new Set())} />
      )}
    </div>
  );
}
