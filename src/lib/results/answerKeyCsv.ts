import { isLetter, type Letter } from "./questionRow";

export interface ParsedKey {
  answers: Record<number, Letter>;
  /** Plain-English row problems; the key must not be saved while any exist. */
  errors: string[];
  /** Questions in the paper that the file does not mention. */
  missing: number[];
}

export function keyTemplateCsv(total: number): string {
  const rows = ["question_number,answer"];
  for (let n = 1; n <= total; n++) rows.push(`${n},`);
  return rows.join("\r\n") + "\r\n";
}

function splitLine(line: string): string[] {
  return line.split(",").map((c) => c.trim().replace(/^"(.*)"$/, "$1").trim());
}

export function parseKeyCsv(text: string, total: number): ParsedKey {
  const answers: Record<number, Letter> = {};
  const errors: string[] = [];
  const lines = text.replace(/^﻿/, "").split(/\r\n|\n|\r/);
  let seenData = false;
  lines.forEach((raw, i) => {
    if (!raw.trim()) return;
    const [num = "", ans = ""] = splitLine(raw);
    const rowNo = i + 1;
    if (!seenData && !/^\d+$/.test(num)) { seenData = true; return; } // header row
    seenData = true;
    if (!/^\d+$/.test(num)) return void errors.push(`Row ${rowNo}: "${num}" is not a question number.`);
    const n = Number(num);
    if (n < 1 || n > total) return void errors.push(`Row ${rowNo}: question ${n} is not in this paper (it has ${total} questions).`);
    if (!ans) return; // blank answer: leave this question without a key
    const letter = ans.toUpperCase();
    if (!isLetter(letter)) return void errors.push(`Row ${rowNo}: "${ans}" is not a valid answer for question ${n}. Use A, B, C or D.`);
    if (answers[n]) return void errors.push(`Row ${rowNo}: question ${n} appears more than once.`);
    answers[n] = letter;
  });
  const missing: number[] = [];
  for (let n = 1; n <= total; n++) if (!answers[n]) missing.push(n);
  return { answers, errors, missing };
}
