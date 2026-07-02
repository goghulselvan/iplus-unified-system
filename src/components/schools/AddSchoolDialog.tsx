import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useActiveProject } from '@/hooks/useOlympiadProjects';
import { useToast } from '@/hooks/use-toast';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Search, CheckCircle, Building2, ArrowLeft, Plus, Star, Phone, Mail, Send, Loader2 } from 'lucide-react';

type ProspectSchool = {
  id: string; ss_no: number; udise_code: string; school_name: string;
  district: string; state: string; board: string | null;
  email: string | null; mobile: string | null; address: string | null;
  pincode: string | null; principal_name: string | null;
  school_management: string | null; class_from: number | null; class_to: number | null;
  linked_to_crm: boolean;
};

type Step = 'search' | 'confirm' | 'manual' | 'notify';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
  mode?: 'register' | 'interested'; // interested = Pending, register = In Progress
}

const BOARDS = ['State Board', 'Matriculation', 'CBSE', 'ICSE', 'International Board'];
const STATES = ['Tamil Nadu', 'Puducherry', 'Karnataka', 'Kerala', 'Andhra Pradesh', 'Telangana'];

export function AddSchoolDialog({ open, onOpenChange, onCreated, mode = 'register' }: Props) {
  const isInterested = mode === 'interested';
  const { toast } = useToast();
  const { data: activeProject } = useActiveProject();
  const [step, setStep] = useState<Step>('search');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ProspectSchool[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<ProspectSchool | null>(null);
  const [saving, setSaving] = useState(false);
  const [notifSending, setNotifSending] = useState(false);
  const [createdInfo, setCreatedInfo] = useState<{ schoolId: string; phone: string | null; email: string | null; name: string } | null>(null);
  // Whether the selected school is already in the ACTIVE project (not just ever-linked).
  const [inActiveProject, setInActiveProject] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  // Manual form state
  const [manual, setManual] = useState({
    school_name: '', state: '', district: '', board: '',
    email: '', mobile: '', address: '', pincode: '',
  });
  const [manualDistricts, setManualDistricts] = useState<string[]>([]);

  // Reset when dialog closes
  useEffect(() => {
    if (!open) {
      setTimeout(() => {
        setStep('search'); setQuery(''); setResults([]);
        setSelected(null); setSaving(false); setNotifSending(false); setCreatedInfo(null);
        setManual({ school_name: '', state: '', district: '', board: '', email: '', mobile: '', address: '', pincode: '' });
      }, 200);
    }
  }, [open]);

  // Load districts when manual state changes
  useEffect(() => {
    if (!manual.state) { setManualDistricts([]); return; }
    supabase.from('prospect_schools').select('district')
      .eq('state', manual.state).order('district')
      .then(({ data }) => {
        const unique = [...new Set((data || []).map(r => r.district).filter(Boolean))] as string[];
        setManualDistricts(unique);
      });
  }, [manual.state]);

  // Debounced search in prospect_schools
  useEffect(() => {
    if (!query.trim() || step !== 'search') { setResults([]); return; }
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      const { data } = await supabase.from('prospect_schools')
        .select('id,ss_no,udise_code,school_name,district,state,board,email,mobile,address,pincode,principal_name,school_management,class_from,class_to,linked_to_crm')
        .ilike('school_name', `%${query.trim()}%`)
        .order('school_name')
        .limit(8);
      setResults((data as ProspectSchool[]) || []);
      setSearching(false);
    }, 300);
  }, [query, step]);

  const selectProspect = async (school: ProspectSchool) => {
    setSelected(school);
    setStep('confirm');
    // `linked_to_crm` is global (any past year). Determine membership in the
    // ACTIVE project specifically, so prior-year schools can be re-added.
    setInActiveProject(false);
    if (activeProject) {
      const { data: sch } = await supabase.from('schools')
        .select('id').eq('prospect_school_id', school.id).maybeSingle();
      if (sch) {
        const { data: wf } = await supabase.from('school_project_workflow')
          .select('id').eq('school_id', sch.id).eq('project_id', activeProject.id).maybeSingle();
        setInActiveProject(!!wf);
      }
    }
  };

  const registerFromProspect = async () => {
    if (!selected || !activeProject) return;
    setSaving(true);
    try {
      // Reuse an existing CRM school row if this prospect was linked in a prior
      // year; only block when it's already in the ACTIVE project.
      const { data: existing } = await supabase.from('schools')
        .select('id').eq('prospect_school_id', selected.id).maybeSingle();

      let schoolId = existing?.id as string | undefined;
      if (schoolId) {
        const { data: wf } = await supabase.from('school_project_workflow')
          .select('id').eq('school_id', schoolId).eq('project_id', activeProject.id).maybeSingle();
        if (wf) {
          toast({ title: 'Already in CRM', description: `${selected.school_name} is already in ${activeProject.project_name}.` });
          setSaving(false); return;
        }
      } else {
        const { data: newSchool, error: schoolErr } = await supabase.from('schools').insert({
          school_name:    selected.school_name,
          ss_no:          selected.ss_no,
          district:       selected.district,
          state:          selected.state,
          board:          selected.board,
          mobile1:        selected.mobile,
          email:          selected.email,
          school_address: selected.address,
          pincode:        selected.pincode,
          prospect_school_id: selected.id,
          current_project_id: activeProject.id,
        }).select('id').single();
        if (schoolErr) throw schoolErr;
        schoolId = newSchool.id;
      }

      const { error: wfErr } = await supabase.from('school_project_workflow').insert({
        school_id:       schoolId,
        project_id:      activeProject.id,
        registration_status: isInterested ? 'Pending' : 'In Progress',
        registration_interest: isInterested ? 'Interested' : undefined,
        contacted: 'Yes',
      });
      if (wfErr) throw wfErr;

      await supabase.from('prospect_schools')
        .update({ stage: isInterested ? 'interested' : 'registered', linked_to_crm: true }).eq('id', selected.id);

      if (isInterested) {
        setCreatedInfo({ schoolId: schoolId!, phone: selected.mobile, email: selected.email, name: selected.school_name });
        setStep('notify');
        onCreated();
      } else {
        toast({ title: 'School registered', description: `${selected.school_name} added to ${activeProject.project_name}.` });
        onOpenChange(false);
        onCreated();
      }
    } catch (e: any) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const registerManual = async () => {
    if (!manual.school_name || !manual.state || !manual.district || !manual.board) {
      toast({ title: 'Required fields missing', description: 'Name, State, District and Board are required.', variant: 'destructive' });
      return;
    }
    if (!activeProject) { toast({ title: 'No active project', variant: 'destructive' }); return; }
    setSaving(true);
    try {
      // Create in prospect_schools first (gets new SS NO from sequence)
      const { data: newProspect, error: prospectErr } = await supabase.from('prospect_schools').insert({
        school_name: manual.school_name.trim(),
        state:       manual.state,
        district:    manual.district,
        board:       manual.board || null,
        email:       manual.email.trim() || null,
        mobile:      manual.mobile.trim() || null,
        address:     manual.address.trim() || null,
        pincode:     manual.pincode.trim() || null,
        stage:       isInterested ? 'interested' : 'registered',
        status:      'active',
        source:      'manual',
        linked_to_crm: true,
      }).select('id,ss_no').single();
      if (prospectErr) throw prospectErr;

      // Create in schools table
      const { data: newSchool, error: schoolErr } = await supabase.from('schools').insert({
        school_name:    manual.school_name.trim(),
        ss_no:          newProspect.ss_no,
        district:       manual.district,
        state:          manual.state,
        board:          manual.board || null,
        mobile1:        manual.mobile.trim() || null,
        email:          manual.email.trim() || null,
        school_address: manual.address.trim() || null,
        pincode:        manual.pincode.trim() || null,
        prospect_school_id: newProspect.id,
        current_project_id: activeProject.id,
      }).select('id').single();
      if (schoolErr) throw schoolErr;

      // Create workflow
      const { error: wfErr } = await supabase.from('school_project_workflow').insert({
        school_id:       newSchool.id,
        project_id:      activeProject.id,
        registration_status: isInterested ? 'Pending' : 'In Progress',
        registration_interest: isInterested ? 'Interested' : undefined,
        contacted: 'Yes',
      });
      if (wfErr) throw wfErr;

      if (isInterested) {
        setCreatedInfo({ schoolId: newSchool.id, phone: manual.mobile || null, email: manual.email || null, name: manual.school_name });
        setStep('notify');
        onCreated();
      } else {
        toast({ title: 'School added', description: `${manual.school_name} registered. SS NO: ${newProspect.ss_no}` });
        onOpenChange(false);
        onCreated();
      }
    } catch (e: any) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const sendInterestNotification = async () => {
    if (!createdInfo) return;
    setNotifSending(true);
    try {
      await supabase.functions.invoke('notify-interested-school', {
        body: { schoolId: createdInfo.schoolId },
      });
      toast({ title: 'Messages sent', description: `Interest acknowledgement sent to ${createdInfo.name}.` });
    } catch (e: any) {
      toast({ title: 'Notification failed', description: e.message, variant: 'destructive' });
    } finally {
      setNotifSending(false);
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {step !== 'search' && (
              <button onClick={() => setStep('search')} className="text-gray-400 hover:text-gray-600 mr-1">
                <ArrowLeft className="h-4 w-4" />
              </button>
            )}
            {step === 'search' && (isInterested ? 'Mark School as Interested' : 'Add School to CRM')}
            {step === 'confirm' && (isInterested ? 'Confirm Interest' : 'Confirm Registration')}
            {step === 'manual' && (isInterested ? 'Add Interested School' : 'Add School Manually')}
            {step === 'notify' && 'Send Intro Message?'}
          </DialogTitle>
        </DialogHeader>

        {/* STEP 1: Search */}
        {step === 'search' && (
          <div className="space-y-4 mt-2">
            <p className="text-sm text-gray-500">Search the prospect school database first. If not found, add manually.</p>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input
                autoFocus
                className="pl-9"
                placeholder="Type school name…"
                value={query}
                onChange={e => setQuery(e.target.value)}
              />
            </div>

            {searching && <p className="text-sm text-gray-400 text-center py-2">Searching…</p>}

            {!searching && results.length > 0 && (
              <div className="border border-gray-100 rounded-lg overflow-hidden divide-y divide-gray-50">
                {results.map(s => (
                  <button
                    key={s.id}
                    onClick={() => selectProspect(s)}
                    className="w-full text-left px-4 py-3 hover:bg-indigo-50 transition-colors flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <p className="font-medium text-gray-900 text-sm truncate">{s.school_name}</p>
                      <p className="text-xs text-gray-500 mt-0.5">{s.district}, {s.state} · {s.board || 'Board unknown'} · SS #{String(s.ss_no).padStart(4,'0')}</p>
                    </div>
                    {s.linked_to_crm
                      ? <span className="text-xs text-green-600 font-medium flex-shrink-0 flex items-center gap-1"><CheckCircle className="h-3 w-3" /> In CRM</span>
                      : <span className="text-xs text-indigo-600 flex-shrink-0">Select →</span>}
                  </button>
                ))}
              </div>
            )}

            {!searching && query.trim().length > 1 && results.length === 0 && (
              <p className="text-sm text-gray-400 text-center py-2">No schools found for "{query}"</p>
            )}

            <div className="pt-2 border-t border-gray-100">
              <Button variant="outline" className="w-full" onClick={() => setStep('manual')}>
                <Plus className="h-4 w-4 mr-2" />
                Not found — add manually
              </Button>
            </div>
          </div>
        )}

        {/* STEP 2A: Confirm from prospect */}
        {step === 'confirm' && selected && (
          <div className="space-y-4 mt-2">
            <div className="bg-gray-50 rounded-xl p-4 space-y-2.5 text-sm">
              <div className="flex items-start gap-2">
                <Building2 className="h-4 w-4 text-indigo-500 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="font-semibold text-gray-900">{selected.school_name}</p>
                  <p className="text-gray-500 text-xs mt-0.5">SS #{String(selected.ss_no).padStart(4,'0')} · UDISE: {selected.udise_code}</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs pt-1">
                <span className="text-gray-500">District</span><span className="text-gray-800 font-medium">{selected.district}</span>
                <span className="text-gray-500">State</span><span className="text-gray-800">{selected.state}</span>
                {selected.board && <><span className="text-gray-500">Board</span><span className="text-gray-800">{selected.board}</span></>}
                {selected.email && <><span className="text-gray-500">Email</span><span className="text-gray-800 truncate">{selected.email}</span></>}
                {selected.mobile && <><span className="text-gray-500">Mobile</span><span className="text-gray-800">{selected.mobile}</span></>}
                {selected.principal_name && <><span className="text-gray-500">Principal</span><span className="text-gray-800">{selected.principal_name}</span></>}
                {selected.class_from != null && <><span className="text-gray-500">Classes</span><span className="text-gray-800">{selected.class_from}–{selected.class_to}</span></>}
              </div>
            </div>

            {inActiveProject ? (
              <div className="flex items-center justify-center gap-2 py-3 rounded-lg bg-green-50 text-green-700 text-sm font-medium">
                <CheckCircle className="h-4 w-4" /> Already in {activeProject?.project_name ?? 'this project'}
              </div>
            ) : (
              <>
                <p className="text-xs text-gray-500 text-center">
                  {isInterested
                    ? <>School will be added to <span className="font-medium text-gray-700">{activeProject?.project_name}</span> as <span className="font-medium text-amber-700">Interested — Pending Registration</span></>
                    : <>School will be registered under <span className="font-medium text-gray-700">{activeProject?.project_name}</span></>
                  }
                </p>
                <Button
                  className={`w-full ${isInterested ? 'bg-amber-500 hover:bg-amber-600' : ''}`}
                  onClick={registerFromProspect} disabled={saving}>
                  {saving ? 'Saving…' : isInterested
                    ? `Mark as Interested for ${activeProject?.project_name ?? 'CRM'}`
                    : `Register for ${activeProject?.project_name ?? 'CRM'}`}
                </Button>
              </>
            )}
          </div>
        )}

        {/* STEP 2B: Manual form */}
        {step === 'manual' && (
          <div className="space-y-3 mt-2">
            <p className="text-xs text-amber-600 bg-amber-50 px-3 py-2 rounded-lg">
              This school will be added to prospect_schools (new SS NO) and registered for {activeProject?.project_name}.
            </p>
            <div className="space-y-1.5">
              <Label>School Name *</Label>
              <Input placeholder="Full school name" value={manual.school_name}
                onChange={e => setManual(m => ({ ...m, school_name: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>State *</Label>
                <Select value={manual.state} onValueChange={v => setManual(m => ({ ...m, state: v, district: '' }))}>
                  <SelectTrigger><SelectValue placeholder="Select state" /></SelectTrigger>
                  <SelectContent>{STATES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>District *</Label>
                <Select value={manual.district} onValueChange={v => setManual(m => ({ ...m, district: v }))} disabled={!manual.state}>
                  <SelectTrigger><SelectValue placeholder="Select district" /></SelectTrigger>
                  <SelectContent>
                    {manualDistricts.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                    <SelectItem value="__other">Other / Type below</SelectItem>
                  </SelectContent>
                </Select>
                {manual.district === '__other' && (
                  <Input className="mt-1" placeholder="Type district name"
                    onChange={e => setManual(m => ({ ...m, district: e.target.value }))} />
                )}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Board *</Label>
              <Select value={manual.board} onValueChange={v => setManual(m => ({ ...m, board: v }))}>
                <SelectTrigger><SelectValue placeholder="Select board" /></SelectTrigger>
                <SelectContent>{BOARDS.map(b => <SelectItem key={b} value={b}>{b}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Email</Label>
                <Input type="email" placeholder="school@example.com" value={manual.email}
                  onChange={e => setManual(m => ({ ...m, email: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Mobile</Label>
                <Input placeholder="10-digit number" value={manual.mobile}
                  onChange={e => setManual(m => ({ ...m, mobile: e.target.value }))} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Address</Label>
                <Input placeholder="School address" value={manual.address}
                  onChange={e => setManual(m => ({ ...m, address: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Pincode</Label>
                <Input placeholder="600001" value={manual.pincode}
                  onChange={e => setManual(m => ({ ...m, pincode: e.target.value }))} />
              </div>
            </div>
            <div className="flex gap-2 pt-1">
              <Button variant="outline" className="flex-1" onClick={() => setStep('search')}>Back</Button>
              <Button className="flex-1" onClick={registerManual} disabled={saving}>
                {saving ? 'Adding…' : 'Add & Register'}
              </Button>
            </div>
          </div>
        )}

        {/* STEP 3: Notify (interested mode only — shown after save) */}
        {step === 'notify' && createdInfo && (
          <div className="space-y-4 mt-2">
            <div className="flex items-center gap-2 py-2 rounded-lg bg-amber-50 text-amber-700 text-sm font-medium px-3">
              <Star className="h-4 w-4 fill-amber-400" />
              <span><span className="font-semibold">{createdInfo.name}</span> added as Interested!</span>
            </div>
            <p className="text-sm text-gray-600">Send an interest acknowledgement email and WhatsApp to this school now?</p>
            <div className="flex gap-2">
              <Button
                className="flex-1 bg-amber-500 hover:bg-amber-600"
                disabled={notifSending}
                onClick={sendInterestNotification}
              >
                {notifSending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}
                {notifSending ? 'Sending…' : 'Send Interest Acknowledgement'}
              </Button>
              <Button variant="outline" disabled={notifSending}
                onClick={() => { toast({ title: 'Added as Interested', description: createdInfo.name }); onOpenChange(false); }}>
                Add
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
