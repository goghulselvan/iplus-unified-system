import { newDoc, finish, table, infoGrid, pct } from "./common";
import type { SchoolRankingInput } from "./types";

const r = (n: number | null) => (n == null ? "-" : n);

export async function generateSchoolRanking(input: SchoolRankingInput): Promise<Blob> {
  const ctx = await newDoc("School Ranking");
  infoGrid(ctx, [["School", input.school.name], ["Students", String(input.rows.length)]]);
  table(ctx, {
    head: ["#", "Student", "Reg. No", "Class", "Olympiad", "Score", "%", "Grade", "Sch", "Dist", "State", "India"],
    body: input.rows.map((x, i) => [
      i + 1, x.name, x.regNo, x.className, x.olympiad, x.score, pct(x.percentage), x.grade,
      r(x.schoolRank), r(x.districtRank), r(x.stateRank), r(x.allIndiaRank),
    ]),
    fontSize: 8.5,
    columnStyles: {
      0: { cellWidth: 8, halign: "center" }, 5: { halign: "center" }, 6: { halign: "center" }, 7: { halign: "center", cellWidth: 14 },
      8: { halign: "center", cellWidth: 9 }, 9: { halign: "center", cellWidth: 10 }, 10: { halign: "center", cellWidth: 11 }, 11: { halign: "center", cellWidth: 11 },
    },
  });
  return finish(ctx, input.school.name);
}
