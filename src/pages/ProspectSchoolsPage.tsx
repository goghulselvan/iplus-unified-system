import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import ProspectLayout from '@/components/prospect/ProspectLayout';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Search, X, Mail, Phone, Globe, Building2, CheckCircle, Star, History, Upload, Download, Loader2, Send, Eye, EyeOff } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useActiveProject } from '@/hooks/useOlympiadProjects';
import { useAuth } from '@/hooks/useAuth';
import ProspectUploadSchools from '@/components/prospect/ProspectUploadSchools';
import { toCSV } from '@/utils/csvExport';

type ProspectSchool = {
  id: string; ss_no: number; udise_code: string; school_name: string;
  district: string; state: string; board: string | null;
  stage: string; school_management: string | null; school_type: string | null;
  school_category: string | null;
  class_from: number | null; class_to: number | null;
  email: string | null; mobile: string | null; website: string | null;
  principal_name: string | null; address: string | null; pincode: string | null;
  school_location: string | null; linked_to_crm: boolean; has_history: boolean;
};

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
  const [contactForm, setContactForm] = useState({ email: '', mobile: '', website: '', principal_name: '' });
  const [savingContact, setSavingContact] = useState(false);

  type InterestNotif = { schoolId: string; phone: string | null; email: string | null; name: string };
  const [interestNotif, setInterestNotif] = useState<InterestNotif | null>(null);
  const [notifSending, setNotifSending] = useState(false);

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
    });
    if (error) toast({ title: 'Error', description: error.message, variant: 'destructive' });
    else {
      const result = data as any;
      setSchools(result.rows as ProspectSchool[]);
      setTotal(result.total as number);
    }
    setLoading(false);
  }, [search, state, district, board, stage, schoolCategory, hasEmail, hasMobile, eligibleOnly, maxEligibleClass, toast]);

  useEffect(() => { setPage(0); fetchSchools(0); }, [fetchSchools]);

  const handlePageChange = (p: number) => { setPage(p); fetchSchools(p); };

  const clearFilters = () => {
    setSearch(''); setState('all'); setDistrict('all'); setBoard('all');
    setStage('all'); setSchoolCategory('all'); setHasEmail(false); setHasMobile(false);
  };

  const startEditContact = () => {
    if (!selected) return;
    setContactForm({
      email:          selected.email          ?? '',
      mobile:         selected.mobile         ?? '',
      website:        selected.website        ?? '',
      principal_name: selected.principal_name ?? '',
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
        toast({ title: 'Already in CRM', description: `${school.school_name} is already registered.` });
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
        registration_status: 'In Progress', contacted: 'Yes',
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
                    onClick={() => { setSelected(s); setEditingContact(false); }}
                    className={`border-b border-gray-50 cursor-pointer transition-colors hover:bg-indigo-50/40 ${selected?.id === s.id ? 'bg-indigo-50' : ''}`}
                  >
                    <td className="px-4 py-3.5 text-gray-400 font-mono text-sm">{String(s.ss_no).padStart(4, '0')}</td>
                    <td className="px-4 py-3.5">
                      <span className="font-semibold text-gray-900">{s.school_name}</span>
                      {s.linked_to_crm && <CheckCircle className="inline h-4 w-4 ml-1.5 text-green-500" />}
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
                        <a href={`tel:${selected.mobile}`} className="flex items-center gap-2 text-gray-700">
                          <Phone className="h-3.5 w-3.5 flex-shrink-0" />{selected.mobile}
                        </a>
                      ) : null}
                      {selected.website ? (
                        <a href={selected.website.startsWith('http') ? selected.website : `https://${selected.website}`} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-gray-500 hover:text-indigo-600">
                          <Globe className="h-3.5 w-3.5 flex-shrink-0" />{selected.website}
                        </a>
                      ) : null}
                      {selected.principal_name ? (
                        <p className="text-gray-600 text-xs">Principal: <span className="font-medium text-gray-800">{selected.principal_name}</span></p>
                      ) : null}
                      {!selected.email && !selected.mobile && !selected.principal_name && (
                        <p className="text-xs text-gray-400 italic">No contact info — click Add to fill in.</p>
                      )}
                    </div>
                  )}
                </div>

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
