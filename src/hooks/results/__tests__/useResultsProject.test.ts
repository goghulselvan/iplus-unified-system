import { describe, expect, it, vi } from "vitest";
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
import { pickResultsProject } from "../useResultsProject";
import type { OlympiadProject } from "@/hooks/useOlympiadProjects";

const p = (id: string) => ({ id, project_name: id, project_year: 2026, is_active: true }) as OlympiadProject;

describe("pickResultsProject", () => {
  it("uses the only active project without asking", () => {
    expect(pickResultsProject([p("a")], null)).toEqual({ project: p("a"), needsChoice: false });
  });
  it("asks when more than one project is active and none is chosen", () => {
    expect(pickResultsProject([p("a"), p("b")], null)).toEqual({ project: null, needsChoice: true });
  });
  it("uses the chosen project when it is still active", () => {
    expect(pickResultsProject([p("a"), p("b")], "b")).toEqual({ project: p("b"), needsChoice: false });
  });
  it("asks again when the chosen project is no longer active", () => {
    expect(pickResultsProject([p("a"), p("b")], "old").needsChoice).toBe(true);
  });
  it("shows nothing when no project is active", () => {
    expect(pickResultsProject([], "a")).toEqual({ project: null, needsChoice: false });
  });
});
