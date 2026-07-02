import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useActiveProject } from '@/hooks/useOlympiadProjects';
import ProspectLayout from '@/components/prospect/ProspectLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { Users, ChevronRight, ChevronLeft, CheckCircle, Send } from 'lucide-react';

type Step = 1 | 2 | 3 | 4;

const STEPS = [
  { n: 1, label: 'Basics'   },
  { n: 2, label: 'Template' },
  { n: 3, label: 'Audience' },
  { n: 4, label: 'Review'   },
];

const BOARDS = ['State Board', 'Matriculation', 'CBSE', 'ICSE', 'International Board'];
const STATES = ['Tamil Nadu', 'Puducherry', 'Karnataka', 'Kerala', 'Andhra Pradesh', 'Telangana'];
const STAGES = ['cold_prospect', 'prospect', 'registered', 'active'];

export default function ProspectCampaignNew() {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const { data: activeProject } = useActiveProject();
  const { toast } = useToast();

  const [step, setStep] = useState<Step>(1);
  const [saving, setSaving] = useState(false);

  // Step 1
  const [name, setName]        = useState('');
  const [description, setDesc] = useState('');

  // Step 2 — email templates only
  const [templates, setTemplates] = useState<any[]>([]);
  const [templateId, setTemplateId] = useState('');

  // Step 3 — audience filters
  const [filters, setFilters] = useState({ state: '', district: '', board: '', stage: '' });
  const [districts, setDistricts] = useState<string[]>([]);
  const [audienceCount, setAudienceCount] = useState<number | null>(null);
  const [counting, setCounting] = useState(false);

  // Step 4
  const [sendNow, setSendNow]       = useState(true);
  const [scheduledAt, setScheduledAt] = useState('');

  useEffect(() => {
    supabase.from('email_templates').select('id,name,subject,category').eq('status', 'approved')
      .then(({ data }) => setTemplates(data || []));
  }, []);

  useEffect(() => {
    if (!filters.state) { setDistricts([]); return; }
    supabase.rpc('get_prospect_districts', { p_state: filters.state })
      .then(({ data }) => setDistricts((data as string[]) || []));
  }, [filters.state]);

  const refreshCount = useCallback(async () => {
    setCounting(true);
    const { data } = await supabase.rpc('get_audience_count', {
      p_state:      filters.state    || null,
      p_district:   filters.district || null,
      p_board:      filters.board    || null,
      p_stage:      filters.stage    || null,
      p_has_email:  true,
      p_has_mobile: null,
      p_project_id: activeProject?.id ?? null,
    });
    setAudienceCount(data as number);
    setCounting(false);
  }, [filters]);

  useEffect(() => { if (step === 3) refreshCount(); }, [step, filters, refreshCount]);

  const canNext = () => {
    if (step === 1) return name.trim().length > 0;
    if (step === 2) return !!templateId;
    if (step === 3) return (audienceCount ?? 0) > 0;
    return true;
  };

  const create = async () => {
    setSaving(true);
    const selectedTemplate = templates.find(t => t.id === templateId);

    const { data: campaign, error } = await supabase.from('campaigns').insert({
      name:              name.trim(),
      description:       description.trim() || null,
      channel:           'email',
      status:            sendNow ? 'scheduled' : 'draft',
      scheduled_at:      sendNow ? new Date().toISOString() : (scheduledAt || null),
      email_template_id: templateId || null,
      email_subject:     selectedTemplate?.subject || null,
      audience_filters:  filters,
      audience_count:    audienceCount ?? 0,
      target_count:      audienceCount ?? 0,
      project_id:        activeProject?.id ?? null,
      created_by:        profile?.id,
    }).select('id').single();

    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
      setSaving(false); return;
    }

    toast({ title: 'Campaign created!', description: sendNow ? 'Campaign queued for sending.' : 'Saved as draft.' });
    navigate(`/prospect/campaigns/${campaign.id}`);
  };

  const selectedTemplate = templates.find(t => t.id === templateId);

  return (
    <ProspectLayout>
      <div className="max-w-3xl mx-auto px-6 py-8">
        {/* Progress steps */}
        <div className="flex items-center gap-0 mb-10">
          {STEPS.map((s, i) => (
            <div key={s.n} className="flex items-center flex-1">
              <div className={`flex items-center gap-2.5 px-4 py-2.5 rounded-xl transition-all ${
                step === s.n ? 'bg-indigo-600 text-white shadow-md' :
                step > s.n  ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-400'
              }`}>
                {step > s.n
                  ? <CheckCircle className="h-5 w-5 flex-shrink-0" />
                  : <span className="w-5 h-5 rounded-full border-2 flex items-center justify-center text-xs font-bold flex-shrink-0 border-current">{s.n}</span>}
                <span className="font-semibold text-sm whitespace-nowrap">{s.label}</span>
              </div>
              {i < STEPS.length - 1 && <div className="flex-1 h-0.5 bg-gray-200 mx-2" />}
            </div>
          ))}
        </div>

        {/* Step 1: Basics */}
        {step === 1 && (
          <div className="bg-white rounded-2xl border border-gray-200 p-8 space-y-6">
            <div>
              <h2 className="text-xl font-bold text-gray-900">Campaign Basics</h2>
              <p className="text-sm text-gray-500 mt-1">Email campaign — sent via Elastic Email</p>
            </div>
            <div className="space-y-2">
              <Label className="text-base font-semibold text-gray-700">Campaign Name *</Label>
              <Input className="h-12 text-base" placeholder="e.g. iPlus 2026 Launch — CBSE Schools"
                value={name} onChange={e => setName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label className="text-base font-semibold text-gray-700">Description <span className="text-gray-400 font-normal">(optional)</span></Label>
              <Textarea className="text-base" rows={3} placeholder="Internal note about this campaign"
                value={description} onChange={e => setDesc(e.target.value)} />
            </div>
          </div>
        )}

        {/* Step 2: Template */}
        {step === 2 && (
          <div className="bg-white rounded-2xl border border-gray-200 p-8 space-y-6">
            <h2 className="text-xl font-bold text-gray-900">Select Email Template</h2>
            <p className="text-base text-gray-500">Only approved templates can be used in campaigns.</p>

            {templates.length === 0 ? (
              <div className="text-center py-12 border border-dashed border-gray-200 rounded-xl">
                <p className="text-gray-600 text-base font-medium">No approved email templates</p>
                <p className="text-gray-400 text-sm mt-1">Create and get a template approved first</p>
                <Button className="mt-4" variant="outline" onClick={() => navigate('/prospect/templates/new')}>
                  Create Template
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                {templates.map(t => (
                  <button key={t.id} onClick={() => setTemplateId(t.id)}
                    className={`w-full text-left p-5 rounded-xl border-2 transition-all ${
                      templateId === t.id ? 'border-indigo-500 bg-indigo-50' : 'border-gray-200 hover:border-gray-300'
                    }`}>
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-bold text-base text-gray-900">{t.name}</p>
                        <p className="text-sm text-gray-500 mt-0.5">Subject: {t.subject}</p>
                        <span className="inline-block mt-1.5 px-2.5 py-0.5 bg-gray-100 text-gray-600 rounded-full text-xs font-medium">
                          {t.category}
                        </span>
                      </div>
                      {templateId === t.id && <CheckCircle className="h-6 w-6 text-indigo-600 flex-shrink-0" />}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Step 3: Audience */}
        {step === 3 && (
          <div className="bg-white rounded-2xl border border-gray-200 p-8 space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold text-gray-900">Target Audience</h2>
                <p className="text-sm text-gray-500 mt-1">Only schools with an email address are counted.</p>
              </div>
              <div className={`px-5 py-3 rounded-xl text-center min-w-32 ${
                audienceCount === null ? 'bg-gray-50' : audienceCount > 0 ? 'bg-indigo-50' : 'bg-red-50'
              }`}>
                {counting ? (
                  <p className="text-sm text-gray-400">Counting…</p>
                ) : (
                  <>
                    <p className={`text-3xl font-bold ${audienceCount === 0 ? 'text-red-500' : 'text-indigo-700'}`}>
                      {audienceCount?.toLocaleString() ?? '—'}
                    </p>
                    <p className="text-sm text-gray-500 mt-0.5">schools match</p>
                  </>
                )}
              </div>
            </div>
            <p className="text-base text-gray-500">Leave filters empty to target all schools with email.</p>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-sm font-semibold text-gray-700">State</Label>
                <Select value={filters.state || 'all'} onValueChange={v => setFilters(f => ({ ...f, state: v === 'all' ? '' : v, district: '' }))}>
                  <SelectTrigger className="h-11 text-base"><SelectValue placeholder="All states" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All States</SelectItem>
                    {STATES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label className="text-sm font-semibold text-gray-700">District</Label>
                <Select value={filters.district || 'all'} onValueChange={v => setFilters(f => ({ ...f, district: v === 'all' ? '' : v }))} disabled={!filters.state}>
                  <SelectTrigger className="h-11 text-base"><SelectValue placeholder="All districts" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Districts</SelectItem>
                    {districts.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label className="text-sm font-semibold text-gray-700">Board</Label>
                <Select value={filters.board || 'all'} onValueChange={v => setFilters(f => ({ ...f, board: v === 'all' ? '' : v }))}>
                  <SelectTrigger className="h-11 text-base"><SelectValue placeholder="All boards" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Boards</SelectItem>
                    {BOARDS.map(b => <SelectItem key={b} value={b}>{b}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label className="text-sm font-semibold text-gray-700">Stage</Label>
                <Select value={filters.stage || 'all'} onValueChange={v => setFilters(f => ({ ...f, stage: v === 'all' ? '' : v }))}>
                  <SelectTrigger className="h-11 text-base"><SelectValue placeholder="All stages" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Stages</SelectItem>
                    {STAGES.map(s => <SelectItem key={s} value={s}>{s.replace('_', ' ')}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {audienceCount === 0 && (
              <p className="text-red-600 text-base font-medium bg-red-50 px-4 py-3 rounded-xl">
                No schools match these filters. Adjust the audience.
              </p>
            )}
          </div>
        )}

        {/* Step 4: Review & Schedule */}
        {step === 4 && (
          <div className="space-y-5">
            <div className="bg-white rounded-2xl border border-gray-200 p-8 space-y-5">
              <h2 className="text-xl font-bold text-gray-900">Review Campaign</h2>
              <div className="grid grid-cols-2 gap-x-8 gap-y-4 text-base">
                <div><p className="text-gray-500 text-sm font-medium mb-0.5">Campaign Name</p><p className="text-gray-900 font-semibold">{name}</p></div>
                <div><p className="text-gray-500 text-sm font-medium mb-0.5">Channel</p><p className="text-gray-900 font-semibold">Email</p></div>
                <div><p className="text-gray-500 text-sm font-medium mb-0.5">Template</p><p className="text-gray-900 font-semibold">{selectedTemplate?.name || '—'}</p></div>
                <div><p className="text-gray-500 text-sm font-medium mb-0.5">Audience</p><p className="text-indigo-700 font-bold text-lg">{(audienceCount ?? 0).toLocaleString()} schools</p></div>
                {selectedTemplate && <div className="col-span-2"><p className="text-gray-500 text-sm font-medium mb-0.5">Subject</p><p className="text-gray-900">{selectedTemplate.subject}</p></div>}
              </div>
            </div>

            <div className="bg-white rounded-2xl border border-gray-200 p-8 space-y-5">
              <h2 className="text-xl font-bold text-gray-900">Schedule</h2>
              <div className="grid grid-cols-2 gap-4">
                {[
                  { v: true,  label: 'Send Now',  desc: 'Queue immediately' },
                  { v: false, label: 'Schedule',   desc: 'Pick a date & time' },
                ].map(({ v, label, desc }) => (
                  <button key={String(v)} onClick={() => setSendNow(v)}
                    className={`p-5 rounded-xl border-2 text-left transition-all ${sendNow === v ? 'border-indigo-500 bg-indigo-50' : 'border-gray-200 hover:border-gray-300'}`}>
                    <p className={`font-bold text-base ${sendNow === v ? 'text-indigo-700' : 'text-gray-700'}`}>{label}</p>
                    <p className="text-sm text-gray-500 mt-0.5">{desc}</p>
                  </button>
                ))}
              </div>
              {!sendNow && (
                <div className="space-y-2">
                  <Label className="text-sm font-semibold text-gray-700">Date & Time</Label>
                  <Input type="datetime-local" className="h-11 text-base" value={scheduledAt} onChange={e => setScheduledAt(e.target.value)} />
                </div>
              )}
            </div>

            <div className="bg-indigo-50 border border-indigo-200 rounded-2xl p-6">
              <p className="text-base font-semibold text-indigo-800 mb-1">Sending via Elastic Email</p>
              <p className="text-sm text-indigo-700">After creating, open the campaign to send a test first, then send in warm-up batches. Schools with no email, bounced, or unsubscribed addresses are skipped automatically.</p>
            </div>
          </div>
        )}

        {/* Navigation */}
        <div className="flex items-center justify-between mt-8">
          <Button variant="outline" size="lg" disabled={step === 1} onClick={() => setStep(s => (s - 1) as Step)}>
            <ChevronLeft className="h-5 w-5 mr-1" /> Back
          </Button>
          {step < 4 ? (
            <Button size="lg" disabled={!canNext()} onClick={() => setStep(s => (s + 1) as Step)}>
              Next <ChevronRight className="h-5 w-5 ml-1" />
            </Button>
          ) : (
            <Button size="lg" onClick={create} disabled={saving}>
              <Send className="h-5 w-5 mr-2" />
              {saving ? 'Creating…' : (sendNow ? 'Create & Queue' : 'Save Campaign')}
            </Button>
          )}
        </div>
      </div>
    </ProspectLayout>
  );
}
