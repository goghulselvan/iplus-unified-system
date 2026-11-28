import { useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ProgressPanel } from "@/components/results/ProgressPanel";
import type { QuestionRow } from "@/lib/results/paperRules";
import { acceptedLabel } from "@/lib/results/accepted";

interface Props {
  paperName: string;
  questions: QuestionRow[];
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0));
const csvCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

function save(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function AnswerKeyExport({ paperName, questions }: Props) {
  const [job, setJob] = useState<{ stage: string; percent: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileBase = paperName.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "") + "-answer-key";

  const rowsOut = async (from: number, to: number, stage: string) => {
    const out: string[][] = [];
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      out.push([String(q.question_number), q.is_grace ? "Grace" : acceptedLabel(q), q.skill_category ?? "", q.cognitive_level ?? ""]);
      if (i % 10 === 0) { setJob({ stage, percent: from + ((to - from) * i) / questions.length }); await tick(); }
    }
    return out;
  };

  const run = async (kind: "csv" | "pdf") => {
    setError(null);
    try {
      const head = ["Question", "Answer", "Skill", "Thinking level"];
      if (kind === "csv") {
        const rows = await rowsOut(0, 90, "Preparing the answer key");
        setJob({ stage: "Saving the file", percent: 95 });
        const text = [head, ...rows].map((r) => r.map(csvCell).join(",")).join("\n");
        save(new Blob([text], { type: "text/csv;charset=utf-8" }), `${fileBase}.csv`);
      } else {
        const rows = await rowsOut(0, 60, "Preparing the answer key");
        setJob({ stage: "Building the PDF", percent: 70 });
        await tick();
        const [{ default: JsPDF }, { default: autoTable }] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
        const doc = new JsPDF();
        doc.setFontSize(16);
        doc.text(`${paperName} - Answer key`, 14, 16);
        autoTable(doc, { head: [head], body: rows, startY: 22, styles: { fontSize: 10 } });
        setJob({ stage: "Saving the file", percent: 95 });
        await tick();
        doc.save(`${fileBase}.pdf`);
      }
      setJob({ stage: "Done", percent: 100 });
      await new Promise((r) => setTimeout(r, 600));
    } catch {
      setError("The answer key could not be created. Please try again.");
    } finally {
      setJob(null);
    }
  };

  const none = questions.length === 0;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" className="min-h-11" disabled={none || !!job} onClick={() => run("csv")}>
          <Download className="mr-2 h-4 w-4" aria-hidden="true" />Answer key (CSV)
        </Button>
        <Button type="button" variant="outline" className="min-h-11" disabled={none || !!job} onClick={() => run("pdf")}>
          <Download className="mr-2 h-4 w-4" aria-hidden="true" />Answer key (PDF)
        </Button>
      </div>
      {job && <ProgressPanel stage={job.stage} percent={job.percent} />}
      {error && <p role="alert" className="text-sm font-medium text-destructive">{error}</p>}
    </div>
  );
}
