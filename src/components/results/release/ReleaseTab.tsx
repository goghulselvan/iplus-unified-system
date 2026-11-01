import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useSchoolSummary, type SchoolSummaryRow } from "@/hooks/results/useResultsReads";
import { useReleaseActions, useResendFlags } from "@/hooks/results/useRelease";

const n = (v: unknown) => Number(v ?? 0);

/** Plain-English readiness for one school. */
export function readiness(s: Pick<SchoolSummaryRow, "evaluated" | "pending">): { ok: boolean; text: string } {
  if (n(s.evaluated) === 0) return { ok: false, text: "No results yet" };
  if (n(s.pending) > 0) return { ok: true, text: `${n(s.pending)} ${n(s.pending) === 1 ? "student" : "students"} still Pending` };
  return { ok: true, text: "Ready" };
}

type Confirm = { kind: "release"; ids: string[] } | { kind: "unrelease"; id: string; name: string };

export function ReleaseTab({ projectId }: { projectId: string }) {
  const { data: schools, isLoading, isError } = useSchoolSummary(projectId);
  const { data: flags } = useResendFlags(projectId);
  const { release, unrelease, clearFlag } = useReleaseActions(projectId);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");
  const [confirm, setConfirm] = useState<Confirm | null>(null);

  const rows = schools ?? [];
  const match = (s: SchoolSummaryRow) => !q.trim() || (s.school_name ?? "").toLowerCase().includes(q.trim().toLowerCase());
  const waiting = useMemo(() => rows.filter((s) => !s.released && match(s)), [rows, q]);
  const released = useMemo(() => rows.filter((s) => s.released && match(s)), [rows, q]);
  const selectable = waiting.filter((s) => readiness(s).ok);
  const allPicked = selectable.length > 0 && selectable.every((s) => picked.has(s.school_id));
  const toggle = (id: string) => setPicked((p) => { const x = new Set(p); x.has(id) ? x.delete(id) : x.add(id); return x; });

  if (isLoading) return <Skeleton className="h-64 w-full" />;
  if (isError) return <p className="text-base">We could not load the schools. Please refresh the page.</p>;

  const doConfirm = async () => {
    const c = confirm; setConfirm(null);
    if (!c) return;
    try {
      if (c.kind === "release") {
        const count = await release.mutateAsync(c.ids);
        setPicked(new Set());
        toast.success(count === 1 ? "Results released for 1 school." : `Results released for ${count} schools.`);
      } else {
        await unrelease.mutateAsync(c.id);
        toast.success(`${c.name} is no longer released.`);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "That did not work. Please try again.");
    }
  };

  return (
    <div className="space-y-8">
      <div className="max-w-sm">
        <label htmlFor="rel-search" className="mb-1 block text-sm font-medium">Find a school</label>
        <Input id="rel-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="School name" className="min-h-11 text-base" />
      </div>

      {(flags?.length ?? 0) > 0 && (
        <section aria-labelledby="flags-h" className="space-y-2">
          <h3 id="flags-h" className="text-lg font-semibold">Schools that need results sent again</h3>
          <p className="text-base">Scores changed after these schools were released. Send them again, then clear the note.</p>
          <ul className="divide-y rounded-md border">
            {flags!.map((f) => (
              <li key={f.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
                <div>
                  <p className="text-base font-medium">{f.school_name ?? "A school"}</p>
                  <p className="text-sm text-muted-foreground">{f.reason}</p>
                </div>
                <Button type="button" variant="outline" className="min-h-11" disabled={clearFlag.isPending}
                  onClick={() => clearFlag.mutate(f.id, { onError: (e) => toast.error(e.message) })}>Clear</Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="wait-h" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 id="wait-h" className="text-lg font-semibold">Not released yet ({waiting.length})</h3>
          <Button type="button" className="min-h-11" disabled={picked.size === 0 || release.isPending}
            onClick={() => setConfirm({ kind: "release", ids: [...picked] })}>
            Release{picked.size ? ` (${picked.size})` : ""}
          </Button>
        </div>
        {waiting.length === 0 ? <p className="text-base">Every school here has been released.</p> : (
          <div className="overflow-x-auto rounded-md border">
            <Table className="text-sm">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">
                    <Checkbox aria-label="Select every school that is ready" checked={allPicked}
                      onCheckedChange={(c) => setPicked(c ? new Set(selectable.map((s) => s.school_id)) : new Set())} />
                  </TableHead>
                  <TableHead>School</TableHead>
                  <TableHead className="text-right">Evaluated</TableHead>
                  <TableHead className="text-right">Pending</TableHead>
                  <TableHead>Ready?</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {waiting.map((s) => {
                  const r = readiness(s);
                  return (
                    <TableRow key={s.school_id}>
                      <TableCell>
                        <Checkbox aria-label={`Select ${s.school_name}`} disabled={!r.ok} checked={picked.has(s.school_id)} onCheckedChange={() => toggle(s.school_id)} />
                      </TableCell>
                      <TableCell className="font-medium">{s.school_name}</TableCell>
                      <TableCell className="text-right tabular-nums">{n(s.evaluated)}</TableCell>
                      <TableCell className="text-right tabular-nums">{n(s.pending)}</TableCell>
                      <TableCell>{r.text}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      <section aria-labelledby="done-h" className="space-y-3">
        <h3 id="done-h" className="text-lg font-semibold">Released ({released.length})</h3>
        {released.length === 0 ? <p className="text-base">No school has been released yet.</p> : (
          <ul className="divide-y rounded-md border">
            {released.map((s) => (
              <li key={s.school_id} className="flex flex-wrap items-center justify-between gap-3 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-base font-medium">{s.school_name}</span>
                  {s.resend_flag && <Badge variant="outline" className="border-amber-600 bg-amber-50 text-sm text-amber-950">Resend needed</Badge>}
                </div>
                <Button type="button" variant="outline" className="min-h-11" disabled={unrelease.isPending}
                  onClick={() => setConfirm({ kind: "unrelease", id: s.school_id, name: s.school_name ?? "this school" })}>Unrelease</Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <AlertDialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm?.kind === "release" ? "Release results?" : "Take the release back?"}</AlertDialogTitle>
            <AlertDialogDescription className="text-base text-foreground">
              {confirm?.kind === "release"
                ? `Release results for ${confirm.ids.length} ${confirm.ids.length === 1 ? "school" : "schools"}? Schools will be able to see them in the portal.`
                : confirm ? `${confirm.name} will no longer see results in the portal, and anything not sent yet to this school will be skipped.` : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-11">Cancel</AlertDialogCancel>
            <AlertDialogAction className="min-h-11" onClick={doConfirm}>{confirm?.kind === "release" ? "Release" : "Unrelease"}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
