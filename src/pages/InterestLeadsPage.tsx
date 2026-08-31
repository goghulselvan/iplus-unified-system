import { useEffect, useMemo, useState } from 'react';
import ProspectLayout from '@/components/prospect/ProspectLayout';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

type Lead = {
  id: number; for_year: number; school_name: string; state: string | null; district: string | null;
  school_email: string; school_mobile: string | null; contact_name: string | null; contact_phone: string | null;
  prospect_school_id: string | null; school_id: string | null; converted_at: string | null; created_at: string;
};
type Prospect = { id: string; school_name: string; district: string | null; state: string | null; mobile: string | null; email: string | null };
type Project = { id: string; project_name: string; project_year: number; registration_deadline: string | null };

const leadStatus = (l: Lead) => (l.converted_at ? 'Imported' : l.prospect_school_id ? 'Linked' : 'New');

export default function InterestLeadsPage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [year, setYear] = useState<number | null>(null);
  const [statusFilter, setStatusFilter] = useState<'all' | 'New' | 'Linked' | 'Imported'>('all');
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const [linkTarget, setLinkTarget] = useState<Lead | null>(null);
  const [pQuery, setPQuery] = useState('');
  const [pResults, setPResults] = useState<Prospect[]>([]);
  const [pSearching, setPSearching] = useState(false);
  const [linkBusy, setLinkBusy] = useState(false);

  const [projectChoices, setProjectChoices] = useState<Project[] | null>(null);
  const [importBusy, setImportBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase.from('olympiad_interest' as any).select('*').order('created_at', { ascending: false });
    const rows = (data || []) as unknown as Lead[];
    setLeads(rows);
    setYear(y => y ?? (rows.length ? Math.max(...rows.map(r => r.for_year)) : null));
    setSelected(new Set());
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const years = useMemo(() => [...new Set(leads.map(l => l.for_year))].sort((a, b) => b - a), [leads]);
  const shown = leads.filter(l =>
    (year == null || l.for_year === year) &&
    (statusFilter === 'all' || leadStatus(l) === statusFilter));
  const selectableShown = shown.filter(l => !l.converted_at);
  const allSel = selectableShown.length > 0 && selectableShown.every(l => selected.has(l.id));

  const toggle = (id: number) => setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleAll = () => setSelected(allSel ? new Set() : new Set(selectableShown.map(l => l.id)));

  // ---- link one lead to a prospect ----
  useEffect(() => {
    if (!linkTarget) return;
    const q = pQuery.trim();
    if (q.length < 2) { setPResults([]); return; }
    setPSearching(true);
    const t = setTimeout(async () => {
      const { data } = await supabase.from('prospect_schools' as any)
        .select('id, school_name, district, state, mobile, email')
        .or(`school_name.ilike.%${q}%,email.ilike.%${q}%`)
        .limit(20);
      setPResults((data || []) as unknown as Prospect[]);
      setPSearching(false);
    }, 300);
    return () => clearTimeout(t);
  }, [pQuery, linkTarget]);

  const openLink = (l: Lead) => { setLinkTarget(l); setPQuery(l.school_name); setPResults([]); };

  const doLink = async (prospectId: string) => {
    if (!linkTarget) return;
    setLinkBusy(true);
    const { error } = await supabase.rpc('link_interest_to_prospect' as any, { p_interest_id: linkTarget.id, p_prospect_school_id: prospectId });
    setLinkBusy(false);
    if (error) { toast({ title: 'Link failed', description: error.message, variant: 'destructive' }); return; }
    toast({ title: 'Linked to prospect' });
    setLinkTarget(null); load();
  };
  const doCreateProspect = async () => {
    if (!linkTarget) return;
    setLinkBusy(true);
    const { error } = await supabase.rpc('create_prospect_from_interest' as any, { p_interest_id: linkTarget.id });
    setLinkBusy(false);
    if (error) { toast({ title: 'Could not create prospect', description: error.message, variant: 'destructive' }); return; }
    toast({ title: 'Prospect created & linked' });
    setLinkTarget(null); load();
  };

  // ---- bulk import selected leads into the year's project ----
  const startImport = async () => {
    if (selected.size === 0 || year == null) return;
    const { data } = await supabase.from('olympiad_projects' as any)
      .select('id, project_name, project_year, registration_deadline')
      .eq('project_year', year);
    const projects = (data || []) as unknown as Project[];
    if (projects.length === 0) {
      toast({ title: `iPlus Olympiads ${year} isn't set up yet`, description: 'Create the project in Project Management first, then import.', variant: 'destructive' });
      return;
    }
    if (projects.length === 1) { runImport(projects[0].id); return; }
    setProjectChoices(projects); // 2+ → let staff pick
  };

  const runImport = async (projectId: string) => {
    setImportBusy(true);
    const { data, error } = await supabase.rpc('import_interest_leads_to_project' as any, {
      p_interest_ids: [...selected], p_project_id: projectId,
    });
    setImportBusy(false);
    setProjectChoices(null);
    if (error) { toast({ title: 'Import failed', description: error.message, variant: 'destructive' }); return; }
    const r = data as { imported: number; skipped_not_linked: number; skipped_already: number };
    toast({
      title: `Imported ${r.imported}`,
      description: `${r.skipped_not_linked} skipped (not linked to a prospect) · ${r.skipped_already} already imported.`,
    });
    load();
  };

  return (
    <ProspectLayout>
      <div className="max-w-6xl mx-auto px-4 py-6">
        <h1 className="text-2xl font-bold mb-1">Interest Leads</h1>
        <p className="text-sm text-muted-foreground mb-4">
          Schools that registered interest for a future Olympiad. Link each to a prospect, then import the linked ones into that year's project to start the workflow.
        </p>

        <div className="flex flex-wrap items-center gap-2 mb-3">
          {years.map(y => (
            <button key={y} onClick={() => { setYear(y); setSelected(new Set()); }}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium ${year === y ? 'bg-indigo-100 text-indigo-700' : 'text-muted-foreground hover:bg-muted'}`}>
              {y} <span className="opacity-60">({leads.filter(l => l.for_year === y).length})</span>
            </button>
          ))}
          <div className="w-px h-5 bg-neutral-200 mx-1" />
          {(['all', 'New', 'Linked', 'Imported'] as const).map(s => (
            <button key={s} onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium ${statusFilter === s ? 'bg-indigo-100 text-indigo-700' : 'text-muted-foreground hover:bg-muted'}`}>
              {s === 'all' ? 'All' : s}
            </button>
          ))}
          <div className="flex-1" />
          <Button size="sm" disabled={selected.size === 0 || importBusy} onClick={startImport}>
            {importBusy ? 'Importing…' : `Import ${selected.size} selected → ${year ?? ''}`}
          </Button>
        </div>

        <div className="bg-white rounded-xl border border-neutral-200 overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  {selectableShown.length > 0 && (
                    <Checkbox checked={allSel} onCheckedChange={toggleAll} aria-label="Select all" />
                  )}
                </TableHead>
                <TableHead>School</TableHead>
                <TableHead>Location</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead>Status</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">Loading…</TableCell></TableRow>
              ) : shown.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">No interest leads.</TableCell></TableRow>
              ) : shown.map(l => {
                const st = leadStatus(l);
                return (
                  <TableRow key={l.id}>
                    <TableCell>
                      {!l.converted_at && <Checkbox checked={selected.has(l.id)} onCheckedChange={() => toggle(l.id)} />}
                    </TableCell>
                    <TableCell>
                      <div className="font-medium">{l.school_name}</div>
                      <div className="text-xs text-muted-foreground">{l.school_email}{l.school_mobile ? ` · ${l.school_mobile}` : ''}</div>
                    </TableCell>
                    <TableCell className="text-sm">{[l.district, l.state].filter(Boolean).join(', ') || '—'}</TableCell>
                    <TableCell className="text-sm">{l.contact_name || '—'}{l.contact_phone ? <div className="text-xs text-muted-foreground">{l.contact_phone}</div> : null}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={
                        st === 'Imported' ? 'bg-emerald-50 text-emerald-600 border-emerald-100'
                        : st === 'Linked' ? 'bg-blue-50 text-blue-600 border-blue-100'
                        : 'bg-neutral-100 text-neutral-500 border-neutral-200'}>{st}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {!l.converted_at && (
                        <Button variant="outline" size="sm" onClick={() => openLink(l)}>
                          {l.prospect_school_id ? 'Re-link' : 'Link to prospect'}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Link dialog */}
      <Dialog open={!!linkTarget} onOpenChange={(o) => { if (!o) setLinkTarget(null); }}>
        <DialogContent className="max-w-xl">
          <DialogHeader><DialogTitle>Link "{linkTarget?.school_name}" to a prospect school</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Input value={pQuery} onChange={(e) => setPQuery(e.target.value)} placeholder="Search prospect schools by name or email…" />
            <div className="max-h-[40vh] overflow-y-auto rounded-lg border border-neutral-200 divide-y">
              {pSearching && <div className="p-3 text-sm text-muted-foreground">Searching…</div>}
              {!pSearching && pResults.length === 0 && pQuery.trim().length >= 2 && (
                <div className="p-3 text-sm text-muted-foreground">No prospect matches.</div>
              )}
              {pResults.map(p => (
                <button key={p.id} onClick={() => doLink(p.id)} disabled={linkBusy}
                  className="w-full text-left p-3 hover:bg-neutral-50 disabled:opacity-50">
                  <div className="font-medium text-sm">{p.school_name}</div>
                  <div className="text-xs text-muted-foreground">
                    {[p.district, p.state].filter(Boolean).join(', ') || '—'}{p.email ? ` · ${p.email}` : ''}{p.mobile ? ` · ${p.mobile}` : ''}
                  </div>
                </button>
              ))}
            </div>
          </div>
          <DialogFooter className="flex items-center justify-between sm:justify-between">
            <Button variant="outline" onClick={doCreateProspect} disabled={linkBusy}>
              Create a new prospect from this lead
            </Button>
            <Button variant="ghost" onClick={() => setLinkTarget(null)}>Cancel</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Project picker (only when 2+ projects share the year) */}
      <Dialog open={!!projectChoices} onOpenChange={(o) => { if (!o) setProjectChoices(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>More than one project for {year} — pick one</DialogTitle></DialogHeader>
          <div className="space-y-2">
            {projectChoices?.map(p => (
              <button key={p.id} onClick={() => runImport(p.id)} disabled={importBusy}
                className="w-full text-left p-3 rounded-lg border border-neutral-200 hover:bg-neutral-50 disabled:opacity-50">
                <div className="font-medium text-sm">{p.project_name}</div>
                <div className="text-xs text-muted-foreground">
                  {p.registration_deadline ? `Deadline ${new Date(p.registration_deadline).toLocaleDateString('en-IN')}` : 'No deadline set'}
                </div>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </ProspectLayout>
  );
}
