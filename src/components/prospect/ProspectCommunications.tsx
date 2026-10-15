import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Loader2, Phone, MessageCircle, Mail, CalendarClock, Activity } from 'lucide-react';

type Entry = {
  happened_at: string; channel: string; direction: string | null; title: string | null;
  detail: string | null; staff_name: string | null; project_id: string | null;
  project_name: string | null; source: string; source_id: string;
};
type Project = { id: string; project_name: string; project_year: number };

const PAGE = 50;

const CHANNEL: Record<string, { label: string; icon: typeof Phone }> = {
  call: { label: 'Call', icon: Phone },
  phone: { label: 'Call', icon: Phone },
  whatsapp: { label: 'WhatsApp', icon: MessageCircle },
  campaign_whatsapp: { label: 'WhatsApp campaign', icon: MessageCircle },
  email: { label: 'Email', icon: Mail },
  campaign_email: { label: 'Email campaign', icon: Mail },
  follow_up: { label: 'Follow-up', icon: CalendarClock },
  status: { label: 'Status change', icon: Activity },
};

// Every call, WhatsApp, email, campaign, follow-up and status change for one school, across all
// projects (CRM and prospect history together). Filter by project with the dropdown.
export default function ProspectCommunications({ prospectId }: { prospectId: string }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [project, setProject] = useState<string>('all');
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [more, setMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    supabase.from('olympiad_projects').select('id, project_name, project_year').order('project_year', { ascending: false })
      .then(({ data }) => setProjects((data ?? []) as Project[]));
  }, []);

  const load = useCallback(async (before: string | null) => {
    const { data, error } = await supabase.rpc('get_school_timeline' as any, {
      p_prospect_school_id: prospectId,
      p_project_id: project === 'all' ? null : project,
      p_before: before,
      p_limit: PAGE,
    });
    if (error) return [] as Entry[];
    const list = (data ?? []) as Entry[];
    setMore(list.length === PAGE);
    return list;
  }, [prospectId, project]);

  useEffect(() => {
    let alive = true;
    setEntries(null);
    load(null).then(list => { if (alive) setEntries(list); });
    return () => { alive = false; };
  }, [load]);

  const loadOlder = async () => {
    if (!entries?.length) return;
    setLoadingMore(true);
    const older = await load(entries[entries.length - 1].happened_at);
    setEntries([...entries, ...older]);
    setLoadingMore(false);
  };

  return (
    <div className="space-y-4 text-sm">
      <Select value={project} onValueChange={setProject}>
        <SelectTrigger className="w-72"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All projects</SelectItem>
          {projects.map(p => <SelectItem key={p.id} value={p.id}>{p.project_name} {p.project_year}</SelectItem>)}
        </SelectContent>
      </Select>

      {entries === null ? (
        <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-gray-400" /></div>
      ) : entries.length === 0 ? (
        <p className="text-gray-500 py-6">No communication recorded{project === 'all' ? '' : ' for this project'} yet.</p>
      ) : (
        <ol className="divide-y divide-gray-100 border border-gray-200 rounded-lg">
          {entries.map(e => {
            const c = CHANNEL[e.channel] ?? { label: e.channel, icon: Activity };
            const Icon = c.icon;
            return (
              <li key={`${e.source}-${e.source_id}`} className="flex gap-3 px-3 py-2.5">
                <Icon className="h-4 w-4 mt-0.5 flex-shrink-0 text-gray-400" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-medium text-gray-900">{c.label}</span>
                    {e.title && e.title.toLowerCase() !== c.label.toLowerCase() && <span className="text-gray-700">{e.title}</span>}
                    {e.direction && <span className="text-xs text-gray-400">{e.direction}</span>}
                  </div>
                  {e.detail && <p className="text-gray-600 whitespace-pre-line break-words">{e.detail}</p>}
                  <p className="text-xs text-gray-400 mt-0.5">
                    {new Date(e.happened_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    {e.staff_name ? ` by ${e.staff_name}` : ''}
                    {project === 'all' && e.project_name ? ` · ${e.project_name}` : ''}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      )}
      {more && (
        <Button variant="outline" size="sm" onClick={loadOlder} disabled={loadingMore}>
          {loadingMore ? 'Loading…' : 'Show older'}
        </Button>
      )}
    </div>
  );
}
