import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { ProgressPanel } from "@/components/results/ProgressPanel";
import { useSchoolSummary } from "@/hooks/results/useResultsReads";
import { attachFiles, fetchContactName, fetchSsNumbers, stageSend, useWhatsAppTemplate } from "@/hooks/results/useRelease";
import { FilesCancelled, prepareSchoolFiles } from "@/lib/results/uploadSchoolFiles";
import { buildEmail } from "../../../../supabase/functions/results-send/message";
import { SendHistory, TEST_DONE_KEY } from "./SendHistory";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useActiveProject } from "@/hooks/useOlympiadProjects";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const testDone = () => { try { return localStorage.getItem(TEST_DONE_KEY) === "1"; } catch { return false; } };

export function SendTab({ projectId }: { projectId: string }) {
  const { data: schools, isLoading } = useSchoolSummary(projectId);
  const { data: hasWa } = useWhatsAppTemplate(projectId);
  const qc = useQueryClient();
  const [channel, setChannel] = useState<"email" | "whatsapp">("email");
  // Test mode is ON until a test send has been made on this computer.
  const [testMode, setTestMode] = useState(() => !testDone());
  const [target, setTarget] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");
  const [progress, setProgress] = useState<{ percent: number; detail: string } | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [problems, setProblems] = useState<{ school: string; message: string }[]>([]);
  const cancel = useRef({ cancelled: false });

  const { data: project } = useActiveProject();
  const firstId = (schools ?? []).find((s) => picked.has(s.school_id))?.school_id;
  const { data: contact } = useQuery({ queryKey: ["results", "contact", firstId], enabled: !!firstId, queryFn: () => fetchContactName(firstId!) });
  const released = useMemo(
    () => (schools ?? []).filter((s) => s.released && (!q.trim() || (s.school_name ?? "").toLowerCase().includes(q.trim().toLowerCase()))),
    [schools, q],
  );
  if (isLoading) return <Skeleton className="h-64 w-full" />;

  const first = (schools ?? []).find((s) => picked.has(s.school_id));
  const targetOk = !testMode || (channel === "email" ? EMAIL_RE.test(target.trim()) : [10, 12].includes(target.replace(/\D/g, "").length));
  const toggle = (id: string) => setPicked((p) => { const x = new Set(p); x.has(id) ? x.delete(id) : x.add(id); return x; });
  const busy = !!progress;
  const preview = first && channel === "email"
    ? buildEmail({ schoolName: first.school_name ?? "your school", contactName: contact ?? null, projectName: (project as { project_name?: string } | undefined)?.project_name ?? null, links: [{ label: "Score sheets - Part 1 of 1", url: "(download link, works for 7 days)" }], testMode })
    : null;

  const stage = async () => {
    const chosen = (schools ?? []).filter((s) => picked.has(s.school_id));
    cancel.current = { cancelled: false };
    setProblems([]);
    setProgress({ percent: 0, detail: "Getting ready" });
    try {
      const ssNos = await fetchSsNumbers(chosen.map((s) => s.school_id));
      const res = await prepareSchoolFiles({
        projectId, schools: chosen.map((s) => ({ school_id: s.school_id, school_name: s.school_name })), ssNos, cancel: cancel.current,
        onProgress: (percent, detail) => setProgress({ percent, detail }),
      });
      setProblems(res.problems);
      const ids = Object.keys(res.files);
      if (ids.length === 0) throw new Error("No school's files could be made, so nothing was prepared.");
      setProgress({ percent: 100, detail: "Preparing the list" });
      const batchId = await stageSend(projectId, channel, ids, testMode ? target.trim() : null);
      await attachFiles(batchId, res.files);
      void qc.invalidateQueries({ queryKey: ["results", "send-batches"] });
      setOpenId(batchId);
      setPicked(new Set());
      toast.success("Prepared. Nothing has been sent yet. Check the list below, then choose Send now.");
    } catch (e) {
      if (e instanceof FilesCancelled) toast.message("Stopped. Nothing was prepared or sent.");
      else toast.error(e instanceof Error ? e.message : "That did not work. Nothing was sent.");
    } finally {
      setProgress(null);
    }
  };

  return (
    <div className="space-y-8">
      <p className="rounded-md border bg-muted p-3 text-base">Nothing is sent automatically. Preparing a batch only makes the files and the list. Messages go out only when you choose Send now and confirm.</p>

      <section aria-labelledby="ch-h" className="space-y-3">
        <h3 id="ch-h" className="text-lg font-semibold">1. How to send</h3>
        <div className="flex flex-wrap gap-3">
          <Button type="button" variant={channel === "email" ? "default" : "outline"} className="min-h-11" aria-pressed={channel === "email"} onClick={() => setChannel("email")}>Email</Button>
          <Button type="button" variant={channel === "whatsapp" ? "default" : "outline"} className="min-h-11" aria-pressed={channel === "whatsapp"} disabled={!hasWa} onClick={() => setChannel("whatsapp")}>WhatsApp</Button>
        </div>
        {!hasWa && <p className="text-sm">WhatsApp template not set up yet</p>}

        <div className="flex items-center gap-3">
          <Switch id="test-mode" checked={testMode} onCheckedChange={setTestMode} />
          <label htmlFor="test-mode" className="text-base font-medium">Test mode: send everything to one {channel === "email" ? "address" : "number"} only</label>
        </div>
        {testMode ? (
          <div className="max-w-sm">
            <label htmlFor="test-target" className="mb-1 block text-sm font-medium">{channel === "email" ? "Test email address" : "Test mobile number"}</label>
            <Input id="test-target" className="min-h-11 text-base" value={target} onChange={(e) => setTarget(e.target.value)}
              inputMode={channel === "email" ? "email" : "tel"} placeholder={channel === "email" ? "you@example.com" : "10-digit mobile number"} />
          </div>
        ) : (
          <p className="text-base font-medium text-destructive">Test mode is off. Messages will go to the schools.</p>
        )}
      </section>

      <section aria-labelledby="sc-h" className="space-y-3">
        <h3 id="sc-h" className="text-lg font-semibold">2. Which schools ({picked.size} chosen)</h3>
        {(schools ?? []).every((s) => !s.released) ? <p className="text-base">No school has been released yet. Release results first.</p> : (
          <>
            <div className="flex flex-wrap items-end gap-3">
              <div className="max-w-sm flex-1">
                <label htmlFor="send-search" className="mb-1 block text-sm font-medium">Find a school</label>
                <Input id="send-search" value={q} onChange={(e) => setQ(e.target.value)} className="min-h-11 text-base" />
              </div>
              <Button type="button" variant="outline" className="min-h-11" onClick={() => setPicked(new Set(released.map((s) => s.school_id)))}>Choose all shown</Button>
              <Button type="button" variant="outline" className="min-h-11" onClick={() => setPicked(new Set())}>Clear</Button>
            </div>
            <ul className="max-h-80 divide-y overflow-y-auto rounded-md border">
              {released.map((s) => (
                <li key={s.school_id} className="flex min-h-11 items-center gap-3 p-3">
                  <Checkbox id={`pick-${s.school_id}`} checked={picked.has(s.school_id)} onCheckedChange={() => toggle(s.school_id)} />
                  <label htmlFor={`pick-${s.school_id}`} className="flex-1 cursor-pointer text-base">
                    {s.school_name}{s.resend_flag ? " (resend needed)" : ""}
                  </label>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      {preview && (
        <section aria-labelledby="pv-h" className="space-y-2">
          <h3 id="pv-h" className="text-lg font-semibold">3. The message</h3>
          <div className="rounded-md bg-muted p-3 text-sm">
            <p className="font-medium">Subject: {preview.subject}</p>
            <pre className="mt-2 whitespace-pre-wrap font-sans">{preview.text}</pre>
          </div>
        </section>
      )}
      {channel === "whatsapp" && <p className="text-base">WhatsApp uses the approved results template, with the download link filled in for each school.</p>}

      <div className="space-y-3">
        <Button type="button" className="min-h-11" disabled={busy || picked.size === 0 || !targetOk} onClick={stage}>
          Stage ({picked.size} {picked.size === 1 ? "school" : "schools"})
        </Button>
        {!targetOk && <p className="text-sm">Type a valid test {channel === "email" ? "email address" : "mobile number"} first.</p>}
        {progress && <ProgressPanel stage="Making and uploading the files" percent={progress.percent} detail={progress.detail} onCancel={() => { cancel.current.cancelled = true; }} />}
        {problems.length > 0 && (
          <div role="status" className="text-base">
            <p>These schools were left out because their files could not be made:</p>
            <ul className="list-disc pl-5 text-sm">{problems.map((p, i) => <li key={i}>{p.school}: {p.message}</li>)}</ul>
          </div>
        )}
      </div>

      <SendHistory projectId={projectId} openId={openId} onOpen={setOpenId} />
    </div>
  );
}
