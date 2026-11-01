// Builds each school's score-sheet and skill-report zip parts in the browser and uploads them
// to R2 under {project_id}/{ss_no}/results/. Runs BEFORE a send is staged. Sends nothing.
import { fetchClassOlympiad } from "@/hooks/results/useResultsReads";
import { fetchSchoolRankRows } from "@/lib/results/pdfData";
import { NothingToMake, scoreSheetJob, skillReportJob, type SchoolZipContext, type ZipJob } from "@/lib/results/schoolZipInputs";
import { streamZipParts, zipPartName } from "@/lib/results/zipParts";
import { uploadWithProgress } from "@/lib/results/uploadWithProgress";
import { resultsFileName, resultsKeyPrefix } from "../../../supabase/functions/results-files/keys";
import type { ResultsFile } from "../../../supabase/functions/results-send/message";

export interface SchoolRef { school_id: string; school_name: string | null }
export interface FilesProblem { school: string; message: string }
export interface PrepareResult { files: Record<string, ResultsFile[]>; problems: FilesProblem[] }
export class FilesCancelled extends Error {}

const yieldToUi = () => new Promise<void>((r) => setTimeout(r, 0));

export async function prepareSchoolFiles(o: {
  projectId: string;
  schools: SchoolRef[];
  ssNos: Map<string, string>;
  onProgress: (percent: number, detail: string) => void;
  cancel: { cancelled: boolean };
}): Promise<PrepareResult> {
  const files: Record<string, ResultsFile[]> = {};
  const problems: FilesProblem[] = [];
  const N = o.schools.length;
  for (let i = 0; i < N; i++) {
    const s = o.schools[i];
    const name = s.school_name ?? "School";
    const report = (inner: number) =>
      o.onProgress(Math.min(99, Math.round(((i + inner) / N) * 100)), `School ${i + 1} of ${N}: ${name}`);
    try {
      if (o.cancel.cancelled) throw new FilesCancelled();
      const ssNo = o.ssNos.get(s.school_id);
      if (!ssNo) throw new Error("This school has no SS number, so its files cannot be stored.");
      report(0);
      const groups = (await fetchClassOlympiad(o.projectId, s.school_id)).filter((g) => Number(g.evaluated) > 0);
      const rows = await fetchSchoolRankRows(o.projectId, s.school_id, groups);
      if (rows.length === 0) throw new Error("This school has no evaluated students.");
      const ctx: SchoolZipContext = {
        projectId: o.projectId, schoolId: s.school_id, schoolName: name,
        className: (c) => groups.find((g) => g.class_code === c)?.class_name ?? `Class ${c}`,
      };
      const out: ResultsFile[] = [];
      const run = async (job: ZipJob, label: string, base: number) => {
        let done = 0;
        const wrapped = job.inputs.map((inp) => ({
          name: inp.name,
          make: async () => {
            if (o.cancel.cancelled) throw new FilesCancelled();
            await yieldToUi();
            const b = await inp.make!();
            done++;
            report(base + 0.5 * (done / job.inputs.length));
            return b;
          },
        }));
        await streamZipParts(wrapped, {
          count: wrapped.length,
          partName: zipPartName(name, label),
          onPart: async (p) => {
            const key = resultsKeyPrefix(o.projectId, ssNo) + resultsFileName(p.name);
            await uploadWithProgress(new File([p.blob], p.name, { type: "application/zip" }), key, () => {}, undefined, ["zip"]);
            out.push({ key, label: p.name.replace(/\.zip$/, "") });
          },
        });
      };
      await run(await scoreSheetJob(ctx, rows), "Score sheets", 0);
      try {
        await run(await skillReportJob(ctx, rows), "Skill reports", 0.5);
      } catch (e) {
        if (!(e instanceof NothingToMake)) throw e; // skill reports are optional
      }
      files[s.school_id] = out;
    } catch (e) {
      if (e instanceof FilesCancelled) throw e;
      problems.push({ school: name, message: e instanceof Error ? e.message : "Its files could not be made." });
    }
  }
  o.onProgress(100, "All files are ready");
  return { files, problems };
}
