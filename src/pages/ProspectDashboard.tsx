import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import ProspectLayout from '@/components/prospect/ProspectLayout';
import { Button } from '@/components/ui/button';
import { ArrowRight, Mail, Phone, Globe, Building2, Send, Plus, Megaphone } from 'lucide-react';

type Stats = {
  total: number; with_email: number; with_mobile: number;
  linked_to_crm: number; with_website: number;
};
type BoardRow   = { board: string | null; count: number };
type StageRow   = { stage: string; count: number };
type StateRow   = { state: string; count: number };
type Campaign   = {
  id: string; name: string; channel: string; status: string;
  target_count: number; sent_count: number; opened_count: number;
  bounced_count: number; created_at: string;
};

const STAGE_LABELS: Record<string, string> = {
  uncontacted: 'Uncontacted',
  contacted:   'Contacted',
  interested:  'Interested',
  registered:  'Registered',
  active:      'Active',
};
const STAGE_COLORS: Record<string, string> = {
  uncontacted: 'bg-gray-400',
  contacted:   'bg-blue-500',
  interested:  'bg-amber-500',
  registered:  'bg-indigo-500',
  active:      'bg-green-500',
};
const BOARD_COLORS: Record<string, string> = {
  'State Board':        'bg-indigo-500',
  'Matriculation':      'bg-violet-500',
  'CBSE':               'bg-blue-500',
  'ICSE':               'bg-cyan-500',
  'International Board':'bg-teal-500',
};

export default function ProspectDashboard() {
  const navigate = useNavigate();
  const [stats,     setStats]     = useState<Stats | null>(null);
  const [boards,    setBoards]    = useState<BoardRow[]>([]);
  const [stages,    setStages]    = useState<StageRow[]>([]);
  const [states,    setStates]    = useState<StateRow[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading,   setLoading]   = useState(true);

  const fetchAll = async () => {
    const [dashRes, campaignRes] = await Promise.all([
      supabase.rpc('get_prospect_dashboard'),
      supabase.from('campaigns')
        .select('id,name,channel,status,target_count,sent_count,opened_count,bounced_count,created_at')
        .order('created_at', { ascending: false })
        .limit(5),
    ]);
    if (dashRes.data) {
      const d = dashRes.data as any;
      setStats({
        total:         d.total         ?? 0,
        with_email:    d.with_email    ?? 0,
        with_mobile:   d.with_mobile   ?? 0,
        with_website:  d.with_website  ?? 0,
        linked_to_crm: d.linked_to_crm ?? 0,
      });
      setBoards((d.by_board  || []) as BoardRow[]);
      setStages((d.by_stage  || []) as StageRow[]);
      setStates((d.by_state  || []) as StateRow[]);
    }
    setCampaigns((campaignRes.data || []) as Campaign[]);
    setLoading(false);
  };

  useEffect(() => {
    fetchAll();

    // Realtime: re-fetch metrics when prospect_schools or campaigns change
    const channel = supabase
      .channel('prospect-dashboard-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'prospect_schools' }, () => fetchAll())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'campaigns' }, () => fetchAll())
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  const maxBoard = Math.max(...boards.map(b => b.count), 1);
  const maxStage = Math.max(...stages.map(s => s.count), 1);

  return (
    <ProspectLayout>
      <div className="max-w-7xl mx-auto px-4 py-6 space-y-6">

        {/* Stat cards */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          {[
            { label: 'Total Schools', value: stats?.total,        icon: Building2, color: 'text-indigo-600', bg: 'bg-indigo-50' },
            { label: 'With Email',    value: stats?.with_email,   icon: Mail,      color: 'text-green-600',  bg: 'bg-green-50'  },
            { label: 'With Mobile',   value: stats?.with_mobile,  icon: Phone,     color: 'text-blue-600',   bg: 'bg-blue-50'   },
            { label: 'With Website',  value: stats?.with_website, icon: Globe,     color: 'text-violet-600', bg: 'bg-violet-50' },
            { label: 'In CRM',        value: stats?.linked_to_crm,icon: Building2, color: 'text-amber-600',  bg: 'bg-amber-50'  },
          ].map(({ label, value, icon: Icon, color, bg }) => (
            <div key={label} className="bg-white rounded-xl border border-gray-200 p-4">
              <div className={`inline-flex p-2 rounded-lg ${bg} mb-3`}>
                <Icon className={`h-4 w-4 ${color}`} />
              </div>
              <p className="text-2xl font-bold text-gray-900">
                {loading ? '—' : (value ?? 0).toLocaleString()}
              </p>
              <p className="text-xs text-gray-500 mt-0.5">{label}</p>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">

          {/* Board breakdown */}
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h3 className="font-semibold text-gray-800 mb-4 text-sm">By Board</h3>
            {loading ? <p className="text-gray-400 text-sm">Loading…</p> : (
              <div className="space-y-3">
                {boards.map(({ board, count }) => {
                  const label = board || 'Unknown';
                  const pct = Math.round((count / maxBoard) * 100);
                  return (
                    <div key={label}>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-gray-600 truncate pr-2">{label}</span>
                        <span className="font-semibold text-gray-800 flex-shrink-0">{count.toLocaleString()}</span>
                      </div>
                      <div className="h-1.5 bg-gray-100 rounded-full">
                        <div
                          className={`h-1.5 rounded-full ${BOARD_COLORS[label] || 'bg-gray-400'}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Stage funnel */}
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h3 className="font-semibold text-gray-800 mb-4 text-sm">Pipeline Stage</h3>
            {loading ? <p className="text-gray-400 text-sm">Loading…</p> : (
              <div className="space-y-3">
                {stages.map(({ stage, count }) => {
                  const pct = Math.round((count / maxStage) * 100);
                  return (
                    <div key={stage}>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-gray-600">{STAGE_LABELS[stage] || stage}</span>
                        <span className="font-semibold text-gray-800">{count.toLocaleString()}</span>
                      </div>
                      <div className="h-1.5 bg-gray-100 rounded-full">
                        <div
                          className={`h-1.5 rounded-full ${STAGE_COLORS[stage] || 'bg-gray-400'}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* State split */}
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h3 className="font-semibold text-gray-800 mb-4 text-sm">By State</h3>
            {loading ? <p className="text-gray-400 text-sm">Loading…</p> : (
              <div className="space-y-4">
                {states.map(({ state, count }) => {
                  const pct = stats?.total ? Math.round((count / stats.total) * 100) : 0;
                  return (
                    <div key={state}>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-gray-600">{state}</span>
                        <span className="font-semibold text-gray-800">{count.toLocaleString()} <span className="text-gray-400 font-normal">({pct}%)</span></span>
                      </div>
                      <div className="h-1.5 bg-gray-100 rounded-full">
                        <div className="h-1.5 rounded-full bg-indigo-500" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Recent campaigns */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-gray-800 text-sm">Recent Campaigns</h3>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => navigate('/prospect/campaigns')}>
                View All
              </Button>
              <Button size="sm" onClick={() => navigate('/prospect/campaigns')}>
                <Plus className="h-3.5 w-3.5 mr-1" /> New Campaign
              </Button>
            </div>
          </div>

          {loading ? (
            <p className="text-gray-400 text-sm py-4 text-center">Loading…</p>
          ) : campaigns.length === 0 ? (
            <div className="text-center py-10 border border-dashed border-gray-200 rounded-xl">
              <Megaphone className="h-8 w-8 text-gray-300 mx-auto mb-2" />
              <p className="text-gray-500 text-sm font-medium">No campaigns yet</p>
              <p className="text-gray-400 text-xs mt-1">Create your first campaign to start reaching schools</p>
              <Button size="sm" className="mt-4" onClick={() => navigate('/prospect/campaigns')}>
                <Plus className="h-3.5 w-3.5 mr-1" /> Create Campaign
              </Button>
            </div>
          ) : (
            <div className="divide-y divide-gray-50">
              {campaigns.map(c => {
                const openRate = c.sent_count > 0 ? Math.round((c.opened_count / c.sent_count) * 100) : null;
                return (
                  <div key={c.id} className="py-3 flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className={`p-1.5 rounded-md flex-shrink-0 ${c.channel === 'email' ? 'bg-indigo-50' : 'bg-green-50'}`}>
                        {c.channel === 'email'
                          ? <Mail className="h-3.5 w-3.5 text-indigo-600" />
                          : <Send className="h-3.5 w-3.5 text-green-600" />}
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">{c.name}</p>
                        <p className="text-xs text-gray-400">
                          {new Date(c.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-6 text-xs flex-shrink-0">
                      <div className="text-center">
                        <p className="font-semibold text-gray-800">{c.target_count.toLocaleString()}</p>
                        <p className="text-gray-400">Target</p>
                      </div>
                      <div className="text-center">
                        <p className="font-semibold text-blue-600">{c.sent_count.toLocaleString()}</p>
                        <p className="text-gray-400">Sent</p>
                      </div>
                      {openRate !== null && (
                        <div className="text-center">
                          <p className="font-semibold text-green-600">{openRate}%</p>
                          <p className="text-gray-400">Opened</p>
                        </div>
                      )}
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                        c.status === 'sent'      ? 'bg-green-100 text-green-700' :
                        c.status === 'sending'   ? 'bg-blue-100 text-blue-700' :
                        c.status === 'scheduled' ? 'bg-amber-100 text-amber-700' :
                                                   'bg-gray-100 text-gray-600'
                      }`}>{c.status}</span>
                    </div>
                  </div>
                );
              })}
              <div className="pt-3">
                <button onClick={() => navigate('/prospect/campaigns')}
                  className="flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800 font-medium">
                  View all campaigns <ArrowRight className="h-3 w-3" />
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Quick actions */}
        <div className="grid grid-cols-2 gap-4">
          <button onClick={() => navigate('/prospect/schools')}
            className="bg-white rounded-xl border border-gray-200 p-5 text-left hover:border-indigo-300 hover:shadow-sm transition-all group">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-semibold text-gray-900">Browse Schools</p>
                <p className="text-sm text-gray-500 mt-0.5">Search, filter and manage all {(stats?.total ?? 0).toLocaleString()} schools</p>
              </div>
              <ArrowRight className="h-5 w-5 text-gray-300 group-hover:text-indigo-500 transition-colors" />
            </div>
          </button>
          <button onClick={() => navigate('/prospect/campaigns')}
            className="bg-white rounded-xl border border-gray-200 p-5 text-left hover:border-indigo-300 hover:shadow-sm transition-all group">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-semibold text-gray-900">Campaigns</p>
                <p className="text-sm text-gray-500 mt-0.5">{campaigns.length} campaign{campaigns.length !== 1 ? 's' : ''} · Email & WhatsApp outreach</p>
              </div>
              <ArrowRight className="h-5 w-5 text-gray-300 group-hover:text-indigo-500 transition-colors" />
            </div>
          </button>
        </div>

      </div>
    </ProspectLayout>
  );
}
