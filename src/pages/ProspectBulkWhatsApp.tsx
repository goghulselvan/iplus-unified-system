import { useState, useEffect, useRef, useCallback, KeyboardEvent } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useActiveProject } from '@/hooks/useOlympiadProjects';
import ProspectLayout from '@/components/prospect/ProspectLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import {
  CheckCircle2, XCircle, Clock, Send, Pause, RefreshCw,
  MessageSquare, Users, FileText, FlaskConical, X,
  Plus, ChevronDown, ChevronUp, Trash2, CalendarClock,
  CheckCheck, Eye, Reply, Download,
} from 'lucide-react';

type WACampaign = {
  id: string;
  name: string;
  description: string | null;
  status: string;
  sent_count: number;
  failed_count: number;
  audience_count: number;
  created_at: string;
  scheduled_at: string | null;
  whatsapp_template_name: string | null;
};

type Stats = { total: number; sent: number; failed: number; pending: number };
type TestResult = { number: string; success: boolean; wamid?: string; error?: string };
type DeliveryStats = { delivered: number; read: number; replied: number; failed: number };
type EngagementRow = {
  id: string; school_name: string; district: string | null; state: string | null;
  mobile: string | null; delivery_status: string; sent_at: string | null;
  delivered_at: string | null; opened_at: string | null;
  reply_text: string | null; replied_at: string | null;
};

const STATUS_CFG: Record<string, { label: string; color: string }> = {
  draft:     { label: 'Draft',      color: 'bg-gray-100 text-gray-600' },
  scheduled: { label: 'Scheduled',  color: 'bg-purple-100 text-purple-700' },
  sending:   { label: 'Sending',    color: 'bg-blue-100 text-blue-700' },
  sent:      { label: 'Sent',      color: 'bg-green-100 text-green-700' },
  paused:    { label: 'Paused',    color: 'bg-amber-100 text-amber-700' },
  cancelled: { label: 'Cancelled', color: 'bg-red-100 text-red-500' },
};

const AUDIENCE_DESC = 'WhatsApp brochure campaign to all prospect schools with valid 10-digit mobile';

const DELIVERY_CFG: Record<string, { label: string; color: string }> = {
  sent:          { label: 'Sent',      color: 'bg-gray-100 text-gray-600' },
  delivered:     { label: 'Delivered', color: 'bg-indigo-100 text-indigo-700' },
  read:          { label: 'Read',      color: 'bg-blue-100 text-blue-700' },
  replied:       { label: 'Replied',   color: 'bg-emerald-100 text-emerald-700' },
  failed:        { label: 'Failed',    color: 'bg-red-100 text-red-500' },
  frequency_cap: { label: 'Freq cap',  color: 'bg-amber-100 text-amber-700' },
};

const ENG_FILTERS: { value: string; label: string }[] = [
  { value: '',          label: 'Engaged' },
  { value: 'replied',   label: 'Replied' },
  { value: 'read',      label: 'Read' },
  { value: 'delivered', label: 'Delivered' },
  { value: 'failed',    label: 'Undelivered' },
  { value: 'all',       label: 'All' },
];

const ENG_PAGE = 50;

export default function ProspectBulkWhatsApp() {
  const { data: activeProject } = useActiveProject();
  const [campaigns, setCampaigns] = useState<WACampaign[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState('');
  const [newTemplate, setNewTemplate] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [newFilters, setNewFilters] = useState({ state: '', district: '', board: '' });
  const [newFilterDistricts, setNewFilterDistricts] = useState<string[]>([]);
  const [newAudienceCount, setNewAudienceCount] = useState<number | null>(null);
  const [countingAudience, setCountingAudience] = useState(false);

  // Per-expanded-campaign state (resets on collapse)
  const [stats, setStats] = useState<Stats>({ total: 0, sent: 0, failed: 0, pending: 0 });
  const [dStats, setDStats] = useState<DeliveryStats | null>(null);
  const [engFilter, setEngFilter] = useState('');
  const [engRows, setEngRows] = useState<EngagementRow[]>([]);
  const [engLoading, setEngLoading] = useState(false);
  const [engHasMore, setEngHasMore] = useState(false);
  const [exporting, setExporting] = useState(false);

  // Not-on-WhatsApp exclusion upload
  const [exclCount, setExclCount] = useState<number | null>(null);
  const [exclParsed, setExclParsed] = useState<string[] | null>(null);
  const [exclFileName, setExclFileName] = useState('');
  const [exclUploading, setExclUploading] = useState(false);
  const [exclError, setExclError] = useState<string | null>(null);
  const [exclResult, setExclResult] = useState<{ flagged: number; pending_skipped: number } | null>(null);
  const [templateName, setTemplateName] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [sending, setSending] = useState(false);
  const [pausing, setPausing] = useState(false);
  const [lastBatch, setLastBatch] = useState<{ sent: number; failed: number } | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const pauseRef = useRef(false);

  // Scheduling state
  const [scheduleAt, setScheduleAt] = useState('');
  const [scheduling, setScheduling] = useState(false);
  const [scheduleError, setScheduleError] = useState<string | null>(null);

  // Test send state
  const [testInput, setTestInput] = useState('');
  const [testNumbers, setTestNumbers] = useState<string[]>([]);
  const [testSending, setTestSending] = useState(false);
  const [testResults, setTestResults] = useState<TestResult[] | null>(null);

  const fetchCampaigns = useCallback(async () => {
    setLoadingList(true);
    const { data } = await supabase
      .from('campaigns')
      .select('id, name, description, status, sent_count, failed_count, audience_count, created_at, scheduled_at, whatsapp_template_name')
      .eq('channel', 'whatsapp')
      .order('created_at', { ascending: false });
    setCampaigns((data as WACampaign[]) ?? []);
    setLoadingList(false);
  }, []);

  useEffect(() => { fetchCampaigns(); }, [fetchCampaigns]);

  useEffect(() => {
    supabase.rpc('count_not_on_whatsapp').then(({ data }) => setExclCount((data as number) ?? null));
  }, []);

  // Pull every 10–12 digit run out of the file, normalise to Indian 10-digit mobiles
  const parseExclNumbers = (text: string): string[] => {
    const found = text.match(/\d{10,12}/g) ?? [];
    const out = new Set<string>();
    for (const raw of found) {
      let n = raw;
      if (n.length === 12 && n.startsWith('91')) n = n.slice(2);
      if (n.length === 11 && n.startsWith('0')) n = n.slice(1);
      if (n.length === 10 && /^[6-9]/.test(n)) out.add(n);
    }
    return [...out];
  };

  const onExclFile = async (file: File) => {
    setExclError(null); setExclResult(null);
    const text = await file.text();
    setExclFileName(file.name);
    setExclParsed(parseExclNumbers(text));
  };

  const flagExcluded = async () => {
    if (!exclParsed?.length) return;
    setExclUploading(true); setExclError(null);
    try {
      const totals = { flagged: 0, pending_skipped: 0 };
      for (let i = 0; i < exclParsed.length; i += 10000) {
        const { data, error } = await supabase.rpc('mark_not_on_whatsapp', {
          p_numbers: exclParsed.slice(i, i + 10000),
        });
        if (error) throw error;
        const r = data as { flagged: number; pending_skipped: number };
        totals.flagged += r.flagged;
        totals.pending_skipped += r.pending_skipped;
      }
      setExclResult(totals);
      setExclParsed(null); setExclFileName('');
      const { data: cnt } = await supabase.rpc('count_not_on_whatsapp');
      setExclCount((cnt as number) ?? null);
    } catch (e: any) {
      setExclError(e.message);
    } finally {
      setExclUploading(false);
    }
  };

  const refreshStats = useCallback(async (campaignId: string) => {
    const [{ data }, { data: ds }] = await Promise.all([
      supabase.rpc('get_wa_campaign_progress', { p_campaign_id: campaignId }),
      supabase.rpc('get_wa_campaign_delivery_stats', { p_campaign_id: campaignId }),
    ]);
    if (data) setStats(data as Stats);
    if (ds) setDStats(ds as DeliveryStats);
  }, []);

  const loadEngagement = useCallback(async (campaignId: string, filter: string, offset: number) => {
    setEngLoading(true);
    const { data } = await supabase.rpc('get_wa_campaign_engagement', {
      p_campaign_id: campaignId,
      p_status: filter || null,
      p_limit: ENG_PAGE + 1,
      p_offset: offset,
    });
    const rows = (data as EngagementRow[]) ?? [];
    setEngHasMore(rows.length > ENG_PAGE);
    const page = rows.slice(0, ENG_PAGE);
    setEngRows(prev => (offset === 0 ? page : [...prev, ...page]));
    setEngLoading(false);
  }, []);

  const changeEngFilter = (filter: string) => {
    if (!expandedId) return;
    setEngFilter(filter);
    loadEngagement(expandedId, filter, 0);
  };

  const exportEngagement = async (campaignId: string, campaignName: string) => {
    setExporting(true);
    try {
      const all: EngagementRow[] = [];
      for (let off = 0; off < 60000; off += 1000) {
        const { data } = await supabase.rpc('get_wa_campaign_engagement', {
          p_campaign_id: campaignId, p_status: engFilter || null, p_limit: 1000, p_offset: off,
        });
        const rows = (data as EngagementRow[]) ?? [];
        all.push(...rows);
        if (rows.length < 1000) break;
      }
      const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const csv = [
        ['School', 'District', 'State', 'Mobile', 'Status', 'Sent At', 'Delivered At', 'Read At', 'Reply', 'Replied At'].join(','),
        ...all.map(r => [r.school_name, r.district, r.state, r.mobile, r.delivery_status,
          r.sent_at, r.delivered_at, r.opened_at, r.reply_text, r.replied_at].map(esc).join(',')),
      ].join('\n');
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `${campaignName.replace(/[^\w-]+/g, '_')}_${engFilter || 'engaged'}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  };

  const resetDetail = () => {
    setSending(false); setPausing(false); pauseRef.current = false;
    setConfirmed(false); setLastBatch(null); setDetailError(null);
    setTestInput(''); setTestNumbers([]); setTestResults(null);
    setTemplateName('');
    setScheduleAt(''); setScheduling(false); setScheduleError(null);
    setDStats(null); setEngFilter(''); setEngRows([]); setEngHasMore(false);
  };

  const expand = async (c: WACampaign) => {
    if (expandedId === c.id) { setExpandedId(null); return; }
    resetDetail();
    if (c.whatsapp_template_name) setTemplateName(c.whatsapp_template_name);
    if (c.scheduled_at) {
      // Convert UTC ISO to local datetime-local string
      const d = new Date(c.scheduled_at);
      const pad = (n: number) => String(n).padStart(2, '0');
      setScheduleAt(`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`);
    }
    setExpandedId(c.id);
    await Promise.all([refreshStats(c.id), loadEngagement(c.id, '', 0)]);
  };

  const scheduleCampaign = async (campaignId: string) => {
    if (!scheduleAt || !templateName) return;
    setScheduling(true); setScheduleError(null);
    try {
      // Ensure template name is saved
      await supabase.from('campaigns').update({
        whatsapp_template_name: templateName,
        scheduled_at: new Date(scheduleAt).toISOString(),
        status: 'scheduled',
      }).eq('id', campaignId);
      setCampaigns(prev => prev.map(c => c.id === campaignId
        ? { ...c, whatsapp_template_name: templateName, scheduled_at: new Date(scheduleAt).toISOString(), status: 'scheduled' }
        : c));
    } catch (e: any) {
      setScheduleError(e.message);
    } finally {
      setScheduling(false);
    }
  };

  const cancelSchedule = async (campaignId: string) => {
    const { error } = await supabase.from('campaigns')
      .update({ scheduled_at: null, status: 'cancelled' })
      .eq('id', campaignId);
    if (error) { toast({ title: 'Failed to cancel', description: error.message, variant: 'destructive' }); return; }
    setCampaigns(prev => prev.map(c => c.id === campaignId ? { ...c, scheduled_at: null, status: 'cancelled' } : c));
    setScheduleAt('');
    toast({ title: 'Campaign cancelled', description: 'No further messages will be sent.' });
  };

  const pauseCampaign = async (campaignId: string) => {
    await supabase.from('campaigns').update({ status: 'paused' }).eq('id', campaignId);
    setCampaigns(prev => prev.map(c => c.id === campaignId ? { ...c, status: 'paused' } : c));
  };

  const resumeCampaign = async (campaignId: string) => {
    // Reset any stuck 'sending' rows back to 'pending' so they get retried
    await supabase.from('campaign_schools')
      .update({ status: 'pending' })
      .eq('campaign_id', campaignId).eq('status', 'sending');
    // Set scheduled_at = now() so cron's `scheduled_at <= now()` condition passes
    const now = new Date().toISOString();
    const { error } = await supabase.from('campaigns')
      .update({ status: 'sending', scheduled_at: now })
      .eq('id', campaignId);
    if (error) { toast({ title: 'Failed to resume', description: error.message, variant: 'destructive' }); return; }
    setCampaigns(prev => prev.map(c => c.id === campaignId ? { ...c, status: 'sending', scheduled_at: now } : c));
    toast({ title: 'Campaign resumed', description: 'Will continue sending on next cron tick (within 1 min).' });
  };

  const deleteCampaign = async (c: WACampaign, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm(`Delete "${c.name}"? This cannot be undone.`)) return;
    await supabase.from('campaign_schools').delete().eq('campaign_id', c.id);
    await supabase.from('campaigns').delete().eq('id', c.id);
    if (expandedId === c.id) setExpandedId(null);
    setCampaigns(prev => prev.filter(x => x.id !== c.id));
  };

  const saveTemplateName = async (name: string) => {
    if (!expandedId) return;
    await supabase.from('campaigns').update({ whatsapp_template_name: name }).eq('id', expandedId);
    setCampaigns(prev => prev.map(c => c.id === expandedId ? { ...c, whatsapp_template_name: name } : c));
  };

  const STATES = ['Tamil Nadu', 'Puducherry', 'Karnataka', 'Kerala', 'Andhra Pradesh', 'Telangana'];
  const BOARDS = ['State Board', 'Matriculation', 'CBSE', 'ICSE', 'International Board'];

  const updateNewState = async (state: string) => {
    setNewFilters(f => ({ ...f, state, district: '' }));
    setNewFilterDistricts([]);
    if (state) {
      const { data } = await supabase.rpc('get_prospect_districts', { p_state: state });
      setNewFilterDistricts((data as string[]) || []);
    }
  };

  const refreshNewAudienceCount = async (filters: typeof newFilters) => {
    setCountingAudience(true);
    const { data } = await supabase.rpc('get_audience_count', {
      p_state:      filters.state    || null,
      p_district:   filters.district || null,
      p_board:      filters.board    || null,
      p_stage:      null,
      p_has_email:  null,
      p_has_mobile: true,
      p_project_id: activeProject?.id ?? null,
    });
    setNewAudienceCount(data as number);
    setCountingAudience(false);
  };

  const createCampaign = async () => {
    if (!newName.trim() || !newTemplate.trim()) return;
    setCreating(true); setCreateError(null);
    try {
      const { data: created, error } = await supabase
        .from('campaigns')
        .insert({
          name: newName.trim(),
          channel: 'whatsapp',
          status: 'draft',
          send_mode: 'manual',
          description: AUDIENCE_DESC,
          whatsapp_template_name: newTemplate.trim(),
          project_id: activeProject?.id ?? null,
          sent_count: 0, failed_count: 0, audience_count: 0, target_count: 0,
          audience_filters: {
            state:    newFilters.state    || null,
            district: newFilters.district || null,
            board:    newFilters.board    || null,
          },
        })
        .select('id, name, description, status, sent_count, failed_count, audience_count, created_at, scheduled_at, whatsapp_template_name')
        .single();
      if (error) throw error;
      await supabase.rpc('populate_wa_campaign_audience', { p_campaign_id: created.id });
      setShowNew(false);
      const tpl = newTemplate.trim();
      setNewName(''); setNewTemplate('');
      setNewFilters({ state: '', district: '', board: '' });
      setNewAudienceCount(null);
      await fetchCampaigns();
      // auto-expand with template pre-filled
      resetDetail();
      setTemplateName(tpl);
      setExpandedId(created.id);
      await refreshStats(created.id);
    } catch (e: any) {
      setCreateError(e.message);
    } finally {
      setCreating(false);
    }
  };

  // Test numbers chip input
  const addTestNumber = () => {
    const raw = testInput.replace(/\D/g, '').trim();
    if (!raw || testNumbers.includes(raw)) { setTestInput(''); return; }
    if (raw.length < 10 || raw.length > 12) return;
    setTestNumbers(prev => [...prev, raw]);
    setTestInput(''); setTestResults(null);
  };
  const handleTestKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTestNumber(); }
    if (e.key === 'Backspace' && !testInput && testNumbers.length > 0)
      setTestNumbers(prev => prev.slice(0, -1));
  };

  const sendTest = async () => {
    if (!templateName || testNumbers.length === 0) return;
    setTestSending(true); setTestResults(null);
    try {
      const { data, error: fnErr } = await supabase.functions.invoke('send-wa-campaign', {
        body: { template_name: templateName, test_numbers: testNumbers },
      });
      if (fnErr) {
        const body = await (fnErr as any).context?.json().catch(() => null);
        throw new Error(body?.error || fnErr.message);
      }
      if (data?.error) throw new Error(data.error);
      setTestResults(data.results as TestResult[]);
    } catch (e: any) {
      setTestResults([{ number: 'error', success: false, error: e.message }]);
    } finally { setTestSending(false); }
  };

  const sendAll = async (campaignId: string) => {
    if (!templateName || !confirmed) return;
    setSending(true); setPausing(false); pauseRef.current = false; setDetailError(null);
    try {
      let done = false;
      while (!done && !pauseRef.current) {
        const { data, error: fnErr } = await supabase.functions.invoke('send-wa-campaign', {
          body: { campaign_id: campaignId, template_name: templateName, batch_size: 50 },
        });
        if (fnErr) throw new Error(fnErr.message);
        if (data?.error) throw new Error(data.error);
        done = data.done;
        setLastBatch({ sent: data.sent, failed: data.failed });
        await refreshStats(campaignId);
        if (!done && !pauseRef.current) await new Promise(r => setTimeout(r, 300));
      }
    } catch (e: any) {
      setDetailError(e.message);
    } finally {
      setSending(false); setPausing(false); pauseRef.current = false;
      await fetchCampaigns();
    }
  };

  return (
    <ProspectLayout>
      <div className="max-w-4xl mx-auto px-4 py-6 space-y-4">

        {/* Page header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
              <MessageSquare className="h-5 w-5 text-green-600" />
              WhatsApp Campaigns
            </h1>
            <p className="text-sm text-gray-500 mt-0.5">
              {loadingList ? '…' : `${campaigns.length} campaign${campaigns.length !== 1 ? 's' : ''}`}
            </p>
          </div>
          <Button onClick={() => { setShowNew(v => !v); setCreateError(null); }} size="sm">
            <Plus className="h-4 w-4 mr-1.5" /> New Campaign
          </Button>
        </div>

        {/* New campaign inline form */}
        {showNew && (
          <div className="bg-white rounded-xl border border-indigo-200 p-5 space-y-4">
            <h3 className="font-semibold text-gray-800 text-sm">New WA Campaign</h3>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-gray-600">Campaign name</label>
                <Input value={newName} onChange={e => setNewName(e.target.value)} placeholder="e.g. iPlus Olympiads 2026 – Brochure" />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-gray-600">Meta template name</label>
                <Input value={newTemplate} onChange={e => setNewTemplate(e.target.value)} placeholder="e.g. iplus_olympiads_2026" className="font-mono text-sm" />
              </div>
            </div>

            {/* Audience filters */}
            <div className="border-t border-gray-100 pt-3">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Audience Filters</p>
                <div className="flex items-center gap-2">
                  {newAudienceCount !== null && (
                    <span className="text-xs font-bold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded-full">
                      {countingAudience ? '…' : `${newAudienceCount.toLocaleString()} schools`}
                    </span>
                  )}
                  <button onClick={() => refreshNewAudienceCount(newFilters)} className="text-xs text-indigo-600 hover:underline">
                    {newAudienceCount === null ? 'Count audience' : 'Refresh'}
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div className="space-y-1">
                  <label className="text-xs text-gray-500">State</label>
                  <select
                    value={newFilters.state}
                    onChange={e => { updateNewState(e.target.value); setNewAudienceCount(null); }}
                    className="w-full text-xs border border-gray-200 rounded px-2 py-1.5 bg-white focus:outline-none focus:ring-1 focus:ring-indigo-400"
                  >
                    <option value="">All States</option>
                    {STATES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-gray-500">District</label>
                  <select
                    value={newFilters.district}
                    onChange={e => { setNewFilters(f => ({ ...f, district: e.target.value })); setNewAudienceCount(null); }}
                    disabled={!newFilters.state}
                    className="w-full text-xs border border-gray-200 rounded px-2 py-1.5 bg-white focus:outline-none focus:ring-1 focus:ring-indigo-400 disabled:opacity-50"
                  >
                    <option value="">All Districts</option>
                    {newFilterDistricts.map(d => <option key={d} value={d}>{d}</option>)}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-gray-500">Board</label>
                  <select
                    value={newFilters.board}
                    onChange={e => { setNewFilters(f => ({ ...f, board: e.target.value })); setNewAudienceCount(null); }}
                    className="w-full text-xs border border-gray-200 rounded px-2 py-1.5 bg-white focus:outline-none focus:ring-1 focus:ring-indigo-400"
                  >
                    <option value="">All Boards</option>
                    {BOARDS.map(b => <option key={b} value={b}>{b}</option>)}
                  </select>
                </div>
              </div>
              <p className="text-xs text-gray-400 mt-1.5">Leave empty to target all schools with a valid WhatsApp number.</p>
            </div>

            {createError && <p className="text-xs text-red-500">{createError}</p>}
            <div className="flex gap-2">
              <Button onClick={createCampaign} disabled={creating || !newName.trim() || !newTemplate.trim()} size="sm">
                {creating ? <><RefreshCw className="h-3.5 w-3.5 mr-1.5 animate-spin" />Creating…</> : 'Create & Load Audience'}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => { setShowNew(false); setNewFilters({ state: '', district: '', board: '' }); setNewAudienceCount(null); }}>Cancel</Button>
            </div>
          </div>
        )}

        {/* Campaign list */}
        {loadingList ? (
          <div className="text-center py-16 text-gray-400">
            <RefreshCw className="h-6 w-6 animate-spin mx-auto mb-2 text-gray-300" />
            Loading…
          </div>
        ) : campaigns.length === 0 ? (
          <div className="text-center py-20 bg-white rounded-xl border border-gray-200">
            <MessageSquare className="h-10 w-10 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500 font-medium">No WA campaigns yet</p>
            <Button className="mt-4" size="sm" onClick={() => setShowNew(true)}>
              <Plus className="h-4 w-4 mr-1.5" /> New Campaign
            </Button>
          </div>
        ) : (
          <div className="space-y-2">
            {campaigns.map(c => {
              const cfg = STATUS_CFG[c.status] ?? STATUS_CFG.draft;
              const isOpen = expandedId === c.id;
              const pct = isOpen && stats.total > 0
                ? Math.round(((stats.sent + stats.failed) / stats.total) * 100)
                : 0;
              const isDone = c.status === 'sent' || (isOpen && stats.pending === 0 && stats.total > 0);

              return (
                <div
                  key={c.id}
                  className={`bg-white rounded-xl border transition-all ${isOpen ? 'border-green-300 shadow-sm' : 'border-gray-200 hover:border-gray-300'}`}
                >
                  {/* Card row — always visible */}
                  <div
                    className="flex items-center gap-4 p-4 cursor-pointer select-none"
                    onClick={() => expand(c)}
                  >
                    <div className="p-2 bg-green-50 rounded-lg flex-shrink-0">
                      <MessageSquare className="h-4 w-4 text-green-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                        <h3 className="font-semibold text-gray-900 text-sm truncate">{c.name}</h3>
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium flex-shrink-0 ${cfg.color}`}>
                          {cfg.label}
                        </span>
                      </div>
                      <p className="text-xs text-gray-400">
                        {new Date(c.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                      </p>
                    </div>
                    {/* Mini stats */}
                    <div className="hidden sm:flex gap-6 text-center flex-shrink-0">
                      {[
                        { label: 'Audience', value: c.audience_count, color: 'text-gray-700' },
                        { label: 'Sent',     value: c.sent_count,     color: 'text-green-600' },
                        { label: 'Failed',   value: c.failed_count,   color: 'text-red-500' },
                      ].map(({ label, value, color }) => (
                        <div key={label}>
                          <p className={`text-sm font-bold ${color}`}>{value.toLocaleString()}</p>
                          <p className="text-xs text-gray-400">{label}</p>
                        </div>
                      ))}
                    </div>
                    {isOpen
                      ? <ChevronUp className="h-4 w-4 text-gray-400 flex-shrink-0" />
                      : <ChevronDown className="h-4 w-4 text-gray-400 flex-shrink-0" />}
                    <button
                      onClick={e => deleteCampaign(c, e)}
                      className="p-1.5 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors flex-shrink-0"
                      title="Delete campaign"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  {/* Expanded detail */}
                  {isOpen && (
                    <div className="border-t border-gray-100 p-5 space-y-5">

                      {/* Progress */}
                      <div className="space-y-3">
                        <div className="flex items-center justify-between text-sm">
                          <span className="font-medium text-gray-700">Progress</span>
                          <span className="text-gray-400 flex items-center gap-1">
                            <Users className="h-3.5 w-3.5" />
                            {stats.total.toLocaleString()} schools
                          </span>
                        </div>
                        <div>
                          <div className="flex justify-between text-xs text-gray-400 mb-1">
                            <span>{(stats.sent + stats.failed).toLocaleString()} processed</span>
                            <span>{pct}%</span>
                          </div>
                          <div className="h-2.5 bg-gray-100 rounded-full overflow-hidden">
                            <div className="h-full bg-green-500 rounded-full transition-all duration-500" style={{ width: `${pct}%` }} />
                          </div>
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                          <div className="bg-green-50 border border-green-100 rounded-xl p-3 text-center">
                            <CheckCircle2 className="h-4 w-4 text-green-500 mx-auto mb-1" />
                            <p className="text-xl font-bold text-green-700">{stats.sent.toLocaleString()}</p>
                            <p className="text-xs text-green-600">Sent</p>
                          </div>
                          <div className="bg-red-50 border border-red-100 rounded-xl p-3 text-center">
                            <XCircle className="h-4 w-4 text-red-400 mx-auto mb-1" />
                            <p className="text-xl font-bold text-red-600">{stats.failed.toLocaleString()}</p>
                            <p className="text-xs text-red-500">Failed</p>
                          </div>
                          <div className="bg-amber-50 border border-amber-100 rounded-xl p-3 text-center">
                            <Clock className="h-4 w-4 text-amber-500 mx-auto mb-1" />
                            <p className="text-xl font-bold text-amber-700">{stats.pending.toLocaleString()}</p>
                            <p className="text-xs text-amber-600">Pending</p>
                          </div>
                        </div>
                        {lastBatch && sending && (
                          <p className="text-xs text-center text-gray-400">
                            Last batch: {lastBatch.sent} sent, {lastBatch.failed} failed
                          </p>
                        )}
                        {isDone && !sending && (
                          <div className="flex items-center gap-2 justify-center text-green-700 bg-green-50 rounded-xl p-2.5 text-sm font-medium">
                            <CheckCircle2 className="h-4 w-4" /> Campaign complete!
                          </div>
                        )}
                      </div>

                      {/* Delivery & Engagement */}
                      {(() => {
                        const deliveredCum = dStats ? dStats.delivered + dStats.read + dStats.replied : 0;
                        const readCum = dStats ? dStats.read + dStats.replied : 0;
                        const repliedN = dStats?.replied ?? 0;
                        const pctOf = (n: number) => stats.sent > 0 ? ` · ${Math.round((n / stats.sent) * 100)}%` : '';
                        return (
                          <div className="space-y-3">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2 text-sm font-medium text-gray-700">
                                <CheckCheck className="h-4 w-4 text-blue-500" /> Delivery &amp; Engagement
                              </div>
                              <Button
                                variant="outline" size="sm"
                                onClick={() => exportEngagement(c.id, c.name)}
                                disabled={exporting || engRows.length === 0}
                                className="h-7 text-xs"
                              >
                                {exporting
                                  ? <><RefreshCw className="h-3 w-3 mr-1 animate-spin" />Exporting…</>
                                  : <><Download className="h-3 w-3 mr-1" />Export CSV</>}
                              </Button>
                            </div>

                            <div className="grid grid-cols-3 gap-2">
                              <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-3 text-center">
                                <CheckCheck className="h-4 w-4 text-indigo-500 mx-auto mb-1" />
                                <p className="text-xl font-bold text-indigo-700">{deliveredCum.toLocaleString()}</p>
                                <p className="text-xs text-indigo-600">Delivered{pctOf(deliveredCum)}</p>
                              </div>
                              <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 text-center">
                                <Eye className="h-4 w-4 text-blue-500 mx-auto mb-1" />
                                <p className="text-xl font-bold text-blue-700">{readCum.toLocaleString()}</p>
                                <p className="text-xs text-blue-600">Read{pctOf(readCum)}</p>
                              </div>
                              <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-3 text-center">
                                <Reply className="h-4 w-4 text-emerald-500 mx-auto mb-1" />
                                <p className="text-xl font-bold text-emerald-700">{repliedN.toLocaleString()}</p>
                                <p className="text-xs text-emerald-600">Replied{pctOf(repliedN)}</p>
                              </div>
                            </div>

                            {/* Filter tabs */}
                            <div className="flex gap-1.5 flex-wrap">
                              {ENG_FILTERS.map(f => (
                                <button
                                  key={f.value}
                                  onClick={() => changeEngFilter(f.value)}
                                  className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                                    engFilter === f.value
                                      ? 'bg-gray-800 text-white'
                                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                                  }`}
                                >
                                  {f.label}
                                </button>
                              ))}
                            </div>

                            {/* School list */}
                            {engLoading && engRows.length === 0 ? (
                              <div className="text-center py-6 text-gray-400 text-sm">
                                <RefreshCw className="h-4 w-4 animate-spin mx-auto mb-1" /> Loading…
                              </div>
                            ) : engRows.length === 0 ? (
                              <div className="text-center py-6 bg-gray-50 rounded-xl text-xs text-gray-400">
                                No schools here yet. Delivery tracking went live 7 Jul 2026 —
                                messages sent before that only show as Sent.
                              </div>
                            ) : (
                              <div className="border border-gray-100 rounded-xl divide-y divide-gray-50 max-h-96 overflow-y-auto">
                                {engRows.map(r => {
                                  const dcfg = DELIVERY_CFG[r.delivery_status] ?? DELIVERY_CFG.sent;
                                  const when = r.opened_at ?? r.delivered_at ?? r.sent_at;
                                  return (
                                    <div key={r.id} className="px-3 py-2 flex items-start gap-3">
                                      <div className="flex-1 min-w-0">
                                        <p className="text-sm font-medium text-gray-800 truncate">{r.school_name}</p>
                                        <p className="text-xs text-gray-400 truncate">
                                          {[r.district, r.state].filter(Boolean).join(', ')}
                                          {r.mobile ? <span className="font-mono"> · {r.mobile}</span> : null}
                                        </p>
                                        {r.reply_text && (
                                          <p className="text-xs text-emerald-700 bg-emerald-50 rounded-lg px-2 py-1 mt-1 italic">
                                            “{r.reply_text}”
                                          </p>
                                        )}
                                      </div>
                                      <div className="text-right flex-shrink-0">
                                        <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${dcfg.color}`}>
                                          {dcfg.label}
                                        </span>
                                        {when && (
                                          <p className="text-[10px] text-gray-400 mt-0.5">
                                            {new Date(when).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                                          </p>
                                        )}
                                      </div>
                                    </div>
                                  );
                                })}
                                {engHasMore && (
                                  <button
                                    onClick={() => loadEngagement(c.id, engFilter, engRows.length)}
                                    disabled={engLoading}
                                    className="w-full py-2 text-xs text-indigo-600 hover:bg-indigo-50 font-medium"
                                  >
                                    {engLoading ? 'Loading…' : 'Load more'}
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })()}

                      {/* Template */}
                      <div className="space-y-3">
                        <div className="flex items-center gap-2 text-sm font-medium text-gray-700">
                          <FileText className="h-4 w-4 text-gray-400" /> Meta Template
                        </div>
                        <div className="space-y-1">
                          <label className="text-xs font-medium text-gray-600">Approved template name</label>
                          <Input
                            value={templateName}
                            onChange={e => setTemplateName(e.target.value.trim())}
                            onBlur={e => { if (e.target.value.trim()) saveTemplateName(e.target.value.trim()); }}
                            placeholder="e.g. iplus_ebrochure_2026"
                            className="font-mono text-sm"
                            disabled={sending}
                          />
                          <p className="text-xs text-gray-400">Exact name from AskEVA/Meta (lowercase, underscores).</p>
                        </div>

                        <div className="flex items-center gap-2">
                          <Checkbox
                            id={`confirm-${c.id}`}
                            checked={confirmed}
                            onCheckedChange={v => setConfirmed(!!v)}
                            disabled={sending}
                          />
                          <label htmlFor={`confirm-${c.id}`} className="text-sm text-gray-700 cursor-pointer select-none">
                            Template is approved in Meta and ready to send
                          </label>
                        </div>
                      </div>

                      {/* Test send */}
                      <div className="space-y-3">
                        <div className="flex items-center gap-2 text-sm font-medium text-gray-700">
                          <FlaskConical className="h-4 w-4 text-indigo-500" />
                          Test Send
                          <span className="text-xs text-gray-400 font-normal">Verify on your phone first</span>
                        </div>
                        <div className="min-h-[40px] flex flex-wrap gap-2 items-center border border-gray-200 rounded-xl px-3 py-2 bg-gray-50 focus-within:ring-2 focus-within:ring-indigo-300 focus-within:border-indigo-400 transition-all">
                          {testNumbers.map(n => (
                            <span key={n} className="flex items-center gap-1 bg-indigo-100 text-indigo-700 text-xs font-mono px-2 py-0.5 rounded-full">
                              {n}
                              <button onClick={() => { setTestNumbers(p => p.filter(x => x !== n)); setTestResults(null); }}>
                                <X className="h-3 w-3" />
                              </button>
                            </span>
                          ))}
                          <input
                            value={testInput}
                            onChange={e => setTestInput(e.target.value)}
                            onKeyDown={handleTestKeyDown}
                            onBlur={addTestNumber}
                            placeholder={testNumbers.length === 0 ? 'Type number + Enter (10-digit)' : 'Add another…'}
                            className="flex-1 min-w-28 bg-transparent text-sm outline-none placeholder:text-gray-400"
                            disabled={testSending || sending}
                          />
                        </div>
                        {testResults && (
                          <div className="space-y-1">
                            {testResults.map((r, i) => (
                              <div key={i} className={`flex items-center gap-3 px-3 py-2 rounded-xl text-sm ${r.success ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                                {r.success ? <CheckCircle2 className="h-4 w-4 flex-shrink-0" /> : <XCircle className="h-4 w-4 flex-shrink-0" />}
                                <span className="font-mono font-medium">{r.number}</span>
                                <span className="text-xs opacity-70">{r.success ? 'Delivered ✓' : r.error}</span>
                              </div>
                            ))}
                          </div>
                        )}
                        <Button
                          onClick={sendTest}
                          disabled={testNumbers.length === 0 || !templateName || testSending || sending}
                          variant="outline" size="sm"
                          className="border-indigo-200 text-indigo-700 hover:bg-indigo-50"
                        >
                          {testSending
                            ? <><RefreshCw className="h-3.5 w-3.5 mr-1.5 animate-spin" />Sending…</>
                            : <><FlaskConical className="h-3.5 w-3.5 mr-1.5" />Send Test{testNumbers.length > 0 ? ` to ${testNumbers.length}` : ''}</>}
                        </Button>
                      </div>

                      {/* Schedule */}
                      <div className="space-y-3 bg-purple-50 border border-purple-100 rounded-xl p-4">
                        <div className="flex items-center gap-2 text-sm font-medium text-purple-800">
                          <CalendarClock className="h-4 w-4" />
                          Schedule for Later
                          {c.status === 'scheduled' && c.scheduled_at && (
                            <span className="ml-auto text-xs font-normal text-purple-600">
                              Starts {new Date(c.scheduled_at).toLocaleString('en-IN', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' })}
                            </span>
                          )}
                        </div>
                        {c.status === 'scheduled' ? (
                          <div className="flex items-center gap-3">
                            <div className="flex-1 text-sm text-purple-700">
                              Campaign will auto-send at the scheduled time.
                            </div>
                            <Button
                              variant="outline" size="sm"
                              className="border-purple-300 text-purple-700 hover:bg-purple-100"
                              onClick={() => cancelSchedule(c.id)}
                            >
                              Cancel Schedule
                            </Button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            <input
                              type="datetime-local"
                              value={scheduleAt}
                              onChange={e => { setScheduleAt(e.target.value); setScheduleError(null); }}
                              min={new Date(Date.now() + 60000).toISOString().slice(0,16)}
                              className="flex-1 border border-purple-200 rounded-lg px-3 py-1.5 text-sm bg-white text-gray-800 focus:outline-none focus:ring-2 focus:ring-purple-300"
                              disabled={sending}
                            />
                            <Button
                              size="sm"
                              className="bg-purple-600 hover:bg-purple-700 text-white"
                              onClick={() => scheduleCampaign(c.id)}
                              disabled={!scheduleAt || !templateName || !confirmed || scheduling || sending}
                            >
                              {scheduling
                                ? <><RefreshCw className="h-3.5 w-3.5 mr-1.5 animate-spin" />Scheduling…</>
                                : <><CalendarClock className="h-3.5 w-3.5 mr-1.5" />Schedule</>}
                            </Button>
                          </div>
                        )}
                        {scheduleError && <p className="text-xs text-red-600">{scheduleError}</p>}
                        {c.status !== 'scheduled' && (
                          <p className="text-xs text-purple-600">Recommended: 7–9 AM. Early morning sends avoid Meta's frequency cap (phone hasn't received other marketing messages yet).</p>
                        )}
                      </div>

                      {detailError && (
                        <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-700 flex items-start gap-2">
                          <XCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />{detailError}
                        </div>
                      )}

                      {/* Send controls */}
                      <div className="flex gap-3">
                        {sending ? (
                          <>
                            <div className="flex-1 bg-green-50 border border-green-200 rounded-xl h-11 flex items-center justify-center gap-2 text-green-700 text-sm font-medium">
                              <RefreshCw className="h-4 w-4 animate-spin" />
                              Sending… {stats.pending.toLocaleString()} remaining
                            </div>
                            <Button onClick={() => { setPausing(true); pauseRef.current = true; }} variant="outline" disabled={pausing} className="h-11 px-5">
                              <Pause className="h-4 w-4 mr-1.5" />
                              {pausing ? 'Pausing…' : 'Pause'}
                            </Button>
                          </>
                        ) : c.status === 'sending' ? (
                          <>
                            <div className="flex-1 bg-blue-50 border border-blue-200 rounded-xl h-11 flex items-center justify-center gap-2 text-blue-700 text-sm font-medium">
                              <RefreshCw className="h-4 w-4 animate-spin" />
                              Running in background… {stats.pending.toLocaleString()} remaining
                            </div>
                            <Button onClick={() => pauseCampaign(c.id)} variant="outline" className="h-11 px-5 border-amber-300 text-amber-700 hover:bg-amber-50">
                              <Pause className="h-4 w-4 mr-1.5" />
                              Pause
                            </Button>
                          </>
                        ) : c.status === 'paused' ? (
                          <>
                            <div className="flex-1 bg-amber-50 border border-amber-200 rounded-xl h-11 flex items-center justify-center gap-2 text-amber-700 text-sm font-medium">
                              <Pause className="h-4 w-4" />
                              Campaign paused — {stats.pending.toLocaleString()} remaining
                            </div>
                            <Button onClick={() => resumeCampaign(c.id)} className="h-11 px-5 bg-green-600 hover:bg-green-700">
                              <Send className="h-4 w-4 mr-1.5" />
                              Resume
                            </Button>
                          </>
                        ) : (
                          <Button
                            onClick={() => sendAll(c.id)}
                            disabled={!confirmed || !templateName || stats.pending === 0 || c.status === 'scheduled'}
                            className="flex-1 bg-green-600 hover:bg-green-700 h-11 font-semibold"
                          >
                            <Send className="h-4 w-4 mr-2" />
                            {c.status === 'scheduled'
                              ? 'Scheduled (cancel to send now)'
                              : stats.pending === 0 && stats.total > 0
                                ? 'All Sent'
                                : `Send Now to ${stats.pending.toLocaleString()} Schools`}
                          </Button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Non-WA numbers exclusion upload */}
        {!loadingList && (
          <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="font-medium text-gray-700 text-sm">📋 Non-WhatsApp number exclusion</p>
                <p className="text-xs text-gray-400 mt-0.5">
                  Upload a campaign result file (CSV/TXT from AskEVA) — the numbers in it are flagged as
                  not on WhatsApp and excluded from all future campaign audiences.
                  {exclCount !== null && (
                    <> Currently excluded: <span className="font-semibold text-gray-600">{exclCount.toLocaleString()}</span> schools.</>
                  )}
                </p>
              </div>
              <label className="flex-shrink-0 inline-flex items-center px-3 py-1.5 rounded-lg border border-indigo-200 text-indigo-700 text-xs font-medium hover:bg-indigo-50 cursor-pointer transition-colors">
                <input
                  type="file"
                  accept=".csv,.txt,.tsv"
                  className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; if (f) onExclFile(f); e.target.value = ''; }}
                />
                Upload result file
              </label>
            </div>

            {exclParsed && (
              exclParsed.length > 0 ? (
                <div className="flex items-center gap-3 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                  <p className="text-xs text-amber-800 flex-1">
                    <span className="font-medium">{exclFileName}</span>: found{' '}
                    <b>{exclParsed.length.toLocaleString()}</b> unique valid mobile numbers.
                    Flag them as not on WhatsApp?
                  </p>
                  <Button size="sm" onClick={flagExcluded} disabled={exclUploading} className="h-7 text-xs">
                    {exclUploading ? <><RefreshCw className="h-3 w-3 mr-1 animate-spin" />Flagging…</> : 'Flag & Exclude'}
                  </Button>
                  <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => { setExclParsed(null); setExclFileName(''); }}>
                    Cancel
                  </Button>
                </div>
              ) : (
                <p className="text-xs text-red-500">{exclFileName}: no valid mobile numbers found in this file.</p>
              )
            )}
            {exclError && <p className="text-xs text-red-500">{exclError}</p>}
            {exclResult && (
              <p className="text-xs text-green-700 bg-green-50 rounded-lg px-3 py-2">
                ✓ {exclResult.flagged.toLocaleString()} school{exclResult.flagged === 1 ? '' : 's'} flagged as not on WhatsApp
                {exclResult.pending_skipped > 0 && <>; {exclResult.pending_skipped.toLocaleString()} pending sends in open campaigns were skipped</>}.
                Future campaign audiences exclude them automatically. Numbers not matching any prospect school are ignored.
              </p>
            )}
          </div>
        )}
      </div>
    </ProspectLayout>
  );
}
