import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import ProspectLayout from '@/components/prospect/ProspectLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import {
  Phone, PhoneCall, Loader2, CheckCircle2, Clock, Target,
  ChevronDown, ChevronRight, Lightbulb, Users, TrendingUp, RefreshCw,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';

type Dash = {
  total: number; worked: number; remaining: number;
  today_calls: number; today_goal: number; days_left: number;
  signed: number; interested: number; regs_committed: number; callbacks_due: number;
  by_district: { district: string; total: number; worked: number; signed: number }[];
};

type Row = {
  id: string;
  prospect_school_id: string;
  district: string | null;
  status: string;
  attempts: number;
  callback_at: string | null;
  last_called_at: string | null;
  registrations_committed: number;
  notes: string | null;
  prospect_schools: { school_name: string; mobile: string | null; whatsapp: string | null; block: string | null } | null;
};

type ScoreRow = {
  user_id: string; name: string; total: number; worked: number;
  signed: number; interested: number; callbacks_due: number;
  regs_committed: number; calls_today: number;
};

const OUTCOMES: { v: string; label: string; hint: string }[] = [
  { v: 'signed',       label: 'Signed up',        hint: 'Agreed to participate — send the WhatsApp pack now' },
  { v: 'interested',   label: 'Interested',       hint: 'Wants it but needs principal sign-off' },
  { v: 'callback',     label: 'Callback booked',  hint: 'Set the date below — this becomes tomorrow’s priority' },
  { v: 'not_now',      label: 'Not this year',    hint: 'Soft no. Leave the door open for 2027' },
  { v: 'refused',      label: 'Refused',          hint: 'Hard no. Do not call again' },
  { v: 'no_answer',    label: 'No answer',        hint: 'Try the alternate number next attempt' },
  { v: 'gatekeeper',   label: 'Gatekeeper only',  hint: 'Ask for the direct number of the person who approves' },
  { v: 'wrong_number', label: 'Wrong number',     hint: 'Removes it from your list' },
];

const STATUS_STYLE: Record<string, string> = {
  pending:      'bg-slate-100 text-slate-600',
  signed:       'bg-emerald-100 text-emerald-700',
  interested:   'bg-amber-100 text-amber-700',
  callback:     'bg-blue-100 text-blue-700',
  not_now:      'bg-slate-100 text-slate-500',
  refused:      'bg-rose-100 text-rose-600',
  no_answer:    'bg-orange-100 text-orange-700',
  gatekeeper:   'bg-violet-100 text-violet-700',
  wrong_number: 'bg-slate-100 text-slate-400',
};

const phoneOf = (r: Row) => (r.prospect_schools?.whatsapp || r.prospect_schools?.mobile || '').replace(/[^0-9]/g, '');
const istToday = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);

// src/integrations/supabase/types.ts is generated and predates the call_campaign_*
// tables and RPCs. Casting here keeps the escape local instead of regenerating the
// shared types file, which would churn ~390 unrelated call sites across the app.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export default function ProspectCallCampaign() {
  const { toast } = useToast();
  const { user } = useAuth();
  const [dash, setDash] = useState<Dash | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [score, setScore] = useState<ScoreRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [showScore, setShowScore] = useState(false);

  // assignment panel — so a new season can be set up without a developer
  const [staffList, setStaffList] = useState<{ user_id: string; name: string }[]>([]);
  const [showAssign, setShowAssign] = useState(false);
  const [selStaff, setSelStaff] = useState<string[]>([]);
  const [perStaff, setPerStaff] = useState('500');
  const [stateFilter, setStateFilter] = useState('tamil%');
  const [requireKit, setRequireKit] = useState(true);
  const [assigning, setAssigning] = useState(false);

  // log dialog
  const [target, setTarget] = useState<Row | null>(null);
  const [outcome, setOutcome] = useState('signed');
  const [reachedDm, setReachedDm] = useState('yes');
  const [regs, setRegs] = useState('');
  const [callbackAt, setCallbackAt] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const [d, a, s, st] = await Promise.all([
      db.rpc('get_my_call_campaign'),
      db.from('call_campaign_assignments')
        .select('id,prospect_school_id,district,status,attempts,callback_at,last_called_at,registrations_committed,notes,prospect_schools(school_name,mobile,whatsapp,block)')
        .eq('assigned_to', user.id)
        .order('district', { ascending: true })
        .limit(2000),
      db.rpc('get_call_campaign_scoreboard'),
      db.from('profiles').select('user_id,full_name,email').not('user_id', 'is', null),
    ]);
    if (d.data) setDash(d.data as unknown as Dash);
    if (a.data) setRows(a.data as unknown as Row[]);
    if (s.data) setScore(s.data as unknown as ScoreRow[]);
    if (st.data) setStaffList((st.data as { user_id: string; full_name: string | null; email: string | null }[])
      .map(p => ({ user_id: p.user_id, name: p.full_name || p.email || 'Unnamed' })));
    if (a.error) toast({ title: 'Could not load your list', description: a.error.message, variant: 'destructive' });
    setLoading(false);
  }, [user, toast]);

  useEffect(() => { load(); }, [load]);

  const today = istToday();
  const callbacks = useMemo(
    () => rows.filter(r => r.callback_at && r.callback_at <= today),
    [rows, today]);

  const byDistrict = useMemo(() => {
    const m = new Map<string, Row[]>();
    for (const r of rows) {
      const k = r.district || '—';
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(r);
    }
    // untouched first inside each district, so callers always start where the value is
    for (const list of m.values()) {
      list.sort((x, y) => (x.status === 'pending' ? 0 : 1) - (y.status === 'pending' ? 0 : 1));
    }
    return [...m.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [rows]);

  const tips = useMemo(() => {
    if (!dash) return [];
    const t: string[] = [];
    const done = dash.today_calls, goal = dash.today_goal;
    if (done < goal) t.push(`${goal - done} more calls today to stay on the curve. At 6 dials an hour that is about ${Math.ceil((goal - done) / 6)} hours.`);
    else t.push(`Goal met — ${done} of ${goal}. Anything past this is ahead of the curve.`);

    const worked = rows.filter(r => r.status !== 'pending');
    const noAns = worked.filter(r => r.status === 'no_answer').length;
    if (worked.length >= 10 && noAns / worked.length > 0.45)
      t.push('Nearly half your calls are going unanswered. Schools answer best 10:30–12:30 and 14:30–16:30 — avoid assembly and lunch.');

    const gate = worked.filter(r => r.status === 'gatekeeper').length;
    if (worked.length >= 10 && gate / worked.length > 0.25)
      t.push('You are getting stuck at the gatekeeper. Ask directly: "Who approves the olympiad student list — can you give me their direct number?"');

    const notNow = worked.filter(r => r.status === 'not_now').length;
    if (worked.length >= 10 && notNow / worked.length > 0.35)
      t.push('Lots of soft nos. Try closing on ONE class instead of the whole school — it roughly doubles the yes rate, and schools expand later.');

    if (dash.callbacks_due > 0)
      t.push(`${dash.callbacks_due} callback${dash.callbacks_due > 1 ? 's' : ''} due today. Those convert far better than a fresh dial — clear them first.`);

    t.push('Always open on the brochure: "we sent your school our olympiad kit in June — did it arrive?" It turns a cold call into a follow-up.');
    return t;
  }, [dash, rows]);

  const runAssign = async () => {
    if (selStaff.length === 0) { toast({ title: 'Pick at least one caller', variant: 'destructive' }); return; }
    setAssigning(true);
    const { data, error } = await db.rpc('assign_call_campaign', {
      p_staff: selStaff,
      p_per_staff: parseInt(perStaff, 10) || 500,
      p_state: stateFilter,
      p_require_kit: requireKit,
    });
    setAssigning(false);
    if (error) { toast({ title: 'Assignment failed', description: error.message, variant: 'destructive' }); return; }
    const n = (data as { assigned?: number })?.assigned ?? 0;
    toast({
      title: `${n} schools assigned`,
      description: n === 0
        ? 'Nothing left in the pool matching those filters — everything is already assigned for this season.'
        : `Split across ${selStaff.length} caller${selStaff.length > 1 ? 's' : ''}, district by district.`,
    });
    setShowAssign(false);
    load();
  };

  const AssignPanel = () => (
    <div className="rounded-lg border bg-card p-5 space-y-4">
      <div>
        <h3 className="font-semibold">Assign lists</h3>
        <p className="text-sm text-muted-foreground mt-1">
          Splits the unassigned pool across the callers you pick, district by district, for the
          active olympiad season. Safe to run again later — it only ever adds schools that
          nobody is working yet.
        </p>
      </div>

      <div>
        <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Callers</label>
        <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
          {staffList.map(s => {
            const on = selStaff.includes(s.user_id);
            return (
              <button key={s.user_id} type="button"
                onClick={() => setSelStaff(v => on ? v.filter(x => x !== s.user_id) : [...v, s.user_id])}
                className={`flex items-center gap-2 rounded border px-3 py-2 text-sm text-left transition-colors ${
                  on ? 'border-primary bg-primary/10 font-medium' : 'hover:bg-muted/50'}`}>
                <span className={`h-3.5 w-3.5 rounded-sm border shrink-0 ${on ? 'bg-primary border-primary' : ''}`} />
                <span className="truncate">{s.name}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Schools each</label>
          <Input className="mt-1" type="number" min={1} value={perStaff} onChange={e => setPerStaff(e.target.value)} />
        </div>
        <div>
          <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">State</label>
          <Select value={stateFilter} onValueChange={setStateFilter}>
            <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="tamil%">Tamil Nadu</SelectItem>
              <SelectItem value="karnataka">Karnataka</SelectItem>
              <SelectItem value="telangana">Telangana</SelectItem>
              <SelectItem value="andhra%">Andhra Pradesh</SelectItem>
              <SelectItem value="kerala">Kerala</SelectItem>
              <SelectItem value="%">Any state</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Brochure sent?</label>
          <Select value={requireKit ? 'yes' : 'no'} onValueChange={v => setRequireKit(v === 'yes')}>
            <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="yes">Only schools sent a kit</SelectItem>
              <SelectItem value="no">Any school with a number</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Button onClick={runAssign} disabled={assigning || selStaff.length === 0}>
          {assigning && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
          Assign {selStaff.length > 0 ? `to ${selStaff.length} caller${selStaff.length > 1 ? 's' : ''}` : ''}
        </Button>
        {dash && dash.total > 0 && <Button variant="ghost" onClick={() => setShowAssign(false)}>Cancel</Button>}
      </div>
    </div>
  );

  const openLog = (r: Row) => {
    setTarget(r); setOutcome('signed'); setReachedDm('yes');
    setRegs(''); setCallbackAt(''); setNotes('');
  };

  const save = async () => {
    if (!target) return;
    setSaving(true);
    const { error } = await db.rpc('log_campaign_call', {
      p_assignment_id: target.id,
      p_outcome: outcome,
      p_reached_dm: reachedDm,
      p_notes: notes || null,
      p_registrations: regs ? parseInt(regs, 10) : 0,
      p_callback_at: outcome === 'callback' && callbackAt ? callbackAt : null,
    });
    setSaving(false);
    if (error) { toast({ title: 'Not saved', description: error.message, variant: 'destructive' }); return; }
    toast({ title: 'Logged', description: `${target.prospect_schools?.school_name ?? 'School'} — ${outcome.replace('_', ' ')}` });
    setTarget(null);
    load();
  };

  const pct = dash && dash.today_goal > 0 ? Math.min(100, Math.round((dash.today_calls / dash.today_goal) * 100)) : 0;

  return (
    <ProspectLayout>
      <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">

        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Call Campaign</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Your assigned schools, grouped by district. Every one of them has our brochure and has never been called.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {dash && dash.total > 0 && (
              <Button variant="outline" size="sm" onClick={() => setShowAssign(s => !s)}>
                <Users className="h-4 w-4 mr-2" />Assign lists
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={load} disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              <span className="ml-2">Refresh</span>
            </Button>
          </div>
        </div>

        {loading && !dash ? (
          <div className="flex items-center gap-2 text-muted-foreground py-16 justify-center">
            <Loader2 className="h-5 w-5 animate-spin" /> Loading your list…
          </div>
        ) : !dash || dash.total === 0 ? (
          <div className="space-y-4">
            <div className="rounded-lg border bg-card p-6 text-center">
              <Users className="h-8 w-8 mx-auto text-muted-foreground mb-3" />
              <h3 className="font-semibold mb-1">No schools assigned to you yet</h3>
              <p className="text-sm text-muted-foreground max-w-lg mx-auto">
                Nothing is assigned to your login for the current season. Set the lists up below —
                or ask whoever runs the campaign to include you.
              </p>
            </div>
            <AssignPanel />
          </div>
        ) : (
          <>
            {showAssign && <AssignPanel />}
            {/* today */}
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-lg border bg-card p-4">
                <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground mb-2">
                  <Target className="h-3.5 w-3.5" /> Today
                </div>
                <div className="text-3xl font-bold tabular-nums">
                  {dash.today_calls}<span className="text-lg text-muted-foreground font-medium"> / {dash.today_goal}</span>
                </div>
                <div className="mt-2 h-2 rounded-full bg-muted overflow-hidden">
                  <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
                </div>
              </div>
              <div className="rounded-lg border bg-card p-4">
                <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground mb-2">
                  <CheckCircle2 className="h-3.5 w-3.5" /> Signed up
                </div>
                <div className="text-3xl font-bold tabular-nums text-emerald-600">{dash.signed}</div>
                <div className="text-xs text-muted-foreground mt-1">{dash.interested} more interested</div>
              </div>
              <div className="rounded-lg border bg-card p-4">
                <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground mb-2">
                  <TrendingUp className="h-3.5 w-3.5" /> Registrations committed
                </div>
                <div className="text-3xl font-bold tabular-nums">{dash.regs_committed}</div>
                <div className="text-xs text-muted-foreground mt-1">₹{(dash.regs_committed * 150).toLocaleString('en-IN')} to iPlus</div>
              </div>
              <div className="rounded-lg border bg-card p-4">
                <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground mb-2">
                  <Clock className="h-3.5 w-3.5" /> List progress
                </div>
                <div className="text-3xl font-bold tabular-nums">{dash.worked}<span className="text-lg text-muted-foreground font-medium"> / {dash.total}</span></div>
                <div className="text-xs text-muted-foreground mt-1">{dash.days_left} days to 20 Sep cutoff</div>
              </div>
            </div>

            {/* tips */}
            {tips.length > 0 && (
              <div className="rounded-lg border bg-amber-50/60 border-amber-200 p-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-amber-900 mb-2">
                  <Lightbulb className="h-4 w-4" /> Today&rsquo;s coaching
                </div>
                <ul className="space-y-1.5 text-sm text-amber-900/90">
                  {tips.map((t, i) => <li key={i} className="flex gap-2"><span className="text-amber-500">•</span><span>{t}</span></li>)}
                </ul>
              </div>
            )}

            {/* callbacks first */}
            {callbacks.length > 0 && (
              <div className="rounded-lg border-2 border-blue-200 bg-blue-50/50 overflow-hidden">
                <div className="px-4 py-3 border-b border-blue-200 bg-blue-100/50">
                  <h2 className="font-semibold text-blue-900 text-sm">
                    Callbacks due today — {callbacks.length}. Do these before any new dial.
                  </h2>
                </div>
                <div className="divide-y divide-blue-100">
                  {callbacks.map(r => <SchoolRow key={r.id} r={r} onLog={openLog} />)}
                </div>
              </div>
            )}

            {/* districts */}
            <div className="space-y-2">
              {byDistrict.map(([district, list]) => {
                const isOpen = open[district] ?? false;
                const worked = list.filter(r => r.status !== 'pending').length;
                const signed = list.filter(r => r.status === 'signed').length;
                return (
                  <div key={district} className="rounded-lg border bg-card overflow-hidden">
                    <button
                      className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/50 text-left"
                      onClick={() => setOpen(o => ({ ...o, [district]: !isOpen }))}
                    >
                      {isOpen ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
                      <span className="font-semibold">{district}</span>
                      <span className="text-sm text-muted-foreground tabular-nums">{worked}/{list.length} worked</span>
                      {signed > 0 && (
                        <span className="text-xs font-semibold px-2 py-0.5 rounded bg-emerald-100 text-emerald-700 tabular-nums">
                          {signed} signed
                        </span>
                      )}
                    </button>
                    {isOpen && <div className="divide-y border-t">{list.map(r => <SchoolRow key={r.id} r={r} onLog={openLog} />)}</div>}
                  </div>
                );
              })}
            </div>

            {/* scoreboard */}
            {score.length > 0 && (
              <div className="rounded-lg border bg-card overflow-hidden">
                <button className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/50 text-left"
                        onClick={() => setShowScore(s => !s)}>
                  {showScore ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  <span className="font-semibold">Team scoreboard</span>
                  <span className="text-sm text-muted-foreground">
                    {score.reduce((a, b) => a + b.calls_today, 0)} calls today across the team
                  </span>
                </button>
                {showScore && (
                  <div className="overflow-x-auto border-t">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/50">
                        <tr className="text-xs uppercase tracking-wider text-muted-foreground">
                          <th className="text-left font-medium px-4 py-2.5">Caller</th>
                          <th className="text-right font-medium px-4 py-2.5">Today</th>
                          <th className="text-right font-medium px-4 py-2.5">Worked</th>
                          <th className="text-right font-medium px-4 py-2.5">Signed</th>
                          <th className="text-right font-medium px-4 py-2.5">Callbacks</th>
                          <th className="text-right font-medium px-4 py-2.5">Regs</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {score.map(s => (
                          <tr key={s.user_id ?? s.name}>
                            <td className="px-4 py-2.5 font-medium">{s.name}</td>
                            <td className="px-4 py-2.5 text-right tabular-nums font-semibold">{s.calls_today}</td>
                            <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">{s.worked}/{s.total}</td>
                            <td className="px-4 py-2.5 text-right tabular-nums text-emerald-600 font-semibold">{s.signed}</td>
                            <td className="px-4 py-2.5 text-right tabular-nums">{s.callbacks_due}</td>
                            <td className="px-4 py-2.5 text-right tabular-nums">{s.regs_committed}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {/* log dialog */}
        <Dialog open={!!target} onOpenChange={o => !o && setTarget(null)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="text-base">{target?.prospect_schools?.school_name}</DialogTitle>
              <p className="text-sm text-muted-foreground">
                {target?.district}{target?.prospect_schools?.block ? ` · ${target.prospect_schools.block}` : ''}
                {target && target.attempts > 0 ? ` · attempt ${target.attempts + 1}` : ''}
              </p>
            </DialogHeader>

            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Outcome</label>
                <Select value={outcome} onValueChange={setOutcome}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {OUTCOMES.map(o => <SelectItem key={o.v} value={o.v}>{o.label}</SelectItem>)}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground mt-1.5">{OUTCOMES.find(o => o.v === outcome)?.hint}</p>
              </div>

              <div>
                <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Reached the decision-maker?</label>
                <Select value={reachedDm} onValueChange={setReachedDm}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="yes">Yes</SelectItem>
                    <SelectItem value="no">No</SelectItem>
                    <SelectItem value="gatekeeper">Gatekeeper only</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {(outcome === 'signed' || outcome === 'interested') && (
                <div>
                  <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Students committed</label>
                  <Input className="mt-1" type="number" inputMode="numeric" min={0} value={regs}
                         onChange={e => setRegs(e.target.value)} placeholder="A number, not &quot;some&quot;" />
                </div>
              )}

              {outcome === 'callback' && (
                <div>
                  <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Call back on</label>
                  <Input className="mt-1" type="date" value={callbackAt} min={today}
                         onChange={e => setCallbackAt(e.target.value)} />
                </div>
              )}

              <div>
                <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Notes</label>
                <Textarea className="mt-1" rows={2} value={notes} onChange={e => setNotes(e.target.value)}
                          placeholder="What did they actually say?" />
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setTarget(null)}>Cancel</Button>
              <Button onClick={save} disabled={saving || (outcome === 'callback' && !callbackAt)}>
                {saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}Save
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </ProspectLayout>
  );
}

function SchoolRow({ r, onLog }: { r: Row; onLog: (r: Row) => void }) {
  const num = phoneOf(r);
  return (
    <div className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/30">
      <div className="min-w-0 flex-1">
        <div className="font-medium truncate text-sm">{r.prospect_schools?.school_name ?? 'Unnamed school'}</div>
        <div className="text-xs text-muted-foreground truncate">
          {num ? `+91 ${num}` : 'no number'}
          {r.prospect_schools?.block ? ` · ${r.prospect_schools.block}` : ''}
          {r.attempts > 0 ? ` · ${r.attempts} attempt${r.attempts > 1 ? 's' : ''}` : ''}
          {r.registrations_committed > 0 ? ` · ${r.registrations_committed} students` : ''}
        </div>
      </div>
      <span className={`text-[11px] font-semibold px-2 py-0.5 rounded shrink-0 ${STATUS_STYLE[r.status] ?? STATUS_STYLE.pending}`}>
        {r.status.replace('_', ' ')}
      </span>
      {num && (
        <a href={`tel:+91${num}`} className="shrink-0">
          <Button size="sm" variant="outline"><Phone className="h-3.5 w-3.5" /></Button>
        </a>
      )}
      <Button size="sm" onClick={() => onLog(r)} className="shrink-0">
        <PhoneCall className="h-3.5 w-3.5 mr-1.5" />Log
      </Button>
    </div>
  );
}
