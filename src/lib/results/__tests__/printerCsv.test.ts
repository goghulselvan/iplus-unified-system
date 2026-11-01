import { describe, it, expect } from "vitest";
import { printerCsv, PRINTER_CSV_HEADER, courierPackData, schoolCodeFromReg } from "../printerCsv";

const row = { regNumber: "133210307001", name: "V Mithun, Kiruthik", className: "Class 7", olympiad: "English", school: 'The "Best" School', award: "Gold" };

describe("printerCsv", () => {
  it("has the six printer columns in order", () => {
    expect(PRINTER_CSV_HEADER).toEqual(["Reg no", "Name", "Class", "Olympiad", "School", "Award"]);
    expect(printerCsv([row]).split("\r\n")[0]).toBe("Reg no,Name,Class,Olympiad,School,Award");
  });
  it("formats the registration number and quotes commas and quotes", () => {
    const line = printerCsv([row]).split("\r\n")[1];
    expect(line).toBe('1-33-21-03-07-001,"V Mithun, Kiruthik",Class 7,English,"The ""Best"" School",Gold');
  });
  it("neutralises formula-looking names", () => {
    expect(printerCsv([{ ...row, name: "=HYPERLINK(1)" }])).toContain("'=HYPERLINK(1)");
  });
  it("is header only for no rows", () => {
    expect(printerCsv([])).toBe("Reg no,Name,Class,Olympiad,School,Award\r\n");
  });
});

describe("courierPackData", () => {
  const a = (n: string, reg: string, c: string, s: string) => ({
    schoolId: "s1", schoolName: "Kalaivani School", district: "Ramanathapuram", ssNo: 46, regNumber: reg, name: n, classCode: c, olympiad: s,
  });
  it("matches the schools.json shape", () => {
    const out = courierPackData([a("A", "133210307001", "07", "EPO"), a("B", "133210307002", "07", "EPO"), a("C", "433210306006", "06", "GKSSPO")]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: "s1", name: "Kalaivani School", district: "Ramanathapuram", ss_no: 46, school_code: "332103", students: 3, qp: 3, omr: 0, unpaid: 0 });
    expect(out[0].cells).toEqual([{ c: "06", n: 1, s: "GKSSPO" }, { c: "07", n: 2, s: "EPO" }]);
    expect(out[0].roster[0]).toEqual({ c: "07", n: "A", r: "1-33-21-03-07-001", s: "EPO" });
  });
  it("derives the school code from the registration number", () => {
    expect(schoolCodeFromReg("1-33-21-03-07-001")).toBe("332103");
    expect(schoolCodeFromReg("123")).toBeNull();
  });
});

import { csvCell } from "../rankingsCsv";
describe("csvCell formula guard", () => {
  it.each(["=1+1", "+1", "-1", "@a", "\tx", "\rx"])("neutralises %j", (v) => {
    expect(csvCell(v).replace(/^"/, "").startsWith("'")).toBe(true);
  });
});
