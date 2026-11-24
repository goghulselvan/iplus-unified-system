import type { OmrErrorKind, OmrUploadError } from "@/hooks/results/useOmrUpload";

export interface OmrErrorGroup { kind: OmrErrorKind; title: string; fix: string; detail: string }

const ORDER: OmrErrorKind[] = ["file", "unread", "not_in_crm", "duplicate", "manual_class", "no_slot", "short", "bad_answer"];
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
  const out: OmrErrorGroup[] = [];
  for (const kind of ORDER) {
    const list = by.get(kind);
    if (!list) continue;
    const n = new Set(rowsOf(list)).size;
    switch (kind) {
      case "unread":
        out.push({ kind, title: `${plural(n, "row has", "rows have")} no readable roll number`,
          fix: "Type the student's 12-digit roll number from their OMR sheet into these rows.",
          detail: `Rows ${rowList(rowsOf(list))}` });
        break;
      case "not_in_crm":
        out.push({ kind, title: `${plural(n, "roll number is", "roll numbers are")} not in the CRM`,
          fix: "Add these students to their school in the CRM (or correct a wrongly shaded roll number), then upload this file again.",
          detail: regList(list.map((e) => e.reg ?? "")) + ` (rows ${rowList(rowsOf(list))})` });
        break;
      case "duplicate":
        out.push({ kind, title: `${plural(n, "row repeats", "rows repeat")} a roll number`,
          fix: "Each answer sheet should appear once. Remove the extra row or correct the roll number.",
          detail: `Rows ${rowList(rowsOf(list))}` });
        break;
      case "manual_class":
        out.push({ kind, title: `${plural(n, "row is", "rows are")} for LKG to Class 2`,
          fix: "These classes are marked by hand. Remove them from this file and upload their marks on the Manual tab.",
          detail: `Rows ${rowList(rowsOf(list))}` });
        break;
      case "no_slot":
        out.push({ kind, title: `${plural(n, "student's school has", "students' schools have")} no clear exam slot`,
          fix: "Set the school's exam slot (Slot 1 or Slot 2) in the CRM, then upload this file again.",
          detail: `Rows ${rowList(rowsOf(list))}` });
        break;
      case "short":
        out.push({ kind, title: `${plural(n, "row has", "rows have")} too few question columns`,
          fix: "Export the file again from the OMR software with every question column.",
          detail: `Rows ${rowList(rowsOf(list))}` });
        break;
      case "bad_answer":
        out.push({ kind, title: `${plural(list.length, "answer is", "answers are")} not A, B, C, D, MULTIPLE or blank`,
          fix: "Correct these cells from the student's OMR sheet.",
          detail: `Rows ${rowList(rowsOf(list))}` });
        break;
    }
  }
  return out;
}
