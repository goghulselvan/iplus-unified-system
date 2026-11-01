import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Award, Download, Plus, Trash2, Undo2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { ProgressPanel } from "@/components/results/ProgressPanel";
import { useActiveProject } from "@/hooks/useOlympiadProjects";
import { useClasses } from "@/hooks/results/usePapers";
import {
  fetchAwards, fetchParticipants, findEnrollmentByReg, useAddManualAward, useAllotAwards, useAwardRules, useAwards,
  useDeleteAwardRule, useSaveAwardRule, useUpdateAward,
  type AllotResult, type AwardLevel, type AwardRule, type AwardRuleInput, type AwardRuleType, type AwardWithStudent, type StudentInfo,
} from "@/hooks/results/usePhase47";
import { CLASS_ORDER, OLYMPIAD_NAMES, type OlympiadCode } from "@/lib/results/paperRules";
import { formatReg } from "@/lib/results/regNumber";
import { downloadCsv } from "@/lib/results/rankingsCsv";
import { courierPackData, printerCsv, type PrinterRow } from "@/lib/results/printerCsv";
import { saveBlob } from "@/lib/results/saveBlob";
import { streamZipParts, zipPartName } from "@/lib/results/zipParts";
import { generateAwardLetter } from "@/lib/results/pdf";

const selectClass =
  "h-11 w-full rounded-md border border-input bg-background px-3 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const LEVELS: Record<AwardLevel, string> = { national: "All-India", state: "State", district: "District", school: "School" };
const OLYMPIADS = Object.keys(OLYMPIAD_NAMES) as OlympiadCode[];
const PAGE = 100;

export default function AwardsPage() {
  const { data: project, isLoading } = useActiveProject();
  if (isLoading) return <Skeleton className="h-64 w-full" />;
  if (!project) return <Card><CardContent className="py-10 text-base">There is no active olympiad year right now.</CardContent></Card>;
  return (
    <Tabs defaultValue="rules" className="space-y-4">
      <TabsList>
        <TabsTrigger value="rules" className="min-h-10 text-sm">Rules and allotting</TabsTrigger>
        <TabsTrigger value="list" className="min-h-10 text-sm">Award list</TabsTrigger>
        <TabsTrigger value="export" className="min-h-10 text-sm">Letters and printing</TabsTrigger>
      </TabsList>
      <TabsContent value="rules"><RulesTab projectId={project.id} /></TabsContent>
      <TabsContent value="list"><ListTab projectId={project.id} /></TabsContent>
      <TabsContent value="export"><ExportTab projectId={project.id} /></TabsContent>
    </Tabs>
  );
}

// ---------------- rules + allot ----------------
const blankRule = (order: number): AwardRuleInput => ({
  award_name: "", level: "national", rule_type: "top_n", value: 10, class_code: null, olympiad_code: null, sort_order: order,
});

function ruleSentence(r: AwardRule, className: (c: string) => string) {
  const who = [r.class_code ? className(r.class_code) : "every class", r.olympiad_code ? OLYMPIAD_NAMES[r.olympiad_code as OlympiadCode] : "every olympiad"].join(", ");
  const what = r.rule_type === "top_n" ? `the top ${r.value} at ${LEVELS[r.level]} level` : `everyone who scores ${r.value}% or more`;
  return `${what} (${who})`;
}

function RulesTab({ projectId }: { projectId: string }) {
  const { data: rules, isLoading } = useAwardRules(projectId);
  const { data: classes } = useClasses();
  const save = useSaveAwardRule(projectId);
  const del = useDeleteAwardRule(projectId);
  const allot = useAllotAwards(projectId);
  const [edit, setEdit] = useState<AwardRuleInput | null>(null);
  const [confirmDel, setConfirmDel] = useState<AwardRule | null>(null);
  const [confirmAllot, setConfirmAllot] = useState(false);
  const [pct, setPct] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval>>();
  const [result, setResult] = useState<AllotResult | null>(null);
  const className = (c: string) => classes?.find((x) => x.code === c)?.display_name ?? `Class ${c}`;

  const valueProblem = edit && (
    !edit.award_name.trim() ? "Give the award a name." :
    !(edit.value > 0) ? "Enter a number above zero." :
    edit.rule_type === "top_n" && !Number.isInteger(edit.value) ? "Top N must be a whole number." :
    edit.rule_type === "min_percentage" && edit.value > 100 ? "A percentage cannot be above 100." : null);

  const runAllot = () => {
    setConfirmAllot(false); setResult(null); setPct(3);
    timer.current = setInterval(() => setPct((p) => (p < 95 ? p + Math.max(1, (95 - p) / 10) : p)), 500);
    allot.mutate(undefined, {
      onSuccess: (r) => { setResult(r); toast.success(`Awards allotted: ${r.awarded} students.`); },
      onError: (e) => toast.error(e.message),
      onSettled: () => { clearInterval(timer.current); setPct(100); },
    });
  };

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader><CardTitle className="text-lg">Award rules</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <p className="text-base">
            Each rule says who gets an award. If a student fits more than one rule, they get the one listed first, so list the biggest awards first.
          </p>
          {isLoading ? <Skeleton className="h-24 w-full" /> : (rules ?? []).length === 0 ? (
            <p className="text-base">No rules yet. Add the first one.</p>
          ) : (
            <ol className="space-y-2">
              {rules!.map((r, i) => (
                <li key={r.id} className="flex flex-col gap-2 rounded-md border p-3 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-base"><span className="font-semibold">{i + 1}. {r.award_name}</span>: {ruleSentence(r, className)}</p>
                  <div className="flex shrink-0 gap-2">
                    <Button variant="outline" className="min-h-11" onClick={() => setEdit(r)}>Edit</Button>
                    <Button variant="outline" className="min-h-11" aria-label={`Delete rule ${r.award_name}`} onClick={() => setConfirmDel(r)}><Trash2 className="h-4 w-4" aria-hidden="true" /></Button>
                  </div>
                </li>
              ))}
            </ol>
          )}
          <Button className="min-h-11" onClick={() => setEdit(blankRule((rules?.length ?? 0) + 1))}><Plus className="mr-2 h-4 w-4" aria-hidden="true" /> Add a rule</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-lg">Allot awards</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <p className="text-base">
            This works out who gets which award from the rules above. Awards you added by hand are never touched, and awards you removed stay removed.
            Students of a school with a Verified integrity flag are left out and listed below for you to handle by hand.
          </p>
          <Button className="min-h-11" disabled={allot.isPending || (rules ?? []).length === 0} onClick={() => setConfirmAllot(true)}>
            <Award className="mr-2 h-4 w-4" aria-hidden="true" /> Allot awards
          </Button>
          {(allot.isPending || result) && <ProgressPanel stage={allot.isPending ? "Working out the awards" : "Awards allotted"} percent={pct} />}
          {result && (
            <div className="space-y-3" role="status">
              <p className="text-base">{result.awarded} students have an award. {result.removedKept > 0 && `${result.removedKept} awards you removed earlier stay removed. `}{result.deleted > 0 && `${result.deleted} awards that no longer fit the rules were taken off.`}</p>
              <Table>
                <TableHeader><TableRow><TableHead className="text-sm">Award</TableHead><TableHead className="text-right text-sm">Students</TableHead></TableRow></TableHeader>
                <TableBody>{result.byAward.map((a) => <TableRow key={a.award}><TableCell className="text-base">{a.award}</TableCell><TableCell className="text-right text-base tabular-nums">{a.students}</TableCell></TableRow>)}</TableBody>
              </Table>
              {result.manualReview.length > 0 && (
                <div className="rounded-md border border-amber-600 p-3">
                  <p className="text-base font-semibold">Schools to handle by hand ({result.manualReview.length})</p>
                  <p className="text-sm">These schools have a Verified integrity flag, so none of their students got an automatic award.</p>
                  <ul className="mt-2 list-disc pl-5 text-base">
                    {result.manualReview.map((m) => <li key={m.schoolId}>{m.schoolName ?? "Unknown school"} ({m.verifiedFlags} verified {m.verifiedFlags === 1 ? "flag" : "flags"})</li>)}
                  </ul>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!edit} onOpenChange={(o) => !o && setEdit(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{edit?.id ? "Edit rule" : "Add a rule"}</DialogTitle><DialogDescription>Describe who should get this award.</DialogDescription></DialogHeader>
          {edit && (
            <div className="space-y-3">
              <div><Label htmlFor="r-name" className="text-sm">Award name</Label>
                <Input id="r-name" className="h-11 text-base" value={edit.award_name} onChange={(e) => setEdit({ ...edit, award_name: e.target.value })} placeholder="Gold Medal" /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label htmlFor="r-type" className="text-sm">Given to</Label>
                  <select id="r-type" className={selectClass} value={edit.rule_type} onChange={(e) => setEdit({ ...edit, rule_type: e.target.value as AwardRuleType })}>
                    <option value="top_n">The top few</option><option value="min_percentage">Everyone above a percentage</option>
                  </select></div>
                <div><Label htmlFor="r-val" className="text-sm">{edit.rule_type === "top_n" ? "How many (top N)" : "Percentage at least"}</Label>
                  <Input id="r-val" type="number" min={1} className="h-11 text-base" value={Number.isNaN(edit.value) ? "" : edit.value} onChange={(e) => setEdit({ ...edit, value: e.target.value === "" ? NaN : Number(e.target.value) })} /></div>
              </div>
              {edit.rule_type === "top_n" && (
                <div><Label htmlFor="r-level" className="text-sm">Ranked at which level</Label>
                  <select id="r-level" className={selectClass} value={edit.level} onChange={(e) => setEdit({ ...edit, level: e.target.value as AwardLevel })}>
                    {Object.entries(LEVELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select></div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div><Label htmlFor="r-class" className="text-sm">Class (optional)</Label>
                  <select id="r-class" className={selectClass} value={edit.class_code ?? ""} onChange={(e) => setEdit({ ...edit, class_code: e.target.value || null })}>
                    <option value="">Every class</option>{CLASS_ORDER.map((c) => <option key={c} value={c}>{className(c)}</option>)}
                  </select></div>
                <div><Label htmlFor="r-oly" className="text-sm">Olympiad (optional)</Label>
                  <select id="r-oly" className={selectClass} value={edit.olympiad_code ?? ""} onChange={(e) => setEdit({ ...edit, olympiad_code: e.target.value || null })}>
                    <option value="">Every olympiad</option>{OLYMPIADS.map((o) => <option key={o} value={o}>{OLYMPIAD_NAMES[o]}</option>)}
                  </select></div>
              </div>
              <div><Label htmlFor="r-order" className="text-sm">Order (1 is checked first)</Label>
                <Input id="r-order" type="number" className="h-11 text-base" value={edit.sort_order} onChange={(e) => setEdit({ ...edit, sort_order: Number(e.target.value) })} /></div>
              {valueProblem && <p className="text-sm text-red-700" role="alert">{valueProblem}</p>}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" className="min-h-11" onClick={() => setEdit(null)}>Cancel</Button>
            <Button className="min-h-11" disabled={!!valueProblem || save.isPending}
              onClick={() => save.mutate(edit!, { onSuccess: () => { toast.success("Rule saved."); setEdit(null); }, onError: (e) => toast.error(e.message) })}>Save rule</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!confirmDel} onOpenChange={(o) => !o && setConfirmDel(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Delete this rule?</AlertDialogTitle>
            <AlertDialogDescription>"{confirmDel?.award_name}" will no longer be used the next time you allot awards. Awards already given stay until you allot again.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel className="min-h-11">Keep it</AlertDialogCancel>
            <AlertDialogAction className="min-h-11" onClick={() => del.mutate(confirmDel!.id, { onSuccess: () => toast.success("Rule deleted."), onError: (e) => toast.error(e.message) })}>Delete rule</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmAllot} onOpenChange={setConfirmAllot}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Allot awards now?</AlertDialogTitle>
            <AlertDialogDescription>Awards from the rules are worked out again for every student. Awards you added by hand are not changed.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel className="min-h-11">Not now</AlertDialogCancel><AlertDialogAction className="min-h-11" onClick={runAllot}>Allot awards</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ---------------- award list ----------------
function ListTab({ projectId }: { projectId: string }) {
  const { data: awards, isLoading, isError } = useAwards(projectId);
  const { data: classes } = useClasses();
  const update = useUpdateAward(projectId);
  const add = useAddManualAward(projectId);
  const [award, setAward] = useState("");
  const [classCode, setClassCode] = useState("");
  const [oly, setOly] = useState("");
  const [source, setSource] = useState("");
  const [showRemoved, setShowRemoved] = useState(false);
  const [text, setText] = useState("");
  const [page, setPage] = useState(0);
  const [removing, setRemoving] = useState<AwardWithStudent | null>(null);
  const [note, setNote] = useState("");
  const [adding, setAdding] = useState(false);
  const className = (c: string) => classes?.find((x) => x.code === c)?.display_name ?? `Class ${c}`;

  const names = useMemo(() => [...new Set((awards ?? []).map((a) => a.award_name))].sort(), [awards]);
  const rows = useMemo(() => {
    const t = text.trim().toLowerCase();
    return (awards ?? []).filter((a) =>
      (showRemoved || !a.removed) && (!award || a.award_name === award) && (!source || a.source === source) &&
      (!classCode || a.student?.classCode === classCode) && (!oly || a.student?.olympiad === oly) &&
      (!t || `${a.student?.name} ${a.student?.regNumber} ${a.school?.name}`.toLowerCase().includes(t)));
  }, [awards, award, classCode, oly, source, showRemoved, text]);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const view = rows.slice(page * PAGE, (page + 1) * PAGE);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <div><Label htmlFor="a-award" className="text-sm">Award</Label>
          <select id="a-award" className={selectClass} value={award} onChange={(e) => { setAward(e.target.value); setPage(0); }}><option value="">All</option>{names.map((n) => <option key={n}>{n}</option>)}</select></div>
        <div><Label htmlFor="a-class" className="text-sm">Class</Label>
          <select id="a-class" className={selectClass} value={classCode} onChange={(e) => { setClassCode(e.target.value); setPage(0); }}><option value="">All</option>{CLASS_ORDER.map((c) => <option key={c} value={c}>{className(c)}</option>)}</select></div>
        <div><Label htmlFor="a-oly" className="text-sm">Olympiad</Label>
          <select id="a-oly" className={selectClass} value={oly} onChange={(e) => { setOly(e.target.value); setPage(0); }}><option value="">All</option>{OLYMPIADS.map((o) => <option key={o} value={o}>{OLYMPIAD_NAMES[o]}</option>)}</select></div>
        <div><Label htmlFor="a-src" className="text-sm">Given by</Label>
          <select id="a-src" className={selectClass} value={source} onChange={(e) => { setSource(e.target.value); setPage(0); }}><option value="">Rules and by hand</option><option value="rule">Rules</option><option value="manual">By hand</option></select></div>
        <div><Label htmlFor="a-text" className="text-sm">Search name, number or school</Label>
          <Input id="a-text" className="h-11 text-base" value={text} onChange={(e) => { setText(e.target.value); setPage(0); }} /></div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-base"><input type="checkbox" className="h-5 w-5" checked={showRemoved} onChange={(e) => { setShowRemoved(e.target.checked); setPage(0); }} /> Show removed awards</label>
        <Button className="min-h-11" onClick={() => setAdding(true)}><Plus className="mr-2 h-4 w-4" aria-hidden="true" /> Give an award by hand</Button>
      </div>

      {isLoading ? <Skeleton className="h-40 w-full" /> : isError ? <Card><CardContent className="py-8 text-base">We could not load the awards. Please refresh.</CardContent></Card> : rows.length === 0 ? (
        <Card><CardContent className="py-8 text-base">{(awards ?? []).length === 0 ? "No awards yet. Add rules and allot awards first." : "No awards match these filters."}</CardContent></Card>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">{rows.length} awards</p>
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader><TableRow>{["Award", "Student", "Registration no.", "Class", "Olympiad", "School", "", ""].map((h, i) => <TableHead key={i} className="text-sm">{h}</TableHead>)}</TableRow></TableHeader>
              <TableBody>
                {view.map((a) => (
                  <TableRow key={a.id} className={a.removed ? "opacity-60" : undefined}>
                    <TableCell className="text-base font-medium">{a.award_name}{a.removed && <Badge variant="outline" className="ml-2">Removed</Badge>}</TableCell>
                    <TableCell className="text-base">{a.student?.name}</TableCell>
                    <TableCell className="whitespace-nowrap text-base">{formatReg(a.student?.regNumber ?? "")}</TableCell>
                    <TableCell className="text-base">{a.student ? className(a.student.classCode) : ""}</TableCell>
                    <TableCell className="text-base">{OLYMPIAD_NAMES[a.student?.olympiad as OlympiadCode] ?? a.student?.olympiad}</TableCell>
                    <TableCell className="text-base">{a.school?.name}</TableCell>
                    <TableCell className="text-sm">{a.source === "manual" ? "By hand" : "Rule"}{a.notes && <span className="block text-muted-foreground">{a.notes}</span>}</TableCell>
                    <TableCell>
                      {a.removed
                        ? <Button variant="outline" className="min-h-11" onClick={() => update.mutate({ id: a.id, removed: false }, { onSuccess: () => toast.success("Award put back."), onError: (e) => toast.error(e.message) })}><Undo2 className="mr-1 h-4 w-4" aria-hidden="true" />Put back</Button>
                        : <Button variant="outline" className="min-h-11" onClick={() => { setRemoving(a); setNote(""); }}>Remove</Button>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {pages > 1 && (
            <div className="flex items-center justify-between">
              <Button variant="outline" className="min-h-11" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</Button>
              <span className="text-base">Page {page + 1} of {pages}</span>
              <Button variant="outline" className="min-h-11" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>Next</Button>
            </div>
          )}
        </>
      )}

      <Dialog open={!!removing} onOpenChange={(o) => !o && setRemoving(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Remove this award?</DialogTitle>
            <DialogDescription>{removing?.student?.name} will no longer get the {removing?.award_name} award. You can put it back later.</DialogDescription></DialogHeader>
          <div><Label htmlFor="rm-note" className="text-sm">Why (required)</Label>
            <Textarea id="rm-note" className="text-base" rows={3} value={note} onChange={(e) => setNote(e.target.value)} /></div>
          <DialogFooter>
            <Button variant="outline" className="min-h-11" onClick={() => setRemoving(null)}>Keep it</Button>
            <Button className="min-h-11" disabled={!note.trim() || update.isPending}
              onClick={() => update.mutate({ id: removing!.id, removed: true, notes: note.trim() }, { onSuccess: () => { toast.success("Award removed."); setRemoving(null); }, onError: (e) => toast.error(e.message) })}>Remove award</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {adding && <ManualAddDialog projectId={projectId} onClose={() => setAdding(false)} add={add} className={className} />}
    </div>
  );
}

function ManualAddDialog({ projectId, onClose, add, className }: {
  projectId: string; onClose: () => void; add: ReturnType<typeof useAddManualAward>; className: (c: string) => string;
}) {
  const [reg, setReg] = useState("");
  const [student, setStudent] = useState<StudentInfo | null>(null);
  const [looked, setLooked] = useState(false);
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const find = async () => {
    setBusy(true); setLooked(false);
    try { setStudent(await findEnrollmentByReg(projectId, reg)); setLooked(true); }
    catch (e) { toast.error((e as Error).message); }
    finally { setBusy(false); }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Give an award by hand</DialogTitle><DialogDescription>Awards given by hand are never changed when you allot awards again.</DialogDescription></DialogHeader>
        <div className="space-y-3">
          <div className="flex items-end gap-2">
            <div className="flex-1"><Label htmlFor="m-reg" className="text-sm">Registration number (12 digits)</Label>
              <Input id="m-reg" className="h-11 text-base" value={reg} onChange={(e) => { setReg(e.target.value); setStudent(null); setLooked(false); }} placeholder="1-33-21-03-07-001" /></div>
            <Button className="min-h-11" variant="outline" onClick={find} disabled={busy || reg.replace(/\D/g, "").length !== 12}>Find student</Button>
          </div>
          {looked && !student && <p className="text-sm text-red-700" role="alert">No student has this registration number this year.</p>}
          {student && <p className="rounded-md border p-2 text-base">{student.name}, {className(student.classCode)}, {OLYMPIAD_NAMES[student.olympiad as OlympiadCode] ?? student.olympiad}</p>}
          <div><Label htmlFor="m-name" className="text-sm">Award name</Label><Input id="m-name" className="h-11 text-base" value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div><Label htmlFor="m-note" className="text-sm">Why (required)</Label><Textarea id="m-note" className="text-base" rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" className="min-h-11" onClick={onClose}>Cancel</Button>
          <Button className="min-h-11" disabled={!student || !name.trim() || !note.trim() || add.isPending}
            onClick={() => add.mutate({ enrollmentId: student!.enrollmentId, awardName: name, notes: note }, { onSuccess: () => { toast.success("Award added."); onClose(); }, onError: (e) => toast.error(e.message) })}>Add award</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------- exports ----------------
function ExportTab({ projectId }: { projectId: string }) {
  const { data: classes } = useClasses();
  const [job, setJob] = useState<{ stage: string; pct: number } | null>(null);
  const className = (c: string) => classes?.find((x) => x.code === c)?.display_name ?? `Class ${c}`;
  const olyName = (o: string) => OLYMPIAD_NAMES[o as OlympiadCode] ?? o;

  const run = async (stage: string, fn: (set: (p: number) => void) => Promise<string | void>) => {
    setJob({ stage, pct: 0 });
    try {
      const done = await fn((pct) => setJob({ stage, pct }));
      toast.success(done || "Done.");
    } catch (e) { toast.error((e as Error).message || "That did not work. Please try again."); }
    finally { setJob(null); }
  };
  const activeAwards = async () => (await fetchAwards(projectId)).filter((a) => !a.removed && a.student);

  const letters = () => run("Making award letters", async (set) => {
    const all = await activeAwards();
    if (all.length === 0) throw new Error("There are no awards yet. Allot awards first.");
    const bySchool = new Map<string, AwardWithStudent[]>();
    for (const a of all) { const k = a.school?.id ?? "none"; bySchool.set(k, [...(bySchool.get(k) ?? []), a]); }
    const groups = [...bySchool.values()].sort((x, y) => (x[0].school?.name ?? "").localeCompare(y[0].school?.name ?? ""));
    const make = (list: AwardWithStudent[]) => generateAwardLetter({
      school: { name: list[0].school?.name ?? "Your school", city: list[0].school?.district ?? undefined, principal: list[0].school?.principal ?? undefined },
      awardees: list.map((a) => ({ name: a.student!.name, className: className(a.student!.classCode), olympiad: olyName(a.student!.olympiad), award: a.award_name })),
    });
    if (groups.length === 1) { saveBlob(`${groups[0][0].school?.name ?? "School"} - Award letter.pdf`, await make(groups[0])); set(100); return "Award letter saved."; }
    async function* files() {
      for (let i = 0; i < groups.length; i++) {
        const g = groups[i];
        yield { name: `${(g[0].school?.name ?? "School").replace(/[\\/:*?"<>|]/g, "-")} - Award letter.pdf`, blob: await make(g) };
        await new Promise((r) => setTimeout(r, 0));
      }
    }
    const r = await streamZipParts(files(), {
      count: groups.length, partName: zipPartName("Award letters"), onProgress: set,
      onPart: (p) => saveBlob(p.name, p.blob),
    });
    return `${groups.length} letters saved in ${r.parts} zip ${r.parts === 1 ? "file" : "files"}.`;
  });

  const achievers = () => run("Preparing the achievers list", async (set) => {
    const all = await activeAwards(); set(60);
    if (all.length === 0) throw new Error("There are no awards yet. Allot awards first.");
    const rows: PrinterRow[] = all.map((a) => ({
      regNumber: a.student!.regNumber, name: a.student!.name, className: className(a.student!.classCode),
      olympiad: olyName(a.student!.olympiad), school: a.school?.name ?? "", award: a.award_name,
    })).sort((x, y) => x.award.localeCompare(y.award) || x.regNumber.localeCompare(y.regNumber));
    downloadCsv("Achievers - certificate printer.csv", printerCsv(rows)); set(100);
    return `${rows.length} achievers saved.`;
  });

  const participation = () => run("Preparing the participation list", async (set) => {
    const [people, awards] = await Promise.all([fetchParticipants(projectId, (n) => set(Math.min(90, n / 100))), activeAwards()]);
    const won = new Set(awards.map((a) => a.student!.enrollmentId));
    const rows: PrinterRow[] = people.filter((p) => !won.has(p.s.enrollmentId)).map((p) => ({
      regNumber: p.s.regNumber, name: p.s.name, className: className(p.classCode), olympiad: olyName(p.olympiad),
      school: p.school?.name ?? "", award: "Participation",
    })).sort((x, y) => x.school.localeCompare(y.school) || x.regNumber.localeCompare(y.regNumber));
    downloadCsv("Participation - certificate printer.csv", printerCsv(rows)); set(100);
    return `${rows.length} participants saved.`;
  });

  const courier = () => run("Preparing the courier pack data", async (set) => {
    const all = await activeAwards(); set(70);
    if (all.length === 0) throw new Error("There are no awards yet. Allot awards first.");
    const data = courierPackData(all.map((a) => ({
      schoolId: a.school?.id ?? "none", schoolName: a.school?.name ?? "Unknown school", district: a.school?.district ?? null, ssNo: a.school?.ssNo ?? null,
      regNumber: a.student!.regNumber, name: a.student!.name, classCode: a.student!.classCode, olympiad: a.student!.olympiad,
    })));
    saveBlob("schools.json", new Blob([JSON.stringify(data, null, 1)], { type: "application/json" })); set(100);
    return `Courier data for ${data.length} schools saved.`;
  });

  const items: [string, string, () => void][] = [
    ["Award letters (PDF)", "One letter for each school listing its award winners. Many schools are saved as zip files of up to 25 MB each.", letters],
    ["Achievers list (CSV)", "Every award winner, for the certificate printer: Reg no, Name, Class, Olympiad, School, Award.", achievers],
    ["Participation list (CSV)", "Every evaluated student who did not win an award, with the award shown as Participation.", participation],
    ["Courier pack data (JSON)", "The school and winner list the parcel scripts read to prepare award parcels (schools.json).", courier],
  ];
  return (
    <div className="space-y-4">
      {job && <ProgressPanel stage={job.stage} percent={job.pct} />}
      <div className="grid gap-4 md:grid-cols-2">
        {items.map(([title, text, fn]) => (
          <Card key={title}>
            <CardHeader><CardTitle className="text-lg">{title}</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <p className="text-base">{text}</p>
              <Button className="min-h-11" disabled={!!job} onClick={fn}><Download className="mr-2 h-4 w-4" aria-hidden="true" /> Download</Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
