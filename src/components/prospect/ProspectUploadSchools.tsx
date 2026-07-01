import { useState, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { downloadCSV } from '@/utils/csvExport';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { Upload, FileText, CheckCircle, AlertCircle, X, Download } from 'lucide-react';

// Column aliases — maps your CSV header (lowercased, trimmed) to our DB field
const COL_MAP: Record<string, string> = {
  'udise code':       'udise_code',
  'udisecode':        'udise_code',
  'school name':      'school_name',
  'schoolname':       'school_name',
  'state':            'state',
  'district':         'district',
  'block':            'block',
  'lgd block':        'lgd_block',
  'cluster':          'cluster',
  'village':          'village',
  'panchayat':        'panchayat',
  'urban body':       'urban_body',
  'ward':             'ward',
  'address':          'address',
  'pincode':          'pincode',
  'school location':  'school_location',
  'school category':  'school_category',
  'school management':'school_management',
  'school type':      'school_type',
  'class from':       'class_from',
  'classfrom':        'class_from',
  'class to':         'class_to',
  'classto':          'class_to',
  'email':            'email',
  'board':            'board',
  'phone':            'mobile',
  'website':          'website',
  'principal':        'principal_name',
};

const REQUIRED = ['school_name', 'state', 'district', 'address', 'pincode', 'school_category', 'class_from', 'class_to'];

// Split a single line on the delimiter, respecting double-quoted fields
// (addresses contain commas inside quotes in the UDISE export).
function splitLine(line: string, delim: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } // escaped ""
        else inQuotes = false;
      } else cur += ch;
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === delim) { out.push(cur); cur = ''; }
      else cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function parseCSV(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return [];
  // Auto-detect delimiter: tab if present in the header, otherwise comma.
  const delim = lines[0].includes('\t') ? '\t' : ',';
  const headers = splitLine(lines[0], delim).map(h => h.trim());
  return lines.slice(1).map(line => {
    const vals = splitLine(line, delim);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => { row[h] = (vals[i] ?? '').trim(); });
    return row;
  });
}

// All DB columns we may write. Every row must carry the SAME key set or
// PostgREST rejects the batch ("All object keys must match").
const TARGET_COLS = Array.from(new Set(Object.values(COL_MAP)));

// CHECK-constraint-safe normalizers (UDISE values carry numeric prefixes like
// "3-Co-Educational"; the DB check only allows the bare enum values).
function normSchoolType(v?: string | null): string | null {
  if (!v) return null;
  const s = v.toLowerCase();
  if (s.includes('co-ed') || s.includes('co ed')) return 'Co-Educational';
  if (s.includes('boy'))  return 'Boys';
  if (s.includes('girl')) return 'Girls';
  return null;
}
function normSchoolLocation(v?: string | null): string | null {
  if (!v) return null;
  const s = v.toLowerCase();
  if (s.startsWith('urban')) return 'Urban';
  if (s.startsWith('rural')) return 'Rural';
  return null;
}

function mapRow(raw: Record<string, string>): Record<string, any> | null {
  // Start with every target column null so all rows share an identical key set.
  const mapped: Record<string, any> = {};
  for (const col of TARGET_COLS) mapped[col] = null;
  mapped.stage = 'uncontacted';
  mapped.linked_to_crm = false;
  for (const [rawKey, rawVal] of Object.entries(raw)) {
    const dbKey = COL_MAP[rawKey.toLowerCase().trim()];
    if (dbKey && rawVal) mapped[dbKey] = rawVal;
  }
  // Coerce numeric fields
  mapped.class_from = mapped.class_from ? (parseInt(mapped.class_from, 10) || null) : null;
  mapped.class_to   = mapped.class_to   ? (parseInt(mapped.class_to,   10) || null) : null;
  if (mapped.pincode) mapped.pincode = String(mapped.pincode);
  // Normalize values constrained by CHECK constraints
  mapped.school_type     = normSchoolType(mapped.school_type);
  mapped.school_location = normSchoolLocation(mapped.school_location);
  // Validate required
  for (const req of REQUIRED) {
    if (!mapped[req]) return null;
  }
  return mapped;
}

type Props = {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
};

export default function ProspectUploadSchools({ open, onClose, onSuccess }: Props) {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile]         = useState<File | null>(null);
  const [preview, setPreview]   = useState<{ valid: number; invalid: number; sample: string[] } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [parsedRows, setParsedRows] = useState<Record<string, any>[]>([]);

  const handleFile = (f: File) => {
    setFile(f);
    const reader = new FileReader();
    reader.onload = e => {
      const text = e.target?.result as string;
      const raw = parseCSV(text);
      const valid: Record<string, any>[] = [];
      const invalid: string[] = [];
      raw.forEach(row => {
        const mapped = mapRow(row);
        if (mapped) valid.push(mapped);
        else invalid.push(row['School Name'] || row['school name'] || '(unknown)');
      });
      setParsedRows(valid);
      setPreview({ valid: valid.length, invalid: invalid.length, sample: invalid.slice(0, 3) });
    };
    reader.readAsText(f);
  };

  const handleUpload = async () => {
    if (!parsedRows.length) return;
    setUploading(true);
    try {
      // Upsert in batches of 200
      const BATCH = 200;
      let inserted = 0;
      for (let i = 0; i < parsedRows.length; i += BATCH) {
        const batch = parsedRows.slice(i, i + BATCH);
        const { error } = await supabase
          .from('prospect_schools')
          .upsert(batch, {
            onConflict: 'udise_code',
            ignoreDuplicates: false,
          });
        if (error) {
          // If udise_code conflict fails (some rows have no udise), try insert-only
          const { error: e2 } = await supabase.from('prospect_schools').insert(batch);
          if (e2) throw e2;
        }
        inserted += batch.length;
      }
      toast({ title: 'Upload complete', description: `${inserted} schools imported successfully.` });
      onSuccess();
    } catch (err: any) {
      toast({ title: 'Upload failed', description: err.message, variant: 'destructive' });
    } finally {
      setUploading(false);
    }
  };

  const reset = () => { setFile(null); setPreview(null); setParsedRows([]); };

  // Download a CSV template with the exact headers (in order) + one sample row.
  const downloadTemplate = () => {
    const headers = [
      'UDISE Code','School Name','State','District','Block','LGD Block','Cluster',
      'Village','Panchayat','Urban Body','Ward','Address','Pincode','School Location',
      'School Category','School Management','School Type','Class From','Class To',
      'Email','Board','Phone','Website','Principal',
    ];
    const sample = [
      '29024100171','Sunrise Public School','Karnataka','Bagalkot','Bagalkot','Bagalkot',
      'Navanagar','Bagalkot','','Bagalkot-Municipality','Ward 11',
      'Sector 110, Road 17, Navanagar','587104','Urban','Primary',
      'Private Unaided','Co-Educational','1','10',
      'school@example.com','State Board','9876543210','https://example.com','Principal Name',
    ];
    downloadCSV([headers, sample], 'prospect_schools_template.csv');
  };

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) { reset(); onClose(); } }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Upload Schools (UDISE Format)</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Format info */}
          <div className="bg-indigo-50 rounded-lg p-3 text-sm text-indigo-800 space-y-2">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <p className="font-semibold">Expected format: Comma or tab-separated (.csv / .txt)</p>
                <p className="text-xs text-indigo-700">
                  Mandatory columns: School Name, State, District, Address, Pincode, School Category, Class From, Class To
                </p>
                <p className="text-xs text-indigo-600">UDISE Code is optional — used as deduplication key when present.</p>
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={downloadTemplate}
              className="h-8 bg-white border-indigo-300 text-indigo-700 hover:bg-indigo-100">
              <Download className="h-3.5 w-3.5 mr-1.5" /> Download Template
            </Button>
          </div>

          {/* Drop zone */}
          {!file ? (
            <div
              onClick={() => fileRef.current?.click()}
              onDragOver={e => e.preventDefault()}
              onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
              className="border-2 border-dashed border-gray-300 rounded-xl p-10 text-center cursor-pointer hover:border-indigo-400 hover:bg-indigo-50/30 transition-colors"
            >
              <Upload className="h-8 w-8 text-gray-400 mx-auto mb-2" />
              <p className="text-sm font-medium text-gray-700">Click or drag a file here</p>
              <p className="text-xs text-gray-400 mt-1">Comma or tab-separated .csv / .txt</p>
              <input ref={fileRef} type="file" accept=".csv,.txt,.tsv" className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
            </div>
          ) : (
            <div className="border rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <FileText className="h-5 w-5 text-indigo-600" />
                  <span className="text-sm font-medium text-gray-900">{file.name}</span>
                </div>
                <button onClick={reset} className="text-gray-400 hover:text-gray-600">
                  <X className="h-4 w-4" />
                </button>
              </div>

              {preview && (
                <div className="space-y-2">
                  <div className="flex gap-4">
                    <div className="flex items-center gap-1.5 text-green-700 text-sm">
                      <CheckCircle className="h-4 w-4" />
                      <span><strong>{preview.valid.toLocaleString()}</strong> valid schools</span>
                    </div>
                    {preview.invalid > 0 && (
                      <div className="flex items-center gap-1.5 text-amber-700 text-sm">
                        <AlertCircle className="h-4 w-4" />
                        <span><strong>{preview.invalid}</strong> skipped (missing required fields)</span>
                      </div>
                    )}
                  </div>
                  {preview.sample.length > 0 && (
                    <p className="text-xs text-gray-500">
                      Skipped: {preview.sample.join(', ')}{preview.invalid > 3 ? ` +${preview.invalid - 3} more` : ''}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => { reset(); onClose(); }}>Cancel</Button>
          <Button
            onClick={handleUpload}
            disabled={!parsedRows.length || uploading}
          >
            {uploading ? 'Uploading…' : `Import ${parsedRows.length.toLocaleString()} Schools`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
