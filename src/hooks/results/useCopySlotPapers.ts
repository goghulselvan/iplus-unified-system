import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fail } from "@/hooks/results/usePapers";

export interface SlotCopyItem {
  classCode: string; className: string; olympiadCode: string; olympiad: string; toSlot: string;
  questions: number; targetExists: boolean; targetQuestions: number; targetStudents: number; problem: string | null;
}
export interface SlotCopyResult { ok: true; dryRun: boolean; items: SlotCopyItem[]; copied: number }

/** Copy every paper of one slot to the same class x subject on all other slots. */
export function useCopySlotPapers() {
  const qc = useQueryClient();
  const call = async (projectId: string, fromSlot: string, dry: boolean) => {
    // results_copy_slot_papers is newer than the generated types.
    const { data, error } = await supabase.rpc("results_copy_slot_papers" as never, {
      p_project_id: projectId, p_from_slot: fromSlot, p_dry_run: dry,
    } as never);
    if (error) fail(error, dry ? "We could not check the papers. Please try again." : "Nothing was copied. Please try again.");
    return data as unknown as SlotCopyResult;
  };
  return {
    check: (projectId: string, fromSlot: string) => call(projectId, fromSlot, true),
    run: async (projectId: string, fromSlot: string) => {
      const r = await call(projectId, fromSlot, false);
      qc.invalidateQueries({ queryKey: ["results"] });
      return r;
    },
  };
}
