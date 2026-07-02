import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import ProspectLayout from '@/components/prospect/ProspectLayout';
import { Button } from '@/components/ui/button';
import { Plus, Mail, MessageSquare, Send, Clock, CheckCircle, XCircle, FileText, Trash2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';

type Campaign = {
  id: string; name: string; description: string | null; channel: string;
  status: string; scheduled_at: string | null; email_subject: string | null;
  target_count: number; sent_count: number; delivered_count: number;
  opened_count: number; bounced_count: number; failed_count: number;
  created_at: string;
};

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ElementType }> = {
  draft:      { label: 'Draft',      color: 'bg-gray-100 text-gray-600',    icon: FileText },
  scheduled:  { label: 'Scheduled',  color: 'bg-amber-100 text-amber-700',  icon: Clock },
  sending:    { label: 'Sending',    color: 'bg-blue-100 text-blue-700',    icon: Send },
  sent:       { label: 'Sent',       color: 'bg-green-100 text-green-700',  icon: CheckCircle },
  cancelled:  { label: 'Cancelled',  color: 'bg-red-100 text-red-600',      icon: XCircle },
};

export default function ProspectCampaigns() {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const { toast } = useToast();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading]     = useState(true);

  const deleteCampaign = async (id: string, name: string) => {
    if (!window.confirm(`Delete campaign "${name}"? This cannot be undone.`)) return;
    const { error } = await supabase.from('campaigns').delete().eq('id', id);
    if (error) toast({ title: 'Error', description: error.message, variant: 'destructive' });
    else { toast({ title: 'Campaign deleted' }); setCampaigns(c => c.filter(x => x.id !== id)); }
  };

  const fetchCampaigns = async () => {
    setLoading(true);
    const { data, error } = await supabase.from('campaigns')
      .select('*').order('created_at', { ascending: false });
    if (error) toast({ title: 'Error', description: error.message, variant: 'destructive' });
    else setCampaigns(data as Campaign[]);
    setLoading(false);
  };

  useEffect(() => { fetchCampaigns(); }, []);

  return (
    <ProspectLayout>
      <div className="max-w-5xl mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold text-gray-900">Campaigns</h1>
            <p className="text-sm text-gray-500 mt-0.5">{campaigns.length} campaign{campaigns.length !== 1 ? 's' : ''}</p>
          </div>
          <Button onClick={() => navigate('/prospect/campaigns/new')} size="lg">
            <Plus className="h-5 w-5 mr-2" /> New Campaign
          </Button>
        </div>

        {/* Campaign list */}
        {loading ? (
          <div className="text-center py-16 text-gray-400">Loading…</div>
        ) : campaigns.length === 0 ? (
          <div className="text-center py-20 bg-white rounded-xl border border-gray-200">
            <Send className="h-10 w-10 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500 font-medium">No campaigns yet</p>
            <p className="text-gray-400 text-sm mt-1">Create your first campaign to start reaching schools</p>
            <Button className="mt-4" onClick={() => navigate('/prospect/campaigns/new')}>
              <Plus className="h-4 w-4 mr-1.5" /> New Campaign
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {campaigns.map(c => {
              const cfg = STATUS_CONFIG[c.status] ?? STATUS_CONFIG.draft;
              const Icon = cfg.icon;
              const deliveryRate = c.sent_count > 0 ? Math.round((c.delivered_count / c.sent_count) * 100) : null;
              const openRate = c.delivered_count > 0 ? Math.round((c.opened_count / c.delivered_count) * 100) : null;

              return (
                <div key={c.id} onClick={() => navigate(`/prospect/campaigns/${c.id}`)} className="bg-white rounded-xl border border-gray-200 p-5 hover:border-indigo-200 hover:shadow-sm transition-all cursor-pointer">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        {c.channel === 'email'
                          ? <Mail className="h-4 w-4 text-indigo-500 flex-shrink-0" />
                          : <MessageSquare className="h-4 w-4 text-green-500 flex-shrink-0" />}
                        <h3 className="font-semibold text-gray-900 truncate">{c.name}</h3>
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${cfg.color}`}>
                          <Icon className="h-3 w-3" />{cfg.label}
                        </span>
                      </div>
                      {c.description && <p className="text-sm text-gray-500 truncate mb-2">{c.description}</p>}
                      {c.email_subject && <p className="text-xs text-gray-400 mb-3">Subject: {c.email_subject}</p>}
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className="text-xs text-gray-400">
                        {new Date(c.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                      </span>
                      <Button
                        size="sm" variant="ghost"
                        className="h-7 w-7 p-0 text-red-400 hover:text-red-600 hover:bg-red-50"
                        onClick={(e) => { e.stopPropagation(); deleteCampaign(c.id, c.name); }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>

                  {/* Stats */}
                  <div className="grid grid-cols-5 gap-3 mt-3 pt-3 border-t border-gray-50">
                    {[
                      { label: 'Target',    value: c.target_count,   color: 'text-gray-700' },
                      { label: 'Sent',      value: c.sent_count,     color: 'text-blue-600' },
                      { label: 'Delivered', value: c.delivered_count, color: 'text-indigo-600' },
                      { label: 'Opened',    value: c.opened_count,   color: 'text-green-600' },
                      { label: 'Bounced',   value: c.bounced_count,  color: 'text-red-500' },
                    ].map(({ label, value, color }) => (
                      <div key={label} className="text-center">
                        <p className={`text-base font-bold ${color}`}>{value.toLocaleString()}</p>
                        <p className="text-xs text-gray-400 mt-0.5">{label}</p>
                      </div>
                    ))}
                  </div>

                  {(deliveryRate !== null || openRate !== null) && (
                    <div className="flex gap-4 mt-2 text-xs text-gray-500">
                      {deliveryRate !== null && <span>Delivery: <strong>{deliveryRate}%</strong></span>}
                      {openRate !== null && <span>Open rate: <strong>{openRate}%</strong></span>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

    </ProspectLayout>
  );
}
