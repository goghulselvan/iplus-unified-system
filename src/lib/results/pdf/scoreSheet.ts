import { newDoc, finish, infoGrid, sectionTitle, table, tiles, studentGrade, ordinalOf, pct1, type RGB } from "./common";
import type { ScoreSheetInput } from "./types";

const GREEN: RGB = [21, 128, 61];
const RED: RGB = [220, 38, 38];
const AMBER: RGB = [202, 138, 4];

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
    { label: "Score", value: `${score.total} / ${score.max}`, sub: pct1(score.percentage) },
    { label: "Grade", value: score.grade ?? g.grade, color: g.color, sub: score.gradeLabel ?? g.label },
    { label: "School rank", value: ordinalOf(score.ranks.school.rank, score.ranks.school.of) },
    { label: "District rank", value: ordinalOf(score.ranks.district.rank, score.ranks.district.of) },
    { label: "State rank", value: ordinalOf(score.ranks.state.rank, score.ranks.state.of) },
    { label: "All-India rank", value: ordinalOf(score.ranks.allIndia.rank, score.ranks.allIndia.of) },
  ]);
  sectionTitle(ctx, "Question-wise result");
  table(ctx, {
    head: ["Q", "Your answer", "Correct answer", "Result", "Skill"],
    body: questions.map((q) => [
      q.number,
      q.studentAnswer && q.studentAnswer.trim() ? q.studentAnswer : "-",
      q.correctAnswer,
      q.result,
      q.skill,
    ]),
    columnStyles: { 0: { cellWidth: 12, halign: "center" }, 3: { cellWidth: 24, halign: "center" } },
    cellColor: (_r, c, raw) => (c === 3 ? (raw === "Correct" ? GREEN : raw === "Wrong" ? RED : AMBER) : null),
  });
  return finish(ctx, s.name);
}
