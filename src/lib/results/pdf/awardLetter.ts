import { newDoc, finish, paragraph, table, setFont, txt, MARGIN, DARK } from "./common";
import type { AwardLetterInput } from "./types";

export async function generateAwardLetter(input: AwardLetterInput): Promise<Blob> {
  const { school, awardees } = input;
  const ctx = await newDoc("Award Letter");
  setFont(ctx.doc, 11, false, DARK);
  txt(ctx.doc, (input.date ?? new Date()).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" }), MARGIN, ctx.y);
  ctx.y += 9;
  paragraph(ctx, "To,", { gap: 0.5 });
  paragraph(ctx, school.principal ? `The Principal (${school.principal})` : "The Principal", { gap: 0.5 });
  paragraph(ctx, school.name, { bold: true, gap: 0.5 });
  if (school.city) paragraph(ctx, school.city);
  ctx.y += 3;
  paragraph(ctx, "Subject: Awards - iPlus Olympiads 2026", { bold: true, gap: 4 });
  paragraph(ctx, "Dear Sir/Madam,");
  paragraph(
    ctx,
    `We are pleased to inform you that the following students of ${school.name} have been selected for awards in iPlus Olympiads 2026. Congratulations to the students, their teachers and your school.`,
    { gap: 4 },
  );
  table(ctx, {
    head: ["#", "Student", "Class", "Olympiad", "Award"],
    body: awardees.map((a, i) => [i + 1, a.name, a.className, a.olympiad, a.award]),
    columnStyles: { 0: { cellWidth: 9, halign: "center" } },
  });
  paragraph(ctx, "Details of the award distribution will be shared with you separately. We wish all the students continued success.", { gap: 6 });
  paragraph(ctx, "Warm regards,", { gap: 0.5 });
  paragraph(ctx, "iPlus Olympiads Team", { bold: true });
  return finish(ctx, school.name);
}
