import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { closeStuckSend, sendBatch, useSendBatches, useSendItems, type SendBatch, type SendItem } from "@/hooks/results/useRelease";
import { buildEmail } from "../../../../supabase/functions/results-send/message";

export const TEST_DONE_KEY = "results-send-test-done";
const STATUS: Record<SendBatch["status"], string> = { staged: "Ready to send", sending: "Sending", done: "Finished" };
const ITEM: Record<SendItem["status"], string> = { pending: "Waiting", sending: "Sending", sent: "Sent", failed: "Failed", unknown: "Unknown" };
const STUCK_MS = 15 * 60 * 1000;
const when = (iso: string) => new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

type Ask = { retryIds?: string[]; count: number };

export function SendHistory({ projectId, openId, onOpen }: { projectId: string; openId: string | null; onOpen: (id: string | null) => void }) {
  const { data: batches, isLoading } = useSendBatches(projectId);
  const batch = batches?.find((b) => b.id === openId) ?? null;
  const { data: items } = useSendItems(batch?.id);
  const qc = useQueryClient();
  const [ask, setAsk] = useState<Ask | null>(null);
  const [busy, setBusy] = useState(false);
  const [typed, setTyped] = useState("");
  // A test batch needs the address or number typed again, so a typo cannot send real links elsewhere.
  const norm = (v: string) => (batch?.channel === "whatsapp" ? v.replace(/\D/g, "") : v.trim().toLowerCase());
  const typedOk = !batch?.test_target || norm(typed) === norm(batch.test_target);

  const go = async () => {
    const a = ask; setAsk(null); setTyped("");
    if (!a || !batch) return;
    setBusy(true);
    try {
      const r = await sendBatch(batch.id, a.retryIds);
      if (batch.test_target) { try { localStorage.setItem(TEST_DONE_KEY, "1"); } catch { /* ignore */ } }
      toast.success(`${r.sent} sent${r.failed ? `, ${r.failed} failed` : ""}.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "The send did not work. Check the history before trying again.");
    } finally {
      setBusy(false);
      void qc.invalidateQueries({ queryKey: ["results", "send-batches"] });
      void qc.invalidateQueries({ queryKey: ["results", "send-items"] });
    }
  };

  const closeStuck = async () => {
    if (!batch) return;
    setBusy(true);
    try {
      const r = await closeStuckSend(batch.id);
      toast.success(`Closed. ${r.unknown} ${r.unknown === 1 ? "message" : "messages"} marked Unknown, ${r.notSent} not reached.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "The send could not be closed.");
    } finally {
      setBusy(false);
      void qc.invalidateQueries({ queryKey: ["results", "send-batches"] });
      void qc.invalidateQueries({ queryKey: ["results", "send-items"] });
    }
  };
  const stuck = !!batch && batch.status === "sending" && !!batch.approved_at && Date.now() - new Date(batch.approved_at).getTime() > STUCK_MS;

  if (isLoading) return <Skeleton className="h-32 w-full" />;
  const pending = items?.filter((i) => i.status === "pending").length ?? 0;
  const first = items?.find((i) => i.payload.files?.length);
  const preview = batch?.channel === "email" && first
    ? buildEmail({
        schoolName: first.payload.schoolName ?? "the school", contactName: first.payload.contactName ?? null, projectName: first.payload.projectName ?? null, links: (first.payload.files ?? []).map((f) => ({ label: f.label, url: "(download link, works for 7 days)" })),
        testMode: !!batch.test_target,
      })
    : null;

  return (
    <section aria-labelledby="hist-h" className="space-y-4">
      <h3 id="hist-h" className="text-lg font-semibold">Prepared and sent</h3>
      {!batches?.length ? <p className="text-base">Nothing has been prepared yet.</p> : (
        <ul className="divide-y rounded-md border">
          {batches.map((b) => (
            <li key={b.id}>
              <button type="button" onClick={() => onOpen(b.id === openId ? null : b.id)} aria-expanded={b.id === openId}
                className="flex min-h-11 w-full flex-wrap items-center justify-between gap-2 p-3 text-left hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <span className="text-base font-medium">{b.channel === "email" ? "Email" : "WhatsApp"} · {when(b.created_at)}</span>
                <span className="flex items-center gap-2">
                  {b.test_target && <Badge variant="outline" className="text-sm">Test to {b.test_target}</Badge>}
                  <Badge variant="outline" className="text-sm">{STATUS[b.status]}</Badge>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {batch && (
        <div className="space-y-4 rounded-md border p-4">
          {batch.test_target
            ? <p className="text-base font-medium">Test: every message in this batch goes to {batch.test_target} only. No school will receive anything.</p>
            : <p className="text-base">Real send: each school gets its own message.</p>}
          {preview && (
            <div className="rounded-md bg-muted p-3 text-sm">
              <p className="font-medium">Message preview (first school)</p>
              <p className="mt-1">Subject: {preview.subject}</p>
              <pre className="mt-2 whitespace-pre-wrap font-sans">{preview.text}</pre>
            </div>
          )}
          {!items ? <Skeleton className="h-24 w-full" /> : (
            <div className="overflow-x-auto rounded-md border">
              <Table className="text-sm">
                <TableHeader>
                  <TableRow><TableHead>School</TableHead><TableHead>Sent to</TableHead><TableHead>Status</TableHead><TableHead>Reason</TableHead><TableHead className="w-28"><span className="sr-only">Actions</span></TableHead></TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((it) => (
                    <TableRow key={it.id}>
                      <TableCell className="font-medium">{it.payload.schoolName ?? "School"}</TableCell>
                      <TableCell>{batch.test_target ?? it.target ?? "-"}</TableCell>
                      <TableCell>{ITEM[it.status]}</TableCell>
                      <TableCell>{it.error ?? ""}</TableCell>
                      <TableCell>
                        {it.status === "failed" && batch.status === "done" && (
                          <Button type="button" variant="outline" className="min-h-11" disabled={busy}
                            onClick={() => setAsk({ retryIds: [it.id], count: 1 })}>Retry</Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          {batch.status === "staged" && (
            <div className="flex flex-wrap items-center gap-3">
              <Button type="button" className="min-h-11" disabled={busy || pending === 0} onClick={() => setAsk({ count: pending })}>Send now</Button>
              {pending === 0 && <span className="text-sm">There is nothing waiting to send in this batch.</span>}
            </div>
          )}
          {batch.status === "sending" && <p className="text-base" role="status">This batch is being sent. The list updates by itself.</p>}
          {stuck && (
            <div className="space-y-2">
              <p className="text-base">This send started more than 15 minutes ago and has not finished. You can close it. Messages that may or may not have gone out will show as Unknown, and cannot be retried.</p>
              <Button type="button" variant="outline" className="min-h-11" disabled={busy} onClick={closeStuck}>Close this stuck send</Button>
            </div>
          )}
        </div>
      )}

      <AlertDialog open={!!ask} onOpenChange={(o) => { if (!o) { setAsk(null); setTyped(""); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{ask?.retryIds ? "Try this message again?" : "Send now?"}</AlertDialogTitle>
            <AlertDialogDescription className="text-base text-foreground">
              {batch?.test_target
                ? `This sends ${ask?.count} ${ask?.count === 1 ? "message" : "messages"} to ${batch.test_target} only. No school receives anything.`
                : `This sends ${ask?.count} real ${batch?.channel === "email" ? "email" : "WhatsApp"} ${ask?.count === 1 ? "message" : "messages"} to schools. It cannot be undone.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {batch?.test_target && (
            <div>
              <label htmlFor="retype-target" className="mb-1 block text-sm font-medium">Type the test {batch.channel === "email" ? "address" : "number"} again to confirm</label>
              <Input id="retype-target" className="min-h-11 text-base" value={typed} autoComplete="off" onChange={(e) => setTyped(e.target.value)} />
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-11">Cancel</AlertDialogCancel>
            <AlertDialogAction className="min-h-11" disabled={!typedOk} onClick={go}>{ask?.retryIds ? "Yes, try again" : "Yes, send now"}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
