import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import ProspectLayout from '@/components/prospect/ProspectLayout';
import { ArrowLeft, Calendar, Users, IndianRupee, CheckCircle, Clock, Mail, Phone, MessageSquare, Bot, ChevronDown } from 'lucide-react';

type ProjectRecord = {
  project_name: string; project_year: number;
  registration_status: string; payment_status: string;
  payment_amount: string | null; payment_date: string | null; payment_mode: string | null;
  name_list_status: string; result_status: string;
  total_participants: number | null; student_count: number;
};

type CommRecord = {
  communication_type: string; details: string | null;
  outcome: string | null; created_at: string;
};

type History = {
  school_id: string;
  projects: ProjectRecord[];
  communications: CommRecord[];
  total_students: number;
  total_paid: number;
};

const COMM_COLORS: Record<string, string> = {
  Phone: 'bg-blue-50 text-blue-700',
  Email: 'bg-orange-50 text-orange-700',
  WhatsApp: 'bg-green-50 text-green-700',
  'AI Call': 'bg-purple-50 text-purple-700',
};
const COMM_ICONS: Record<string, React.ElementType> = {
  Phone: Phone, Email: Mail, WhatsApp: MessageSquare, 'AI Call': Bot,
};

export default function ProspectSchoolHistory() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [school, setSchool] = useState<any>(null);
  const [history, setHistory] = useState<History | null>(null);
  const [loading, setLoading] = useState(true);
  const [openYears, setOpenYears] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (!id) return;
    Promise.all([
      supabase.from('prospect_schools')
        .select('id,ss_no,school_name,district,state,board,email,mobile,linked_to_crm')
        .eq('id', id).single(),
      supabase.rpc('get_school_history', { p_prospect_school_id: id }),
    ]).then(([schoolRes, historyRes]) => {
      setSchool(schoolRes.data);
      const hist = historyRes.data as History;
      setHistory(hist);
      // Default-open the most recent year
      const years = (hist?.projects ?? []).map(p => p.project_year);
      if (years.length) setOpenYears(new Set([Math.max(...years)]));
      setLoading(false);
    });
  }, [id]);

  const toggleYear = (year: number) => {
    setOpenYears(prev => {
      const next = new Set(prev);
      next.has(year) ? next.delete(year) : next.add(year);
      return next;
    });
  };

  if (loading) return (
    <ProspectLayout>
      <div className="flex items-center justify-center h-64 text-gray-400 text-lg">Loading history…</div>
    </ProspectLayout>
  );

  if (!school) return (
    <ProspectLayout>
      <div className="flex items-center justify-center h-64 text-gray-400 text-lg">School not found</div>
    </ProspectLayout>
  );

  const projects = [...(history?.projects ?? [])].sort((a, b) => b.project_year - a.project_year);
  const comms = history?.communications ?? [];

  return (
    <ProspectLayout>
      <div className="max-w-5xl mx-auto px-6 py-8">

        {/* Back + Header */}
        <div className="flex items-start gap-4 mb-8">
          <button onClick={() => navigate('/prospect/schools')}
            className="flex items-center gap-1.5 text-gray-500 hover:text-gray-800 text-base font-medium mt-1 flex-shrink-0 transition-colors">
            <ArrowLeft className="h-5 w-5" /> Schools
          </button>
          <div className="flex-1">
            <h1 className="text-2xl font-bold text-gray-900">{school.school_name}</h1>
            <p className="text-gray-500 mt-0.5">{school.district}, {school.state} · {school.board} · SS #{String(school.ss_no).padStart(4,'0')}</p>
          </div>
          {school.linked_to_crm && (
            <span className="flex items-center gap-1.5 px-3 py-1.5 bg-green-50 text-green-700 rounded-xl text-sm font-semibold border border-green-200">
              <CheckCircle className="h-4 w-4" /> In CRM
            </span>
          )}
        </div>

        {/* Summary stats */}
        <div className="grid grid-cols-3 gap-4 mb-8">
          <div className="bg-indigo-50 rounded-2xl p-5 text-center border border-indigo-100">
            <p className="text-4xl font-bold text-indigo-700">{projects.length}</p>
            <p className="text-sm text-indigo-600 font-medium mt-1">Olympiad{projects.length !== 1 ? 's' : ''} Participated</p>
          </div>
          <div className="bg-green-50 rounded-2xl p-5 text-center border border-green-100">
            <p className="text-4xl font-bold text-green-700">{history?.total_students?.toLocaleString() ?? 0}</p>
            <p className="text-sm text-green-600 font-medium mt-1">Total Students Registered</p>
          </div>
          <div className="bg-amber-50 rounded-2xl p-5 text-center border border-amber-100">
            <p className="text-4xl font-bold text-amber-700">
              ₹{(history?.total_paid ?? 0).toLocaleString('en-IN')}
            </p>
            <p className="text-sm text-amber-600 font-medium mt-1">Total Payment Made</p>
          </div>
        </div>

        {/* No history */}
        {projects.length === 0 && (
          <div className="bg-white rounded-2xl border border-gray-200 p-12 text-center mb-6">
            <Calendar className="h-12 w-12 text-gray-300 mx-auto mb-4" />
            <p className="text-gray-600 text-lg font-medium">No participation history yet</p>
            <p className="text-gray-400 text-sm mt-1">This school hasn't participated in any iPlus Olympiad</p>
          </div>
        )}

        {/* Project participation — collapsible per year */}
        {projects.map((p, i) => {
          const isOpen = openYears.has(p.project_year);
          return (
            <div key={i} className="bg-white rounded-2xl border border-gray-200 mb-4 overflow-hidden">
              {/* Clickable header */}
              <button
                onClick={() => toggleYear(p.project_year)}
                className="w-full flex items-center justify-between gap-3 p-6 hover:bg-gray-50 transition-colors text-left"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-12 h-12 rounded-xl bg-indigo-600 flex items-center justify-center flex-shrink-0">
                    <span className="text-white font-bold text-base">{p.project_year}</span>
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-lg font-bold text-gray-900 truncate">{p.project_name}</h3>
                    <p className="text-sm text-gray-500">
                      {p.student_count} student{p.student_count !== 1 ? 's' : ''}
                      {p.payment_amount ? ` · ₹${Number(p.payment_amount).toLocaleString('en-IN')} ${p.payment_status}` : ''}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  <span className={`px-3 py-1.5 rounded-xl text-sm font-semibold border ${
                    p.registration_status === 'Confirmed'
                      ? 'bg-green-50 text-green-700 border-green-200'
                      : 'bg-amber-50 text-amber-700 border-amber-200'
                  }`}>{p.registration_status}</span>
                  <ChevronDown className={`h-5 w-5 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                </div>
              </button>

              {/* Collapsible body */}
              {isOpen && (
                <div className="px-6 pb-6 border-t border-gray-100 pt-5">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="bg-gray-50 rounded-xl p-4 text-center">
                      <Users className="h-5 w-5 text-indigo-500 mx-auto mb-1.5" />
                      <p className="text-2xl font-bold text-gray-900">{p.student_count}</p>
                      <p className="text-xs text-gray-500 font-medium mt-0.5">Students</p>
                    </div>
                    <div className="bg-gray-50 rounded-xl p-4 text-center">
                      <IndianRupee className="h-5 w-5 text-green-500 mx-auto mb-1.5" />
                      <p className="text-2xl font-bold text-gray-900">
                        {p.payment_amount ? `₹${Number(p.payment_amount).toLocaleString('en-IN')}` : '—'}
                      </p>
                      <p className="text-xs text-gray-500 font-medium mt-0.5">
                        {p.payment_status}
                        {p.payment_mode ? ` · ${p.payment_mode}` : ''}
                      </p>
                    </div>
                    <div className="bg-gray-50 rounded-xl p-4 text-center">
                      <CheckCircle className="h-5 w-5 text-blue-500 mx-auto mb-1.5" />
                      <p className="text-base font-bold text-gray-900">{p.name_list_status}</p>
                      <p className="text-xs text-gray-500 font-medium mt-0.5">Name List</p>
                    </div>
                    <div className="bg-gray-50 rounded-xl p-4 text-center">
                      <Calendar className="h-5 w-5 text-violet-500 mx-auto mb-1.5" />
                      <p className="text-base font-bold text-gray-900">{p.result_status}</p>
                      <p className="text-xs text-gray-500 font-medium mt-0.5">Results</p>
                    </div>
                  </div>

                  {p.payment_date && (
                    <p className="text-sm text-gray-500 mt-3 flex items-center gap-1.5">
                      <Clock className="h-4 w-4" />
                      Payment received on {new Date(p.payment_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}
                    </p>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {/* Communication history */}
        {comms.length > 0 && (
          <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden mt-6">
            <div className="px-6 py-5 border-b border-gray-100">
              <h2 className="text-lg font-bold text-gray-900">Communication History</h2>
              <p className="text-sm text-gray-500 mt-0.5">{comms.length} interactions logged</p>
            </div>
            <div className="divide-y divide-gray-50">
              {comms.map((c, i) => {
                const Icon = COMM_ICONS[c.communication_type] ?? Phone;
                const color = COMM_COLORS[c.communication_type] ?? 'bg-gray-50 text-gray-600';
                const minsAgo = Math.round((Date.now() - new Date(c.created_at).getTime()) / 60000);
                const label = minsAgo < 60 ? `${minsAgo}m ago`
                  : minsAgo < 1440 ? `${Math.round(minsAgo/60)}h ago`
                  : new Date(c.created_at).toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric' });
                return (
                  <div key={i} className="flex items-start gap-4 px-6 py-4">
                    <div className={`p-2 rounded-lg flex-shrink-0 ${color}`}>
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-sm font-semibold text-gray-800">{c.communication_type}</span>
                        {c.outcome && <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">{c.outcome}</span>}
                      </div>
                      {c.details && <p className="text-sm text-gray-600 line-clamp-2">{c.details}</p>}
                    </div>
                    <span className="text-xs text-gray-400 flex-shrink-0 mt-0.5">{label}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

      </div>
    </ProspectLayout>
  );
}
