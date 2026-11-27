import { useState } from "react";
import { Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { fail } from "@/hooks/results/usePapers";

/**
 * Shown on a paper made by "Same questions for all slots". It follows its source paper:
 * every change there (questions, key, flag decisions, PDF) is copied here automatically.
 */
export function LinkedPaperNotice({ paperId, sourceName, onChanged }: { paperId: string; sourceName: string; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const unlink = async () => {
    setBusy(true); setError(null);
    try {
      // linked_from_paper_id is newer than the generated types.
      const { error: e } = await supabase.from("question_papers").update({ linked_from_paper_id: null } as never).eq("id", paperId);
      if (e) fail(e, "The paper could not be unlinked. Please try again.");
      onChanged();
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  };
  return (
    <div role="note" className="flex flex-wrap items-start gap-3 rounded-md border border-sky-700/40 bg-sky-50 p-3 text-sky-950">
      <Link2 className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1 space-y-2">
        <p className="text-base font-medium">This paper follows the {sourceName} paper.</p>
        <p className="text-sm">
          This paper can't be changed here. To change a question or its answer, change the same question on the
          {sourceName} paper: it is copied here automatically and students on this paper are marked again.
          Unlink only if this slot gets a different question paper.
        </p>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      </div>
      <Button type="button" variant="outline" className="min-h-11 bg-white" onClick={unlink} disabled={busy}>
        {busy ? "Unlinking" : "Unlink this paper"}
      </Button>
    </div>
  );
}
