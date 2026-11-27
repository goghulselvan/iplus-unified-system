import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useReevaluateSchool, type ReevaluateResult } from "@/hooks/results/useReevaluateSchool";

type Phase = { t: "idle" } | { t: "checking" } | { t: "preview"; r: ReevaluateResult } | { t: "saving" } | { t: "error"; message: string };

/**
 * Superadmin only. When a school's exam slot was wrong in the CRM and has been corrected,
 * moves the school's saved answers onto the papers of its current slot and marks them again.
 */
export function ReevaluateSchoolCard({ projectId, schoolId }: { projectId: string; schoolId: string }) {
  const api = useReevaluateSchool();
  const [phase, setPhase] = useState<Phase>({ t: "idle" });

  const check = async () => {
    setPhase({ t: "checking" });
    try { setPhase({ t: "preview", r: await api.check(projectId, schoolId) }); }
    catch (e) { setPhase({ t: "error", message: (e as Error).message }); }
  };
  const run = async () => {
    setPhase({ t: "saving" });
    try {
      const r = await api.run(projectId, schoolId);
      toast.success(`${r.moved} ${r.moved === 1 ? "student was" : "students were"} moved to ${r.slotName} papers and marked again.`);
      setPhase({ t: "idle" });
    } catch (e) { setPhase({ t: "error", message: (e as Error).message }); }
  };

  return (
    <Card>
      <CardContent className="space-y-3 pt-6">
        <h4 className="text-lg font-semibold">Re-evaluate after a slot change</h4>
        <p className="text-sm text-muted-foreground">
          If this school's exam slot was wrong in the CRM and you have corrected it, this marks the school's saved answers
          again against the papers of its current slot. No file needs to be uploaded again. Only a superadmin can do this.
        </p>
        {(phase.t === "idle" || phase.t === "error" || phase.t === "checking") && (
          <Button type="button" variant="outline" className="min-h-11" onClick={check} disabled={phase.t === "checking"}>
            <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
            {phase.t === "checking" ? "Checking" : "Check this school's slot"}
          </Button>
        )}
        {phase.t === "error" && <p role="alert" className="text-sm text-destructive">{phase.message}</p>}
        {phase.t === "preview" && phase.r.count === 0 && (
          <div className="space-y-3">
            <p className="text-base">All of this school's results are already on its {phase.r.slotName} papers. Nothing to re-evaluate.</p>
            <Button type="button" variant="outline" className="min-h-11" onClick={() => setPhase({ t: "idle" })}>Close</Button>
          </div>
        )}
        {phase.t === "preview" && phase.r.count > 0 && (
          <div className="space-y-3">
            <p className="text-base font-medium">
              The CRM now says this school sat {phase.r.slotName}. {phase.r.count} {phase.r.count === 1 ? "student's result is" : "students' results are"} on
              another slot's paper and will be moved:
            </p>
            <div className="overflow-x-auto rounded-md border">
              <Table className="text-sm">
                <TableHeader>
                  <TableRow>
                    <TableHead>Class</TableHead><TableHead>Subject</TableHead><TableHead>From</TableHead><TableHead>To</TableHead>
                    <TableHead className="text-right">Students</TableHead><TableHead>Marking</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {phase.r.groups.map((g) => (
                    <TableRow key={`${g.classCode}-${g.olympiadCode}-${g.fromSlot}`}>
                      <TableCell>{g.className}</TableCell><TableCell>{g.olympiad}</TableCell>
                      <TableCell>{g.fromSlot ?? "—"}</TableCell><TableCell>{g.toSlot}</TableCell>
                      <TableCell className="text-right tabular-nums">{g.count}</TableCell>
                      <TableCell>
                        {g.keyReady ? "Marked straight away"
                          : g.paperExists ? "Waits for this paper's answer key"
                          : "Waits for the question paper and answer key"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <p className="text-sm text-muted-foreground">The old results are kept for 30 days and can be restored from the Students page. Ranks are recalculated.</p>
            <div className="flex flex-wrap gap-3">
              <Button type="button" className="min-h-11" onClick={run}>Re-evaluate {phase.r.count} {phase.r.count === 1 ? "student" : "students"}</Button>
              <Button type="button" variant="outline" className="min-h-11" onClick={() => setPhase({ t: "idle" })}>Cancel</Button>
            </div>
          </div>
        )}
        {phase.t === "saving" && <p role="status" className="text-base">Moving results and marking again…</p>}
      </CardContent>
    </Card>
  );
}
