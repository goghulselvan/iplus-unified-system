import { newDoc, finish, infoGrid, sectionTitle, table, tiles, paragraph, schoolGrade, pct, vsState } from "./common";
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
    { label: "School average", value: pct(t.averagePct), sub: vsState(t.averagePct, t.stateAveragePct) },
    { label: "School grade", value: t.schoolGrade ?? g.grade, color: g.color, sub: t.schoolGradeLabel ?? g.label },
    { label: "State average", value: pct(t.stateAveragePct) },
  ]);
  sectionTitle(ctx, "Class and olympiad breakdown");
  table(ctx, {
    head: ["Class", "Olympiad", "Enrolled", "Evaluated", "Average", "State avg", "vs state"],
    body: rows.map((r) => [r.className, r.olympiad, r.enrolled, r.evaluated, pct(r.averagePct), pct(r.stateAveragePct), vsState(r.averagePct, r.stateAveragePct, true)]),
    columnStyles: { 2: { halign: "center" }, 3: { halign: "center" }, 4: { halign: "center" }, 5: { halign: "center" }, 6: { halign: "center" } },
  });
  if (aiAnalysis && aiAnalysis.trim()) {
    sectionTitle(ctx, "Analysis");
    // plain text only: strip markdown markers (headings, bold, bullets)
    const clean = aiAnalysis.replace(/^\s{0,3}#{1,6}\s*/gm, "").replace(/\*\*|__|`/g, "").replace(/^\s*[-*]\s+/gm, "- ");
    for (const p of clean.split(/\n+/).filter((x) => x.trim())) paragraph(ctx, p);
  }
  return finish(ctx, school.name);
}
