import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import ProspectLayout from '@/components/prospect/ProspectLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { ArrowLeft, Mail, MessageSquare, Users, Send, Clock, CheckCircle, XCircle, RefreshCw } from 'lucide-react';

type Campaign = {
  id: string; name: string; description: string | null; channel: string;
  status: string; scheduled_at: string | null; email_subject: string | null;
  target_count: number; sent_count: number; delivered_count: number;
  opened_count: number; bounced_count: number; failed_count: number;
  audience_count: number; audience_filters: any;
  created_at: string; started_at: string | null; completed_at: string | null;
  send_mode: string; send_start_date: string | null; send_plan: any;
  seed_enabled: boolean;
};
type SeedContact = { id: string; email: string; name: string | null; is_active: boolean };
type SchoolRow = {
  id: string; status: string; sent_at: string | null; opened_at: string | null;
  bounced: boolean; error_message: string | null;
  prospect_schools: { school_name: string; district: string; email: string | null; mobile: string | null } | null;
};

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  draft:      { label: 'Draft',      color: 'text-gray-600',   bg: 'bg-gray-100' },
  scheduled:  { label: 'Scheduled',  color: 'text-amber-700',  bg: 'bg-amber-100' },
  sending:    { label: 'Sending…',   color: 'text-blue-700',   bg: 'bg-blue-100' },
  sent:       { label: 'Sent',       color: 'text-green-700',  bg: 'bg-green-100' },
  paused:     { label: 'Paused',     color: 'text-amber-700',  bg: 'bg-amber-100' },
  cancelled:  { label: 'Cancelled',  color: 'text-red-600',    bg: 'bg-red-100' },
};

const SCHOOL_STATUS: Record<string, { label: string; color: string }> = {
  pending:   { label: 'Pending',   color: 'text-gray-500' },
  sent:      { label: 'Sent',      color: 'text-blue-600' },
  delivered: { label: 'Delivered', color: 'text-indigo-600' },
  opened:    { label: 'Opened',    color: 'text-green-600' },
  bounced:   { label: 'Bounced',   color: 'text-red-600' },
  failed:    { label: 'Failed',    color: 'text-red-500' },
};

// Test recipients can be entered separated by comma, space, semicolon or newline.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const parseTestEmails = (raw: string) => {
  const parts = [...new Set(raw.split(/[\s,;]+/).map(e => e.trim()).filter(Boolean))];
  return { valid: parts.filter(e => EMAIL_RE.test(e)), invalid: parts.filter(e => !EMAIL_RE.test(e)) };
};

// Smart Email Manager — daily-volume safety bands & domain reputation thresholds.
const SAFE_GREEN = 5000;        // ≤ this/day = safe
const SAFE_AMBER = 15000;       // ≤ this/day = ok for a warmed domain
const MONTHLY_CAP = 100000;     // Elastic Starter plan: 100k emails/month
const WARMED_AFTER = 40000;     // lifetime sent ≥ this ⇒ domain treated as warmed
const verdictFor = (daily: number) =>
  daily <= SAFE_GREEN
    ? { emoji: '🟢', label: 'Safe', cls: 'text-green-700 bg-green-50 border-green-200' }
    : daily <= SAFE_AMBER
    ? { emoji: '🟡', label: 'OK for a warmed domain — monitor', cls: 'text-amber-700 bg-amber-50 border-amber-200' }
    : { emoji: '🔴', label: 'Not recommended — too much per day', cls: 'text-red-700 bg-red-50 border-red-200' };

export default function ProspectCampaignDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [schools, setSchools]   = useState<SchoolRow[]>([]);
  const [total, setTotal]       = useState(0);
  const [page, setPage]         = useState(0);
  const [statusFilter, setStatusFilter] = useState('all');
  const [loading, setLoading]   = useState(true);
  const [sending, setSending]   = useState(false);
  const [testInput, setTestInput] = useState('');
  const [testChips, setTestChips] = useState<string[]>([]);
  const [batchSize, setBatchSize] = useState(500);
  // Smart Email Manager UI state
  const [sendUiMode, setSendUiMode] = useState<'manual' | 'smart'>('smart');
  const [startDate, setStartDate] = useState(() => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10));
  const [days, setDays] = useState(0);
  const [stats, setStats] = useState<{ lifetime_sent: number; month_sent: number } | null>(null);
  // Monitoring (seed) contacts
  const [seeds, setSeeds] = useState<SeedContact[]>([]);
  const [seedInput, setSeedInput] = useState('');
  const [showSeedMgr, setShowSeedMgr] = useState(false);
  const { toast } = useToast();

  const loadSeeds = async () => {
    const { data } = await supabase.from('seed_contacts').select('*').order('created_at');
    setSeeds((data || []) as SeedContact[]);
  };
  const addSeed = async () => {
    const email = seedInput.trim().toLowerCase();
    if (!EMAIL_RE.test(email)) { toast({ title: 'Enter a valid email', variant: 'destructive' }); return; }
    const { error } = await supabase.from('seed_contacts').insert({ email });
    if (error) { toast({ title: 'Could not add', description: error.message, variant: 'destructive' }); return; }
    setSeedInput(''); await loadSeeds();
  };
  const removeSeed = async (id: string) => {
    await supabase.from('seed_contacts').delete().eq('id', id);
    await loadSeeds();
  };
  const toggleSeedEnabled = async (val: boolean) => {
    await supabase.from('campaigns').update({ seed_enabled: val }).eq('id', id!);
    await reloadCampaign();
  };

  const PAGE = 50;

  const reloadCampaign = async () => {
    const { data } = await supabase.from('campaigns').select('*').eq('id', id!).single();
    if (!data) return;
    // Count live from campaign_schools — campaigns.sent_count is not reliably updated
    const { data: counts } = await supabase
      .from('campaign_schools')
      .select('status')
      .eq('campaign_id', id!);
    if (counts) {
      const tally = counts.reduce((acc, r) => { acc[r.status] = (acc[r.status] || 0) + 1; return acc; }, {} as Record<string, number>);
      (data as any).sent_count      = (tally['sent'] || 0) + (tally['sending'] || 0);
      (data as any).delivered_count = tally['delivered'] || 0;
      (data as any).opened_count    = tally['opened'] || 0;
      (data as any).bounced_count   = tally['bounced'] || 0;
      (data as any).failed_count    = tally['failed'] || 0;
    }
    setCampaign(data as Campaign);
  };

  // ── Chips-style test recipients ──
  const commitInput = (raw: string) => {
    const { valid, invalid } = parseTestEmails(raw);
    if (valid.length) setTestChips(prev => [...new Set([...prev, ...valid])]);
    setTestInput(invalid.join(' '));
  };
  const removeChip = (email: string) => setTestChips(prev => prev.filter(e => e !== email));
  const onTestKeyDown = (e: any) => {
    if (['Enter', ',', ';', ' '].includes(e.key)) { e.preventDefault(); commitInput(testInput); }
    else if (e.key === 'Backspace' && !testInput && testChips.length) setTestChips(prev => prev.slice(0, -1));
  };
  const sendTest = async () => {
    const pending = parseTestEmails(testInput).valid;
    const all = [...new Set([...testChips, ...pending])];
    if (all.length === 0) { toast({ title: 'Add at least one valid email', variant: 'destructive' }); return; }
    setSending(true);
    const { data, error } = await supabase.functions.invoke('send-campaign', { body: { campaign_id: id, test_emails: all } });
    setSending(false);
    if (error || data?.error) { toast({ title: 'Test failed', description: data?.error || error?.message, variant: 'destructive' }); return; }
    setTestInput('');
    const notes = data.failed?.length ? `${data.failed.length} failed: ${data.failed[0]}` : '';
    toast({ title: `Test sent to ${data.sent}/${data.total}`, description: notes || all.join(', ') });
  };

  // ── Smart Email Manager activation ──
  const activateSmart = async (warmed: boolean) => {
    const plan = warmed ? { type: 'even', days } : { type: 'warmup' };
    setSending(true);
    const { error } = await supabase.from('campaigns')
      .update({ send_mode: 'auto', send_start_date: startDate, send_plan: plan, status: 'scheduled' })
      .eq('id', id!);
    setSending(false);
    if (error) { toast({ title: 'Could not activate', description: error.message, variant: 'destructive' }); return; }
    toast({ title: 'Smart sending activated', description: `Auto-sends from ${startDate}, Mon–Fri 9am–6pm IST` });
    await reloadCampaign();
  };
  const setCampaignStatus = async (status: string) => {
    await supabase.from('campaigns').update({ status }).eq('id', id!);
    await reloadCampaign();
    toast({ title: status === 'paused' ? 'Smart sending paused' : 'Smart sending resumed' });
  };
  const sendBatch = async () => {
    setSending(true);
    const { data, error } = await supabase.functions.invoke('send-campaign', { body: { campaign_id: id, limit: batchSize } });
    setSending(false);
    if (error || data?.error) { toast({ title: 'Send failed', description: data?.error || error?.message, variant: 'destructive' }); return; }
    toast({ title: `Batch sent: ${data.sent}${data.failed ? ` · ${data.failed} failed` : ''}`, description: data.done ? 'Campaign complete ✓' : `${data.remaining.toLocaleString()} remaining` });
    await reloadCampaign();
    setStatusFilter('all'); setPage(0);
  };

  useEffect(() => {
    supabase.from('campaigns').select('*').eq('id', id!).single()
      .then(({ data }) => setCampaign(data as Campaign));
    supabase.rpc('get_domain_send_stats').then(({ data }) => {
      const row = Array.isArray(data) ? data[0] : data;
      if (row) setStats({ lifetime_sent: Number(row.lifetime_sent), month_sent: Number(row.month_sent) });
    });
    loadSeeds();
  }, [id]);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    let q = supabase.from('campaign_schools')
      .select('id,status,sent_at,opened_at,error_message,prospect_schools(school_name,district,email,mobile)', { count: 'exact' })
      .eq('campaign_id', id!)
      .order('created_at')
      .range(page * PAGE, (page + 1) * PAGE - 1);
    if (statusFilter !== 'all') q = q.eq('status', statusFilter);
    q.then(({ data, count }) => {
      setSchools((data || []) as SchoolRow[]);
      setTotal(count ?? 0);
      setLoading(false);
    });
  }, [id, page, statusFilter]);

  if (!campaign) return <ProspectLayout><div className="p-10 text-center text-gray-400 text-lg">Loading…</div></ProspectLayout>;

  const cfg = STATUS_CONFIG[campaign.status] ?? STATUS_CONFIG.draft;
  const deliveryRate = campaign.sent_count > 0 ? Math.round((campaign.delivered_count / campaign.sent_count) * 100) : null;
  const openRate = campaign.delivered_count > 0 ? Math.round((campaign.opened_count / campaign.delivered_count) * 100) : null;
  const bounceRate = campaign.sent_count > 0 ? Math.round((campaign.bounced_count / campaign.sent_count) * 100) : null;
  const totalPages = Math.ceil(total / PAGE);

  // ── Smart Email Manager derived planning ──
  const warmed = (stats?.lifetime_sent ?? 0) >= WARMED_AFTER;
  const audienceTotal = campaign.audience_count || campaign.target_count || total || 0;
  const minDaysSafe = Math.max(1, Math.ceil(audienceTotal / SAFE_GREEN));
  const minDaysOk = Math.max(1, Math.ceil(audienceTotal / SAFE_AMBER));
  const effDays = days > 0 ? days : minDaysSafe;
  const dailyEven = Math.ceil(audienceTotal / Math.max(1, effDays));
  const verdict = verdictFor(dailyEven);
  const monthExceed = stats ? (audienceTotal + stats.month_sent) > MONTHLY_CAP : false;
  const isAuto = campaign.send_mode === 'auto' && ['scheduled', 'sending', 'paused'].includes(campaign.status);
  const todayIST = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);

  return (
    <ProspectLayout>
      <div className="max-w-6xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="flex items-center gap-4 mb-8">
          <button onClick={() => navigate('/prospect/campaigns')}
            className="flex items-center gap-1.5 text-gray-500 hover:text-gray-800 text-base font-medium transition-colors">
            <ArrowLeft className="h-5 w-5" /> Campaigns
          </button>
          <span className="text-gray-300 text-xl">/</span>
          <h1 className="text-2xl font-bold text-gray-900 flex-1">{campaign.name}</h1>
          <span className={`px-4 py-2 rounded-xl text-base font-semibold ${cfg.bg} ${cfg.color}`}>{cfg.label}</span>
        </div>

        {/* Sending controls — Smart Email Manager (email campaigns) */}
        {campaign.channel === 'email' && (
          <div className="bg-white rounded-xl border p-5 mb-6 space-y-4">
            <div className="flex items-center justify-between">
              <p className="font-semibold text-sm">Sending</p>
              <Button variant="ghost" size="sm" onClick={reloadCampaign} disabled={sending}>
                <RefreshCw className="h-3.5 w-3.5" />
              </Button>
            </div>

            {/* Test recipients — chips */}
            <div>
              <label className="text-xs text-muted-foreground block mb-1">
                Send a test to <span className="text-gray-400">(type emails, separate with comma / space / Enter)</span>
              </label>
              <div className="flex flex-wrap items-center gap-1.5 border rounded-md px-2 py-1.5 min-h-9">
                {testChips.map(e => (
                  <span key={e} className="inline-flex items-center gap-1 bg-indigo-50 text-indigo-700 text-xs rounded-full pl-2.5 pr-1 py-0.5">
                    {e}
                    <button onClick={() => removeChip(e)} className="hover:bg-indigo-200 rounded-full w-4 h-4 inline-flex items-center justify-center leading-none">×</button>
                  </span>
                ))}
                <input value={testInput} onChange={e => setTestInput(e.target.value)} onKeyDown={onTestKeyDown} onBlur={() => commitInput(testInput)}
                  placeholder={testChips.length ? 'add another…' : 'you@example.com'}
                  className="flex-1 min-w-[140px] outline-none text-sm py-0.5 bg-transparent" />
                <Button variant="outline" size="sm" className="h-7" onClick={sendTest} disabled={sending}>Send test</Button>
              </div>
              <p className="text-[11px] mt-1 text-muted-foreground">
                {testChips.length} recipient{testChips.length === 1 ? '' : 's'}{testChips.length > 25 ? ' · only first 25 sent' : ''}
              </p>
            </div>

            {/* Monitoring (seed) contacts */}
            <div className="rounded-lg border border-gray-200 bg-gray-50/60 px-3 py-2.5">
              <div className="flex items-center justify-between gap-2">
                <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                  <input type="checkbox" className="h-4 w-4 accent-indigo-600"
                    checked={campaign.seed_enabled} onChange={e => toggleSeedEnabled(e.target.checked)} />
                  Also send to monitoring contacts <span className="text-gray-400">({seeds.filter(s => s.is_active).length})</span>
                </label>
                <button onClick={() => setShowSeedMgr(v => !v)} className="text-xs text-indigo-600 hover:underline">
                  {showSeedMgr ? 'close' : 'manage'}
                </button>
              </div>
              <p className="text-[11px] text-muted-foreground mt-1">Your team receives a copy at launch &amp; on every test, to check delivery &amp; inbox placement.</p>
              {showSeedMgr && (
                <div className="mt-2.5 border-t border-gray-200 pt-2.5 space-y-2">
                  <div className="flex gap-2">
                    <Input value={seedInput} onChange={e => setSeedInput(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addSeed(); } }}
                      placeholder="director@iplusedu.in" className="h-8 flex-1 text-sm" />
                    <Button variant="outline" size="sm" className="h-8" onClick={addSeed}>Add</Button>
                  </div>
                  {seeds.length === 0 ? (
                    <p className="text-[11px] text-gray-400">No monitoring contacts yet — add your 5–7 directors above.</p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {seeds.map(s => (
                        <span key={s.id} className="inline-flex items-center gap-1 bg-white border border-gray-200 text-gray-700 text-xs rounded-full pl-2.5 pr-1 py-0.5">
                          {s.email}
                          <button onClick={() => removeSeed(s.id)} className="hover:bg-gray-200 rounded-full w-4 h-4 inline-flex items-center justify-center leading-none">×</button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {campaign.status === 'sent' ? (
              <p className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">Campaign complete ✓ — all emails sent.</p>
            ) : isAuto ? (
              /* Active Smart Sender */
              <div className="rounded-lg border border-indigo-200 bg-indigo-50/50 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-indigo-800">
                    {campaign.status === 'paused' ? '⏸ Smart sending paused' : '🟢 Smart sending active'}
                  </p>
                  {campaign.status === 'paused'
                    ? <Button size="sm" className="h-8 bg-indigo-600 hover:bg-indigo-700" onClick={() => setCampaignStatus(campaign.started_at ? 'sending' : 'scheduled')}>Resume</Button>
                    : <Button size="sm" variant="outline" className="h-8" onClick={() => setCampaignStatus('paused')}>Pause</Button>}
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                  <div><p className="text-xs text-gray-500">Plan</p><p className="font-semibold capitalize">{campaign.send_plan?.type ?? 'warmup'}{campaign.send_plan?.days ? ` · ${campaign.send_plan.days}d` : ''}</p></div>
                  <div><p className="text-xs text-gray-500">Starts</p><p className="font-semibold">{campaign.send_start_date}</p></div>
                  <div><p className="text-xs text-gray-500">Sent</p><p className="font-semibold">{campaign.sent_count.toLocaleString()} / {audienceTotal.toLocaleString()}</p></div>
                  <div><p className="text-xs text-gray-500">Window</p><p className="font-semibold">Mon–Fri 9–6 IST</p></div>
                </div>
                <p className="text-[11px] text-muted-foreground">Runs automatically — no clicking needed. Pause anytime to stop further sends.</p>
              </div>
            ) : (
              /* Setup */
              <>
                <div className="flex gap-2">
                  {(['smart', 'manual'] as const).map(m => (
                    <button key={m} onClick={() => setSendUiMode(m)}
                      className={`px-3 py-1.5 rounded-lg text-sm font-medium border ${sendUiMode === m ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-600 border-gray-200 hover:border-indigo-300'}`}>
                      {m === 'smart' ? 'Smart auto-sender' : 'Manual batches'}
                    </button>
                  ))}
                </div>

                {sendUiMode === 'manual' ? (
                  <div className="flex flex-wrap items-end gap-3">
                    <div>
                      <label className="text-xs text-muted-foreground block mb-1">Batch size</label>
                      <Input type="number" min={1} max={5000} value={batchSize}
                        onChange={e => setBatchSize(Math.max(1, Math.min(5000, parseInt(e.target.value) || 500)))} className="h-9 w-28" />
                    </div>
                    <Button className="bg-indigo-600 hover:bg-indigo-700 h-9" onClick={sendBatch} disabled={sending}>
                      <Send className="h-4 w-4 mr-2" />{sending ? 'Sending…' : `Send next ${batchSize.toLocaleString()}`}
                    </Button>
                    <p className="text-[11px] text-muted-foreground w-full">Manually send one batch now. Unsubscribes &amp; bounced are auto-excluded.</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-end gap-3">
                      <div>
                        <label className="text-xs text-muted-foreground block mb-1">Start date</label>
                        <Input type="date" value={startDate} min={todayIST} onChange={e => setStartDate(e.target.value)} className="h-9 w-44" />
                      </div>
                      <div>
                        <label className="text-xs text-muted-foreground block mb-1">Audience</label>
                        <div className="h-9 flex items-center font-semibold text-sm">{audienceTotal.toLocaleString()} schools</div>
                      </div>
                      {warmed && (
                        <div>
                          <label className="text-xs text-muted-foreground block mb-1">Complete in (days)</label>
                          <Input type="number" min={1} value={days || minDaysSafe}
                            onChange={e => setDays(Math.max(1, parseInt(e.target.value) || 1))} className="h-9 w-28" />
                        </div>
                      )}
                    </div>

                    {!warmed ? (
                      <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
                        <p className="font-semibold mb-0.5">Domain still warming up</p>
                        <p className="text-[13px]">Only {(stats?.lifetime_sent ?? 0).toLocaleString()} emails sent so far. The manager will use a gradual ramp (200 → 1k → 3k → 9k/day, ≈13 days) to protect reputation. The “complete in X days” option unlocks after {WARMED_AFTER.toLocaleString()} sent.</p>
                      </div>
                    ) : (
                      <div className={`rounded-lg border px-3 py-2.5 text-sm ${verdict.cls}`}>
                        <p className="font-semibold">{verdict.emoji} {dailyEven.toLocaleString()} emails/day — {verdict.label}</p>
                        {dailyEven > SAFE_AMBER && <p className="text-[13px] mt-0.5">Use at least {minDaysOk} days (or {minDaysSafe} days to stay 🟢).</p>}
                        {dailyEven > SAFE_GREEN && dailyEven <= SAFE_AMBER && <p className="text-[13px] mt-0.5">For 🟢 safe, spread over {minDaysSafe} days.</p>}
                      </div>
                    )}

                    {monthExceed && (
                      <p className="text-[12px] text-red-600">⚠ This campaign ({audienceTotal.toLocaleString()}) plus {stats?.month_sent.toLocaleString()} already sent this month exceeds your {MONTHLY_CAP.toLocaleString()}/mo Elastic plan.</p>
                    )}

                    <Button className="bg-indigo-600 hover:bg-indigo-700 h-9"
                      disabled={sending || (warmed && dailyEven > SAFE_AMBER)} onClick={() => activateSmart(warmed)}>
                      <Send className="h-4 w-4 mr-2" />Activate Smart Sending
                    </Button>
                    <p className="text-[11px] text-muted-foreground">Auto-sends Mon–Fri 9am–6pm IST, dripped across the day, until complete. Pause anytime.</p>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* Stat cards */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8">
          {[
            { label: 'Target',    value: campaign.target_count,    color: 'text-gray-800',   bg: 'bg-gray-50',    icon: Users },
            { label: 'Sent',      value: campaign.sent_count,      color: 'text-blue-700',   bg: 'bg-blue-50',    icon: Send },
            { label: 'Delivered', value: campaign.delivered_count, color: 'text-indigo-700', bg: 'bg-indigo-50',  icon: CheckCircle },
            { label: 'Opened',    value: campaign.opened_count,    color: 'text-green-700',  bg: 'bg-green-50',   icon: Mail },
            { label: 'Bounced',   value: campaign.bounced_count,   color: 'text-red-600',    bg: 'bg-red-50',     icon: XCircle },
          ].map(({ label, value, color, bg, icon: Icon }) => (
            <div key={label} className={`${bg} rounded-2xl p-5 text-center`}>
              <p className={`text-3xl font-bold ${color}`}>{value.toLocaleString()}</p>
              <p className="text-sm text-gray-500 mt-1 font-medium">{label}</p>
            </div>
          ))}
        </div>

        {/* Rate badges */}
        {(deliveryRate !== null || openRate !== null || bounceRate !== null) && (
          <div className="flex gap-4 mb-8 flex-wrap">
            {deliveryRate !== null && (
              <div className="bg-white border border-gray-200 rounded-xl px-5 py-3 text-center">
                <p className="text-2xl font-bold text-indigo-700">{deliveryRate}%</p>
                <p className="text-sm text-gray-500">Delivery Rate</p>
              </div>
            )}
            {openRate !== null && (
              <div className="bg-white border border-gray-200 rounded-xl px-5 py-3 text-center">
                <p className="text-2xl font-bold text-green-700">{openRate}%</p>
                <p className="text-sm text-gray-500">Open Rate</p>
              </div>
            )}
            {bounceRate !== null && (
              <div className="bg-white border border-gray-200 rounded-xl px-5 py-3 text-center">
                <p className="text-2xl font-bold text-red-600">{bounceRate}%</p>
                <p className="text-sm text-gray-500">Bounce Rate</p>
              </div>
            )}
          </div>
        )}

        {/* Campaign info */}
        <div className="bg-white rounded-2xl border border-gray-200 p-6 mb-6 grid grid-cols-2 md:grid-cols-3 gap-x-8 gap-y-4 text-base">
          <div><p className="text-sm text-gray-500 font-medium mb-0.5">Channel</p><p className="text-gray-900 font-semibold capitalize">{campaign.channel}</p></div>
          <div><p className="text-sm text-gray-500 font-medium mb-0.5">Created</p><p className="text-gray-900">{new Date(campaign.created_at).toLocaleString('en-IN')}</p></div>
          {campaign.scheduled_at && <div><p className="text-sm text-gray-500 font-medium mb-0.5">Scheduled</p><p className="text-gray-900">{new Date(campaign.scheduled_at).toLocaleString('en-IN')}</p></div>}
          {campaign.email_subject && <div className="col-span-2"><p className="text-sm text-gray-500 font-medium mb-0.5">Subject</p><p className="text-gray-900">{campaign.email_subject}</p></div>}
          {campaign.description && <div className="col-span-2"><p className="text-sm text-gray-500 font-medium mb-0.5">Description</p><p className="text-gray-600">{campaign.description}</p></div>}
        </div>

        {/* School-level status */}
        <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
          <div className="px-6 py-5 border-b border-gray-100 flex items-center justify-between flex-wrap gap-3">
            <div>
              <h2 className="text-lg font-bold text-gray-900">School Status</h2>
              <p className="text-sm text-gray-500 mt-0.5">{total.toLocaleString()} schools in this campaign</p>
            </div>
            <div className="flex gap-2 flex-wrap">
              {['all', 'pending', 'sent', 'opened', 'bounced', 'failed'].map(s => (
                <button key={s} onClick={() => { setStatusFilter(s); setPage(0); }}
                  className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors border ${
                    statusFilter === s ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-600 border-gray-200 hover:border-indigo-300'
                  }`}>
                  {s === 'all' ? 'All' : SCHOOL_STATUS[s]?.label}
                </button>
              ))}
            </div>
          </div>

          {total === 0 && !loading ? (
            <div className="text-center py-16 text-gray-400">
              <Users className="h-10 w-10 mx-auto mb-3" />
              <p className="text-lg font-medium text-gray-600">No schools added yet</p>
              <p className="text-sm mt-1">Schools will appear here once the campaign is sent</p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-100">
                      <th className="text-left px-6 py-4 font-semibold text-gray-600 text-sm">School</th>
                      <th className="text-left px-6 py-4 font-semibold text-gray-600 text-sm">District</th>
                      <th className="text-left px-6 py-4 font-semibold text-gray-600 text-sm">Email</th>
                      <th className="text-left px-6 py-4 font-semibold text-gray-600 text-sm">Status</th>
                      <th className="text-left px-6 py-4 font-semibold text-gray-600 text-sm">Sent At</th>
                      <th className="text-left px-6 py-4 font-semibold text-gray-600 text-sm">Opened At</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      <tr><td colSpan={6} className="px-6 py-12 text-center text-gray-400 text-base">Loading…</td></tr>
                    ) : schools.map(s => {
                      const sc = s.prospect_schools;
                      const sCfg = SCHOOL_STATUS[s.status] ?? SCHOOL_STATUS.pending;
                      return (
                        <tr key={s.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                          <td className="px-6 py-4 font-medium text-gray-900 text-base">{sc?.school_name ?? '—'}</td>
                          <td className="px-6 py-4 text-gray-600 text-base">{sc?.district ?? '—'}</td>
                          <td className="px-6 py-4 text-gray-500 text-sm font-mono">{sc?.email ?? '—'}</td>
                          <td className="px-6 py-4">
                            <span className={`text-base font-semibold ${sCfg.color}`}>{sCfg.label}</span>
                            {s.error_message && <p className="text-xs text-red-500 mt-0.5">{s.error_message}</p>}
                          </td>
                          <td className="px-6 py-4 text-gray-500 text-sm">{s.sent_at ? new Date(s.sent_at).toLocaleString('en-IN') : '—'}</td>
                          <td className="px-6 py-4 text-sm">{s.opened_at ? <span className="text-green-600 font-medium">{new Date(s.opened_at).toLocaleString('en-IN')}</span> : '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {totalPages > 1 && (
                <div className="flex items-center justify-between px-6 py-4 border-t border-gray-100">
                  <span className="text-base text-gray-500">
                    Showing {page * PAGE + 1}–{Math.min((page + 1) * PAGE, total)} of {total.toLocaleString()}
                  </span>
                  <div className="flex gap-2">
                    <Button variant="outline" disabled={page === 0} onClick={() => setPage(p => p - 1)}>Previous</Button>
                    <Button variant="outline" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>Next</Button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </ProspectLayout>
  );
}
