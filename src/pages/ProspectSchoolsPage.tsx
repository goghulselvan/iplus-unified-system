import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import ProspectLayout from '@/components/prospect/ProspectLayout';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Search, X, Mail, Phone, Globe, Building2, CheckCircle, Star, History, Upload, Download, Loader2, Send, Eye, EyeOff, PhoneCall, PhoneOff, Mic } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useActiveProject } from '@/hooks/useOlympiadProjects';
import { useAuth } from '@/hooks/useAuth';
import ProspectUploadSchools from '@/components/prospect/ProspectUploadSchools';
import { toCSV } from '@/utils/csvExport';

type ProspectContact = { name: string; role: string; mobile: string };

type ProspectSchool = {
  id: string; ss_no: number; udise_code: string; school_name: string;
  district: string; state: string; board: string | null;
  stage: string; school_management: string | null; school_type: string | null;
  school_category: string | null;
  class_from: number | null; class_to: number | null;
  email: string | null; mobile: string | null; website: string | null;
  principal_name: string | null; address: string | null; pincode: string | null;
  school_location: string | null; linked_to_crm: boolean; has_history: boolean;
  is_active: boolean | null;
  additional_contacts: ProspectContact[] | null;
};

const CONTACT_ROLES = ['Principal', 'School', 'Coordinator', 'Other'];
const MAX_CONTACTS = 5;

const STAGE_COLORS: Record<string, string> = {
  uncontacted: 'bg-gray-100 text-gray-500',
  contacted:   'bg-blue-100 text-blue-700',
  interested:  'bg-amber-100 text-amber-700',
  registered:  'bg-green-100 text-green-700',
  active:      'bg-indigo-100 text-indigo-700',
};

const PAGE_SIZE = 50;

export default function ProspectSchoolsPage() {
  const { toast } = useToast();
  const navigate = useNavigate();
  const { data: activeProject } = useActiveProject();
  const { profile } = useAuth();

  const [schools, setSchools]         = useState<ProspectSchool[]>([]);
  const [total, setTotal]             = useState(0);
  const [page, setPage]               = useState(0);
  const [loading, setLoading]         = useState(true);
  const [selected, setSelected]       = useState<ProspectSchool | null>(null);
  const [registering, setRegistering] = useState(false);
  const [uploadOpen, setUploadOpen]   = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [editingContact, setEditingContact] = useState(false);
  const [contactForm, setContactForm] = useState<{ email: string; mobile: string; website: string; principal_name: string; contacts: ProspectContact[] }>({ email: '', mobile: '', website: '', principal_name: '', contacts: [] });
  const [savingContact, setSavingContact] = useState(false);

  // Click2Call state
  const [callDialogOpen, setCallDialogOpen] = useState(false);
  const [callType, setCallType] = useState<'click2call' | 'tts'>('click2call');
  const [staffPhone, setStaffPhone] = useState('7598321769');
  const [ttsSpeech, setTtsSpeech] = useState('');
  const [calling, setCalling] = useState(false);
  const [callLogs, setCallLogs] = useState<any[]>([]);

  type InterestNotif = { schoolId: string; phone: string | null; email: string | null; name: string };
  const [interestNotif, setInterestNotif] = useState<InterestNotif | null>(null);
  const [notifSending, setNotifSending] = useState(false);

  // E-Brochure state — checkbox multi-select, sends to every checked number
  const [ebrochureOpen, setEbrochureOpen] = useState(false);
  const [ebrochureChecked, setEbrochureChecked] = useState<Set<string>>(new Set());
  const [ebrochureManual, setEbrochureManual] = useState('');
  const [ebrochureManualName, setEbrochureManualName] = useState('');
  const [ebrochureManualRole, setEbrochureManualRole] = useState('');
  const [ebrochureSaveMobile, setEbrochureSaveMobile] = useState(false);
  const [ebrochureSending, setEbrochureSending] = useState(false);

  const toggleEbrochureNumber = (key: string) => {
    setEbrochureChecked(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  const isSuperAdmin = profile?.role === 'superadmin';

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const { data, error } = await supabase.rpc('get_prospect_schools', {
        p_search:          search.trim() || null,
        p_state:           state    !== 'all' ? state    : null,
        p_district:        district !== 'all' ? district : null,
        p_board:           board    !== 'all' ? board    : null,
        p_stage:           stage    !== 'all' ? stage    : null,
        p_school_category: schoolCategory !== 'all' ? schoolCategory : null,
        p_has_email:       hasEmail  ? true : null,
        p_has_mobile:      hasMobile ? true : null,
        p_limit:           100000,
        p_offset:          0,
        p_max_class:       eligibleOnly && maxEligibleClass != null ? maxEligibleClass : null,
        p_active_only:     activeOnly,
      });
      if (error) throw error;

      const rows = (data as any).rows as ProspectSchool[];
      if (!rows.length) {
        toast({ title: 'No data', description: 'No schools match the current filters.', variant: 'destructive' });
        return;
      }

      const headers = [
        'SS NO', 'UDISE Code', 'School Name', 'District', 'State', 'Board',
        'Stage', 'Email', 'Mobile', 'Category', 'Management', 'Type',
        'Class From', 'Class To', 'Address', 'Pincode', 'Principal Name', 'In CRM',
      ];
      const csvData = rows.map(s => [
        String(s.ss_no).padStart(4, '0'),
        s.udise_code || '',
        s.school_name,
        s.district,
        s.state,
        s.board || '',
        s.stage,
        s.email || '',
        s.mobile || '',
        s.school_category || '',
        s.school_management || '',
        s.school_type || '',
        s.class_from ?? '',
        s.class_to ?? '',
        s.address || '',
        s.pincode || '',
        s.principal_name || '',
        s.linked_to_crm ? 'Yes' : 'No',
      ]);

      const csvContent = toCSV([headers, ...csvData]);
      const blob = new Blob([csvContent], { type: 'text/csv' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `prospect_schools_${new Date().toISOString().split('T')[0]}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);

      toast({ title: 'Export successful', description: `${rows.length.toLocaleString()} schools exported.` });
    } catch (e: any) {
      toast({ title: 'Export failed', description: e.message, variant: 'destructive' });
    } finally {
      setIsExporting(false);
    }
  };

  // Eligibility filter — on by default; shows only schools eligible for the active project
  const [eligibleOnly, setEligibleOnly]     = useState(true);
  const [maxEligibleClass, setMaxEligibleClass] = useState<number | null>(null);
  // Active filter — on by default; hides inactive (special/differently-abled) schools
  const [activeOnly, setActiveOnly] = useState(true);

  // Filters
  const [search, setSearch]                 = useState('');
  const [state, setState]                   = useState('all');
  const [district, setDistrict]             = useState('all');
  const [board, setBoard]                   = useState('all');
  const [stage, setStage]                   = useState('all');
  const [schoolCategory, setSchoolCategory] = useState('all');
  const [hasEmail, setHasEmail]             = useState(false);
  const [hasMobile, setHasMobile]           = useState(false);

  // Dynamic filter options (fetched from DB)
  const [states, setStates]           = useState<string[]>([]);
  const [districts, setDistricts]     = useState<string[]>([]);
  const [categories, setCategories]   = useState<string[]>([]);

  // Load states + categories once
  useEffect(() => {
    supabase.rpc('get_prospect_filter_options').then(({ data }) => {
      if (data) {
        setStates((data as any).states ?? []);
        setCategories((data as any).categories ?? []);
      }
    });
  }, []);

  // Fetch max eligible class whenever active project changes
  useEffect(() => {
    if (!activeProject?.id) { setMaxEligibleClass(null); return; }
    supabase.rpc('project_eligible_class_max', { p_project_id: activeProject.id })
      .then(({ data }) => setMaxEligibleClass(typeof data === 'number' ? data : null));
  }, [activeProject?.id]);

  // Load districts when state changes
  useEffect(() => {
    if (state === 'all') { setDistricts([]); setDistrict('all'); return; }
    supabase.rpc('get_prospect_districts', { p_state: state })
      .then(({ data }) => { setDistricts((data as string[]) || []); setDistrict('all'); });
  }, [state]);

  const filtersActive = search || state !== 'all' || district !== 'all' || board !== 'all'
    || stage !== 'all' || schoolCategory !== 'all' || hasEmail || hasMobile;

  const fetchSchools = useCallback(async (p = 0) => {
    setLoading(true);
    const { data, error } = await supabase.rpc('get_prospect_schools', {
      p_search:          search.trim() || null,
      p_state:           state    !== 'all' ? state    : null,
      p_district:        district !== 'all' ? district : null,
      p_board:           board    !== 'all' ? board    : null,
      p_stage:           stage    !== 'all' ? stage    : null,
      p_school_category: schoolCategory !== 'all' ? schoolCategory : null,
      p_has_email:       hasEmail  ? true : null,
      p_has_mobile:      hasMobile ? true : null,
      p_limit:           PAGE_SIZE,
      p_offset:          p * PAGE_SIZE,
      p_max_class:       eligibleOnly && maxEligibleClass != null ? maxEligibleClass : null,
      p_active_only:     activeOnly,
    });
    if (error) toast({ title: 'Error', description: error.message, variant: 'destructive' });
    else {
      const result = data as any;
      setSchools(result.rows as ProspectSchool[]);
      setTotal(result.total as number);
    }
    setLoading(false);
  }, [search, state, district, board, stage, schoolCategory, hasEmail, hasMobile, eligibleOnly, maxEligibleClass, activeOnly, toast]);

  useEffect(() => { setPage(0); fetchSchools(0); }, [fetchSchools]);

  const handlePageChange = (p: number) => { setPage(p); fetchSchools(p); };

  const clearFilters = () => {
    setSearch(''); setState('all'); setDistrict('all'); setBoard('all');
    setStage('all'); setSchoolCategory('all'); setHasEmail(false); setHasMobile(false);
  };

  const toggleActiveStatus = async () => {
    if (!selected) return;
    const newStatus = selected.is_active === false ? true : false;
    const { error } = await supabase.from('prospect_schools').update({ is_active: newStatus }).eq('id', selected.id);
    if (error) { toast({ title: 'Failed', description: error.message, variant: 'destructive' }); return; }
    const updated = { ...selected, is_active: newStatus };
    setSelected(updated);
    setSchools(prev => prev.map(s => s.id === selected.id ? updated : s));
    toast({ title: newStatus ? 'Marked Active' : 'Marked Inactive' });
  };

  const startEditContact = () => {
    if (!selected) return;
    setContactForm({
      email:          selected.email          ?? '',
      mobile:         selected.mobile         ?? '',
      website:        selected.website        ?? '',
      principal_name: selected.principal_name ?? '',
      contacts:       (selected.additional_contacts ?? []).map(c => ({ name: c.name ?? '', role: c.role ?? '', mobile: c.mobile ?? '' })),
    });
    setEditingContact(true);
  };

  const saveContact = async () => {
    if (!selected) return;
    setSavingContact(true);
    const updates = {
      email:          contactForm.email          || null,
      mobile:         contactForm.mobile         || null,
      website:        contactForm.website        || null,
      principal_name: contactForm.principal_name || null,
      additional_contacts: contactForm.contacts.filter(c => c.mobile.trim()),
    };
    const { error } = await supabase.from('prospect_schools').update(updates).eq('id', selected.id);
    if (error) {
      toast({ title: 'Save failed', description: error.message, variant: 'destructive' });
    } else {
      const updated = { ...selected, ...updates };
      setSelected(updated);
      setSchools(prev => prev.map(s => s.id === selected.id ? updated : s));
      setEditingContact(false);
      toast({ title: 'Contact updated' });
    }
    setSavingContact(false);
  };

  const loadCallLogs = async (schoolId: string) => {
    const { data } = await supabase
      .from('bonvoice_call_logs')
      .select('id, call_mode, school_phone, staff_phone, status, call_duration, created_at')
      .eq('prospect_school_id', schoolId)
      .order('created_at', { ascending: false })
      .limit(5);
    setCallLogs(data ?? []);
  };

  const initiateCall = async () => {
    if (!selected?.mobile) return;
    if (callType === 'click2call' && !staffPhone) {
      toast({ title: 'Enter staff phone', variant: 'destructive' }); return;
    }
    if (callType === 'tts' && !ttsSpeech.trim()) {
      toast({ title: 'Enter TTS message', variant: 'destructive' }); return;
    }
    setCalling(true);
    try {
      const { error } = await supabase.functions.invoke('bonvoice-click2call', {
        body: {
          type: callType,
          prospect_school_id: selected.id,
          school_phone: selected.mobile,
          staff_phone: callType === 'click2call' ? staffPhone : undefined,
          speech_content: callType === 'tts' ? ttsSpeech : undefined,
        },
      });
      if (error) throw new Error(error.message);
      toast({
        title: callType === 'click2call' ? 'Call initiated!' : 'TTS call initiated!',
        description: callType === 'click2call'
          ? `Bonvoice will call your phone (${staffPhone}), then bridge to the school.`
          : `Auto-call sent to ${selected.mobile}.`,
      });
      setCallDialogOpen(false);
      loadCallLogs(selected.id);
    } catch (e: any) {
      toast({ title: 'Call failed', description: e.message, variant: 'destructive' });
    } finally {
      setCalling(false);
    }
  };

  const openEbrochureDialog = () => {
    if (!selected) return;
    setEbrochureChecked(new Set(selected.mobile ? ['mobile'] : []));
    setEbrochureManual('');
    setEbrochureManualName('');
    setEbrochureManualRole('');
    setEbrochureSaveMobile(false);
    setEbrochureOpen(true);
  };

  const handleSendEbrochure = async () => {
    if (!selected) return;
    const recipients: { phone: string; contactName?: string; isManual?: boolean }[] = [];
    if (ebrochureChecked.has('mobile') && selected.mobile) recipients.push({ phone: selected.mobile });
    (selected.additional_contacts ?? []).forEach((c, i) => {
      if (ebrochureChecked.has(`contact_${i}`) && c.mobile) recipients.push({ phone: c.mobile, contactName: c.name });
    });
    if (ebrochureChecked.has('manual')) {
      if (ebrochureManual.replace(/\D/g, '').length < 10) {
        toast({ title: 'Error', description: 'Please enter a valid 10-digit manual phone number', variant: 'destructive' });
        return;
      }
      recipients.push({ phone: ebrochureManual, contactName: ebrochureManualName || undefined, isManual: true });
    }
    // Dedupe by last 10 digits
    const seen = new Set<string>();
    const unique = recipients.filter(r => {
      const d = r.phone.replace(/\D/g, '').slice(-10);
      if (seen.has(d)) return false;
      seen.add(d);
      return true;
    });
    if (unique.length === 0) {
      toast({ title: 'Error', description: 'Select at least one phone number', variant: 'destructive' });
      return;
    }
    setEbrochureSending(true);
    try {
      // getSession refreshes an expired token; without this the invoke can fall back
      // to the anon key and the function returns "Unauthorized"
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        throw new Error('Your login session has expired — please refresh the page and log in again.');
      }
      let sentCount = 0;
      const failed: string[] = [];
      let firstError = '';
      for (const r of unique) {
        try {
          const res = await supabase.functions.invoke('send-ebrochure', {
            headers: { Authorization: `Bearer ${session.access_token}` },
            body: {
              prospectSchoolId: selected.id,
              phone: r.phone,
              schoolName: selected.school_name,
              district: selected.district,
              state: selected.state,
              contactName: r.contactName,
            },
          });
          if (res.error) {
            const body = await (res.error as any).context?.json?.().catch(() => null);
            throw new Error(body?.error || res.error.message);
          }
          if (!res.data?.success) throw new Error(res.data?.error || 'Send failed');
          sentCount++;
        } catch (e: any) {
          failed.push(r.phone);
          if (!firstError) firstError = e.message;
        }
      }
      if (failed.length === 0) {
        toast({ title: 'E-Brochure sent!', description: sentCount === 1 ? `Sent to ${unique[0].phone}` : `Sent to ${sentCount} numbers` });
      } else {
        toast({
          title: sentCount > 0 ? 'Partially sent' : 'Send failed',
          description: `${sentCount} sent · failed for ${failed.join(', ')} — ${firstError}`,
          variant: 'destructive',
        });
      }
      // Save the manual number to the school's contacts if requested
      const manualSent = ebrochureChecked.has('manual') && !failed.includes(ebrochureManual);
      if (manualSent && ebrochureSaveMobile) {
        const digits = ebrochureManual.replace(/\D/g, '').slice(-10);
        let updated: ProspectSchool | null = null;
        if (!selected.mobile) {
          const { error } = await supabase.from('prospect_schools').update({ mobile: digits }).eq('id', selected.id);
          if (!error) updated = { ...selected, mobile: digits };
        } else {
          const existing = selected.additional_contacts ?? [];
          const isDup = existing.some(c => c.mobile.replace(/\D/g, '').slice(-10) === digits) || selected.mobile.replace(/\D/g, '').slice(-10) === digits;
          if (!isDup && existing.length < MAX_CONTACTS) {
            const contacts = [...existing, { name: ebrochureManualName, role: ebrochureManualRole, mobile: digits }];
            const { error } = await supabase.from('prospect_schools').update({ additional_contacts: contacts }).eq('id', selected.id);
            if (!error) updated = { ...selected, additional_contacts: contacts };
          }
        }
        if (updated) {
          setSelected(updated);
          setSchools(prev => prev.map(s => s.id === updated!.id ? updated! : s));
        }
      }
      if (sentCount > 0) {
        setEbrochureOpen(false);
        setEbrochureManual('');
        setEbrochureManualName('');
        setEbrochureManualRole('');
        setEbrochureSaveMobile(false);
        setEbrochureChecked(new Set());
      }
    } catch (e: any) {
      toast({ title: 'Send failed', description: e.message, variant: 'destructive' });
    } finally {
      setEbrochureSending(false);
    }
  };

  const markInterested = async (school: ProspectSchool) => {
    if (!activeProject) { toast({ title: 'No active project', variant: 'destructive' }); return; }
    setRegistering(true);
    try {
      const { data: existing } = await supabase.from('schools')
        .select('id').eq('prospect_school_id', school.id).maybeSingle();
      let crmSchoolId: string;
      if (!existing) {
        const { data: newSchool, error: schoolErr } = await supabase.from('schools').insert({
          school_name: school.school_name, ss_no: school.ss_no, district: school.district,
          state: school.state, board: school.board, mobile1: school.mobile,
          email: school.email, school_address: school.address, pincode: school.pincode,
          prospect_school_id: school.id, current_project_id: activeProject.id,
        }).select('id').single();
        if (schoolErr) throw schoolErr;
        crmSchoolId = newSchool.id;
        const { error: wfErr } = await supabase.from('school_project_workflow').insert({
          school_id: crmSchoolId, project_id: activeProject.id,
          registration_status: 'Pending', registration_interest: 'Interested', contacted: 'Yes',
        });
        if (wfErr) throw wfErr;
      } else {
        crmSchoolId = existing.id;
      }
      await supabase.from('prospect_schools')
        .update({ stage: 'interested', linked_to_crm: true }).eq('id', school.id);
      setSelected(s => s ? { ...s, stage: 'interested', linked_to_crm: true } : s);
      fetchSchools(page);
      // Show notification popup after marking
      setInterestNotif({ schoolId: crmSchoolId, phone: school.mobile, email: school.email, name: school.school_name });
    } catch (e: any) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    } finally { setRegistering(false); }
  };

  const sendInterestNotification = async () => {
    if (!interestNotif) return;
    const notif = interestNotif;
    setNotifSending(true);
    try {
      await supabase.functions.invoke('notify-interested-school', {
        body: { schoolId: notif.schoolId },
      });
      toast({ title: 'Messages sent', description: `Interest acknowledgement sent to ${notif.name}.` });
    } catch (e: any) {
      toast({ title: 'Notification failed', description: e.message, variant: 'destructive' });
    } finally {
      setNotifSending(false);
      setInterestNotif(null);
    }
  };

  const registerForProject = async (school: ProspectSchool) => {
    if (!activeProject) { toast({ title: 'No active project', variant: 'destructive' }); return; }
    setRegistering(true);
    try {
      const { data: existing } = await supabase.from('schools')
        .select('id').eq('prospect_school_id', school.id).maybeSingle();
      if (existing) {
        // School already in CRM — just ensure workflow is set to In Progress and stage updated
        const { error: wfErr } = await supabase.from('school_project_workflow').upsert(
          { school_id: existing.id, project_id: activeProject.id, registration_status: 'In Progress', registration_interest: 'Interested', contacted: 'Yes' },
          { onConflict: 'school_id,project_id' }
        );
        if (wfErr) throw wfErr;
        await supabase.from('prospect_schools').update({ stage: 'registered' }).eq('id', school.id);
        toast({ title: 'Registered', description: `${school.school_name} added to ${activeProject.project_name}.` });
        setSelected(s => s ? { ...s, stage: 'registered' } : s);
        fetchSchools(page);
        setRegistering(false); return;
      }
      const { data: newSchool, error: schoolErr } = await supabase.from('schools').insert({
        school_name: school.school_name, ss_no: school.ss_no, district: school.district,
        state: school.state, board: school.board, mobile1: school.mobile,
        email: school.email, school_address: school.address, pincode: school.pincode,
        prospect_school_id: school.id,
      }).select('id').single();
      if (schoolErr) throw schoolErr;
      const { error: wfErr } = await supabase.from('school_project_workflow').insert({
        school_id: newSchool.id, project_id: activeProject.id,
        registration_status: 'In Progress', registration_interest: 'Interested', contacted: 'Yes',
      });
      if (wfErr) throw wfErr;
      await supabase.from('prospect_schools')
        .update({ stage: 'registered', linked_to_crm: true }).eq('id', school.id);
      toast({ title: 'Registered', description: `${school.school_name} added to ${activeProject.project_name}.` });
      setSelected(s => s ? { ...s, stage: 'registered', linked_to_crm: true } : s);
      fetchSchools(page);
    } catch (e: any) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    } finally { setRegistering(false); }
  };

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <ProspectLayout>
      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold text-gray-900">Schools Database</h1>
            <p className="text-sm text-gray-500 mt-0.5">
              {loading ? '…' : (
                filtersActive
                  ? <><span className="font-semibold text-indigo-700">{total.toLocaleString()}</span> schools found</>
                  : <><span className="font-semibold">{total.toLocaleString()}</span> schools total</>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {isSuperAdmin && (
              <Button variant="outline" size="sm" onClick={handleExport} disabled={isExporting}>
                {isExporting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}
                Export CSV
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={() => setUploadOpen(true)}>
              <Upload className="h-4 w-4 mr-2" />
              Upload Schools
            </Button>
          </div>
        </div>

        {/* Filters */}
        <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4 flex flex-wrap gap-3 items-center">
          <div className="relative flex-1 min-w-52">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <Input
              placeholder="Search name, UDISE or SS NO…"
              className="pl-9 h-9"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2">
                <X className="h-3.5 w-3.5 text-gray-400" />
              </button>
            )}
          </div>

          {/* State — dynamic from DB */}
          <Select value={state} onValueChange={setState}>
            <SelectTrigger className="w-36 h-9"><SelectValue placeholder="State" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All States</SelectItem>
              {states.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>

          {districts.length > 0 && (
            <Select value={district} onValueChange={setDistrict}>
              <SelectTrigger className="w-44 h-9"><SelectValue placeholder="District" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Districts</SelectItem>
                {districts.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}
              </SelectContent>
            </Select>
          )}

          <Select value={board} onValueChange={setBoard}>
            <SelectTrigger className="w-40 h-9"><SelectValue placeholder="Board" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Boards</SelectItem>
              <SelectItem value="State Board">State Board</SelectItem>
              <SelectItem value="Matriculation">Matriculation</SelectItem>
              <SelectItem value="CBSE">CBSE</SelectItem>
              <SelectItem value="ICSE">ICSE</SelectItem>
              <SelectItem value="International Board">International Board</SelectItem>
            </SelectContent>
          </Select>

          {/* School Category — dynamic from DB */}
          <Select value={schoolCategory} onValueChange={setSchoolCategory}>
            <SelectTrigger className="w-52 h-9"><SelectValue placeholder="Category" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Categories</SelectItem>
              {categories.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>

          <Select value={stage} onValueChange={setStage}>
            <SelectTrigger className="w-36 h-9"><SelectValue placeholder="Stage" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Stages</SelectItem>
              <SelectItem value="uncontacted">Uncontacted</SelectItem>
              <SelectItem value="contacted">Contacted</SelectItem>
              <SelectItem value="interested">Interested</SelectItem>
              <SelectItem value="registered">Registered</SelectItem>
              <SelectItem value="active">Active</SelectItem>
            </SelectContent>
          </Select>

          <button
            onClick={() => setHasEmail(v => !v)}
            className={`h-9 px-3 rounded-md border text-sm font-medium transition-colors ${hasEmail ? 'bg-indigo-50 border-indigo-300 text-indigo-700' : 'border-gray-200 text-gray-600 hover:border-gray-300'}`}
          >
            Has Email
          </button>

          <button
            onClick={() => setHasMobile(v => !v)}
            className={`h-9 px-3 rounded-md border text-sm font-medium transition-colors ${hasMobile ? 'bg-indigo-50 border-indigo-300 text-indigo-700' : 'border-gray-200 text-gray-600 hover:border-gray-300'}`}
          >
            Has Mobile
          </button>

          {filtersActive && (
            <button onClick={clearFilters} className="h-9 px-3 rounded-md text-sm font-medium text-red-600 hover:bg-red-50 transition-colors flex items-center gap-1">
              <X className="h-3.5 w-3.5" /> Clear
            </button>
          )}

          {maxEligibleClass != null && (
            <button
              onClick={() => setEligibleOnly(v => !v)}
              className={`h-9 px-3 rounded-md border text-sm font-medium transition-colors flex items-center gap-1.5 ${
                eligibleOnly
                  ? 'bg-green-50 border-green-300 text-green-700'
                  : 'border-gray-200 text-gray-500 hover:border-gray-300'
              }`}
              title={eligibleOnly ? 'Showing eligible schools only — click to show all' : 'Click to show eligible schools only'}
            >
              {eligibleOnly ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
              {eligibleOnly ? `Eligible (Class 1–${maxEligibleClass})` : 'All Schools'}
            </button>
          )}

          <button
            onClick={() => setActiveOnly(v => !v)}
            className={`h-9 px-3 rounded-md border text-sm font-medium transition-colors flex items-center gap-1.5 ${
              activeOnly
                ? 'bg-blue-50 border-blue-300 text-blue-700'
                : 'bg-red-50 border-red-300 text-red-600'
            }`}
            title={activeOnly ? 'Hiding inactive schools — click to show all' : 'Showing inactive schools too — click to hide'}
          >
            {activeOnly ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
            {activeOnly ? 'Active Only' : 'Incl. Inactive'}
          </button>
        </div>

        {/* Table */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="text-left px-4 py-4 font-semibold text-gray-600 text-sm w-20">SS NO</th>
                  <th className="text-left px-4 py-4 font-semibold text-gray-600 text-sm">School Name</th>
                  <th className="text-left px-4 py-4 font-semibold text-gray-600 text-sm w-36">District</th>
                  <th className="text-left px-4 py-4 font-semibold text-gray-600 text-sm w-36">Board</th>
                  <th className="text-left px-4 py-4 font-semibold text-gray-600 text-sm w-32">Stage</th>
                  <th className="text-left px-4 py-4 font-semibold text-gray-600 text-sm w-20">Email</th>
                  <th className="text-left px-4 py-4 font-semibold text-gray-600 text-sm w-20">Mobile</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={7} className="px-4 py-12 text-center text-gray-400">Loading…</td></tr>
                ) : schools.length === 0 ? (
                  <tr><td colSpan={7} className="px-4 py-12 text-center text-gray-400">No schools found</td></tr>
                ) : schools.map(s => (
                  <tr
                    key={s.id}
                    onClick={() => { setSelected(s); setEditingContact(false); loadCallLogs(s.id); }}
                    className={`border-b border-gray-50 cursor-pointer transition-colors hover:bg-indigo-50/40 ${selected?.id === s.id ? 'bg-indigo-50' : ''}`}
                  >
                    <td className="px-4 py-3.5 text-gray-400 font-mono text-sm">{String(s.ss_no).padStart(4, '0')}</td>
                    <td className="px-4 py-3.5">
                      <span className={`font-semibold ${s.is_active === false ? 'text-gray-400' : 'text-gray-900'}`}>{s.school_name}</span>
                      {s.linked_to_crm && <CheckCircle className="inline h-4 w-4 ml-1.5 text-green-500" />}
                      {s.is_active === false && <span className="ml-2 text-xs bg-red-100 text-red-500 px-1.5 py-0.5 rounded font-medium">Inactive</span>}
                    </td>
                    <td className="px-4 py-3.5 text-gray-700">{s.district}</td>
                    <td className="px-4 py-3.5 text-gray-600">{s.board || '—'}</td>
                    <td className="px-4 py-3.5">
                      <span className={`inline-flex px-2.5 py-1 rounded-full text-xs font-semibold ${STAGE_COLORS[s.stage] || 'bg-gray-100 text-gray-600'}`}>
                        {s.stage.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="px-4 py-3.5">
                      {s.email ? <Mail className="h-4 w-4 text-green-500" /> : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-4 py-3.5">
                      {s.mobile ? <Phone className="h-4 w-4 text-green-500" /> : <span className="text-gray-300">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
              <span className="text-sm text-gray-500">
                Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of {total.toLocaleString()}
              </span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={page === 0} onClick={() => handlePageChange(page - 1)}>Previous</Button>
                <Button variant="outline" size="sm" disabled={page >= totalPages - 1} onClick={() => handlePageChange(page + 1)}>Next</Button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Side panel */}
      <Sheet open={!!selected} onOpenChange={open => !open && setSelected(null)}>
        <SheetContent className="w-96 overflow-y-auto">
          {selected && (
            <>
              <SheetHeader className="mb-4">
                <SheetTitle className="text-base leading-snug pr-4">{selected.school_name}</SheetTitle>
                <div className="flex items-center gap-2 flex-wrap mt-1">
                  <span className="font-mono text-xs text-gray-400">SS #{String(selected.ss_no).padStart(4, '0')}</span>
                  <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${STAGE_COLORS[selected.stage] || 'bg-gray-100 text-gray-600'}`}>
                    {selected.stage.replace('_', ' ')}
                  </span>
                  {selected.linked_to_crm && (
                    <span className="inline-flex items-center gap-1 text-xs text-green-600 font-medium">
                      <CheckCircle className="h-3 w-3" /> In CRM
                    </span>
                  )}
                </div>
              </SheetHeader>

              <div className="space-y-4 text-sm">
                {/* Location */}
                <div className="space-y-1.5">
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Location</p>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                    <span className="text-gray-500">District</span><span className="text-gray-900 font-medium">{selected.district}</span>
                    <span className="text-gray-500">State</span><span className="text-gray-900">{selected.state}</span>
                    {selected.pincode && <><span className="text-gray-500">Pincode</span><span className="text-gray-900">{selected.pincode}</span></>}
                    {selected.school_location && <><span className="text-gray-500">Location</span><span className="text-gray-900">{selected.school_location}</span></>}
                  </div>
                  {selected.address && <p className="text-gray-600 text-xs leading-relaxed mt-1">{selected.address}</p>}
                </div>

                {/* School info */}
                <div className="space-y-1.5">
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">School Info</p>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                    {selected.school_category && <><span className="text-gray-500">Category</span><span className="text-gray-900 text-xs">{selected.school_category}</span></>}
                    {selected.board && <><span className="text-gray-500">Board</span><span className="text-gray-900 font-medium">{selected.board}</span></>}
                    {selected.school_management && <><span className="text-gray-500">Management</span><span className="text-gray-900 text-xs">{selected.school_management}</span></>}
                    {selected.school_type && <><span className="text-gray-500">Type</span><span className="text-gray-900">{selected.school_type}</span></>}
                    {selected.class_from != null && <><span className="text-gray-500">Classes</span><span className="text-gray-900">{selected.class_from} – {selected.class_to}</span></>}
                  </div>
                </div>

                {/* Contact */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Contact</p>
                    {!editingContact && (
                      <button onClick={startEditContact} className="text-xs text-indigo-600 hover:underline">
                        {selected.email || selected.mobile || selected.principal_name ? 'Edit' : '+ Add'}
                      </button>
                    )}
                  </div>

                  {editingContact ? (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <Mail className="h-3.5 w-3.5 text-gray-400 flex-shrink-0" />
                        <input
                          type="email"
                          placeholder="Email"
                          value={contactForm.email}
                          onChange={e => setContactForm(f => ({ ...f, email: e.target.value }))}
                          className="flex-1 text-xs border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                        />
                      </div>
                      <div className="flex items-center gap-2">
                        <Phone className="h-3.5 w-3.5 text-gray-400 flex-shrink-0" />
                        <input
                          type="tel"
                          placeholder="Mobile (10 digits)"
                          value={contactForm.mobile}
                          onChange={e => setContactForm(f => ({ ...f, mobile: e.target.value.replace(/\D/g, '').slice(0, 10) }))}
                          className="flex-1 text-xs border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                        />
                      </div>
                      <div className="flex items-center gap-2">
                        <Globe className="h-3.5 w-3.5 text-gray-400 flex-shrink-0" />
                        <input
                          type="text"
                          placeholder="Website"
                          value={contactForm.website}
                          onChange={e => setContactForm(f => ({ ...f, website: e.target.value }))}
                          className="flex-1 text-xs border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                        />
                      </div>
                      <input
                        type="text"
                        placeholder="Principal name"
                        value={contactForm.principal_name}
                        onChange={e => setContactForm(f => ({ ...f, principal_name: e.target.value }))}
                        className="w-full text-xs border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                      />

                      {/* Additional numbers — Principal / School / Coordinator etc., up to 5 */}
                      <div className="pt-1 space-y-1.5">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-semibold text-gray-400">More Numbers ({contactForm.contacts.length}/{MAX_CONTACTS})</span>
                          {contactForm.contacts.length < MAX_CONTACTS && (
                            <button
                              onClick={() => setContactForm(f => ({ ...f, contacts: [...f.contacts, { name: '', role: '', mobile: '' }] }))}
                              className="text-xs text-indigo-600 hover:underline"
                            >
                              + Add number
                            </button>
                          )}
                        </div>
                        {contactForm.contacts.map((c, i) => (
                          <div key={i} className="border border-gray-100 rounded p-2 space-y-1.5">
                            <div className="flex items-center gap-1.5">
                              <select
                                value={c.role}
                                onChange={e => setContactForm(f => ({ ...f, contacts: f.contacts.map((x, j) => j === i ? { ...x, role: e.target.value } : x) }))}
                                className="text-xs border border-gray-200 rounded px-1.5 py-1 bg-white focus:outline-none focus:ring-1 focus:ring-indigo-400"
                              >
                                <option value="">Role…</option>
                                {CONTACT_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                              </select>
                              <input
                                type="text"
                                placeholder="Name"
                                value={c.name}
                                onChange={e => setContactForm(f => ({ ...f, contacts: f.contacts.map((x, j) => j === i ? { ...x, name: e.target.value } : x) }))}
                                className="flex-1 min-w-0 text-xs border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                              />
                              <button
                                onClick={() => setContactForm(f => ({ ...f, contacts: f.contacts.filter((_, j) => j !== i) }))}
                                title="Remove"
                              >
                                <X className="h-3.5 w-3.5 text-gray-400 hover:text-red-500" />
                              </button>
                            </div>
                            <input
                              type="tel"
                              placeholder="Mobile (10 digits)"
                              value={c.mobile}
                              onChange={e => setContactForm(f => ({ ...f, contacts: f.contacts.map((x, j) => j === i ? { ...x, mobile: e.target.value.replace(/\D/g, '').slice(0, 10) } : x) }))}
                              className="w-full text-xs border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                            />
                          </div>
                        ))}
                      </div>

                      <div className="flex gap-2 pt-1">
                        <button onClick={saveContact} disabled={savingContact}
                          className="flex-1 text-xs bg-indigo-600 text-white rounded px-3 py-1.5 hover:bg-indigo-700 disabled:opacity-50">
                          {savingContact ? 'Saving…' : 'Save'}
                        </button>
                        <button onClick={() => setEditingContact(false)}
                          className="flex-1 text-xs border border-gray-200 rounded px-3 py-1.5 hover:bg-gray-50">
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      {selected.email ? (
                        <a href={`mailto:${selected.email}`} className="flex items-center gap-2 text-indigo-600 hover:underline">
                          <Mail className="h-3.5 w-3.5 flex-shrink-0" />{selected.email}
                        </a>
                      ) : null}
                      {selected.mobile ? (
                        <div className="flex items-center gap-2">
                          <a href={`tel:${selected.mobile}`} className="flex items-center gap-2 text-gray-700">
                            <Phone className="h-3.5 w-3.5 flex-shrink-0" />{selected.mobile}
                          </a>
                          <button
                            onClick={() => { setCallDialogOpen(true); setCallType('click2call'); }}
                            className="ml-auto flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-green-50 border border-green-200 text-green-700 hover:bg-green-100 transition-colors"
                            title="Call this school via Bonvoice"
                          >
                            <PhoneCall className="h-3 w-3" /> Call
                          </button>
                        </div>
                      ) : null}
                      {selected.website ? (
                        <a href={selected.website.startsWith('http') ? selected.website : `https://${selected.website}`} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-gray-500 hover:text-indigo-600">
                          <Globe className="h-3.5 w-3.5 flex-shrink-0" />{selected.website}
                        </a>
                      ) : null}
                      {selected.principal_name ? (
                        <p className="text-gray-600 text-xs">Principal: <span className="font-medium text-gray-800">{selected.principal_name}</span></p>
                      ) : null}
                      {(selected.additional_contacts ?? []).map((c, i) => (
                        <div key={i} className="flex items-center gap-2">
                          <Phone className="h-3.5 w-3.5 flex-shrink-0 text-gray-400" />
                          <a href={`tel:${c.mobile}`} className="text-gray-700">{c.mobile}</a>
                          <span className="text-xs text-gray-400 truncate">{[c.role, c.name].filter(Boolean).join(' — ')}</span>
                        </div>
                      ))}
                      {!selected.email && !selected.mobile && !selected.principal_name && !(selected.additional_contacts ?? []).length && (
                        <p className="text-xs text-gray-400 italic">No contact info — click Add to fill in.</p>
                      )}
                    </div>
                  )}
                </div>

                {/* Send E-Brochure — always fetches the active project's brochure */}
                <button
                  onClick={openEbrochureDialog}
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-indigo-200 bg-indigo-50 text-indigo-700 text-sm font-semibold hover:bg-indigo-100 transition-colors"
                >
                  <Send className="h-4 w-4" />
                  Send E-Brochure
                </button>

                {/* Call history */}
                {callLogs.length > 0 && (
                  <div className="space-y-1.5">
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Recent Calls</p>
                    <div className="space-y-1">
                      {callLogs.map(log => (
                        <div key={log.id} className="flex items-center justify-between text-xs py-1 border-b border-gray-50 last:border-0">
                          <div className="flex items-center gap-1.5">
                            {log.call_mode === 'click2call' ? <PhoneCall className="h-3 w-3 text-indigo-400" /> : <Mic className="h-3 w-3 text-purple-400" />}
                            <span className="text-gray-600">{log.call_mode === 'click2call' ? 'Click2Call' : 'TTS'}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            {log.call_duration ? <span className="text-gray-500">{log.call_duration}s</span> : null}
                            <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${
                              log.status === 'completed' ? 'bg-green-50 text-green-700' :
                              log.status === 'answered'  ? 'bg-blue-50 text-blue-700'  :
                              log.status === 'no_answer' ? 'bg-amber-50 text-amber-700' :
                              log.status === 'ringing'   ? 'bg-indigo-50 text-indigo-600' :
                              'bg-gray-100 text-gray-500'
                            }`}>{log.status}</span>
                            <span className="text-gray-400">{new Date(log.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {selected.udise_code && (
                  <div className="pt-1 border-t border-gray-100">
                    <p className="text-xs text-gray-400">UDISE: <span className="font-mono text-gray-600">{selected.udise_code}</span></p>
                  </div>
                )}

                {/* History — only show if school has actual participation */}
                {selected.has_history && (
                  <button
                    onClick={() => navigate(`/prospect/schools/${selected.id}/history`)}
                    className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-indigo-200 bg-indigo-50 text-indigo-700 text-sm font-semibold hover:bg-indigo-100 transition-colors"
                  >
                    <History className="h-4 w-4" />
                    View Participation History
                  </button>
                )}

                {/* Active/Inactive toggle */}
                <button
                  onClick={toggleActiveStatus}
                  className={`w-full flex items-center justify-center gap-2 py-2 rounded-lg border text-sm font-medium transition-colors ${
                    selected.is_active === false
                      ? 'border-green-300 bg-green-50 text-green-700 hover:bg-green-100'
                      : 'border-red-200 bg-red-50 text-red-600 hover:bg-red-100'
                  }`}
                >
                  {selected.is_active === false
                    ? <><Eye className="h-4 w-4" /> Mark as Active</>
                    : <><EyeOff className="h-4 w-4" /> Mark as Inactive</>}
                </button>

                {/* Actions */}
                {!selected.linked_to_crm ? (
                  <div className="space-y-2 mt-2">
                    <Button variant="outline" className="w-full border-amber-300 text-amber-700 hover:bg-amber-50"
                      onClick={() => markInterested(selected)} disabled={registering}>
                      <Star className="h-4 w-4 mr-2 fill-amber-400" />
                      {registering ? 'Saving…' : 'Mark as Interested'}
                    </Button>
                    <Button className="w-full" onClick={() => registerForProject(selected)} disabled={registering}>
                      <Building2 className="h-4 w-4 mr-2" />
                      {registering ? 'Registering…' : `Register for ${activeProject?.project_name ?? 'CRM'}`}
                    </Button>
                  </div>
                ) : selected.stage === 'interested' ? (
                  <div className="space-y-2 mt-2">
                    <div className="flex items-center justify-center gap-2 py-2 rounded-lg bg-amber-50 text-amber-700 text-sm font-medium">
                      <Star className="h-4 w-4 fill-amber-400" /> Interested — Pending Registration
                    </div>
                    <Button className="w-full" onClick={() => registerForProject(selected)} disabled={registering}>
                      <Building2 className="h-4 w-4 mr-2" />
                      {registering ? 'Registering…' : 'Convert to Registered'}
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center justify-center gap-2 py-2 rounded-lg bg-green-50 text-green-700 text-sm font-medium mt-2">
                    <CheckCircle className="h-4 w-4" /> Already in CRM
                  </div>
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      {/* Upload dialog */}
      <ProspectUploadSchools
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        onSuccess={() => { setUploadOpen(false); fetchSchools(0); }}
      />

      {/* Call dialog */}
      <Dialog open={callDialogOpen} onOpenChange={open => { if (!calling) setCallDialogOpen(open); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <PhoneCall className="h-5 w-5 text-green-600" />
              Call {selected?.school_name}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-1">
            <p className="text-xs text-gray-500">School mobile: <span className="font-mono font-semibold text-gray-800">{selected?.mobile}</span></p>

            {/* Type toggle */}
            <div className="flex rounded-lg border border-gray-200 overflow-hidden">
              {(['click2call', 'tts'] as const).map(t => (
                <button
                  key={t}
                  onClick={() => setCallType(t)}
                  className={`flex-1 py-2 text-sm font-medium transition-colors ${
                    callType === t ? 'bg-green-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  {t === 'click2call' ? '📞 Click2Call' : '🔊 TTS Call'}
                </button>
              ))}
            </div>

            {callType === 'click2call' ? (
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1.5">Your phone (staff)</label>
                <Input
                  type="tel"
                  placeholder="10-digit mobile"
                  value={staffPhone}
                  onChange={e => setStaffPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
                  className="h-9"
                />
                <p className="text-xs text-gray-400 mt-1.5">Bonvoice will call your phone first, then connect to the school.</p>
              </div>
            ) : (
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1.5">TTS Message</label>
                <textarea
                  rows={3}
                  placeholder="Message to be read to the school..."
                  value={ttsSpeech}
                  onChange={e => setTtsSpeech(e.target.value)}
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-400 resize-none"
                />
                <p className="text-xs text-gray-400 mt-1">Bonvoice auto-dials the school and reads this message.</p>
              </div>
            )}

            <div className="flex gap-2 pt-1">
              <Button
                className="flex-1 bg-green-600 hover:bg-green-700"
                onClick={initiateCall}
                disabled={calling || !selected?.mobile}
              >
                {calling ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <PhoneCall className="h-4 w-4 mr-2" />}
                {calling ? 'Initiating…' : 'Call Now'}
              </Button>
              <Button variant="outline" onClick={() => setCallDialogOpen(false)} disabled={calling}>
                Cancel
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* E-Brochure send dialog */}
      <Dialog open={ebrochureOpen} onOpenChange={open => { if (!ebrochureSending) setEbrochureOpen(open); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Send className="h-5 w-5 text-indigo-600" />
              Send E-Brochure via WhatsApp
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <p className="text-xs text-gray-500">
              Sends the <span className="font-semibold text-gray-700">{activeProject?.project_name ?? 'active project'}</span> brochure to <span className="font-semibold text-gray-700">{selected?.school_name}</span>.
            </p>
            <div>
              <Label className="text-sm font-medium mb-2 block">Select WhatsApp numbers (sent to all checked)</Label>
              <div className="space-y-2">
                <div className="flex items-center gap-3 border rounded-md px-3 py-2">
                  <Checkbox checked={ebrochureChecked.has('mobile')} onCheckedChange={() => toggleEbrochureNumber('mobile')} id="peb_mobile" disabled={!selected?.mobile} />
                  <Label htmlFor="peb_mobile" className="cursor-pointer flex-1">
                    <span className="text-xs text-muted-foreground">School Mobile</span>
                    <p className="font-medium">{selected?.mobile || <span className="text-muted-foreground italic">Not set</span>}</p>
                  </Label>
                </div>
                {(selected?.additional_contacts ?? []).map((c, i) => (
                  <div key={i} className="flex items-center gap-3 border rounded-md px-3 py-2">
                    <Checkbox checked={ebrochureChecked.has(`contact_${i}`)} onCheckedChange={() => toggleEbrochureNumber(`contact_${i}`)} id={`peb_c${i}`} disabled={!c.mobile} />
                    <Label htmlFor={`peb_c${i}`} className="cursor-pointer flex-1">
                      <span className="text-xs text-muted-foreground">{[c.role || 'Contact', c.name].filter(Boolean).join(' — ')}</span>
                      <p className="font-medium">{c.mobile}</p>
                    </Label>
                  </div>
                ))}
                <div className="flex items-center gap-3 border rounded-md px-3 py-2">
                  <Checkbox checked={ebrochureChecked.has('manual')} onCheckedChange={() => toggleEbrochureNumber('manual')} id="peb_manual" />
                  <Label htmlFor="peb_manual" className="cursor-pointer">Enter manually</Label>
                </div>
              </div>
            </div>

            {ebrochureChecked.has('manual') && (
              <div className="space-y-3 border-l-2 border-indigo-400 pl-3">
                <div>
                  <Label htmlFor="peb_number" className="text-xs">Phone Number</Label>
                  <Input
                    id="peb_number"
                    value={ebrochureManual}
                    onChange={e => setEbrochureManual(e.target.value.replace(/\D/g, '').slice(0, 10))}
                    placeholder="10-digit mobile number"
                    className="mt-1"
                  />
                </div>
                <div className="flex gap-2">
                  <div className="flex-1">
                    <Label htmlFor="peb_cname" className="text-xs">Name (optional)</Label>
                    <Input id="peb_cname" value={ebrochureManualName} onChange={e => setEbrochureManualName(e.target.value)} placeholder="e.g., Principal Ravi" className="mt-1" />
                  </div>
                  <div className="w-32">
                    <Label htmlFor="peb_crole" className="text-xs">Role (optional)</Label>
                    <select
                      id="peb_crole"
                      value={ebrochureManualRole}
                      onChange={e => setEbrochureManualRole(e.target.value)}
                      className="mt-1 w-full h-10 text-sm border border-input rounded-md px-2 bg-background focus:outline-none focus:ring-1 focus:ring-indigo-400"
                    >
                      <option value="">Role…</option>
                      {CONTACT_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <input type="checkbox" id="peb_save" checked={ebrochureSaveMobile} onChange={e => setEbrochureSaveMobile(e.target.checked)} className="rounded" />
                  <Label htmlFor="peb_save" className="text-xs cursor-pointer">Save this number to school's contacts</Label>
                </div>
              </div>
            )}

            <div className="flex gap-2 pt-2">
              <Button variant="outline" className="flex-1" onClick={() => setEbrochureOpen(false)} disabled={ebrochureSending}>Cancel</Button>
              <Button className="flex-1" onClick={handleSendEbrochure} disabled={ebrochureSending}>
                {ebrochureSending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}
                {ebrochureSending ? 'Sending…' : 'Send E-Brochure'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Interest notification popup */}
      <Dialog open={!!interestNotif} onOpenChange={open => { if (!open && !notifSending) setInterestNotif(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Star className="h-5 w-5 text-amber-500 fill-amber-400" />
              Marked as Interested!
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-gray-600">
              <span className="font-semibold text-gray-900">{interestNotif?.name}</span> added as Interested.
              Send an interest acknowledgement email and WhatsApp now?
            </p>
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
                onClick={() => setInterestNotif(null)}>
                Add
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </ProspectLayout>
  );
}
