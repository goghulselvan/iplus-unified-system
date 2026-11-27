import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fail } from "@/hooks/results/usePapers";

export interface ReevaluateGroup {
  classCode: string; className: string; olympiadCode: string; olympiad: string;
  fromSlot: string | null; toSlot: string; count: number; paperExists: boolean; keyReady: boolean;
}
export interface ReevaluateResult {
  ok: true; dryRun: boolean; slotName: string; count: number; moved: number; groups: ReevaluateGroup[];
}

/** Superadmin: move a school's results onto the papers of its current exam slot and re-mark. */
export function useReevaluateSchool() {
  const qc = useQueryClient();
  const call = async (projectId: string, schoolId: string, dry: boolean) => {
    // results_reevaluate_school is newer than the generated types.
    const { data, error } = await supabase.rpc("results_reevaluate_school" as never, {
      p_project_id: projectId, p_school_id: schoolId, p_dry_run: dry,
    } as never);
    if (error) fail(error, dry ? "We could not check this school. Please try again." : "Nothing was changed. Please try again.");
    return data as unknown as ReevaluateResult;
  };
  return {
    check: (projectId: string, schoolId: string) => call(projectId, schoolId, true),
    run: async (projectId: string, schoolId: string) => {
      const r = await call(projectId, schoolId, false);
      qc.invalidateQueries({ queryKey: ["results"] });
      return r;
    },
  };
}
