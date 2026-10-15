import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2 } from 'lucide-react';

type ProjectRow = {
  project_id: string; project_name: string; project_year: number; is_active: boolean;
  status: string; registration_status: string | null; payment_status: string | null;
  payment_received: number | null; students: number; enrolments: number;
  book_orders: number; book_order_total: number; result_status: string | null;
  interest_note: string | null; communications: number;
};

const STATUS_STYLE: Record<string, string> = {
  'Participated': 'bg-green-100 text-green-700',
  'Registered': 'bg-indigo-100 text-indigo-700',
  'Interested': 'bg-amber-100 text-amber-700',
  'Interested (lead)': 'bg-amber-50 text-amber-700',
};

const rupees = (n: number | null) => `₹${Number(n ?? 0).toLocaleString('en-IN')}`;

// Per-project summary for one school, newest project first. A dropdown (not tabs) so it still
// works when a school has 10+ projects behind it.
export default function ProspectProjectHistory({ prospectId }: { prospectId: string }) {
  const [rows, setRows] = useState<ProjectRow[] | null>(null);
  const [pick, setPick] = useState<string>('');

  useEffect(() => {
    let alive = true;
    setRows(null);
    supabase.rpc('get_school_project_history' as any, { p_prospect_school_id: prospectId }).then(({ data }) => {
      if (!alive) return;
      const list = (data ?? []) as ProjectRow[];
      setRows(list);
      setPick(list[0]?.project_id ?? '');
    });
    return () => { alive = false; };
  }, [prospectId]);

  if (!rows) return <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-gray-400" /></div>;
  if (rows.length === 0) return <p className="text-sm text-gray-500 py-6">This school has no project history yet.</p>;

  const participated = rows.filter(r => r.status === 'Participated').length;
  const r = rows.find(x => x.project_id === pick) ?? rows[0];
  const facts: [string, string][] = [
    ['Registration', r.registration_status ?? '—'],
    ['Students', String(r.students)],
    ['Subject entries', String(r.enrolments)],
    ['Payment', r.payment_status ? `${r.payment_status}${r.payment_received ? ` · ${rupees(r.payment_received)}` : ''}` : '—'],
    ['Book orders', r.book_orders ? `${r.book_orders} · ${rupees(r.book_order_total)}` : 'None'],
    ['Results', r.result_status ?? '—'],
    ['Communications', String(r.communications)],
  ];

  return (
    <div className="space-y-4 text-sm">
      <p className="text-gray-700">
        Participated in <span className="font-semibold">{participated}</span> of {rows.length} project{rows.length === 1 ? '' : 's'}.
      </p>
      <Select value={r.project_id} onValueChange={setPick}>
        <SelectTrigger className="w-72"><SelectValue /></SelectTrigger>
        <SelectContent>
          {rows.map(x => (
            <SelectItem key={x.project_id} value={x.project_id}>
              {x.project_name} {x.project_year}{x.is_active ? ' (current)' : ''}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <div className="rounded-lg border border-gray-200 p-4 space-y-3">
        <div className="flex items-center gap-2">
          <span className="font-medium text-gray-900">{r.project_name} {r.project_year}</span>
          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLE[r.status] ?? 'bg-gray-100 text-gray-600'}`}>{r.status}</span>
        </div>
        <dl className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-2">
          {facts.map(([k, v]) => (
            <div key={k}>
              <dt className="text-xs text-gray-500">{k}</dt>
              <dd className="text-gray-900">{v}</dd>
            </div>
          ))}
        </dl>
        {r.interest_note && <p className="text-xs text-amber-700 bg-amber-50 rounded px-2 py-1">{r.interest_note}</p>}
      </div>
    </div>
  );
}
