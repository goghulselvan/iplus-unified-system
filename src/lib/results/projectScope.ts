// Project isolation helpers for the Results module. Every olympiad project keeps its own
// papers, marks, ranks and sends; these keep the screens honest about which one is shown.

export interface ProjectLike { project_name?: string | null; project_year?: number | null }

/** "iPlus Olympiads (2026)" — the label shown next to the Results title. */
export function projectLabel(p: ProjectLike | null | undefined): string | null {
  if (!p?.project_name) return null;
  return p.project_year ? `${p.project_name} (${p.project_year})` : p.project_name;
}

/**
 * Plain-English notice when a page opened by link (a paper or a student) belongs to a
 * different project than the one the CRM is set to. Null when they match or are unknown.
 */
export function otherProjectNotice(
  activeProjectId: string | null | undefined,
  itemProjectId: string | null | undefined,
  itemProjectName: string | null | undefined,
  what: "paper" | "student",
): string | null {
  if (!activeProjectId || !itemProjectId || activeProjectId === itemProjectId) return null;
  const name = itemProjectName ? `"${itemProjectName}"` : "another olympiad project";
  return `This ${what} belongs to ${name}, not the project the CRM is set to now. Everything on this page (marks, ranks, totals) is from ${name} only.`;
}

export interface CopyPaperSide { id: string; project_id: string; class_code: string; olympiad_code: string }

/**
 * "Copy from Slot 1" may only copy between two papers of the SAME project, class and
 * olympiad. Returns the reason it is refused, or null when it is allowed.
 */
export function copyScopeProblem(source: CopyPaperSide | null, target: CopyPaperSide | null): string | null {
  if (!source || !target) return "The paper to copy from could not be found. Please refresh and try again.";
  if (source.id === target.id) return "A paper cannot be copied onto itself.";
  if (source.project_id !== target.project_id) {
    return "Questions can only be copied between papers of the same olympiad project.";
  }
  if (source.class_code !== target.class_code || source.olympiad_code !== target.olympiad_code) {
    return "Questions can only be copied between papers of the same class and subject.";
  }
  return null;
}
