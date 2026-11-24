import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { fail } from "@/hooks/results/usePapers";
import type { ReplaceItem } from "@/hooks/results/useEvaluations";
import type { OmrRow } from "@/lib/results/omrFile";

export type OmrErrorKind = "unread" | "duplicate" | "not_in_crm" | "manual_class" | "no_slot" | "short" | "bad_answer" | "file";
export interface OmrUploadError { row: number; kind: OmrErrorKind; reg: string | null; message: string }
export interface OmrPaperGroup {
  classCode: string; className: string; olympiadCode: string; olympiad: string;
  slotName: string | null; count: number; paperExists: boolean; keyReady: boolean;
}
export interface OmrFailure { ok: false; errors: OmrUploadError[]; moreErrors: number }
export interface OmrDryRun { ok: true; dryRun: true; count: number; replacing: number; replace: ReplaceItem[]; papers: OmrPaperGroup[] }
export interface OmrSaved { ok: true; saved: number; replaced: number; papers: OmrPaperGroup[] }

export interface OmrUploadArgs { projectId: string; fileName: string; rows: OmrRow[] }

/** Check an OMR file (dry run) or save it. Project-level problems throw with a plain-English message. */
export function useOmrUploadRpc() {
  const qc = useQueryClient();
  const call = async (a: OmrUploadArgs, dry: boolean) => {
    // results_upload_omr is newer than the generated types.
    const { data, error } = await supabase.rpc("results_upload_omr" as never, {
      p_project_id: a.projectId, p_file_name: a.fileName, p_rows: a.rows as unknown as Json, p_dry_run: dry,
    } as never);
    if (error) fail(error, dry ? "We could not check this file. Please try again." : "We could not save this file. Nothing was saved. Please try again.");
    return data as unknown;
  };
  return {
    check: async (a: OmrUploadArgs) => (await call(a, true)) as OmrFailure | OmrDryRun,
    save: async (a: OmrUploadArgs) => {
      const r = (await call(a, false)) as OmrFailure | OmrSaved;
      if (r.ok) qc.invalidateQueries({ queryKey: ["results"] });
      return r;
    },
  };
}
