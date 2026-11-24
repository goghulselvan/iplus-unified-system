import { useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { OlympiadProject } from "@/hooks/useOlympiadProjects";

/**
 * The olympiad project every Results page works on. Results are only kept for active
 * projects: with one active project it is used straight away; with more than one, the
 * Results layout asks which one first and remembers the choice for this browser tab.
 */
const KEY = "results-project-id";
const listeners = new Set<() => void>();

function readChoice(): string | null {
  try { return sessionStorage.getItem(KEY); } catch { return null; }
}
export function chooseResultsProject(id: string | null) {
  try { if (id) sessionStorage.setItem(KEY, id); else sessionStorage.removeItem(KEY); } catch { /* storage blocked */ }
  listeners.forEach((l) => l());
}
const subscribe = (l: () => void) => { listeners.add(l); return () => listeners.delete(l); };

export function useActiveProjects() {
  return useQuery({
    queryKey: ["results", "active-projects"],
    queryFn: async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return [] as OlympiadProject[];
      const { data, error } = await supabase
        .from("olympiad_projects").select("*").eq("is_active", true).order("project_year", { ascending: false });
      if (error) throw error;
      return (data ?? []) as OlympiadProject[];
    },
    staleTime: 5 * 60 * 1000,
  });
}

/** Pick the project from the active list and the stored choice. */
export function pickResultsProject(active: OlympiadProject[], chosenId: string | null) {
  if (active.length === 1) return { project: active[0], needsChoice: false };
  const chosen = active.find((p) => p.id === chosenId) ?? null;
  return { project: chosen, needsChoice: active.length > 1 && !chosen };
}

export function useResultsProject() {
  const q = useActiveProjects();
  const chosenId = useSyncExternalStore(subscribe, readChoice, () => null);
  const { project, needsChoice } = pickResultsProject(q.data ?? [], chosenId);
  return { data: project, isLoading: q.isLoading, needsChoice, projects: q.data ?? [] };
}
