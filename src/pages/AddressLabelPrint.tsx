import { useState, useEffect, useMemo } from 'react';
import Navbar from '@/components/layout/Navbar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Printer, FileDown, Search, X } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useActiveProject } from '@/hooks/useOlympiadProjects';
import jsPDF from 'jspdf';

const PRESETS = [
  { label: '2.5 × 3 in', w: 2.5, h: 3 },
  { label: '3 × 4 in',   w: 3,   h: 4 },
  { label: '4 × 6 in',   w: 4,   h: 6 },
  { label: '2 × 1 in',   w: 2,   h: 1 },
];

const PX_PER_INCH = 96;

type LabelSchool = {
  id: string;
  ss_no: number;
  school_name: string;
  address: string | null;
  district: string | null;
  state: string | null;
  pincode: string | null;
};

type CrmSchool = LabelSchool & {
  registration_status: string | null;
  payment_status: string | null;
};

// Many imported addresses are the same text pasted twice ("X X"). If the
// alphanumeric content is exactly two equal halves, keep just the first half.
function collapseDoubled(s: string): string {
  const compact = s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const L = compact.length;
  if (L >= 4 && L % 2 === 0 && compact.slice(0, L / 2) === compact.slice(L / 2)) {
    let count = 0, i = 0;
    for (; i < s.length && count < L / 2; i++) {
      if (/[a-z0-9]/i.test(s[i])) count++;
    }
    return s.slice(0, i).replace(/[\s,.;:\-]+$/, '').trim();
  }
  return s;
}

// Build the address line: street/area/district tokens from the raw address, then
// state — always last. Collapses a fully-doubled address, deduplicates comma-tokens
// case-insensitively (a doubled "Tamil Nadu" or a repeated district), and strips any
// state/pincode already embedded in the address. Pincode is rendered as its own line.
function addressLine(address: string | null, state?: string | null, pincode?: string | null): string {
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (val?: string | null) => {
    const s = (val == null ? '' : String(val)).trim();
    if (!s) return;
    const key = s.toLowerCase().replace(/\s+/g, ' ');
    if (seen.has(key)) return;
    seen.add(key);
    out.push(s);
  };

  const stateKey = state ? String(state).trim().toLowerCase().replace(/\s+/g, ' ') : '';
  const pinKey = pincode ? String(pincode).replace(/\s+/g, '') : '';

  collapseDoubled(address || '').split(',').forEach(raw => {
    const p = raw.trim();
    if (!p) return;
    if (stateKey && p.toLowerCase().replace(/\s+/g, ' ') === stateKey) return; // hold state for the end
    if (pinKey && p.replace(/\s+/g, '') === pinKey) return;                     // pincode rendered separately
    add(p);
  });

  add(state);
  return out.join(', ');
}

function LabelPreview({ school, wIn, hIn, namePt, addrPt, pinPt }: {
  school: LabelSchool; wIn: number; hIn: number; namePt: number; addrPt: number; pinPt: number;
}) {
  const w = wIn * PX_PER_INCH;
  const h = hIn * PX_PER_INCH;
  const ssPx = Math.max(7, addrPt - 2);
  const addr = addressLine(school.address, school.state, school.pincode);

  return (
    <div style={{
      width: w, height: h,
      border: '1.5px solid #6366f1', borderRadius: 6,
      padding: '10px 12px', boxSizing: 'border-box',
      background: '#fff', display: 'flex', flexDirection: 'column', gap: 3,
      overflow: 'hidden', fontFamily: 'Arial, sans-serif',
      boxShadow: '0 2px 12px rgba(0,0,0,0.10)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <span style={{ fontSize: ssPx, color: '#9ca3af' }}>SS {school.ss_no}</span>
      </div>
      <span style={{ fontSize: namePt, fontWeight: 700, color: '#111827', lineHeight: 1.25, wordBreak: 'break-word' }}>
        {school.school_name}
      </span>
      <span style={{ fontSize: addrPt, color: '#374151', lineHeight: 1.35, wordBreak: 'break-word', flex: 1 }}>
        {addr}
      </span>
      {school.pincode && (
        <span style={{ fontSize: pinPt, fontWeight: 700, color: '#111827', borderTop: '1px solid #e5e7eb', paddingTop: 3, marginTop: 2 }}>
          {school.pincode}
        </span>
      )}
    </div>
  );
}

function generatePdf(
  schools: LabelSchool[],
  wIn: number, hIn: number,
  namePt: number, addrPt: number, pinPt: number,
  tag: string,
  toast: ReturnType<typeof useToast>['toast'],
  print = false,
) {
  if (!schools.length) return;
  const ptW = wIn * 72;
  const ptH = hIn * 72;
  const margin = 10;

  const doc = new jsPDF({
    orientation: ptW > ptH ? 'landscape' : 'portrait',
    unit: 'pt',
    format: [ptW, ptH],
  });

  schools.forEach((school, idx) => {
    if (idx > 0) doc.addPage([ptW, ptH]);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(120, 120, 120);
    doc.text(`SS ${school.ss_no}`, ptW - margin, 12, { align: 'right' });

    // ── Body region (reserves a footer line for the pincode when present) ──
    const maxW = ptW - margin * 2;
    const bodyTop = 24;
    const hasPin = !!school.pincode;
    const footerBaseY = ptH - margin;             // pincode baseline near the bottom
    const footerLineY = footerBaseY - pinPt - 4;  // divider sits just above the pincode
    const bodyBottom = hasPin ? footerLineY - 4 : ptH - margin;
    const nameTop = 8;                                  // name's top offset below the SS line
    const bodyAvail = bodyBottom - bodyTop - nameTop;   // keep auto-fit in sync with the draw start (else the last line clips)
    const LH = 1.25; // line-height factor (conservative ≥ jsPDF's default)

    const addr = addressLine(school.address, school.state, school.pincode);

    // Auto-fit: shrink name/address fonts (to ~55%) so name + address always fit
    // above the footer — long names/addresses no longer overrun it.
    let scale = 1, nameLines: string[] = [], addrLines: string[] = [];
    for (; scale >= 0.5; scale -= 0.05) {
      const np = namePt * scale, ap = addrPt * scale;
      doc.setFont('helvetica', 'bold'); doc.setFontSize(np);
      nameLines = doc.splitTextToSize(school.school_name, maxW);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(ap);
      addrLines = addr ? doc.splitTextToSize(addr, maxW) : [];
      const h = nameLines.length * np * LH
        + (addrLines.length ? 3 + addrLines.length * ap * LH : 0);
      if (h <= bodyAvail) break;
    }
    const np = namePt * scale, ap = addrPt * scale;

    let y = bodyTop + nameTop;
    doc.setTextColor(17, 24, 39);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(np);
    doc.text(nameLines, margin, y);
    y += nameLines.length * (np * LH);

    if (addrLines.length) {
      y += 3;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(ap);
      doc.setTextColor(55, 65, 81);
      // Final safety clamp: never draw address lines into the footer zone.
      const lineH = ap * LH;
      const fit = Math.max(0, Math.floor((bodyBottom - y) / lineH));
      let lines = addrLines;
      if (fit === 0) {
        lines = [];
      } else if (addrLines.length > fit) {
        lines = addrLines.slice(0, fit);
        lines[lines.length - 1] = lines[lines.length - 1].replace(/\s*\S*$/, '') + '…';
      }
      if (lines.length) doc.text(lines, margin, y);
    }

    if (hasPin) {
      doc.setDrawColor(229, 231, 235);
      doc.line(margin, footerLineY, ptW - margin, footerLineY);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(pinPt);
      doc.setTextColor(17, 24, 39);
      doc.text(String(school.pincode), margin, footerBaseY);
    }
  });

  const fname = `iplus-labels-${tag}-${schools.length}schools-${wIn}x${hIn}in.pdf`;
  if (print) {
    // Open the PDF and auto-trigger the print dialog (sent to the label-printer driver).
    doc.autoPrint();
    const win = window.open(doc.output('bloburl'), '_blank');
    if (!win) {
      doc.save(fname);
      toast({ title: 'Pop-up blocked — downloaded instead', description: 'Allow pop-ups for one-click printing.', variant: 'destructive' });
    } else {
      toast({ title: 'Opening print dialog', description: `${schools.length} labels — pick your label printer, set scale to 100% / Actual size.` });
    }
  } else {
    doc.save(fname);
    toast({ title: 'PDF saved', description: `${schools.length} labels at ${wIn}" × ${hIn}"` });
  }
}

// ─── Shared label size + font controls ───────────────────────────────────────

function SizeControls({ wIn, hIn, setWIn, setHIn }: {
  wIn: number; hIn: number;
  setWIn: (v: number) => void; setHIn: (v: number) => void;
}) {
  return (
    <div className="bg-white rounded-xl border p-4 space-y-3">
      <p className="font-semibold text-sm">Label Size</p>
      <div className="flex gap-2 flex-wrap">
        {PRESETS.map(p => (
          <button
            key={p.label}
            onClick={() => { setWIn(p.w); setHIn(p.h); }}
            className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-all ${
              wIn === p.w && hIn === p.h
                ? 'bg-indigo-600 text-white border-indigo-600'
                : 'bg-white text-gray-700 border-gray-200 hover:border-indigo-400'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <div className="flex-1">
          <label className="text-xs text-muted-foreground mb-1 block">Width (in)</label>
          <Input type="number" min={1} max={12} step={0.25} value={wIn}
            onChange={e => setWIn(parseFloat(e.target.value) || 2.5)} />
        </div>
        <span className="mt-5 text-muted-foreground">×</span>
        <div className="flex-1">
          <label className="text-xs text-muted-foreground mb-1 block">Height (in)</label>
          <Input type="number" min={1} max={12} step={0.25} value={hIn}
            onChange={e => setHIn(parseFloat(e.target.value) || 3)} />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        {(wIn * 25.4).toFixed(1)} mm × {(hIn * 25.4).toFixed(1)} mm
      </p>
    </div>
  );
}

function FontControls({ namePt, addrPt, pinPt, setNamePt, setAddrPt, setPinPt }: {
  namePt: number; addrPt: number; pinPt: number;
  setNamePt: (v: number) => void; setAddrPt: (v: number) => void; setPinPt: (v: number) => void;
}) {
  return (
    <div className="bg-white rounded-xl border p-4 space-y-3">
      <p className="font-semibold text-sm">Font Sizes</p>
      <div>
        <div className="flex justify-between mb-1">
          <label className="text-xs text-muted-foreground">School Name</label>
          <span className="text-xs font-medium">{namePt} pt</span>
        </div>
        <input type="range" min={7} max={20} step={0.5} value={namePt}
          onChange={e => setNamePt(parseFloat(e.target.value))}
          className="w-full accent-indigo-600" />
      </div>
      <div>
        <div className="flex justify-between mb-1">
          <label className="text-xs text-muted-foreground">Address</label>
          <span className="text-xs font-medium">{addrPt} pt</span>
        </div>
        <input type="range" min={6} max={14} step={0.5} value={addrPt}
          onChange={e => setAddrPt(parseFloat(e.target.value))}
          className="w-full accent-indigo-600" />
      </div>
      <div>
        <div className="flex justify-between mb-1">
          <label className="text-xs text-muted-foreground">Pincode</label>
          <span className="text-xs font-medium">{pinPt} pt</span>
        </div>
        <input type="range" min={6} max={20} step={0.5} value={pinPt}
          onChange={e => setPinPt(parseFloat(e.target.value))}
          className="w-full accent-indigo-600" />
      </div>
    </div>
  );
}

// ─── CRM MODE ─────────────────────────────────────────────────────────────────
// Auto-loads all project schools on mount. Individual checkboxes build the print
// list. Workflow + geo filters are client-side (no extra DB calls after load).

function CrmLabelMode({ activeProject }: { activeProject: any }) {
  const { toast } = useToast();
  const [allSchools, setAllSchools] = useState<CrmSchool[]>([]);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const [regFilter, setRegFilter] = useState('all');
  const [payFilter, setPayFilter] = useState('all');
  const [stateFilter, setStateFilter] = useState('all');
  const [districtFilter, setDistrictFilter] = useState('all');
  const [search, setSearch] = useState('');

  const [wIn, setWIn] = useState(2.5);
  const [hIn, setHIn] = useState(3);
  const [namePt, setNamePt] = useState(14);
  const [addrPt, setAddrPt] = useState(12);
  const [pinPt, setPinPt] = useState(12);

  useEffect(() => {
    if (!activeProject?.id) return;
    setLoading(true);
    supabase
      .from('school_project_workflow')
      .select('registration_status, payment_status, schools!inner(id, ss_no, school_name, school_address, district, state, pincode)')
      .eq('project_id', activeProject.id)
      .then(({ data, error }) => {
        setLoading(false);
        if (error) { toast({ title: 'Error loading schools', description: error.message, variant: 'destructive' }); return; }
        const normalized: CrmSchool[] = (data || []).map((r: any) => ({
          id: r.schools.id,
          ss_no: r.schools.ss_no,
          school_name: r.schools.school_name,
          address: r.schools.school_address ?? null,
          district: r.schools.district,
          state: r.schools.state,
          pincode: r.schools.pincode,
          registration_status: r.registration_status,
          payment_status: r.payment_status,
        }));
        setAllSchools(normalized.sort((a, b) => a.ss_no - b.ss_no));
      });
  }, [activeProject?.id]);

  const stateOptions = useMemo(() =>
    [...new Set(allSchools.map(s => s.state).filter(Boolean))].sort() as string[],
    [allSchools]);

  const districtOptions = useMemo(() =>
    [...new Set(
      allSchools.filter(s => stateFilter === 'all' || s.state === stateFilter)
        .map(s => s.district).filter(Boolean)
    )].sort() as string[],
    [allSchools, stateFilter]);

  const regOptions = useMemo(() =>
    [...new Set(allSchools.map(s => s.registration_status).filter(Boolean))].sort() as string[],
    [allSchools]);

  const payOptions = useMemo(() =>
    [...new Set(allSchools.map(s => s.payment_status).filter(Boolean))].sort() as string[],
    [allSchools]);

  const filtered = useMemo(() => allSchools.filter(s => {
    if (regFilter !== 'all' && s.registration_status !== regFilter) return false;
    if (payFilter !== 'all' && s.payment_status !== payFilter) return false;
    if (stateFilter !== 'all' && s.state !== stateFilter) return false;
    if (districtFilter !== 'all' && s.district !== districtFilter) return false;
    if (search.trim() && !s.school_name.toLowerCase().includes(search.trim().toLowerCase())) return false;
    return true;
  }), [allSchools, regFilter, payFilter, stateFilter, districtFilter, search]);

  const selectedSchools = useMemo(() =>
    allSchools.filter(s => selectedIds.has(s.id)), [allSchools, selectedIds]);

  const someSelected = filtered.some(s => selectedIds.has(s.id));
  const allSelected = filtered.length > 0 && filtered.every(s => selectedIds.has(s.id));
  const selectAllState: boolean | 'indeterminate' = allSelected ? true : someSelected ? 'indeterminate' : false;

  const toggleSelect = (id: string) => setSelectedIds(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const toggleSelectAll = () => setSelectedIds(prev => {
    const next = new Set(prev);
    if (allSelected) { filtered.forEach(s => next.delete(s.id)); }
    else { filtered.forEach(s => next.add(s.id)); }
    return next;
  });

  const previewSchool = selectedSchools[0] ?? filtered[0] ?? null;

  const handleDownload = () => {
    setGenerating(true);
    try {
      generatePdf(
        selectedSchools, wIn, hIn, namePt, addrPt, pinPt,
        activeProject?.project_name?.replace(/\s+/g, '-') ?? 'crm',
        toast,
      );
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* School list — takes 2 columns */}
      <div className="lg:col-span-2 space-y-4">
        {/* Filters */}
        <div className="bg-white rounded-xl border p-4 space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Reg. Status</label>
              <Select value={regFilter} onValueChange={setRegFilter}>
                <SelectTrigger><SelectValue placeholder="All" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  {regOptions.map(v => <SelectItem key={v} value={v}>{v}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Payment</label>
              <Select value={payFilter} onValueChange={setPayFilter}>
                <SelectTrigger><SelectValue placeholder="All" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  {payOptions.map(v => <SelectItem key={v} value={v}>{v}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">State</label>
              <Select value={stateFilter} onValueChange={v => { setStateFilter(v); setDistrictFilter('all'); }}>
                <SelectTrigger><SelectValue placeholder="All" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All States</SelectItem>
                  {stateOptions.map(v => <SelectItem key={v} value={v}>{v}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">District</label>
              <Select value={districtFilter} onValueChange={setDistrictFilter}>
                <SelectTrigger><SelectValue placeholder="All" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Districts</SelectItem>
                  {districtOptions.map(v => <SelectItem key={v} value={v}>{v}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search school name…"
              className="pl-8"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
        </div>

        {/* Selectable school list */}
        <div className="bg-white rounded-xl border">
          <div className="px-4 py-3 border-b flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Checkbox checked={selectAllState} onCheckedChange={toggleSelectAll} />
              <span className="text-sm font-semibold">
                {loading ? 'Loading…' : `${filtered.length} school${filtered.length !== 1 ? 's' : ''}`}
              </span>
            </div>
            {selectedIds.size > 0 && (
              <div className="flex items-center gap-2">
                <Badge className="bg-indigo-600 text-white">{selectedIds.size} in print list</Badge>
                <button onClick={() => setSelectedIds(new Set())} className="text-muted-foreground hover:text-gray-700">
                  <X className="h-4 w-4" />
                </button>
              </div>
            )}
          </div>
          <div className="max-h-[520px] overflow-y-auto divide-y">
            {filtered.length === 0 && !loading && (
              <p className="text-center text-sm text-muted-foreground py-10">
                {allSchools.length === 0 ? 'No schools in this project yet.' : 'No schools match the filters.'}
              </p>
            )}
            {filtered.map(school => (
              <div
                key={school.id}
                onClick={() => toggleSelect(school.id)}
                className={`px-4 py-2.5 flex items-center gap-3 cursor-pointer hover:bg-gray-50 transition-colors ${
                  selectedIds.has(school.id) ? 'bg-indigo-50/60' : ''
                }`}
              >
                <Checkbox
                  checked={selectedIds.has(school.id)}
                  onCheckedChange={() => toggleSelect(school.id)}
                  onClick={e => e.stopPropagation()}
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{school.school_name}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {[school.address, school.district, school.state].filter(Boolean).join(', ')}
                    {school.pincode ? ` – ${school.pincode}` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {school.registration_status && (
                    <Badge variant="outline" className="text-xs py-0 px-1.5">{school.registration_status}</Badge>
                  )}
                  <span className="text-xs text-muted-foreground">SS {school.ss_no}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Config + preview + download */}
      <div className="space-y-4">
        <SizeControls wIn={wIn} hIn={hIn} setWIn={setWIn} setHIn={setHIn} />
        <FontControls namePt={namePt} addrPt={addrPt} pinPt={pinPt} setNamePt={setNamePt} setAddrPt={setAddrPt} setPinPt={setPinPt} />

        <div className="bg-white rounded-xl border p-4">
          <p className="font-semibold text-sm mb-3">
            {selectedIds.size > 0 ? 'Preview (first selected)' : 'Preview (first in list)'}
          </p>
          <div className="flex justify-center overflow-auto">
            {previewSchool ? (
              <LabelPreview school={previewSchool} wIn={wIn} hIn={hIn} namePt={namePt} addrPt={addrPt} pinPt={pinPt} />
            ) : (
              <div style={{
                width: wIn * PX_PER_INCH, height: hIn * PX_PER_INCH,
                border: '1.5px dashed #d1d5db', borderRadius: 6,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: '#9ca3af', fontSize: 12,
              }}>
                No schools loaded
              </div>
            )}
          </div>
        </div>

        <Button
          className="w-full bg-indigo-600 hover:bg-indigo-700"
          size="lg"
          onClick={handleDownload}
          disabled={selectedIds.size === 0 || generating}
        >
          <FileDown className="h-4 w-4 mr-2" />
          {generating
            ? 'Generating…'
            : selectedIds.size === 0
              ? 'Select schools to print'
              : `Print ${selectedIds.size} label${selectedIds.size === 1 ? '' : 's'}`}
        </Button>
      </div>
    </div>
  );
}

// ─── PROSPECT MODE ────────────────────────────────────────────────────────────
// Manual trigger: filter → Load Schools → prints all matched. Unchanged UX.

function ProspectLabelMode() {
  const { toast } = useToast();
  const [schools, setSchools] = useState<LabelSchool[]>([]);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);

  const [stateFilter, setStateFilter] = useState('all');
  const [districtFilter, setDistrictFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [stateOptions, setStateOptions] = useState<string[]>([]);
  const [districtOptions, setDistrictOptions] = useState<string[]>([]);

  const [wIn, setWIn] = useState(3);   // default to the common 3" × 2" sticker
  const [hIn, setHIn] = useState(2);
  const [namePt, setNamePt] = useState(14);
  const [addrPt, setAddrPt] = useState(12);
  const [pinPt, setPinPt] = useState(12);

  // Batch printing with printed-tracking (whole-state runs across multiple rolls)
  const [batchSize, setBatchSize] = useState(1000);
  const [progress, setProgress] = useState<{ total: number; printed: number } | null>(null);

  // Use distinct-value RPCs (raw selects are capped at 1000 rows, which only
  // returned the first state / a few districts).
  useEffect(() => {
    supabase.rpc('get_prospect_filter_options').then(({ data }: any) => {
      if (data?.states) setStateOptions(data.states as string[]);
    });
  }, []);

  useEffect(() => {
    setDistrictFilter('all');
    if (stateFilter === 'all') { setDistrictOptions([]); return; }
    supabase.rpc('get_prospect_districts', { p_state: stateFilter }).then(({ data }: any) => {
      setDistrictOptions((data as string[]) || []);
    });
  }, [stateFilter]);

  const fetchSchools = async () => {
    setLoading(true);
    try {
      let q = supabase
        .from('prospect_schools' as any)
        .select('id, ss_no, school_name, address, district, state, pincode')
        .order('ss_no');

      if (stateFilter !== 'all') q = (q as any).eq('state', stateFilter);
      if (districtFilter !== 'all') q = (q as any).eq('district', districtFilter);
      if (search.trim()) q = (q as any).ilike('school_name', `%${search.trim()}%`);

      const { data, error } = await (q as any).limit(1000);
      if (error) throw error;

      const normalised: LabelSchool[] = (data || []).map((r: any) => ({
        id: r.id,
        ss_no: r.ss_no,
        school_name: r.school_name,
        address: r.address ?? null,
        district: r.district,
        state: r.state,
        pincode: r.pincode,
      }));
      setSchools(normalised);
    } catch (e: any) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  // Progress (printed vs total) for the selected state
  const loadProgress = async (state: string) => {
    if (state === 'all') { setProgress(null); return; }
    const [totalRes, printedRes] = await Promise.all([
      supabase.from('prospect_schools' as any).select('id', { count: 'exact', head: true }).eq('state', state),
      supabase.from('prospect_schools' as any).select('id', { count: 'exact', head: true }).eq('state', state).not('label_printed_at', 'is', null),
    ]);
    setProgress({ total: (totalRes as any).count ?? 0, printed: (printedRes as any).count ?? 0 });
  };
  useEffect(() => { loadProgress(stateFilter); }, [stateFilter]);

  // Fetch the next unprinted batch for the state, build the PDF, then mark printed.
  const printNextBatch = async () => {
    if (stateFilter === 'all') { toast({ title: 'Pick a state first', variant: 'destructive' }); return; }
    setGenerating(true);
    try {
      let q = supabase.from('prospect_schools' as any)
        .select('id, ss_no, school_name, address, district, state, pincode')
        .eq('state', stateFilter)
        .is('label_printed_at', null)
        .order('ss_no')
        .limit(batchSize);
      if (districtFilter !== 'all') q = (q as any).eq('district', districtFilter);
      const { data, error } = await (q as any);
      if (error) throw error;
      const batch = (data || []) as LabelSchool[];
      if (!batch.length) { toast({ title: 'All done', description: `No unprinted labels left for ${stateFilter}.` }); return; }

      generatePdf(batch, wIn, hIn, namePt, addrPt, pinPt, `prospect-${stateFilter}`, toast, true);

      const { error: markErr } = await supabase.rpc('mark_prospect_labels_printed', { p_ids: batch.map(s => s.id) });
      if (markErr) throw markErr;

      setSchools(batch);
      await loadProgress(stateFilter);
    } catch (e: any) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    } finally {
      setGenerating(false);
    }
  };

  const resetPrinted = async () => {
    if (stateFilter === 'all') return;
    if (!window.confirm(`Reset printed status for ALL ${stateFilter} schools? They become available to print again.`)) return;
    const { error } = await supabase.from('prospect_schools' as any)
      .update({ label_printed_at: null }).eq('state', stateFilter);
    if (error) { toast({ title: 'Error', description: error.message, variant: 'destructive' }); return; }
    toast({ title: 'Reset', description: `${stateFilter} labels can be printed again.` });
    await loadProgress(stateFilter);
  };

  const remaining = progress ? progress.total - progress.printed : 0;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="space-y-5">
        <div className="bg-white rounded-xl border p-4 space-y-3">
          <p className="font-semibold text-sm">Filters</p>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">State</label>
            <Select value={stateFilter} onValueChange={setStateFilter}>
              <SelectTrigger><SelectValue placeholder="All states" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All States</SelectItem>
                {stateOptions.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">District</label>
            <Select value={districtFilter} onValueChange={setDistrictFilter}>
              <SelectTrigger><SelectValue placeholder="All districts" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Districts</SelectItem>
                {districtOptions.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search school name…"
              className="pl-8"
              value={search}
              onChange={e => setSearch(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && fetchSchools()}
            />
          </div>
          <Button className="w-full" onClick={fetchSchools} disabled={loading}>
            {loading ? 'Loading…' : 'Load & Preview'}
          </Button>
          <p className="text-[11px] text-muted-foreground">Load &amp; Preview is for ad-hoc printing (no tracking). For a whole state, use Batch Print below.</p>
        </div>

        {/* Batch printing by state — roll-sized batches, resumable, no duplicates */}
        {stateFilter !== 'all' && (
          <div className="bg-white rounded-xl border p-4 space-y-3">
            <p className="font-semibold text-sm">Batch Print — {stateFilter}</p>
            {progress && (
              <>
                <div className="text-xs text-muted-foreground">
                  <span className="font-semibold text-emerald-600">{progress.printed.toLocaleString()}</span> printed ·{' '}
                  <span className="font-semibold text-foreground">{remaining.toLocaleString()}</span> remaining ·{' '}
                  {progress.total.toLocaleString()} total
                </div>
                <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                  <div className="h-1.5 bg-emerald-600 rounded-full transition-all"
                    style={{ width: `${progress.total ? Math.round((progress.printed / progress.total) * 100) : 0}%` }} />
                </div>
              </>
            )}
            <div className="flex items-center gap-2">
              <label className="text-xs text-muted-foreground whitespace-nowrap">Labels per roll</label>
              <Input type="number" min={1} max={2000} value={batchSize}
                onChange={e => setBatchSize(Math.max(1, Math.min(2000, parseInt(e.target.value) || 1000)))}
                className="h-8 w-24" />
            </div>
            <Button className="w-full bg-emerald-600 hover:bg-emerald-700" onClick={printNextBatch}
              disabled={generating || remaining === 0}>
              <Printer className="h-4 w-4 mr-2" />
              {generating ? 'Preparing…' : remaining === 0
                ? 'All labels printed ✓'
                : `Print next ${Math.min(batchSize, remaining).toLocaleString()} unprinted`}
            </Button>
            <button onClick={resetPrinted}
              className="text-[11px] text-muted-foreground hover:text-red-600 w-full text-center">
              Reset printed status for {stateFilter}
            </button>
          </div>
        )}

        <SizeControls wIn={wIn} hIn={hIn} setWIn={setWIn} setHIn={setHIn} />
        <FontControls namePt={namePt} addrPt={addrPt} pinPt={pinPt} setNamePt={setNamePt} setAddrPt={setAddrPt} setPinPt={setPinPt} />

        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="outline"
            onClick={() => {
              setGenerating(true);
              try { generatePdf(schools, wIn, hIn, namePt, addrPt, pinPt, 'prospect', toast); }
              finally { setGenerating(false); }
            }}
            disabled={schools.length === 0 || generating}
          >
            <FileDown className="h-4 w-4 mr-2" />
            Download
          </Button>
          <Button
            className="bg-indigo-600 hover:bg-indigo-700"
            onClick={() => {
              setGenerating(true);
              try { generatePdf(schools, wIn, hIn, namePt, addrPt, pinPt, 'prospect', toast, true); }
              finally { setGenerating(false); }
            }}
            disabled={schools.length === 0 || generating}
          >
            <Printer className="h-4 w-4 mr-2" />
            Open &amp; Print
          </Button>
        </div>
        <p className="text-[11px] text-muted-foreground text-center -mt-2">
          {schools.length} label{schools.length === 1 ? '' : 's'} loaded · print at 100% / Actual size
        </p>
      </div>

      <div className="lg:col-span-2 space-y-5">
        <div className="bg-white rounded-xl border p-5">
          <div className="flex items-center justify-between mb-4">
            <p className="font-semibold text-sm">Label Preview</p>
            <span className="text-xs text-muted-foreground">{wIn}" × {hIn}" — {(wIn * 25.4).toFixed(0)}×{(hIn * 25.4).toFixed(0)} mm</span>
          </div>
          <div className="flex justify-center overflow-auto">
            {schools.length > 0 ? (
              <LabelPreview school={schools[0]} wIn={wIn} hIn={hIn} namePt={namePt} addrPt={addrPt} pinPt={pinPt} />
            ) : (
              <div style={{
                width: wIn * PX_PER_INCH, height: hIn * PX_PER_INCH,
                border: '1.5px dashed #d1d5db', borderRadius: 6,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: '#9ca3af', fontSize: 13,
              }}>
                Load schools to preview
              </div>
            )}
          </div>
        </div>

        {schools.length > 0 && (
          <div className="bg-white rounded-xl border">
            <div className="px-4 py-3 border-b flex items-center justify-between">
              <p className="font-semibold text-sm">Schools matched</p>
              <Badge variant="secondary">
                {schools.length}{schools.length === 1000 ? ' (max 1000 per load)' : ''}
              </Badge>
            </div>
            <div className="max-h-96 overflow-y-auto divide-y">
              {schools.map((s, i) => (
                <div key={s.id} className="px-4 py-2.5 flex items-center gap-3">
                  <span className="text-xs text-muted-foreground w-6 text-right">{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{s.school_name}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {[s.address, s.district, s.state, s.pincode].filter(Boolean).join(', ')}
                    </p>
                  </div>
                  <span className="text-xs text-muted-foreground shrink-0">SS {s.ss_no}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Shared page wrapper ──────────────────────────────────────────────────────

interface Props {
  source: 'crm' | 'prospect';
}

export function AddressLabelPrintPage({ source }: Props) {
  const { data: activeProject } = useActiveProject();

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Printer className="h-6 w-6 text-indigo-600" />
          Address Label Print
          <Badge variant="outline" className="ml-1 text-xs font-normal">
            {source === 'crm'
              ? `CRM — ${activeProject?.project_name ?? 'loading…'}`
              : 'Prospect Schools — all 11,274'}
          </Badge>
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          {source === 'crm'
            ? 'Select schools individually to build your print list (question papers, materials, books).'
            : 'Labels for all prospect schools (brochure dispatch, first-time outreach).'}
        </p>
      </div>

      {source === 'crm' ? (
        activeProject
          ? <CrmLabelMode activeProject={activeProject} />
          : <p className="text-amber-600 text-sm">No active project selected — switch project to load schools.</p>
      ) : (
        <ProspectLabelMode />
      )}
    </div>
  );
}

// CRM entry point
export default function AddressLabelPrint() {
  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <AddressLabelPrintPage source="crm" />
    </div>
  );
}
