import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import ProspectLayout from '@/components/prospect/ProspectLayout';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { Plus, Mail, MessageSquare, Clock, CheckCircle, XCircle, FileText, Eye, Edit, Archive } from 'lucide-react';
import { WhatsAppTemplatesContent } from '@/pages/WhatsAppTemplates';

type Template = {
  id: string; name: string; description: string | null; category: string;
  subject: string; status: string; rejection_reason: string | null;
  created_at: string; approved_at: string | null;
  profiles?: { username: string } | null;
};

const STATUS: Record<string, { label: string; color: string; icon: React.ElementType }> = {
  draft:            { label: 'Draft',            color: 'bg-gray-100 text-gray-700',   icon: FileText },
  pending_approval: { label: 'Pending Approval', color: 'bg-amber-100 text-amber-800', icon: Clock },
  approved:         { label: 'Approved',         color: 'bg-green-100 text-green-800', icon: CheckCircle },
  rejected:         { label: 'Rejected',         color: 'bg-red-100 text-red-700',     icon: XCircle },
  archived:         { label: 'Archived',         color: 'bg-gray-100 text-gray-500',   icon: Archive },
};

const CATEGORY_COLOR: Record<string, string> = {
  announcement:  'bg-blue-50 text-blue-700',
  promotional:   'bg-violet-50 text-violet-700',
  reminder:      'bg-amber-50 text-amber-700',
  seasonal:      'bg-green-50 text-green-700',
  transactional: 'bg-gray-50 text-gray-700',
  general:       'bg-indigo-50 text-indigo-700',
};

export default function ProspectTemplates() {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const { toast } = useToast();
  const [tab, setTab]             = useState<'email' | 'whatsapp'>('email');
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading]     = useState(true);
  const [statusFilter, setStatusFilter] = useState('all');

  const fetchTemplates = async () => {
    setLoading(true);
    let q = supabase.from('email_templates')
      .select('id,name,description,category,subject,status,rejection_reason,created_at,approved_at')
      .order('created_at', { ascending: false });
    if (statusFilter !== 'all') q = q.eq('status', statusFilter);
    const { data, error } = await q;
    if (error) toast({ title: 'Error', description: error.message, variant: 'destructive' });
    else setTemplates((data || []) as Template[]);
    setLoading(false);
  };

  useEffect(() => { if (tab === 'email') fetchTemplates(); }, [tab, statusFilter]);

  const submitForApproval = async (id: string) => {
    await supabase.from('email_templates').update({ status: 'pending_approval' }).eq('id', id);
    await supabase.from('template_approval_log').insert({ template_id: id, action: 'submitted', actor_id: profile?.id });
    toast({ title: 'Submitted for approval' });
    fetchTemplates();
  };

  const approveTemplate = async (id: string) => {
    await supabase.from('email_templates').update({ status: 'approved', approved_by: profile?.id, approved_at: new Date().toISOString() }).eq('id', id);
    await supabase.from('template_approval_log').insert({ template_id: id, action: 'approved', actor_id: profile?.id });
    toast({ title: 'Template approved' });
    fetchTemplates();
  };

  const rejectTemplate = async (id: string) => {
    const reason = prompt('Rejection reason:');
    if (!reason) return;
    await supabase.from('email_templates').update({ status: 'rejected', rejection_reason: reason }).eq('id', id);
    await supabase.from('template_approval_log').insert({ template_id: id, action: 'rejected', actor_id: profile?.id, comment: reason });
    toast({ title: 'Template rejected' });
    fetchTemplates();
  };

  const isSuperadmin = profile?.role === 'superadmin';

  return (
    <ProspectLayout>
      <div className="max-w-6xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Template Library</h1>
            <p className="text-base text-gray-500 mt-1">Manage email and WhatsApp templates for campaigns</p>
          </div>
          {tab === 'email' && (
            <Button size="lg" onClick={() => navigate('/prospect/templates/new')}>
              <Plus className="h-5 w-5 mr-2" /> New Email Template
            </Button>
          )}
        </div>

        {/* Tabs */}
        <div className="flex gap-1 bg-gray-100 p-1 rounded-xl w-fit mb-6">
          {(['email', 'whatsapp'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold transition-all ${
                tab === t ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'
              }`}>
              {t === 'email' ? <Mail className="h-4 w-4" /> : <MessageSquare className="h-4 w-4" />}
              {t === 'email' ? 'Email' : 'WhatsApp'}
            </button>
          ))}
        </div>

        {tab === 'email' && (
          <>
            {/* Status filter */}
            <div className="flex gap-2 mb-6 flex-wrap">
              {['all', 'draft', 'pending_approval', 'approved', 'rejected'].map(s => (
                <button key={s} onClick={() => setStatusFilter(s)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors border ${
                    statusFilter === s
                      ? 'bg-indigo-600 text-white border-indigo-600'
                      : 'bg-white text-gray-600 border-gray-200 hover:border-indigo-300'
                  }`}>
                  {s === 'all' ? 'All' : STATUS[s]?.label}
                </button>
              ))}
            </div>

            {/* Template cards */}
            {loading ? (
              <div className="text-center py-20 text-gray-400 text-lg">Loading…</div>
            ) : templates.length === 0 ? (
              <div className="text-center py-20 bg-white rounded-2xl border border-dashed border-gray-200">
                <FileText className="h-12 w-12 text-gray-300 mx-auto mb-4" />
                <p className="text-gray-600 text-lg font-medium">No templates yet</p>
                <p className="text-gray-400 mt-1">Create your first email template to use in campaigns</p>
                <Button className="mt-6" onClick={() => navigate('/prospect/templates/new')}>
                  <Plus className="h-4 w-4 mr-2" /> Create Template
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                {templates.map(t => {
                  const cfg = STATUS[t.status] ?? STATUS.draft;
                  const Icon = cfg.icon;
                  return (
                    <div key={t.id} className="bg-white rounded-2xl border border-gray-200 p-6 hover:border-indigo-200 transition-colors">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-3 flex-wrap mb-2">
                            <h3 className="text-lg font-bold text-gray-900">{t.name}</h3>
                            <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-semibold ${cfg.color}`}>
                              <Icon className="h-3.5 w-3.5" />{cfg.label}
                            </span>
                            <span className={`inline-flex px-3 py-1 rounded-full text-sm font-medium ${CATEGORY_COLOR[t.category] || CATEGORY_COLOR.general}`}>
                              {t.category}
                            </span>
                          </div>
                          <p className="text-base text-gray-600 mb-1">
                            <span className="font-medium text-gray-700">Subject:</span> {t.subject}
                          </p>
                          {t.description && <p className="text-sm text-gray-500">{t.description}</p>}
                          {t.rejection_reason && (
                            <p className="text-sm text-red-600 mt-2 bg-red-50 px-3 py-2 rounded-lg">
                              <strong>Rejection reason:</strong> {t.rejection_reason}
                            </p>
                          )}
                          <p className="text-sm text-gray-400 mt-3">
                            Created {new Date(t.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                            {t.approved_at && ` · Approved ${new Date(t.approved_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`}
                          </p>
                        </div>

                        {/* Actions */}
                        <div className="flex flex-col gap-2 flex-shrink-0">
                          <Button variant="outline" size="sm" onClick={() => navigate(`/prospect/templates/${t.id}`)}>
                            <Eye className="h-4 w-4 mr-1.5" /> Preview
                          </Button>
                          {(t.status === 'draft' || t.status === 'rejected') && (
                            <>
                              <Button variant="outline" size="sm" onClick={() => navigate(`/prospect/templates/${t.id}/edit`)}>
                                <Edit className="h-4 w-4 mr-1.5" /> Edit
                              </Button>
                              <Button size="sm" onClick={() => submitForApproval(t.id)}>
                                Submit for Approval
                              </Button>
                            </>
                          )}
                          {t.status === 'pending_approval' && isSuperadmin && (
                            <>
                              <Button size="sm" className="bg-green-600 hover:bg-green-700" onClick={() => approveTemplate(t.id)}>
                                <CheckCircle className="h-4 w-4 mr-1.5" /> Approve
                              </Button>
                              <Button size="sm" variant="outline" className="text-red-600 border-red-200 hover:bg-red-50" onClick={() => rejectTemplate(t.id)}>
                                <XCircle className="h-4 w-4 mr-1.5" /> Reject
                              </Button>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}

        {tab === 'whatsapp' && (
          <WhatsAppTemplatesContent category="marketing" />
        )}
      </div>
    </ProspectLayout>
  );
}

