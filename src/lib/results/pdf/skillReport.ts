import { newDoc, finish, infoGrid, sectionTitle, table, paragraph, pct1 } from "./common";
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
    head: ["Skill", "Correct", "Total", "Percentage"],
    body: skills.map((k) => [k.skill, k.correct, k.total, pct1(k.percentage)]),
    columnStyles: { 1: { cellWidth: 24, halign: "center" }, 2: { cellWidth: 24, halign: "center" }, 3: { cellWidth: 30, halign: "center" } },
  });
  if (feedback) {
    sectionTitle(ctx, "Overall feedback");
    paragraph(ctx, feedback.overall);
    if (feedback.strengths?.length) {
      sectionTitle(ctx, "Strengths");
      for (const x of feedback.strengths) {
        paragraph(ctx, x.skill, { bold: true, gap: 0.5 });
        paragraph(ctx, x.feedback, { indent: 3 });
      }
    }
    if (feedback.focus_areas?.length) {
      sectionTitle(ctx, "Areas to focus on");
      for (const x of feedback.focus_areas) {
        paragraph(ctx, x.skill, { bold: true, gap: 0.5 });
        paragraph(ctx, x.feedback, { indent: 3 });
      }
    }
    if (feedback.tips?.length) {
      sectionTitle(ctx, "Study tips");
      for (const t of feedback.tips) paragraph(ctx, "- " + t, { indent: 2 });
    }
    if (feedback.goals?.length) {
      sectionTitle(ctx, "Goals");
      for (const t of feedback.goals) paragraph(ctx, "- " + t, { indent: 2 });
    }
  }
  return finish(ctx, s.name);
}
