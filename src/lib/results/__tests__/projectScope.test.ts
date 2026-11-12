import { describe, expect, it } from "vitest";
import { copyScopeProblem, otherProjectNotice, projectLabel } from "../projectScope";

const paper = (id: string, project_id: string, class_code = "03", olympiad_code = "MPO") => ({ id, project_id, class_code, olympiad_code });

describe("projectLabel", () => {
  it("names the project and year", () => {
    expect(projectLabel({ project_name: "iPlus Olympiads", project_year: 2026 })).toBe("iPlus Olympiads (2026)");
  });
  it("is null when there is no project", () => {
    expect(projectLabel(null)).toBeNull();
    expect(projectLabel({ project_name: "" })).toBeNull();
  });
});

describe("otherProjectNotice", () => {
  it("says nothing when the item is in the active project", () => {
    expect(otherProjectNotice("p26", "p26", "2026", "student")).toBeNull();
  });
  it("says nothing when either project is unknown", () => {
    expect(otherProjectNotice(undefined, "p25", "2025", "student")).toBeNull();
    expect(otherProjectNotice("p26", null, null, "paper")).toBeNull();
  });
  it("warns when a linked student is from another project", () => {
    const t = otherProjectNotice("p26", "p25", "iPlus Olympiad 2025", "student");
    expect(t).toContain('This student belongs to "iPlus Olympiad 2025"');
    expect(t).toContain("from \"iPlus Olympiad 2025\" only");
  });
});

describe("copyScopeProblem (Copy from Slot 1)", () => {
  it("allows the same project, class and olympiad", () => {
    expect(copyScopeProblem(paper("a", "p26"), paper("b", "p26"))).toBeNull();
  });
  it("refuses a source paper from another project", () => {
    expect(copyScopeProblem(paper("a", "p25"), paper("b", "p26"))).toMatch(/same olympiad project/);
  });
  it("refuses another class or subject", () => {
    expect(copyScopeProblem(paper("a", "p26", "04"), paper("b", "p26"))).toMatch(/same class and subject/);
    expect(copyScopeProblem(paper("a", "p26", "03", "EPO"), paper("b", "p26"))).toMatch(/same class and subject/);
  });
  it("refuses a missing paper or a copy onto itself", () => {
    expect(copyScopeProblem(null, paper("b", "p26"))).toMatch(/could not be found/);
    expect(copyScopeProblem(paper("b", "p26"), paper("b", "p26"))).toMatch(/onto itself/);
  });
});
