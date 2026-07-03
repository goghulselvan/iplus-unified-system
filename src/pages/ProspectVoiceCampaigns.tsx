import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import ProspectLayout from '@/components/prospect/ProspectLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Phone, PhoneCall, PhoneOff, Pause, Play, Trash2, Plus,
  ChevronDown, ChevronUp, Loader2, Users, CheckCircle2, XCircle, Clock,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

type VoiceCampaign = {
  id: string;
  name: string;
  speech_content: string;
  speech_language: string;
  status: string;
  total_count: number;
  sent_count: number;
  answered_count: number;
  failed_count: number;
  audience_filters: any;
  created_at: string;
};

const STATES = ['Karnataka', 'Telangana', 'Tamil Nadu', 'Andhra Pradesh', 'Kerala', 'Puducherry'];
const BOARDS = ['State Board', 'Matriculation', 'CBSE', 'ICSE', 'International Board'];
const LANGUAGES = ['ENGLISH', 'HINDI', 'TAMIL', 'TELUGU', 'KANNADA', 'MALAYALAM'];

const STATUS_CFG: Record<string, { label: string; color: string }> = {
  draft:   { label: 'Draft',   color: 'bg-gray-100 text-gray-600' },
  sending: { label: 'Sending', color: 'bg-blue-100 text-blue-700' },
  sent:    { label: 'Sent',    color: 'bg-green-100 text-green-700' },
  paused:  { label: 'Paused',  color: 'bg-amber-100 text-amber-700' },
};

export default function ProspectVoiceCampaigns() {
  const { toast } = useToast();
  const [campaigns, setCampaigns] = useState<VoiceCampaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);

  // New campaign form
  const [newName, setNewName] = useState('');
  const [newSpeech, setNewSpeech] = useState('');
  const [newLang, setNewLang] = useState('ENGLISH');
  const [newFilters, setNewFilters] = useState({ state: '', district: '', board: '' });
  const [newFilterDistricts, setNewFilterDistricts] = useState<string[]>([]);
  const [audienceCount, setAudienceCount] = useState<number | null>(null);
  const [countingAudience, setCountingAudience] = useState(false);
  const [creating, setCreating] = useState(false);

  // Per-campaign send state
  const [sending, setSending] = useState(false);
  const [pausing, setPausing] = useState(false);

  const fetchCampaigns = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from('voice_campaigns')
      .select('*')
      .order('created_at', { ascending: false });
    setCampaigns((data as VoiceCampaign[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { fetchCampaigns(); }, [fetchCampaigns]);

  const updateNewState = async (val: string) => {
    setNewFilters(f => ({ ...f, state: val, district: '' }));
    setAudienceCount(null);
    if (!val) { setNewFilterDistricts([]); return; }
    const { data } = await supabase.rpc('get_prospect_districts', { p_state: val });
    setNewFilterDistricts((data as string[]) ?? []);
  };

  const refreshAudienceCount = async () => {
    setCountingAudience(true);
    const { data } = await supabase.rpc('get_audience_count', {
      p_state:     newFilters.state    || null,
      p_district:  newFilters.district || null,
      p_board:     newFilters.board    || null,
      p_has_mobile: true,
    });
    setAudienceCount(typeof data === 'number' ? data : null);
    setCountingAudience(false);
  };

  const createCampaign = async () => {
    if (!newName.trim() || !newSpeech.trim()) {
      toast({ title: 'Campaign name and speech content required', variant: 'destructive' });
      return;
    }
    setCreating(true);
    try {
      const { data: camp, error } = await supabase.from('voice_campaigns').insert({
        name: newName.trim(),
        speech_content: newSpeech.trim(),
        speech_language: newLang,
        audience_filters: {
          state:    newFilters.state    || null,
          district: newFilters.district || null,
          board:    newFilters.board    || null,
        },
      }).select('id').single();

      if (error) throw error;

      // Populate audience
      const { data: count } = await supabase.rpc('populate_voice_campaign_audience', { p_campaign_id: camp.id });
      toast({ title: 'Campaign created', description: `${count ?? 0} schools added to audience.` });

      setShowNew(false);
      setNewName(''); setNewSpeech(''); setNewLang('ENGLISH');
      setNewFilters({ state: '', district: '', board: '' });
      setAudienceCount(null);
      fetchCampaigns();
    } catch (e: any) {
      toast({ title: 'Create failed', description: e.message, variant: 'destructive' });
    } finally {
      setCreating(false);
    }
  };

  const sendBatch = async (campaignId: string) => {
    setSending(true);
    try {
      // Fire the first batch immediately for instant feedback;
      // the voice-campaign-auto-sender cron (every minute) handles all subsequent batches.
      const { data, error } = await supabase.functions.invoke('send-voice-campaign', {
        body: { campaign_id: campaignId },
      });
      if (error) throw new Error(error.message);
      const firstBatch = data?.sent ?? 0;
      toast({
        title: 'Campaign started',
        description: `${firstBatch} calls initiated. Remaining calls will be placed automatically every minute.`,
      });
      fetchCampaigns();
    } catch (e: any) {
      toast({ title: 'Send failed', description: e.message, variant: 'destructive' });
    } finally {
      setSending(false);
    }
  };

  const pauseCampaign = async (campaignId: string) => {
    setPausing(true);
    await supabase.from('voice_campaigns').update({ status: 'paused' }).eq('id', campaignId);
    toast({ title: 'Campaign paused' });
    fetchCampaigns();
    setPausing(false);
  };

  const deleteCampaign = async (campaignId: string) => {
    if (!confirm('Delete this campaign? This cannot be undone.')) return;
    await supabase.from('voice_campaigns').delete().eq('id', campaignId);
    setCampaigns(p => p.filter(c => c.id !== campaignId));
    if (expandedId === campaignId) setExpandedId(null);
    toast({ title: 'Campaign deleted' });
  };

  return (
    <ProspectLayout>
      <div className="max-w-4xl mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
              <Phone className="h-5 w-5 text-indigo-600" />
              Voice Campaigns
            </h1>
            <p className="text-sm text-gray-500 mt-0.5">Bulk TTS auto-dial to prospect schools via Bonvoice</p>
          </div>
          <Button onClick={() => setShowNew(v => !v)} size="sm">
            <Plus className="h-4 w-4 mr-1.5" /> New Campaign
          </Button>
        </div>

        {/* New campaign form */}
        {showNew && (
          <div className="bg-white border border-gray-200 rounded-xl p-5 mb-5 space-y-4">
            <h2 className="font-semibold text-gray-800">New Voice Campaign</h2>

            <Input
              placeholder="Campaign name"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              className="h-9"
            />

            <div>
              <label className="text-xs font-medium text-gray-500 mb-1 block">Speech Content (TTS message read to school)</label>
              <textarea
                rows={4}
                placeholder="e.g. Hello, this is iPlus Olympiads. We are conducting national level science and maths olympiads for students of Class 1 to 8. To register your school, please call us or visit our website. Thank you."
                value={newSpeech}
                onChange={e => setNewSpeech(e.target.value)}
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-400 resize-none"
              />
              <p className="text-xs text-gray-400 mt-1">{newSpeech.length} characters</p>
            </div>

            <div className="flex gap-3 flex-wrap">
              <div className="flex-1 min-w-32">
                <label className="text-xs font-medium text-gray-500 mb-1 block">Language</label>
                <Select value={newLang} onValueChange={setNewLang}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {LANGUAGES.map(l => <SelectItem key={l} value={l}>{l}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex-1 min-w-36">
                <label className="text-xs font-medium text-gray-500 mb-1 block">State</label>
                <Select value={newFilters.state || 'all'} onValueChange={v => updateNewState(v === 'all' ? '' : v)}>
                  <SelectTrigger className="h-9"><SelectValue placeholder="All States" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All States</SelectItem>
                    {STATES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              {newFilterDistricts.length > 0 && (
                <div className="flex-1 min-w-36">
                  <label className="text-xs font-medium text-gray-500 mb-1 block">District</label>
                  <Select value={newFilters.district || 'all'} onValueChange={v => setNewFilters(f => ({ ...f, district: v === 'all' ? '' : v }))}>
                    <SelectTrigger className="h-9"><SelectValue placeholder="All Districts" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Districts</SelectItem>
                      {newFilterDistricts.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="flex-1 min-w-36">
                <label className="text-xs font-medium text-gray-500 mb-1 block">Board</label>
                <Select value={newFilters.board || 'all'} onValueChange={v => setNewFilters(f => ({ ...f, board: v === 'all' ? '' : v }))}>
                  <SelectTrigger className="h-9"><SelectValue placeholder="All Boards" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Boards</SelectItem>
                    {BOARDS.map(b => <SelectItem key={b} value={b}>{b}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Audience count */}
            <div className="flex items-center gap-3">
              <Button variant="outline" size="sm" onClick={refreshAudienceCount} disabled={countingAudience}>
                {countingAudience ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Users className="h-3.5 w-3.5 mr-1" />}
                Count Audience
              </Button>
              {audienceCount !== null && (
                <span className="text-sm font-semibold text-indigo-700">
                  {audienceCount.toLocaleString()} schools with mobile
                </span>
              )}
            </div>

            <div className="flex gap-2 pt-1">
              <Button onClick={createCampaign} disabled={creating} className="flex-1">
                {creating ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Creating…</> : 'Create Campaign'}
              </Button>
              <Button variant="outline" onClick={() => setShowNew(false)}>Cancel</Button>
            </div>
          </div>
        )}

        {/* Campaign list */}
        {loading ? (
          <div className="text-center py-12 text-gray-400">Loading…</div>
        ) : campaigns.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <Phone className="h-8 w-8 mx-auto mb-3 opacity-40" />
            <p className="text-sm">No voice campaigns yet. Create one to start bulk calling.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {campaigns.map(c => {
              const cfg = STATUS_CFG[c.status] ?? { label: c.status, color: 'bg-gray-100 text-gray-600' };
              const isExpanded = expandedId === c.id;
              const pct = c.total_count > 0 ? Math.round((c.sent_count / c.total_count) * 100) : 0;

              return (
                <div key={c.id} className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                  <button
                    onClick={() => setExpandedId(isExpanded ? null : c.id)}
                    className="w-full flex items-center justify-between px-5 py-4 hover:bg-gray-50 transition-colors text-left"
                  >
                    <div className="flex items-center gap-3">
                      <Phone className="h-4 w-4 text-indigo-500 flex-shrink-0" />
                      <div>
                        <p className="font-semibold text-gray-900 text-sm">{c.name}</p>
                        <p className="text-xs text-gray-400 mt-0.5">
                          {new Date(c.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                          {c.audience_filters?.state && ` · ${c.audience_filters.state}`}
                          {c.audience_filters?.district && ` / ${c.audience_filters.district}`}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-medium text-gray-600">{c.total_count.toLocaleString()} schools</span>
                      <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${cfg.color}`}>{cfg.label}</span>
                      {isExpanded ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
                    </div>
                  </button>

                  {isExpanded && (
                    <div className="border-t border-gray-100 px-5 py-4 space-y-4">
                      {/* Speech preview */}
                      <div className="bg-gray-50 rounded-lg p-3">
                        <p className="text-xs font-medium text-gray-500 mb-1">TTS Message</p>
                        <p className="text-sm text-gray-800 leading-relaxed">{c.speech_content}</p>
                        <p className="text-xs text-gray-400 mt-1">Language: {c.speech_language}</p>
                      </div>

                      {/* Progress bar */}
                      {c.total_count > 0 && (
                        <div>
                          <div className="flex justify-between text-xs text-gray-500 mb-1">
                            <span>{c.sent_count} called</span>
                            <span>{pct}%</span>
                          </div>
                          <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                            <div className="h-full bg-indigo-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
                          </div>
                        </div>
                      )}

                      {/* Stats */}
                      <div className="grid grid-cols-4 gap-3">
                        {[
                          { label: 'Total',    value: c.total_count,    icon: Users,        color: 'text-gray-600' },
                          { label: 'Called',   value: c.sent_count,     icon: PhoneCall,    color: 'text-blue-600' },
                          { label: 'Answered', value: c.answered_count, icon: CheckCircle2, color: 'text-green-600' },
                          { label: 'Failed',   value: c.failed_count,   icon: XCircle,      color: 'text-red-500' },
                        ].map(({ label, value, icon: Icon, color }) => (
                          <div key={label} className="bg-gray-50 rounded-lg p-3 text-center">
                            <Icon className={`h-4 w-4 mx-auto mb-1 ${color}`} />
                            <p className="text-lg font-bold text-gray-900">{value.toLocaleString()}</p>
                            <p className="text-xs text-gray-500">{label}</p>
                          </div>
                        ))}
                      </div>

                      {/* Actions */}
                      <div className="flex gap-2 flex-wrap">
                        {(c.status === 'draft' || c.status === 'paused') && (
                          <Button
                            size="sm"
                            onClick={() => sendBatch(c.id)}
                            disabled={sending || c.total_count === 0}
                            className="bg-green-600 hover:bg-green-700"
                          >
                            {sending ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Play className="h-3.5 w-3.5 mr-1" />}
                            {c.status === 'paused' ? 'Resume' : 'Start Calling'}
                          </Button>
                        )}
                        {c.status === 'sending' && (
                          <Button
                            size="sm" variant="outline"
                            onClick={() => pauseCampaign(c.id)}
                            disabled={pausing}
                          >
                            <Pause className="h-3.5 w-3.5 mr-1" /> Pause
                          </Button>
                        )}
                        <Button
                          size="sm" variant="outline"
                          className="border-red-200 text-red-500 hover:bg-red-50 ml-auto"
                          onClick={() => deleteCampaign(c.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5 mr-1" /> Delete
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </ProspectLayout>
  );
}
