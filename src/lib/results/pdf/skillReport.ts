import { newDoc, finish, infoGrid, sectionTitle, table, paragraph, pct, bandColor } from "./common";
import type { SkillReportInput } from "./types";

export async function generateSkillReport(input: SkillReportInput): Promise<Blob> {
  const { student: s, skills, feedback } = input;
  const ctx = await newDoc("Skill Report");
  infoGrid(ctx, [
    ["Student", s.name],
    ["Reg. No", s.regNo],
    ["School", s.schoolName],
    ["Class", s.className],
    ["Olympiad", s.olympiad],
    ["Exam", s.examLabel ?? "-"],
  ]);
  sectionTitle(ctx, "Skill-wise performance");
  table(ctx, {
    head: ["Skill", "Correct", "Total", "%", "Performance"],
    body: skills.map((k) => [k.skill, k.correct, k.total, pct(k.percentage), ""]),
    columnStyles: {
      1: { cellWidth: 20, halign: "center" }, 2: { cellWidth: 18, halign: "center" }, 3: { cellWidth: 18, halign: "center" }, 4: { cellWidth: 60 },
    },
    drawCell: (doc, r, c, x, y, w, h) => {
      if (c !== 4) return;
      const p = Math.max(0, Math.min(100, skills[r].percentage));
      doc.setFillColor(232, 234, 240);
      doc.rect(x + 1.5, y + h / 2 - 1.8, w - 3, 3.6, "F");
      doc.setFillColor(...bandColor(p));
      doc.rect(x + 1.5, y + h / 2 - 1.8, ((w - 3) * p) / 100, 3.6, "F");
    },
  });
  const f = feedback;
  if (f) {
    if (f.overall?.trim()) { sectionTitle(ctx, "Overall feedback"); paragraph(ctx, f.overall); }
    const block = (title: string, items?: { skill: string; feedback: string }[]) => {
      if (!items?.length) return;
      sectionTitle(ctx, title);
      for (const x of items) { paragraph(ctx, x.skill, { bold: true, gap: 0.5 }); paragraph(ctx, x.feedback, { indent: 3 }); }
    };
    const list = (title: string, items?: string[]) => {
      if (!items?.length) return;
      sectionTitle(ctx, title);
      for (const t of items) paragraph(ctx, "- " + t, { indent: 2 });
    };
    block("Strengths", f.strengths);
    block("Areas to focus on", f.focus_areas);
    list("Study tips", f.tips);
    list("Goals", f.goals);
  }
  return finish(ctx, s.name);
}
