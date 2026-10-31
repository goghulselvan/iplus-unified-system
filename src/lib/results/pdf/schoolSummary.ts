import { newDoc, finish, infoGrid, sectionTitle, table, tiles, paragraph, schoolGrade, pct1 } from "./common";
import type { SchoolSummaryInput } from "./types";

export async function generateSchoolSummary(input: SchoolSummaryInput): Promise<Blob> {
  const { school, tiles: t, rows, aiAnalysis } = input;
  const ctx = await newDoc("School Performance Summary");
  infoGrid(ctx, [
    ["School", school.name],
    ["SS No", school.ssNo ?? "-"],
    ["City", school.city ?? "-"],
    ["District", school.district ?? "-"],
    ["State", school.state ?? "-"],
  ]);
  const g = schoolGrade(t.averagePct);
  tiles(ctx, [
    { label: "Enrolled", value: String(t.enrolled) },
    { label: "Evaluated", value: String(t.evaluated) },
    { label: "Absent", value: String(t.absent) },
    { label: "School average", value: pct1(t.averagePct) },
    { label: "School grade", value: t.schoolGrade ?? g.grade, color: g.color, sub: t.schoolGradeLabel ?? g.label },
    { label: "State average", value: pct1(t.stateAveragePct) },
  ]);
  sectionTitle(ctx, "Class and olympiad breakdown");
  table(ctx, {
    head: ["Class", "Olympiad", "Enrolled", "Evaluated", "Average", "State avg"],
    body: rows.map((r) => [r.className, r.olympiad, r.enrolled, r.evaluated, pct1(r.averagePct), pct1(r.stateAveragePct)]),
    columnStyles: { 2: { halign: "center" }, 3: { halign: "center" }, 4: { halign: "center" }, 5: { halign: "center" } },
  });
  if (aiAnalysis && aiAnalysis.trim()) {
    sectionTitle(ctx, "Analysis");
    for (const p of aiAnalysis.split(/\n{1,}/).filter((x) => x.trim())) paragraph(ctx, p);
  }
  return finish(ctx, school.name);
}
