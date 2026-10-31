import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useActiveProject } from '@/hooks/useOlympiadProjects';

export type TimelineRow = {
  happened_at: string;
  channel: string | null;
  direction: string | null;
  title: string | null;
  detail: string | null;
  staff_name: string | null;
  project_id: string | null;
  project_name: string | null;
  source: string;
  source_id: string;
};

// The school page used to read `communications` directly, which missed every
// Bonvoice call: the call row is written server-side by the edge function while
// the communications row was written by the browser afterwards, so any call
// where the browser never completed that second step vanished from the history.
// get_school_timeline() unions both (and campaigns, follow-ups, activity) and
// de-duplicates a call that exists in both places.
export const useSchoolTimeline = (prospectSchoolId?: string | null, limit = 100) => {
  const { toast } = useToast();
  const { data: activeProject } = useActiveProject();
  const [rows, setRows] = useState<TimelineRow[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchTimeline = useCallback(async () => {
    if (!prospectSchoolId) { setRows([]); return; }
    setLoading(true);
    const { data, error } = await supabase.rpc('get_school_timeline' as any, {
      p_prospect_school_id: prospectSchoolId,
      p_project_id: activeProject?.id ?? null,
      p_before: null,
      p_limit: limit,
    });
    setLoading(false);
    if (error) {
      toast({ title: 'Error', description: 'Failed to load communication history', variant: 'destructive' });
      return;
    }
    setRows((data ?? []) as TimelineRow[]);
  }, [prospectSchoolId, activeProject?.id, limit, toast]);

  // The timeline folds any note into `detail` for display, so to EDIT one we
  // read the current value straight from whichever table the row came from.
  const loadNote = async (row: TimelineRow): Promise<string> => {
    const { table, col } = row.source === 'bonvoice_call_logs'
      ? { table: 'bonvoice_call_logs' as const, col: 'staff_comment' }
      : { table: 'communications' as const, col: 'staff_note' };
    const { data } = await supabase.from(table).select(col).eq('id', row.source_id).maybeSingle();
    return ((data as Record<string, string | null> | null)?.[col]) ?? '';
  };

  // A note lives on whichever table the row came from — communications rows use
  // staff_note, Bonvoice call rows use the staff_comment column they already have.
  const saveNote = async (row: TimelineRow, note: string) => {
    const trimmed = note.trim();
    const { error } = row.source === 'bonvoice_call_logs'
      ? await supabase.from('bonvoice_call_logs')
          .update({ staff_comment: trimmed || null, commented_at: trimmed ? new Date().toISOString() : null })
          .eq('id', row.source_id)
      : await supabase.from('communications')
          .update({ staff_note: trimmed || null })
          .eq('id', row.source_id);

    if (error) {
      toast({ title: 'Error', description: error.message || 'Failed to save the note', variant: 'destructive' });
      return { error };
    }
    await fetchTimeline();
    toast({ title: trimmed ? 'Note saved' : 'Note removed' });
    return { error: null };
  };

  useEffect(() => { fetchTimeline(); }, [fetchTimeline]);

  return { rows, loading, fetchTimeline, saveNote, loadNote };
};
