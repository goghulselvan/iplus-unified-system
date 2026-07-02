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

const STATUS_CFG: Record<string, { label: string; color: string }> = {
  draft:     { label: 'Draft',      color: 'bg-gray-100 text-gray-600' },
  scheduled: { label: 'Scheduled',  color: 'bg-purple-100 text-purple-700' },
  sending:   { label: 'Sending',    color: 'bg-blue-100 text-blue-700' },
  sent:      { label: 'Sent',      color: 'bg-green-100 text-green-700' },
  paused:    { label: 'Paused',    color: 'bg-amber-100 text-amber-700' },
  cancelled: { label: 'Cancelled', color: 'bg-red-100 text-red-500' },
};

const AUDIENCE_DESC = 'WhatsApp brochure campaign to all prospect schools with valid 10-digit mobile';

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

  // Per-expanded-campaign state (resets on collapse)
  const [stats, setStats] = useState<Stats>({ total: 0, sent: 0, failed: 0, pending: 0 });
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

  const refreshStats = useCallback(async (campaignId: string) => {
    const { data } = await supabase.rpc('get_wa_campaign_progress', { p_campaign_id: campaignId });
    if (data) setStats(data as Stats);
  }, []);

  const resetDetail = () => {
    setSending(false); setPausing(false); pauseRef.current = false;
    setConfirmed(false); setLastBatch(null); setDetailError(null);
    setTestInput(''); setTestNumbers([]); setTestResults(null);
    setTemplateName('');
    setScheduleAt(''); setScheduling(false); setScheduleError(null);
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
    await refreshStats(c.id);
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
        })
        .select('id, name, description, status, sent_count, failed_count, audience_count, created_at, scheduled_at, whatsapp_template_name')
        .single();
      if (error) throw error;
      await supabase.rpc('populate_wa_campaign_audience', { p_campaign_id: created.id });
      setShowNew(false);
      const tpl = newTemplate.trim();
      setNewName(''); setNewTemplate('');
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
          <div className="bg-white rounded-xl border border-indigo-200 p-5 space-y-3">
            <h3 className="font-semibold text-gray-800 text-sm">New WA Campaign</h3>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-gray-600">Campaign name</label>
                <Input
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  placeholder="e.g. iPlus Olympiads 2026 – Brochure"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-gray-600">Meta template name</label>
                <Input
                  value={newTemplate}
                  onChange={e => setNewTemplate(e.target.value)}
                  placeholder="e.g. iplus_olympiads_2026"
                  className="font-mono text-sm"
                />
              </div>
            </div>
            {createError && <p className="text-xs text-red-500">{createError}</p>}
            <div className="flex gap-2">
              <Button
                onClick={createCampaign}
                disabled={creating || !newName.trim() || !newTemplate.trim()}
                size="sm"
              >
                {creating
                  ? <><RefreshCw className="h-3.5 w-3.5 mr-1.5 animate-spin" />Creating…</>
                  : 'Create & Load Audience'}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setShowNew(false)}>Cancel</Button>
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

        {/* Non-WA numbers placeholder */}
        {!loadingList && campaigns.length > 0 && (
          <div className="bg-gray-50 border border-dashed border-gray-200 rounded-xl p-4 text-sm text-gray-500">
            <p className="font-medium text-gray-600 mb-1">📋 Non-WhatsApp number filtering</p>
            Once you get the exclusion list from AskEVA, share it here — numbers will be flagged and excluded from future campaigns automatically.
          </div>
        )}
      </div>
    </ProspectLayout>
  );
}
