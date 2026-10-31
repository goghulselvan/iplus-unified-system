import { newDoc, finish, infoGrid, table, tiles, sectionTitle, studentGrade, ordinalOf, pct, MARGIN, PAGE_W, TOP, type RGB } from "./common";
import type { ScoreSheetInput } from "./types";

const GREEN: RGB = [21, 128, 61];
const RED: RGB = [220, 38, 38];
const AMBER: RGB = [202, 138, 4];
const PER_BLOCK = 30;

export async function generateScoreSheet(input: ScoreSheetInput): Promise<Blob> {
  const { student: s, score, questions } = input;
  const ctx = await newDoc("Score Sheet");
  infoGrid(ctx, [
    ["Student", s.name],
    ["Reg. No", s.regNo],
    ["School", s.schoolName],
    ["Class", s.className],
    ["Olympiad", s.olympiad],
    ["Exam", s.examLabel ?? "-"],
  ]);
  const g = studentGrade(score.percentage);
  tiles(ctx, [
    { label: "Score", value: `${score.total} / ${score.max}`, sub: pct(score.percentage) },
    { label: "Grade", value: score.grade ?? g.grade, color: g.color, sub: score.gradeLabel ?? g.label },
    { label: "School rank", value: ordinalOf(score.ranks.school.rank, score.ranks.school.of) },
    { label: "District rank", value: ordinalOf(score.ranks.district.rank, score.ranks.district.of) },
    { label: "State rank", value: ordinalOf(score.ranks.state.rank, score.ranks.state.of) },
    { label: "All-India rank", value: ordinalOf(score.ranks.allIndia.rank, score.ranks.allIndia.of) },
  ]);
  sectionTitle(ctx, "Question-wise result");

  // Blocks of 30 questions; two blocks side by side, so 60 questions fit on one page.
  const blocks: (typeof questions)[] = [];
  for (let i = 0; i < questions.length; i += PER_BLOCK) blocks.push(questions.slice(i, i + PER_BLOCK));
  const gap = 4;
  const half = (PAGE_W - MARGIN * 2 - gap) / 2;
  for (let b = 0; b < blocks.length; b += 2) {
    if (b > 0) { ctx.doc.addPage(); ctx.y = TOP; }
    const startY = ctx.y;
    let maxY = startY;
    for (let k = 0; k < 2 && blocks[b + k]; k++) {
      const left = MARGIN + k * (half + gap);
      const blk = blocks[b + k];
      const fy = table(ctx, {
        head: ["Q", "Yours", "Key", "Result", "Skill"],
        body: blk.map((q) => [q.number, q.studentAnswer && q.studentAnswer.trim() ? q.studentAnswer : "-", q.correctAnswer, q.result, q.skill]),
        fontSize: 8,
        padding: 0.8,
        ellipsize: true,
        startY,
        margin: { left, right: PAGE_W - left - half },
        noAdvance: true,
        columnStyles: { 0: { cellWidth: 8, halign: "center" }, 1: { cellWidth: 14 }, 2: { cellWidth: 13 }, 3: { cellWidth: 16, halign: "center" } },
        // colour from the raw result glyph, not from rewritten text
        cellColor: (r, c) => (c === 3 ? (blk[r].result === "✓" ? GREEN : blk[r].result === "✗" ? RED : AMBER) : null),
      });
      maxY = Math.max(maxY, fy);
    }
    ctx.y = maxY;
  }
  return finish(ctx, s.name);
}
