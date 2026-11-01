import { NavLink, Route, Routes, useLocation } from "react-router-dom";
import Navbar from "@/components/layout/Navbar";
import { Card, CardContent } from "@/components/ui/card";
import { Lock } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { RESULTS_NAV, isNavLive } from "@/lib/results/nav";
import ComingSoon from "./ComingSoon";
import ResultsDashboard from "./ResultsDashboard";
import QuestionPapersPage, { PaperEditorRoute } from "./QuestionPapersPage";
import UploadAnswersPage from "./UploadAnswersPage";
import StudentsPage from "./StudentsPage";
import StudentResultPage from "./StudentResultPage";
import RankingsPage from "./RankingsPage";
import SchoolResultsPage from "./SchoolResultsPage";
import SchoolResultDetailPage from "./SchoolResultDetailPage";
import IntegrityPage from "./IntegrityPage";
import AwardsPage from "./AwardsPage";

const linkClass = (active: boolean) =>
  `flex items-center whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
    active ? "bg-primary text-primary-foreground" : "text-foreground/80 hover:bg-muted"
  }`;

export default function ResultsLayout() {
  const { profile, loading } = useAuth();
  const location = useLocation();
  const allowed = profile?.role === "manager" || profile?.role === "superadmin";
  const current = RESULTS_NAV.find(
    (n) => n.path === location.pathname || (n.path !== "/results" && location.pathname.startsWith(n.path + "/")),
  );

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="container mx-auto max-w-7xl px-4 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold">Results</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Question papers, student marks, rankings and reports for the olympiad.
          </p>
        </div>
        {loading ? null : !allowed ? (
          <Card>
            <CardContent className="flex items-center gap-3 py-10">
              <Lock className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
              <p className="text-base">Only managers can open Results. Ask a manager if you need something from here.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="flex flex-col gap-6 md:flex-row">
            <nav aria-label="Results sections" className="md:w-60 md:shrink-0">
              <ul className="-mx-4 flex gap-1 overflow-x-auto px-4 pb-2 md:mx-0 md:flex-col md:overflow-visible md:px-0 md:pb-0">
                {RESULTS_NAV.filter((n) => !n.hidden).map((n) => (
                  <li key={n.key} className="shrink-0">
                    <NavLink to={n.path} end={n.path === "/results"} className={({ isActive }) => linkClass(isActive)}>
                      {n.label}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </nav>
            <section className="min-w-0 flex-1">
              {current && <h2 className="mb-4 text-xl font-semibold">{current.label}</h2>}
              <Routes>
                <Route index element={<ResultsDashboard />} />
                <Route path="papers" element={<QuestionPapersPage />} />
                <Route path="papers/:paperId" element={<PaperEditorRoute />} />
                <Route path="upload" element={<UploadAnswersPage />} />
                <Route path="students" element={<StudentsPage />} />
                <Route path="students/:enrollmentId" element={<StudentResultPage />} />
                <Route path="rankings" element={<RankingsPage />} />
                <Route path="schools" element={<SchoolResultsPage />} />
                <Route path="schools/:schoolId" element={<SchoolResultDetailPage />} />
                <Route path="integrity" element={<IntegrityPage />} />
                <Route path="awards" element={<AwardsPage />} />
                {RESULTS_NAV.filter((n) => n.path !== "/results" && !["papers", "rankings", "schools", "upload", "students", "student", "integrity", "awards"].includes(n.key)).map((n) => (
                  <Route
                    key={n.key}
                    path={n.path.replace("/results/", "") + (n.key === "schools" || n.key === "student" ? "/*" : "")}
                    element={
                      isNavLive(n) ? (
                        <ComingSoon title={n.label} summary={n.summary} headline="This page is being built" />
                      ) : (
                        <ComingSoon title={n.label} summary={n.summary} />
                      )
                    }
                  />
                ))}
                <Route
                  path="*"
                  element={<ComingSoon title="Page not found" headline="There is nothing at this address" summary="Pick a section from the list to carry on." />}
                />
              </Routes>
            </section>
          </div>
        )}
      </main>
    </div>
  );
}
