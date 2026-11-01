import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  bookedSlotFor, findPapersForStudents, useSetAbsent, type StudentListRow,
} from "@/hooks/results/useEvaluations";
import type { SlotTemplate } from "@/hooks/results/usePapers";
import { OLYMPIAD_NAMES, type OlympiadCode } from "@/lib/results/paperRules";

interface Group {
  key: string;
  label: string;
  rows: StudentListRow[];
  candidates: { id: string; slot_template_id: string | null }[];
  chosen: string;
  reason: string; // why we are asking, or why it can't go ahead
}

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  mode: "absent" | "present";
  rows: StudentListRow[];
  projectId: string;
  slots: SlotTemplate[];
  onDone: () => void;
}

const selectClass =
  "h-11 w-full rounded-md border border-input bg-background px-3 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function AttendanceDialog({ open, onOpenChange, mode, rows, projectId, slots, onDone }: Props) {
  const setAbsent = useSetAbsent();
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const n = rows.length;
  const noun = n === 1 ? "student" : "students";

  useEffect(() => {
    if (!open) return;
    let live = true;
    setGroups(null);
    setError(null);
    (async () => {
      try {
        const byKey = new Map<string, StudentListRow[]>();
        for (const r of rows) {
          const k = `${r.class_code}|${r.olympiad_code}|${r.school_id ?? ""}`;
          byKey.set(k, [...(byKey.get(k) ?? []), r]);
        }
        const out: Group[] = [];
        const paperCache = new Map<string, Awaited<ReturnType<typeof findPapersForStudents>>>();
        for (const [key, rs] of byKey) {
          const first = rs[0];
          const pk = `${first.class_code}|${first.olympiad_code}`;
          if (!paperCache.has(pk)) paperCache.set(pk, await findPapersForStudents(projectId, first.class_code, first.olympiad_code));
          const candidates = paperCache.get(pk)!;
          const label = `Class ${first.class_code} · ${OLYMPIAD_NAMES[first.olympiad_code as OlympiadCode] ?? first.olympiad_code}`;
          let chosen = "";
          let reason = "";
          if (candidates.length === 0) {
            reason = "There is no question paper for this class and olympiad yet. Create one on the Question Papers page first.";
          } else if (candidates.length === 1) {
            chosen = candidates[0].id;
          } else {
            const booked = first.school_id ? await bookedSlotFor(projectId, first.school_id) : null;
            const match = candidates.find((c) => c.slot_template_id === booked);
            if (match) chosen = match.id;
            else reason = booked ? "This school's booked slot has no paper. Pick the paper to use." : "This school has no slot booked. Pick which slot's paper to use.";
          }
          out.push({ key, label, rows: rs, candidates, chosen, reason });
        }
        if (live) setGroups(out);
      } catch (e) {
        if (live) setError((e as Error).message);
      }
    })();
    return () => { live = false; };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const slotName = (id: string | null) => {
    const i = slots.findIndex((s) => s.id === id);
    return i >= 0 ? `Slot ${i + 1}` : "Paper";
  };
  const blocked = !groups || groups.some((g) => !g.chosen);

  const go = async () => {
    if (!groups) return;
    try {
      let changed = 0;
      for (const g of groups) {
        changed += await setAbsent.mutateAsync({ paperId: g.chosen, enrollmentIds: g.rows.map((r) => r.enrollment_id), absent: mode === "absent" });
      }
      toast.success(mode === "absent" ? `${changed} ${changed === 1 ? "student" : "students"} marked absent.` : `${changed} ${changed === 1 ? "student" : "students"} marked present. They are now Pending.`);
      onOpenChange(false);
      onDone();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Mark {n} {noun} {mode}?</DialogTitle>
          <DialogDescription>
            {mode === "absent"
              ? "Their scores will be removed from rankings. You can mark them present again later."
              : "Their absent mark will be removed and they will go back to Pending until their answers are uploaded."}
          </DialogDescription>
        </DialogHeader>
        {!groups && !error && <p className="text-base text-muted-foreground">Finding the right paper</p>}
        {groups?.filter((g) => g.reason).map((g) => (
          <div key={g.key} className="space-y-2 rounded-md border p-3">
            <p className="text-sm font-medium">{g.label} ({g.rows.length} {g.rows.length === 1 ? "student" : "students"})</p>
            <p className="text-sm text-muted-foreground">{g.reason}</p>
            {g.candidates.length > 1 && (
              <select
                aria-label={`Paper for ${g.label}`} className={selectClass} value={g.chosen}
                onChange={(e) => setGroups((gs) => gs!.map((x) => (x.key === g.key ? { ...x, chosen: e.target.value } : x)))}
              >
                <option value="">Choose a paper</option>
                {g.candidates.map((c) => <option key={c.id} value={c.id}>{slotName(c.slot_template_id)}</option>)}
              </select>
            )}
          </div>
        ))}
        {error && <p role="alert" className="text-sm font-medium text-destructive">{error}</p>}
        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} className="min-h-11">Cancel</Button>
          <Button type="button" onClick={go} disabled={blocked || setAbsent.isPending} className="min-h-11">
            {setAbsent.isPending ? "Saving" : `Mark ${mode}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
