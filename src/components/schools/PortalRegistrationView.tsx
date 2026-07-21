import { useState, useRef, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Trash2, Plus, Check, X, Pencil, Save, Upload, Download, ChevronDown, ChevronUp, ClipboardList } from 'lucide-react';
import { toast, useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { useActiveProject, useOlympiadSubjects, OlympiadSubject } from '@/hooks/useOlympiadProjects';
import { formatRegNumberForStudent } from '@/utils/registrationNumberFormatter';

type OlympiadCode = string;

// Derive the class label used in applicable_classes from a class_code value
function classLabel(classCode: string): string {
  if (classCode === '14') return 'LKG';
  if (classCode === '15') return 'UKG';
  return String(parseInt(classCode, 10)); // '01' → '1'
}

// Return only subjects valid for the given class code, driven by applicable_classes in DB
function subjectsForClass(subjects: OlympiadSubject[], classCode: string): OlympiadSubject[] {
  if (!classCode || !subjects.length) return subjects;
  const label = classLabel(classCode);
  return subjects.filter(s => s.applicable_classes.includes(label));
}

const CLASS_OPTIONS = [
  { value: '14', label: 'LKG' }, { value: '15', label: 'UKG' },
  ...Array.from({ length: 8 }, (_, i) => ({
    value: String(i + 1).padStart(2, '0'), label: `Class ${i + 1}`,
  })),
];

const CLASS_LABEL_TO_CODE: Record<string, string> = {
  LKG: '14', UKG: '15',
  ...Object.fromEntries(Array.from({ length: 8 }, (_, i) => [String(i + 1), String(i + 1).padStart(2, '0')])),
};

function parseClassCode(raw: string): string | null {
  const upper = raw.trim().toUpperCase();
  return CLASS_LABEL_TO_CODE[upper] ?? null;
}


interface BulkUploadProps {
  schoolId: string;
  subjects: OlympiadSubject[];
  onSuccess: () => void;
}

function BulkUpload({ schoolId, subjects, onSuccess }: BulkUploadProps) {
  const validCodes = new Set(subjects.map(s => s.alphabetical_code).filter(Boolean) as string[]);
  const { data: activeProject } = useActiveProject();
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function downloadTemplate() {
    const csv = [
      'Student Name,Class,Olympiads',
      'ARJUN KUMAR,5,EPO MPO SPO',
      'PRIYA DEVI,3,EPO',
      'KARTHIK S,LKG,KidsPO',
      'MEENA R,7,EPO GKSSPO LRPO',
    ].join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url; a.download = 'bulk_registration_template.csv';
    a.click(); URL.revokeObjectURL(url);
  }

  async function handleUpload() {
    if (!file) return;
    setErrors([]);
    setUploading(true);

    try {
      const text = await file.text();
      const lines = text.trim().split('\n').filter(Boolean);
      const dataLines = lines[0].toLowerCase().includes('student') ? lines.slice(1) : lines;

      const rowErrors: string[] = [];
      type ParsedRow = { name: string; classCode: string; olympiads: OlympiadCode[] };
      const rows: ParsedRow[] = [];

      dataLines.forEach((line, i) => {
        const rowNum = i + 2;
        const parts = line.split(',').map(p => p.trim().replace(/^"|"$/g, ''));
        if (parts.length < 3) { rowErrors.push(`Row ${rowNum}: must have 3 columns (Name, Class, Olympiads)`); return; }

        const name = parts[0];
        const rawClass = parts[1];
        const rawOlympiads = parts.slice(2).join(' ');

        if (!name || name.length < 2) { rowErrors.push(`Row ${rowNum}: name is empty or too short`); return; }

        const classCode = parseClassCode(rawClass);
        if (!classCode) { rowErrors.push(`Row ${rowNum}: invalid class "${rawClass}" — use LKG, UKG, or 1–9`); return; }

        // Validate all codes exist in subjects table
        const rawCodes = rawOlympiads.trim().toUpperCase().split(/[\s,;]+/).filter(Boolean);
        if (rawCodes.length === 0) { rowErrors.push(`Row ${rowNum}: no olympiad codes found`); return; }
        const invalidCodes = rawCodes.filter(c => !validCodes.has(c));
        if (invalidCodes.length > 0) { rowErrors.push(`Row ${rowNum}: unknown subject code(s): ${invalidCodes.join(', ')} — use ${[...validCodes].join(', ')}`); return; }
        const olympiads = rawCodes as OlympiadCode[];

        // Validate codes are valid for the student's class (using applicable_classes from DB)
        const allowedForClass = subjectsForClass(subjects, classCode).map(s => s.alphabetical_code!);
        const wrongClass = olympiads.filter(o => !allowedForClass.includes(o));
        if (wrongClass.length > 0) {
          rowErrors.push(`Row ${rowNum}: subject(s) ${wrongClass.join(', ')} are not available for class ${rawClass}`);
          return;
        }

        rows.push({ name: name.toUpperCase(), classCode, olympiads });
      });

      if (rowErrors.length > 0) { setErrors(rowErrors); setUploading(false); return; }
      if (rows.length === 0) { setErrors(['No data rows found']); setUploading(false); return; }

      // Batched insert — handles 2,000–4,000+ students without thousands of
      // round-trips. Students inserted in chunks; enrollments mapped back by the
      // RETURNING order (PostgREST returns rows in the inserted VALUES order),
      // then inserted in their own chunks.
      const STUDENT_BATCH = 200;
      const ENROLL_BATCH = 500;
      const projectId = activeProject?.id ?? '';
      setProgress({ done: 0, total: rows.length });

      for (let i = 0; i < rows.length; i += STUDENT_BATCH) {
        const chunk = rows.slice(i, i + STUDENT_BATCH);

        const { data: inserted, error: se } = await supabase
          .from('portal_registered_students')
          .insert(chunk.map(r => ({
            school_id: schoolId, project_id: projectId,
            student_name: r.name, class_code: r.classCode,
          })))
          .select('id');
        if (se) throw se;
        if (!inserted || inserted.length !== chunk.length) {
          throw new Error('Insert count mismatch — aborting to avoid mis-mapped enrollments.');
        }

        const enrollments = chunk.flatMap((r, idx) =>
          r.olympiads.map(code => ({ student_id: inserted[idx].id, olympiad_code: code }))
        );
        for (let j = 0; j < enrollments.length; j += ENROLL_BATCH) {
          const { error: ee } = await supabase
            .from('portal_student_enrollments')
            .insert(enrollments.slice(j, j + ENROLL_BATCH));
          if (ee) throw ee;
        }

        setProgress({ done: Math.min(i + chunk.length, rows.length), total: rows.length });
      }

      toast({ title: 'Bulk upload complete', description: `${rows.length} student${rows.length !== 1 ? 's' : ''} added successfully.` });
      setFile(null);
      if (fileRef.current) fileRef.current.value = '';
      setOpen(false);
      onSuccess();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setErrors([`Upload failed: ${msg}`]);
    } finally {
      setUploading(false);
      setProgress(null);
    }
  }

  return (
    <Card>
      <CardHeader className="cursor-pointer select-none" onClick={() => setOpen(o => !o)}>
        <CardTitle className="text-base flex items-center justify-between">
          <span className="flex items-center gap-2"><Upload className="h-4 w-4" /> Bulk Upload (Staff)</span>
          {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </CardTitle>
      </CardHeader>
      {open && (
        <CardContent className="space-y-4">
          <div className="text-sm text-muted-foreground space-y-1">
            <p>CSV format: <code className="bg-muted px-1 rounded">Student Name, Class, Olympiads</code></p>
            <p>Class: <code className="bg-muted px-1 rounded">LKG UKG 1 2 3 4 5 6 7 8 9</code></p>
            <p>Olympiads (space-separated): <code className="bg-muted px-1 rounded">{subjects.map(s=>s.alphabetical_code).filter(Boolean).join(' ') || 'EPO MPO SPO GKSSPO LRPO KidsPO'}</code></p>
          </div>
          <Button variant="outline" size="sm" onClick={downloadTemplate} className="flex items-center gap-2">
            <Download className="h-4 w-4" /> Download Template
          </Button>
          <div className="flex items-center gap-3">
            <input
              ref={fileRef}
              type="file"
              accept=".csv"
              onChange={e => { setFile(e.target.files?.[0] ?? null); setErrors([]); }}
              className="text-sm"
            />
            <Button onClick={handleUpload} disabled={!file || uploading} className="flex items-center gap-2">
              <Upload className="h-4 w-4" />
              {uploading
                ? (progress ? `Uploading ${progress.done.toLocaleString()}/${progress.total.toLocaleString()}…` : 'Uploading…')
                : 'Upload'}
            </Button>
          </div>
          {errors.length > 0 && (
            <div className="rounded-lg bg-red-50 border border-red-200 p-3 space-y-1">
              {errors.map((e, i) => <p key={i} className="text-xs text-red-700">{e}</p>)}
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}

interface PortalStudent {
  id: string;
  student_name: string;
  class_code: string;
  enrollments: OlympiadCode[];
  regNumbers: Record<string, string | null>;
}

interface PortalWorkflow {
  per_entry_rate: number | null;
  concession_per_entry: number | null;
  payment_status: string | null;
  name_list_status: string | null;
  list_submitted_at: string | null;
}

function PaymentStatusBadge({ status }: { status: string | null | undefined }) {
  const map: Record<string, { label: string; className: string }> = {
    Pending:  { label: 'Pending',  className: 'bg-red-100 text-red-700 border-red-300' },
    Partial:  { label: 'Partial',  className: 'bg-yellow-100 text-yellow-700 border-yellow-300' },
    Received: { label: 'Received', className: 'bg-green-100 text-green-700 border-green-300' },
    Overpaid: { label: 'Overpaid', className: 'bg-orange-100 text-orange-700 border-orange-300' },
  };
  const s = map[status ?? ''] ?? map['Pending'];
  return (
    <span className={`inline-flex items-center px-2.5 py-1 rounded-md text-sm font-semibold border ${s.className}`}>
      {s.label}
    </span>
  );
}

const STAFF_CLASS_OPTIONS = [
  { value: '14', label: 'LKG' }, { value: '15', label: 'UKG' },
  ...Array.from({ length: 8 }, (_, i) => ({
    value: String(i + 1).padStart(2, '0'),
    label: `Class ${i + 1}`,
  })),
];

interface StaffAddStudentPanelProps {
  schoolId: string;
  projectId: string;
  subjects: OlympiadSubject[];
  onAdded: () => void;
}

function StaffAddStudentPanel({ schoolId, projectId, subjects, onAdded }: StaffAddStudentPanelProps) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [cls, setCls] = useState('');
  const [selectedOlympiads, setSelectedOlympiads] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const availableOlympiads = cls ? subjectsForClass(subjects, cls) : [];

  function handleClassChange(val: string) {
    setCls(val);
    setSelectedOlympiads([]);
  }

  function toggleOlympiad(code: string) {
    setSelectedOlympiads(prev =>
      prev.includes(code) ? prev.filter(o => o !== code) : [...prev, code]
    );
  }

  async function handleSubmit() {
    if (!name.trim() || !cls || selectedOlympiads.length === 0) {
      toast({ title: 'Fill all fields', variant: 'destructive' });
      return;
    }
    setSubmitting(true);
    try {
      const { data: student, error: se } = await supabase
        .from('portal_registered_students')
        .insert({
          school_id: schoolId,
          project_id: projectId,
          student_name: name.trim().toUpperCase(),
          class_code: cls,
        })
        .select('id')
        .single();
      if (se) throw se;

      const { error: ee } = await supabase
        .from('portal_student_enrollments')
        .insert(
          selectedOlympiads.map(code => ({
            student_id: student.id,
            olympiad_code: code,
            submitted_at: new Date().toISOString(),
          }))
        );
      if (ee) throw ee;

      toast({ title: 'Student added', description: `${name.trim().toUpperCase()} registered successfully.` });
      setName('');
      setCls('');
      setSelectedOlympiads([]);
      onAdded();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      toast({ title: 'Error', description: msg, variant: 'destructive' });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader className="cursor-pointer select-none" onClick={() => setOpen(o => !o)}>
        <CardTitle className="text-base flex items-center justify-between">
          <span className="flex items-center gap-2"><Plus className="h-4 w-4" /> Add Student (Staff)</span>
          {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </CardTitle>
      </CardHeader>
      {open && (
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-3 items-end">
            <div className="flex-1 min-w-[160px]">
              <Label className="text-sm">Student Name</Label>
              <Input
                value={name}
                onChange={e => setName(e.target.value)}
                className="mt-1"
                placeholder="e.g. ARJUN KUMAR"
              />
            </div>
            <div className="w-28">
              <Label className="text-sm">Class</Label>
              <select
                value={cls}
                onChange={e => handleClassChange(e.target.value)}
                className="mt-1 w-full h-10 rounded-md border border-input bg-background px-3 text-sm focus:ring-2 focus:ring-ring"
              >
                <option value="">Select</option>
                {STAFF_CLASS_OPTIONS.map(c => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </div>
            {cls && (
              <div>
                <Label className="text-sm">Olympiad Subjects</Label>
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {availableOlympiads.map(s => (
                    <button
                      key={s.alphabetical_code}
                      type="button"
                      onClick={() => toggleOlympiad(s.alphabetical_code!)}
                      title={s.subject_name}
                      className={`px-2 py-1 rounded text-xs font-semibold border transition-colors ${
                        selectedOlympiads.includes(s.alphabetical_code!)
                          ? 'bg-indigo-600 text-white border-indigo-600'
                          : 'border-border hover:border-indigo-400 text-muted-foreground'
                      }`}
                    >
                      {s.alphabetical_code}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <Button
              onClick={handleSubmit}
              disabled={submitting || !name.trim() || !cls || selectedOlympiads.length === 0}
              className="flex items-center gap-2"
            >
              <Plus className="h-4 w-4" />
              {submitting ? 'Adding…' : 'Add'}
            </Button>
          </div>
        </CardContent>
      )}
    </Card>
  );
}

interface Props { schoolId: string; paymentStatus?: string | null; }

export function PortalRegistrationView({ schoolId, paymentStatus }: Props) {
  const qc = useQueryClient();
  const { profile } = useAuth();
  const { data: activeProject } = useActiveProject();
  const { data: subjects = [] } = useOlympiadSubjects(activeProject?.id);
  const canBulkDelete = profile?.role === 'superadmin' || profile?.role === 'manager';

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editClass, setEditClass] = useState('');
  const [editOlympiads, setEditOlympiads] = useState<OlympiadCode[]>([]);
  const [concessionInput, setConcessionInput] = useState<string>('');
  const [savingConcession, setSavingConcession] = useState(false);
  const [sortField, setSortField] = useState<'name' | 'class'>('class');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const { data: students = [], isLoading } = useQuery({
    queryKey: ['crm-portal-students', schoolId, activeProject?.id],
    queryFn: async (): Promise<PortalStudent[]> => {
      const { data, error } = await supabase
        .from('portal_registered_students')
        .select('id, student_name, class_code, portal_student_enrollments(olympiad_code, registration_number)')
        .eq('school_id', schoolId)
        .eq('project_id', activeProject!.id)
        .order('class_code').order('student_name');
      if (error) throw error;
      return (data ?? []).map((s) => {
        const enrollRows = s.portal_student_enrollments as { olympiad_code: OlympiadCode; registration_number: string | null }[];
        return {
          id: s.id,
          student_name: s.student_name,
          class_code: s.class_code,
          enrollments: enrollRows.map((e) => e.olympiad_code),
          regNumbers: Object.fromEntries(enrollRows.map((e) => [e.olympiad_code, e.registration_number])),
        };
      });
    },
    enabled: !!activeProject?.id,
  });

  const { data: workflow } = useQuery({
    queryKey: ['crm-portal-workflow', schoolId, activeProject?.id],
    enabled: !!activeProject?.id,
    queryFn: async (): Promise<PortalWorkflow | null> => {
      const { data, error } = await supabase
        .from('school_project_workflow')
        .select('per_entry_rate, concession_per_entry, payment_status, name_list_status, list_submitted_at')
        .eq('school_id', schoolId)
        .eq('project_id', activeProject!.id)
        .maybeSingle();
      if (error) throw error;
      if (data) setConcessionInput(String(data.concession_per_entry ?? 0));
      return data as PortalWorkflow | null;
    },
  });

  const isSubmitted = !!workflow?.list_submitted_at;

  const totalEnrollments = students.reduce((s, st) => s + st.enrollments.length, 0);
  const rate = workflow?.per_entry_rate ?? 150;
  const concessionPerEntry = workflow?.concession_per_entry ?? 0;
  const grossFee = totalEnrollments * rate;
  const totalConcession = totalEnrollments * concessionPerEntry;
  const expectedFee = Math.max(0, grossFee - totalConcession);

  const olympiadStats = useMemo(
    () => Object.fromEntries(subjects.map(subj => [subj.alphabetical_code, students.filter(s => s.enrollments.includes(subj.alphabetical_code!)).length])),
    [students, subjects]
  );

  const displayedStudents = useMemo(() => {
    const sorted = [...students];
    sorted.sort((a, b) => {
      if (sortField === 'name') {
        const cmp = a.student_name.localeCompare(b.student_name);
        return sortOrder === 'asc' ? cmp : -cmp;
      } else {
        const cmp = a.class_code.localeCompare(b.class_code);
        return sortOrder === 'asc' ? cmp : -cmp;
      }
    });
    return sorted;
  }, [students, sortField, sortOrder]);

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('portal_registered_students').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['crm-portal-students'] });
      toast({ title: 'Student removed' });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, name, originalName, cls, originalClass, oldEnrollments, newEnrollments }: {
      id: string; name: string; originalName: string; cls: string; originalClass: string;
      oldEnrollments: OlympiadCode[]; newEnrollments: OlympiadCode[];
    }) => {
      const classChanged = cls !== originalClass;
      const nameChanged = name !== originalName;

      if (classChanged) {
        // DB function updates class_code AND touches submitted_at on all enrollments → trigger regenerates numbers
        const { error } = await supabase.rpc('correct_student_class', {
          p_student_id: id,
          p_new_class_code: cls,
        });
        if (error) throw error;
      }

      if (nameChanged && !classChanged) {
        const { error } = await supabase
          .from('portal_registered_students')
          .update({ student_name: name })
          .eq('id', id);
        if (error) throw error;
      } else if (nameChanged && classChanged) {
        // class was already updated by the RPC; update name separately
        const { error } = await supabase
          .from('portal_registered_students')
          .update({ student_name: name })
          .eq('id', id);
        if (error) throw error;
      }

      // Enrollment diff — always runs regardless of class change
      const toAdd = newEnrollments.filter((o) => !oldEnrollments.includes(o));
      const toRemove = oldEnrollments.filter((o) => !newEnrollments.includes(o));
      if (toRemove.length) {
        const { error } = await supabase.from('portal_student_enrollments').delete().eq('student_id', id).in('olympiad_code', toRemove);
        if (error) throw error;
      }
      if (toAdd.length) {
        // submitted_at = now() so the trigger fires and generates registration numbers
        const { error } = await supabase.from('portal_student_enrollments').insert(
          toAdd.map((code) => ({ student_id: id, olympiad_code: code, submitted_at: new Date().toISOString() }))
        );
        if (error) throw error;
      }

      return { classChanged };
    },
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ['crm-portal-students'] });
      qc.invalidateQueries({ queryKey: ['crm-reg-summary'] });
      qc.invalidateQueries({ queryKey: ['portal-students'] });
      setEditingId(null);
      toast({
        title: result.classChanged ? 'Class corrected — registration numbers regenerated' : 'Student updated',
      });
    },
    onError: (error: Error) => {
      toast({ title: 'Update failed', description: error.message, variant: 'destructive' });
    },
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      const { error } = await supabase.from('portal_registered_students').delete().in('id', ids);
      if (error) throw error;
    },
    onSuccess: (_, ids) => {
      qc.invalidateQueries({ queryKey: ['crm-portal-students'] });
      setSelectedIds(new Set());
      toast({ title: `${ids.length} student${ids.length !== 1 ? 's' : ''} removed` });
    },
  });

  async function saveConcession() {
    const val = parseFloat(concessionInput);
    if (isNaN(val) || val < 0) { toast({ title: 'Invalid concession amount', variant: 'destructive' }); return; }
    setSavingConcession(true);
    const { error } = await supabase
      .from('school_project_workflow')
      .upsert({ school_id: schoolId, project_id: activeProject?.id ?? '', concession_per_entry: val, per_entry_rate: rate }, { onConflict: 'school_id,project_id' });
    setSavingConcession(false);
    if (error) { toast({ title: 'Error', description: error.message, variant: 'destructive' }); return; }
    qc.invalidateQueries({ queryKey: ['crm-portal-workflow'] });
    toast({ title: 'Concession updated', description: `₹${val.toLocaleString('en-IN')} concession set` });
  }

  function exportCSV() {
    const subjectCodes = subjects.map(s => s.alphabetical_code!).filter(Boolean);
    const header = ['#', 'Name', 'Class', ...subjectCodes];
    const csvRows = displayedStudents.map((s, i) => {
      const clsLabel = CLASS_OPTIONS.find(c => c.value === s.class_code)?.label ?? s.class_code;
      return [i + 1, s.student_name, clsLabel, ...subjectCodes.map(code => s.enrollments.includes(code) ? '1' : '0')];
    });
    const content = [header, ...csvRows].map(r => r.map(v => `"${v}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob(['﻿' + content], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `students_${schoolId}_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function toggleSort(field: 'name' | 'class') {
    if (sortField === field) setSortOrder(o => o === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortOrder('asc'); }
  }

  const allSelected = displayedStudents.length > 0 && selectedIds.size === displayedStudents.length;

  return (
    <div className="space-y-6">
      {/* Workflow summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wider">Students</p>
            <p className="text-xl font-bold mt-1">{students.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wider">Registrations</p>
            <p className="text-xl font-bold mt-1">{totalEnrollments}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wider">Payment Status</p>
            <div className="mt-2">
              <PaymentStatusBadge status={paymentStatus} />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wider">Name List</p>
            <p className="text-xl font-bold mt-1">
              {workflow?.name_list_status ?? 'Pending'}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Olympiad participation stats */}
      <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
        {subjects.map(subj => (
          <Card key={subj.alphabetical_code}>
            <CardContent className="pt-3 pb-3">
              <p className="text-xs text-muted-foreground truncate" title={subj.subject_name}>{subj.subject_name}</p>
              <p className="text-lg font-bold mt-0.5">{olympiadStats[subj.alphabetical_code!] ?? 0}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Fee summary + concession */}
      <Card>
        <CardHeader><CardTitle className="text-base">Fee Calculation</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="p-3 bg-muted/50 rounded-lg">
              <p className="text-xs text-muted-foreground mb-1">Gross Fee</p>
              <p className="text-lg font-semibold">₹{grossFee.toLocaleString('en-IN')}</p>
              <p className="text-xs text-muted-foreground">{totalEnrollments} × ₹{rate}</p>
            </div>
            <div className="p-3 bg-amber-50 rounded-lg">
              <p className="text-xs text-muted-foreground mb-1">Total Concession</p>
              <p className="text-lg font-semibold text-amber-700">
                {totalConcession > 0 ? `− ₹${totalConcession.toLocaleString('en-IN')}` : '—'}
              </p>
              {totalConcession > 0 && (
                <p className="text-xs text-muted-foreground">{totalEnrollments} × ₹{concessionPerEntry}</p>
              )}
            </div>
            <div className="p-3 bg-indigo-50 rounded-lg md:col-span-2">
              <p className="text-xs text-muted-foreground mb-1">Net Amount to Collect</p>
              <p className="text-xl font-bold text-indigo-700">₹{expectedFee.toLocaleString('en-IN')}</p>
            </div>
          </div>
          <div className="flex items-end gap-3 pt-1">
            <div className="flex-1 max-w-xs">
              <Label className="text-sm">Concession per Registration (₹) — staff only</Label>
              <Input
                type="number"
                min="0"
                value={concessionInput}
                onChange={(e) => setConcessionInput(e.target.value)}
                className="mt-1"
                placeholder="e.g. 20"
              />
            </div>
            <Button onClick={saveConcession} disabled={savingConcession} className="flex items-center gap-2">
              <Save className="h-4 w-4" />
              {savingConcession ? 'Saving…' : 'Save Concession'}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Applied per registration (subject enrollment). e.g. ₹20 concession on 16 registrations = ₹320 off. Reflected in the school's portal payment view.
          </p>
        </CardContent>
      </Card>

      <BulkUpload schoolId={schoolId} subjects={subjects} onSuccess={() => qc.invalidateQueries({ queryKey: ['crm-portal-students', schoolId] })} />

      {/* Students table — full read+write once submitted; a red-tinted read-only
          preview beforehand so staff can see progress without touching a list
          the school is still actively building on the portal. */}
      {students.length === 0 ? (
        <div className="rounded-2xl p-8 border border-black/5 bg-white text-center">
          <ClipboardList className="w-10 h-10 text-muted-foreground mx-auto mb-3 opacity-40" />
          <p className="text-base font-semibold text-foreground mb-1">
            {isSubmitted ? 'No Students Added' : 'Student List Not Yet Submitted'}
          </p>
          <p className="text-sm text-muted-foreground max-w-sm mx-auto">
            {isSubmitted
              ? 'The school submitted an empty list.'
              : 'Nothing added by the school on the portal yet.'}
          </p>
        </div>
      ) : (
      <Card className={!isSubmitted ? 'border-red-200' : undefined}>
        <CardHeader>
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-2 flex-wrap">
              <CardTitle className="text-base">
                Student List ({students.length} students · {totalEnrollments} registrations)
              </CardTitle>
              {!isSubmitted && (
                <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-semibold bg-red-100 text-red-700 border border-red-300">
                  Not yet submitted — live preview, read-only
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {isSubmitted && canBulkDelete && selectedIds.size > 0 && (
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={bulkDeleteMutation.isPending}
                  onClick={() => {
                    if (confirm(`Delete ${selectedIds.size} selected student${selectedIds.size !== 1 ? 's' : ''}?`)) {
                      bulkDeleteMutation.mutate(Array.from(selectedIds));
                    }
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5 mr-1" />
                  Delete {selectedIds.size} selected
                </Button>
              )}
              <Button variant="outline" size="sm" onClick={exportCSV}>
                <Download className="h-3.5 w-3.5 mr-1" />
                Export CSV
              </Button>
              <Button
                variant={sortField === 'name' ? 'secondary' : 'ghost'}
                size="sm"
                onClick={() => toggleSort('name')}
              >
                Name {sortField === 'name' ? (sortOrder === 'asc' ? '↑' : '↓') : ''}
              </Button>
              <Button
                variant={sortField === 'class' ? 'secondary' : 'ghost'}
                size="sm"
                onClick={() => toggleSort('class')}
              >
                Class {sortField === 'class' ? (sortOrder === 'asc' ? '↑' : '↓') : ''}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <p className="text-sm text-muted-foreground p-6 text-center">Loading…</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className={`border-b ${!isSubmitted ? 'bg-red-50' : 'bg-muted/50'}`}>
                  <tr>
                    {isSubmitted && canBulkDelete && (
                      <th className="px-4 py-3 w-10">
                        <input
                          type="checkbox"
                          className="rounded"
                          checked={allSelected}
                          onChange={(e) => setSelectedIds(e.target.checked ? new Set(displayedStudents.map(s => s.id)) : new Set())}
                        />
                      </th>
                    )}
                    <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">#</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Name</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Class</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Subjects</th>
                    {isSubmitted && <th className="px-4 py-3 w-24" />}
                  </tr>
                </thead>
                <tbody className={`divide-y ${!isSubmitted ? 'bg-red-50/60' : ''}`}>
                  {displayedStudents.map((s, i) => {
                    const isEditing = isSubmitted && editingId === s.id;
                    const clsLabel = CLASS_OPTIONS.find((c) => c.value === s.class_code)?.label ?? s.class_code;

                    return (
                      <tr key={s.id} className={isSubmitted ? 'hover:bg-muted/30 group' : ''}>
                        {isSubmitted && canBulkDelete && (
                          <td className="px-4 py-3">
                            <input
                              type="checkbox"
                              className="rounded"
                              checked={selectedIds.has(s.id)}
                              onChange={(e) => setSelectedIds(prev => {
                                const next = new Set(prev);
                                if (e.target.checked) next.add(s.id); else next.delete(s.id);
                                return next;
                              })}
                            />
                          </td>
                        )}
                        <td className="px-4 py-3 text-muted-foreground text-xs">{i + 1}</td>
                        <td className="px-4 py-3 font-medium">
                          {isEditing ? (
                            <Input value={editName} onChange={(e) => setEditName(e.target.value)} className="h-7 text-sm" />
                          ) : s.student_name}
                        </td>
                        <td className="px-4 py-3">
                          {isEditing ? (
                            <select value={editClass} onChange={(e) => setEditClass(e.target.value)}
                              className="h-7 rounded border border-input bg-background px-2 text-sm">
                              {CLASS_OPTIONS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                            </select>
                          ) : clsLabel}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-1">
                            {subjectsForClass(subjects, isEditing ? editClass : s.class_code).map((subj) => {
                              const code = subj.alphabetical_code!;
                              const active = isEditing ? editOlympiads.includes(code) : s.enrollments.includes(code);
                              return (
                                <button key={code} type="button"
                                  title={subj.subject_name}
                                  onClick={() => isEditing && setEditOlympiads((p) => p.includes(code) ? p.filter((o) => o !== code) : [...p, code])}
                                  disabled={!isEditing}
                                  className={`px-1.5 py-0.5 rounded text-[11px] font-semibold border transition-colors ${
                                    active ? 'bg-indigo-600 text-white border-indigo-600' : 'border-border text-muted-foreground'
                                  } ${isEditing ? 'cursor-pointer hover:border-indigo-400' : 'cursor-default'}`}>
                                  {code}
                                </button>
                              );
                            })}
                          </div>
                          {!isEditing && s.enrollments.length > 0 && (
                            <div className="mt-1 space-y-0.5">
                              {s.enrollments.map((code) => {
                                const formatted = formatRegNumberForStudent(s.regNumbers[code]);
                                return formatted ? (
                                  <p key={code} className="text-[10px] text-muted-foreground font-mono">{formatted}</p>
                                ) : (
                                  <p key={code} className="text-[10px] text-amber-500 font-mono">Pending</p>
                                );
                              })}
                            </div>
                          )}
                        </td>
                        {isSubmitted && (
                        <td className="px-4 py-3">
                          {isEditing ? (
                            <div className="flex flex-col gap-1.5">
                              {editClass !== s.class_code && (
                                <p className="text-[10px] text-amber-600 font-medium">
                                  ⚠ Class changed — reg numbers will regenerate
                                </p>
                              )}
                              <div className="flex gap-1">
                                <button
                                  onClick={() => updateMutation.mutate({
                                    id: s.id,
                                    name: editName,
                                    originalName: s.student_name,
                                    cls: editClass,
                                    originalClass: s.class_code,
                                    oldEnrollments: s.enrollments,
                                    newEnrollments: editOlympiads,
                                  })}
                                  disabled={updateMutation.isPending}
                                  className="p-1.5 rounded text-emerald-600 hover:bg-emerald-50 disabled:opacity-50">
                                  <Check className="h-3.5 w-3.5" />
                                </button>
                                <button onClick={() => setEditingId(null)} className="p-1.5 rounded text-muted-foreground hover:bg-muted">
                                  <X className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button onClick={() => { setEditingId(s.id); setEditName(s.student_name); setEditClass(s.class_code); setEditOlympiads(s.enrollments); }}
                                className="p-1.5 rounded text-muted-foreground hover:text-indigo-600 hover:bg-indigo-50">
                                <Pencil className="h-3.5 w-3.5" />
                              </button>
                              <button onClick={() => deleteMutation.mutate(s.id)}
                                className="p-1.5 rounded text-muted-foreground hover:text-red-500 hover:bg-red-50">
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          )}
                        </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
      )}

      {isSubmitted && (
        <StaffAddStudentPanel
          schoolId={schoolId}
          projectId="dd5de83d-64f8-4113-a231-27024058396b"
          subjects={subjects}
          onAdded={() => qc.invalidateQueries({ queryKey: ['crm-portal-students', schoolId, activeProject?.id] })}
        />
      )}
    </div>
  );
}
