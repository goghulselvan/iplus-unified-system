import type { OmrErrorKind, OmrUploadError } from "@/hooks/results/useOmrUpload";

export interface OmrErrorGroup { kind: OmrErrorKind; title: string; fix: string; detail: string }

const ORDER: OmrErrorKind[] = ["file", "unread", "not_in_crm", "duplicate", "manual_class", "omr_class", "no_slot", "short", "bad_answer", "bad_mark", "bad_total"];
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const rowList = (rows: number[]) => {
  const u = [...new Set(rows)].sort((a, b) => a - b);
  return u.length > 30 ? `${u.slice(0, 30).join(", ")} and ${u.length - 30} more` : u.join(", ");
};
const regList = (regs: string[]) => {
  const u = [...new Set(regs)];
  return u.length > 15 ? `${u.slice(0, 15).join(", ")} and ${u.length - 15} more` : u.join(", ");
};

/** One plain-English summary per kind of problem, with what staff should do about it. */
export function omrErrorGroups(errors: OmrUploadError[]): OmrErrorGroup[] {
  const by = new Map<OmrErrorKind, OmrUploadError[]>();
  for (const e of errors) {
    if (e.kind === "file") continue;
    by.set(e.kind, [...(by.get(e.kind) ?? []), e]);
  }
  const rowsOf = (list: OmrUploadError[]) => list.map((e) => e.row);
  // Manual files have several sheets: name the sheet with its rows.
  const where = (list: OmrUploadError[]) => {
    if (!list.some((e) => e.sheet)) return `Rows ${rowList(rowsOf(list))}`;
    const bySheet = new Map<string, number[]>();
    for (const e of list) bySheet.set(e.sheet ?? "", [...(bySheet.get(e.sheet ?? "") ?? []), e.row]);
    return [...bySheet].map(([sh, rows]) => `${sh ? `Sheet "${sh}"` : "Rows"}: rows ${rowList(rows)}`).join("; ");
  };
  const out: OmrErrorGroup[] = [];
  for (const kind of ORDER) {
    const list = by.get(kind);
    if (!list) continue;
    const n = new Set(rowsOf(list)).size;
    switch (kind) {
      case "omr_class":
        out.push({ kind, title: `${plural(n, "row is", "rows are")} for Class 3 or above`,
          fix: "These classes use OMR sheets. Remove them from this file and upload them on the OMR tab.",
          detail: where(list) });
        break;
      case "bad_mark":
        out.push({ kind, title: `${plural(list.length, "mark is", "marks are")} not 0, 0.5 or 1`,
          fix: "Correct these cells from the marked answer sheet.",
          detail: where(list) });
        break;
      case "bad_total":
        out.push({ kind, title: `${plural(n, "total is", "totals are")} not allowed`,
          fix: "A total must be a number from 0 to the number of questions (30 or 40), in steps of 0.5.",
          detail: where(list) });
        break;
      case "unread":
        out.push({ kind, title: `${plural(n, "row has", "rows have")} no readable roll number`,
          fix: "Type the student's 12-digit roll number from their OMR sheet into these rows.",
          detail: where(list) });
        break;
      case "not_in_crm":
        out.push({ kind, title: `${plural(n, "roll number is", "roll numbers are")} not in the CRM`,
          fix: "Add these students to their school in the CRM (or correct a wrongly shaded roll number), then upload this file again.",
          detail: `${regList(list.map((e) => e.reg ?? ""))} (${where(list).replace(/^Rows /, "rows ")})` });
        break;
      case "duplicate":
        out.push({ kind, title: `${plural(n, "row repeats", "rows repeat")} a roll number`,
          fix: "Each answer sheet should appear once. Remove the extra row or correct the roll number.",
          detail: where(list) });
        break;
      case "manual_class":
        out.push({ kind, title: `${plural(n, "row is", "rows are")} for LKG to Class 2`,
          fix: "These classes are marked by hand. Remove them from this file and upload their marks on the Manual tab.",
          detail: where(list) });
        break;
      case "no_slot":
        out.push({ kind, title: `${plural(n, "student's school has", "students' schools have")} no clear exam slot`,
          fix: "Set the school's exam slot (Slot 1 or Slot 2) in the CRM, then upload this file again.",
          detail: where(list) });
        break;
      case "short":
        out.push({ kind, title: `${plural(n, "row has", "rows have")} too few question columns`,
          fix: "Export the file again from the OMR software with every question column.",
          detail: where(list) });
        break;
      case "bad_answer":
        out.push({ kind, title: `${plural(list.length, "answer is", "answers are")} not A, B, C, D, MULTIPLE or blank`,
          fix: "Correct these cells from the student's OMR sheet.",
          detail: where(list) });
        break;
    }
  }
  return out;
}
