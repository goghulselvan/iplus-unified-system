import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import ProspectLayout from '@/components/prospect/ProspectLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { Eye, Code, Save, Send, Download } from 'lucide-react';

const VARIABLES = ['{{school_name}}', '{{principal_name}}', '{{district}}', '{{state}}', '{{board}}', '{{ss_no}}'];
const CATEGORIES = ['general', 'announcement', 'promotional', 'reminder', 'seasonal', 'transactional'];

const DEFAULT_HTML = `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px;">
  <div style="text-align: center; margin-bottom: 32px;">
    <h1 style="color: #4F46E5; font-size: 28px; margin: 0;">iPlus Olympiads</h1>
    <p style="color: #7C3AED; font-size: 14px; margin: 4px 0 0;">Ignite · Inspire · Impact</p>
  </div>

  <p style="font-size: 16px; color: #374151;">Dear {{principal_name}},</p>

  <p style="font-size: 16px; color: #374151; line-height: 1.6;">
    We are pleased to invite <strong>{{school_name}}</strong> to participate in the iPlus Olympiads 2026.
  </p>

  <p style="font-size: 16px; color: #374151; line-height: 1.6;">
    [Write your message here]
  </p>

  <div style="text-align: center; margin: 32px 0;">
    <a href="https://portal.iplusedu.in" style="background: #4F46E5; color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-size: 16px; font-weight: bold;">
      Register Now
    </a>
  </div>

  <hr style="border: none; border-top: 1px solid #E5E7EB; margin: 24px 0;" />
  <p style="font-size: 13px; color: #9CA3AF; text-align: center;">
    iPlus Education · iplusedu.in<br/>
    To unsubscribe, <a href="{{unsubscribe_url}}" style="color: #9CA3AF;">click here</a>
  </p>
</div>`;

export default function ProspectTemplateBuilder() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const { toast } = useToast();
  const isEdit = !!id;

  const [form, setForm] = useState({
    name: '', description: '', category: 'general',
    subject: '', body_html: DEFAULT_HTML,
  });
  const [preview, setPreview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!isEdit) return;
    supabase.from('email_templates').select('*').eq('id', id).single()
      .then(({ data }) => {
        if (data) setForm({
          name: data.name, description: data.description || '',
          category: data.category, subject: data.subject, body_html: data.body_html,
        });
      });
  }, [id]);

  const previewHtml = form.body_html
    .replace(/\{\{school_name\}\}/g, 'ABC Matriculation School')
    .replace(/\{\{principal_name\}\}/g, 'Mr. Ramesh Kumar')
    .replace(/\{\{district\}\}/g, 'Chennai')
    .replace(/\{\{state\}\}/g, 'Tamil Nadu')
    .replace(/\{\{board\}\}/g, 'Matriculation')
    .replace(/\{\{ss_no\}\}/g, '1234')
    .replace(/\{\{unsubscribe_url\}\}/g, '#');

  // Open the rendered email in a new window and trigger the print dialog
  // (the user chooses "Save as PDF") — a crisp, true-to-recipient proof.
  const downloadPdf = () => {
    const w = window.open('', '_blank');
    if (!w) { toast({ title: 'Allow pop-ups', description: 'Enable pop-ups to download / print the proof.', variant: 'destructive' }); return; }
    w.document.open();
    w.document.write(previewHtml);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 600);
  };

  const save = async (submitForApproval = false) => {
    if (!form.name || !form.subject || !form.body_html) {
      toast({ title: 'Required fields missing', description: 'Name, subject and body are required.', variant: 'destructive' });
      return;
    }
    setSaving(true);
    const payload = {
      ...form,
      status: submitForApproval ? 'pending_approval' : 'draft',
      created_by: profile?.id,
    };
    let templateId = id;
    if (isEdit) {
      const { error } = await supabase.from('email_templates').update(payload).eq('id', id!);
      if (error) { toast({ title: 'Error', description: error.message, variant: 'destructive' }); setSaving(false); return; }
    } else {
      const { data, error } = await supabase.from('email_templates').insert(payload).select('id').single();
      if (error) { toast({ title: 'Error', description: error.message, variant: 'destructive' }); setSaving(false); return; }
      templateId = data.id;
    }
    await supabase.from('template_approval_log').insert({
      template_id: templateId,
      action: submitForApproval ? 'submitted' : (isEdit ? 'edited' : 'created'),
      actor_id: profile?.id,
    });
    toast({ title: submitForApproval ? 'Submitted for approval' : 'Template saved' });
    setSaving(false);
    navigate('/prospect/templates');
  };

  const insertVariable = (v: string) => {
    setForm(f => ({ ...f, body_html: f.body_html + v }));
  };

  return (
    <ProspectLayout>
      <div className="max-w-6xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{isEdit ? 'Edit Template' : 'New Email Template'}</h1>
            <p className="text-base text-gray-500 mt-1">Build your email template. Use variables to personalise for each school.</p>
          </div>
          <div className="flex gap-3">
            <Button variant="outline" size="lg" onClick={() => navigate('/prospect/templates')}>Cancel</Button>
            <Button variant="outline" size="lg" onClick={() => save(false)} disabled={saving}>
              <Save className="h-4 w-4 mr-2" />{saving ? 'Saving…' : 'Save Draft'}
            </Button>
            <Button size="lg" onClick={() => save(true)} disabled={submitting}>
              <Send className="h-4 w-4 mr-2" />Submit for Approval
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left: form */}
          <div className="space-y-5">
            <div className="bg-white rounded-2xl border border-gray-200 p-6 space-y-5">
              <h2 className="font-semibold text-gray-800 text-base">Template Details</h2>
              <div className="space-y-2">
                <Label className="text-sm font-semibold text-gray-700">Template Name *</Label>
                <Input className="h-11 text-base" placeholder="e.g. iPlus 2026 Launch Announcement"
                  value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label className="text-sm font-semibold text-gray-700">Category</Label>
                <Select value={form.category} onValueChange={v => setForm(f => ({ ...f, category: v }))}>
                  <SelectTrigger className="h-11 text-base"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map(c => <SelectItem key={c} value={c} className="text-base">{c.charAt(0).toUpperCase() + c.slice(1)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label className="text-sm font-semibold text-gray-700">Description</Label>
                <Input className="h-11 text-base" placeholder="Internal note about this template"
                  value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label className="text-sm font-semibold text-gray-700">Email Subject Line *</Label>
                <Input className="h-11 text-base" placeholder="Subject shown in inbox"
                  value={form.subject} onChange={e => setForm(f => ({ ...f, subject: e.target.value }))} />
              </div>
            </div>

            {/* Variables */}
            <div className="bg-white rounded-2xl border border-gray-200 p-6">
              <h2 className="font-semibold text-gray-800 text-base mb-3">Insert Variable</h2>
              <p className="text-sm text-gray-500 mb-4">Click to insert into body. Each school's data fills these automatically.</p>
              <div className="flex flex-wrap gap-2">
                {VARIABLES.map(v => (
                  <button key={v} onClick={() => insertVariable(v)}
                    className="px-3 py-1.5 bg-indigo-50 text-indigo-700 rounded-lg text-sm font-mono font-medium hover:bg-indigo-100 transition-colors">
                    {v}
                  </button>
                ))}
              </div>
            </div>

            {/* HTML editor */}
            <div className="bg-white rounded-2xl border border-gray-200 p-6">
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-semibold text-gray-800 text-base flex items-center gap-2">
                  <Code className="h-4 w-4" /> HTML Body *
                </h2>
                <button onClick={() => setPreview(v => !v)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${preview ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                  <Eye className="h-4 w-4" /> {preview ? 'Edit' : 'Preview'}
                </button>
              </div>
              {!preview ? (
                <Textarea
                  className="font-mono text-sm leading-relaxed min-h-[400px] resize-y"
                  value={form.body_html}
                  onChange={e => setForm(f => ({ ...f, body_html: e.target.value }))}
                />
              ) : (
                <div className="border border-gray-200 rounded-xl overflow-hidden min-h-[400px]">
                  <div className="bg-gray-50 px-4 py-2 text-xs text-gray-400 border-b border-gray-200 font-medium">
                    PREVIEW — Sample data substituted
                  </div>
                  <iframe
                    srcDoc={previewHtml}
                    className="w-full min-h-[380px] border-0"
                    title="Email preview"
                    sandbox="allow-same-origin"
                  />
                </div>
              )}
            </div>
          </div>

          {/* Right: live preview */}
          <div className="hidden lg:block">
            <div className="sticky top-6">
              <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
                <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
                  <span className="font-semibold text-gray-800">Live Preview</span>
                  <span className="text-sm text-gray-400">Sample school data</span>
                </div>
                <div className="p-4 bg-gray-50 border-b border-gray-100 space-y-1">
                  <p className="text-sm"><span className="text-gray-400 w-16 inline-block">From:</span> <span className="text-gray-700 font-medium">iPlus Olympiads &lt;olympiad@iplusedu.in&gt;</span></p>
                  <p className="text-sm"><span className="text-gray-400 w-16 inline-block">To:</span> <span className="text-gray-700">school@abcschool.com</span></p>
                  <p className="text-sm"><span className="text-gray-400 w-16 inline-block">Subject:</span> <span className="text-gray-700 font-medium">{form.subject || '(no subject)'}</span></p>
                </div>
                <iframe
                  srcDoc={previewHtml}
                  className="w-full min-h-[500px] border-0"
                  title="Live preview"
                  sandbox="allow-same-origin"
                />
                <div className="px-5 py-3 border-t border-gray-100">
                  <Button variant="outline" className="w-full" onClick={downloadPdf}>
                    <Download className="h-4 w-4 mr-2" /> Download PDF (print proof)
                  </Button>
                  <p className="text-[11px] text-gray-400 mt-1.5 text-center">Opens the email and your print dialog — choose “Save as PDF”.</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </ProspectLayout>
  );
}
