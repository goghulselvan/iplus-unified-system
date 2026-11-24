import { describe, expect, it } from "vitest";
import { omrErrorGroups } from "../omrErrors";
import type { OmrUploadError } from "@/hooks/results/useOmrUpload";

const e = (row: number, kind: OmrUploadError["kind"], reg: string | null = null): OmrUploadError =>
  ({ row, kind, reg, message: `Row ${row}` });

describe("omrErrorGroups", () => {
  it("groups the sample file's problems with a fix for each", () => {
    const g = omrErrorGroups([
      e(15, "unread", "REVIEW"), e(2, "not_in_crm", "433380307029"), e(20, "unread", "REVIEW"), e(3, "not_in_crm", "433380307011"),
    ]);
    expect(g.map((x) => x.kind)).toEqual(["unread", "not_in_crm"]);
    expect(g[0].title).toBe("2 rows have no readable roll number");
    expect(g[0].detail).toBe("Rows 15, 20");
    expect(g[1].title).toBe("2 roll numbers are not in the CRM");
    expect(g[1].fix).toMatch(/Add these students to their school/);
    expect(g[1].detail).toBe("433380307029, 433380307011 (rows 2, 3)");
  });
  it("counts bad answers by cell and leaves file-level errors to the list", () => {
    const g = omrErrorGroups([e(4, "bad_answer"), e(4, "bad_answer"), e(0, "file")]);
    expect(g).toHaveLength(1);
    expect(g[0].title).toBe("2 answers are not A, B, C, D, MULTIPLE or blank");
    expect(g[0].detail).toBe("Rows 4");
  });
  it("uses singular wording for one row", () => {
    expect(omrErrorGroups([e(9, "no_slot")])[0].title).toBe("1 student's school has no clear exam slot");
  });
});
