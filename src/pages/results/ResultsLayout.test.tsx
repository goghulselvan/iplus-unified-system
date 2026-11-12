import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/components/layout/Navbar", () => ({ default: () => null }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ profile: { role: "manager" }, loading: false }) }));
const active = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/useOlympiadProjects", () => ({ useActiveProject: () => active() }));
// The sub-pages are not under test here.
vi.mock("./SkillAnalysisPage", () => ({ default: () => null }));
vi.mock("./ResultsDashboard", () => ({ default: () => null }));
vi.mock("./QuestionPapersPage", () => ({ default: () => null, PaperEditorRoute: () => null }));
vi.mock("./UploadAnswersPage", () => ({ default: () => null }));
vi.mock("./StudentsPage", () => ({ default: () => null }));
vi.mock("./StudentResultPage", () => ({ default: () => null }));
vi.mock("./RankingsPage", () => ({ default: () => null }));
vi.mock("./SchoolResultsPage", () => ({ default: () => null }));
vi.mock("./SchoolResultDetailPage", () => ({ default: () => null }));
vi.mock("./ReleaseSendPage", () => ({ default: () => null }));
vi.mock("./IntegrityPage", () => ({ default: () => null }));
vi.mock("./AwardsPage", () => ({ default: () => null }));

import ResultsLayout from "./ResultsLayout";

afterEach(cleanup);

describe("ResultsLayout project indicator", () => {
  it("shows which olympiad project the Results pages are for", () => {
    active.mockReturnValue({ data: { id: "p26", project_name: "iPlus Olympiads", project_year: 2026 } });
    render(<MemoryRouter initialEntries={["/results"]}><ResultsLayout /></MemoryRouter>);
    expect(screen.getByTestId("results-project").textContent).toBe("iPlus Olympiads (2026)");
    expect(screen.getByText(/for iPlus Olympiads \(2026\) only/)).toBeTruthy();
  });

  it("shows no project badge when there is no active project", () => {
    active.mockReturnValue({ data: null });
    render(<MemoryRouter initialEntries={["/results"]}><ResultsLayout /></MemoryRouter>);
    expect(screen.queryByTestId("results-project")).toBeNull();
  });
});
