import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { OLYMPIAD_NAMES, olympiadsForClass, CLASS_ORDER, type OlympiadCode } from "@/lib/results/paperRules";
import { useCreatePaper, type ClassRow, type PaperRow, type SlotTemplate } from "@/hooks/results/usePapers";
import type { CreateDefaults } from "./PaperGrid";

const selectClass =
  "h-11 w-full rounded-md border border-input bg-background px-3 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  classes: ClassRow[];
  slots: SlotTemplate[];
  defaults?: CreateDefaults;
  onCreated: (paper: PaperRow) => void;
}

export function CreatePaperDialog({ open, onOpenChange, projectId, classes, slots, defaults, onCreated }: Props) {
  const create = useCreatePaper();
  const [classCode, setClassCode] = useState("01");
  const [olympiad, setOlympiad] = useState<OlympiadCode>("MPO");
  const [slotId, setSlotId] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setClassCode(defaults?.classCode ?? "01");
    setOlympiad(defaults?.olympiad ?? "MPO");
    setSlotId(defaults?.slotId ?? slots[0]?.id ?? "");
  }, [open, defaults, slots]);

  const sortedClasses = [...classes].sort((a, b) => CLASS_ORDER.indexOf(a.code) - CLASS_ORDER.indexOf(b.code));
  const valid = olympiadsForClass(classCode);
  const total = classes.find((c) => c.code === classCode)?.question_count;

  const changeClass = (code: string) => {
    setClassCode(code);
    const v = olympiadsForClass(code);
    if (!v.includes(olympiad)) setOlympiad(v[0]);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!total || !slotId) return setError("Choose a class, a subject and a slot first");
    try {
      const paper = await create.mutateAsync({
        project_id: projectId, class_code: classCode, olympiad_code: olympiad,
        slot_template_id: slotId, total_questions: total,
      });
      onCreated(paper);
    } catch (err) {
      setError(err instanceof Error ? err.message : "We could not create the paper. Please try again.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Create a question paper</DialogTitle>
            <DialogDescription>Pick the class, subject and exam slot this paper is for.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="cp-class" className="text-sm">Class</Label>
            <select id="cp-class" className={selectClass} value={classCode} onChange={(e) => changeClass(e.target.value)}>
              {sortedClasses.map((c) => <option key={c.code} value={c.code}>{c.display_name}</option>)}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cp-sub" className="text-sm">Subject</Label>
            <select id="cp-sub" className={selectClass} value={olympiad} onChange={(e) => setOlympiad(e.target.value as OlympiadCode)}>
              {valid.map((o) => <option key={o} value={o}>{OLYMPIAD_NAMES[o]}</option>)}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cp-slot" className="text-sm">Exam slot</Label>
            <select id="cp-slot" className={selectClass} value={slotId} onChange={(e) => setSlotId(e.target.value)}>
              {slots.slice(0, 2).map((s, i) => <option key={s.id} value={s.id}>Slot {i + 1}</option>)}
            </select>
          </div>
          {total ? <p className="text-sm text-muted-foreground">This paper has {total} questions.</p> : null}
          {error && <p role="alert" className="text-sm font-medium text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" className="min-h-11" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" className="min-h-11" disabled={create.isPending}>
              {create.isPending ? "Creating the paper…" : "Create paper"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
