import { useState, useEffect } from "react";
import DOMPurify from "dompurify";
import Navbar from "@/components/layout/Navbar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Mail, MessageSquare, Plus, CheckCircle2, AlertCircle, Edit2, Trash2, Workflow, Megaphone } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useActiveProject, useOlympiadProjects } from "@/hooks/useOlympiadProjects";
import { useCommunicationTemplates, CommunicationTemplate } from "@/hooks/useCommunicationTemplates";
import { useWhatsAppTemplates, WhatsAppTemplate } from "@/hooks/useWhatsAppTemplates";
import { useToast } from "@/hooks/use-toast";
import {
  WHATSAPP_VARIABLE_SOURCES, WHATSAPP_TEMPLATE_TYPES, WHATSAPP_LANGUAGE_CODES,
  typeNeedsVariables,
} from "@/utils/whatsappVariableSources";

// ── Workflow template definitions (key = same for email + WA) ──────────────
const WORKFLOW_KEYS = [
  { key: "interest_acknowledged",        name: "Interest Acknowledged",        trigger: "Registration Interest → Interested (WA only)" },
  { key: "registration_confirmed",       name: "Registration Confirmed",       trigger: "Registration Status → Confirmed" },
  { key: "payment_received",             name: "Payment Confirmed",            trigger: "Payment Status → Received" },
  { key: "payment_partial",              name: "Payment Partial",              trigger: "Payment Status → Partial (WA only)" },
  { key: "name_list_received",           name: "Name List Received",           trigger: "Name List Status → Received" },
  { key: "question_paper_sent_wa",       name: "Question Papers Sent",         trigger: "Question Paper Sent → Sent" },
  { key: "answer_sheet_received_wa",     name: "Answer Sheets Received",       trigger: "Answer Sheet Status → Received" },
  { key: "result_sent_wa",               name: "Results Dispatched",           trigger: "Result Status → Sent" },
  { key: "portal_registration_approved", name: "Portal Access Approved",       trigger: "Portal Registration → Approved" },
  { key: "portal_registration_rejected", name: "Portal Registration Rejected", trigger: "Portal Registration → Rejected" },
  { key: "exam_slot_confirmed",          name: "Exam Slot Confirmed",          trigger: "School selects exam slot" },
];

type Category = "workflow" | "marketing";

const EMAIL_DEFAULTS: Record<string, { subject: string; body: string }> = {
  interest_acknowledged: {
    subject: "Thank You for Your Interest — {project_name} {project_year}",
    body: `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#f4f4f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background-color:#f4f4f7;">
  <tr><td align="center" style="padding:20px 10px;">
    <table width="600" cellpadding="0" cellspacing="0" role="presentation" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">

      <!-- Header -->
      <tr><td style="background:linear-gradient(135deg,#7C3AED 0%,#4F46E5 100%);padding:40px 32px 36px;text-align:center;">
        <div style="font-size:11px;font-weight:600;letter-spacing:3px;color:rgba(255,255,255,0.7);text-transform:uppercase;margin-bottom:16px;">iPlus Olympiads</div>
        <div style="font-size:30px;font-weight:700;color:#ffffff;line-height:1.25;margin-bottom:12px;">Thank You for<br/>Your Interest!</div>
        <div style="font-size:13px;color:rgba(255,255,255,0.8);font-style:italic;">Ignite Genius. Inspire Excellence.</div>
      </td></tr>

      <!-- Status banner -->
      <tr><td style="background:#f5f3ff;border-bottom:1px solid #ede9fe;padding:12px 32px;text-align:center;">
        <span style="font-size:11px;font-weight:700;letter-spacing:2px;color:#4F46E5;text-transform:uppercase;">&#10003;&nbsp;&nbsp;INTEREST ACKNOWLEDGED</span>
      </td></tr>

      <!-- Body -->
      <tr><td style="padding:32px 32px 8px;">
        <p style="margin:0 0 16px;font-size:16px;font-weight:700;color:#1a1a2e;">Dear {contact_person},</p>
        <p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#374151;">Thank you for expressing your interest in <strong>{project_name} {project_year}</strong>. We are delighted to have <strong>{school_name}</strong> as part of India's No. 1 Progressive Olympiad platform.</p>
        <p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#374151;">Every participant receives a <strong>skill-based analytical report</strong> with individual strengths, areas for improvement, and rankings at school and national level. Students also earn medals, merit certificates, and national recognition.</p>
      </td></tr>

      <!-- Details card -->
      <tr><td style="padding:8px 32px 16px;">
        <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="border:1px solid #e5e7eb;border-left:3px solid #4F46E5;border-radius:8px;overflow:hidden;">
          <tr><td style="padding:16px 20px;">
            <div style="font-size:10px;font-weight:700;letter-spacing:2px;color:#4F46E5;text-transform:uppercase;margin-bottom:12px;">Interest Details</div>
            <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
              <tr>
                <td style="padding:5px 0;font-size:13px;color:#6b7280;width:35%;">School</td>
                <td style="padding:5px 0;font-size:13px;font-weight:600;color:#111827;">{school_name}</td>
              </tr>
              <tr>
                <td style="padding:5px 0;font-size:13px;color:#6b7280;">SS No.</td>
                <td style="padding:5px 0;font-size:13px;font-weight:600;color:#111827;">{ss_no}</td>
              </tr>
              <tr>
                <td style="padding:5px 0;font-size:13px;color:#6b7280;">Programme</td>
                <td style="padding:5px 0;font-size:13px;font-weight:600;color:#111827;">{project_name} {project_year}</td>
              </tr>
              <tr>
                <td style="padding:5px 0;font-size:13px;color:#6b7280;">District</td>
                <td style="padding:5px 0;font-size:13px;font-weight:600;color:#111827;">{district}, {state}</td>
              </tr>
            </table>
          </td></tr>
        </table>
      </td></tr>

      <!-- Body continued -->
      <tr><td style="padding:8px 32px 24px;">
        <p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#374151;">Our team will be in touch shortly to guide you through the registration process. The registration deadline is <strong>20 August 2026</strong>. In the meantime, please ensure your student data is ready for submission.</p>
      </td></tr>

      <!-- CTA -->
      <tr><td style="padding:0 32px 32px;text-align:center;">
        <a href="https://iplusedu.in/school/register" style="display:inline-block;background:linear-gradient(135deg,#7C3AED 0%,#4F46E5 100%);color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;padding:14px 32px;border-radius:8px;">Register Your School &rarr;</a>
      </td></tr>

      <!-- Footer -->
      <tr><td style="background:#f9fafb;border-top:1px solid #e5e7eb;padding:24px 32px;text-align:center;">
        <div style="font-size:14px;font-weight:600;color:#4F46E5;margin-bottom:6px;">iPlus Olympiads</div>
        <div style="font-size:12px;color:#6b7280;line-height:1.8;">
          Ivar Pro Learn for Universal Success Pvt. Ltd.<br/>
          115, GST Road, Guduvancheri, Chennai 603 202<br/>
          <a href="mailto:support@iplusedu.in" style="color:#4F46E5;text-decoration:none;">support@iplusedu.in</a>&nbsp;|&nbsp;<a href="tel:+918111066556" style="color:#4F46E5;text-decoration:none;">+91 81110 66556</a>
        </div>
        <div style="font-size:11px;color:#9ca3af;margin-top:10px;">&copy; 2026 iPlus Olympiads. All rights reserved.</div>
      </td></tr>

    </table>
  </td></tr>
</table>
</body>
</html>`,
  },
};

function StatusPill({ active, label }: { active: boolean | null; label: string }) {
  if (active === null) return (
    <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
      <AlertCircle className="h-3 w-3" /> Not set
    </span>
  );
  return active ? (
    <span className="inline-flex items-center gap-1 text-[11px] text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full font-medium">
      <CheckCircle2 className="h-3 w-3" /> Active
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-[11px] text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full">
      <AlertCircle className="h-3 w-3" /> Inactive
    </span>
  );
}

export default function TemplateManagement() {
  const { toast } = useToast();
  const { data: activeProject } = useActiveProject();
  const { data: projects = [] } = useOlympiadProjects();
  const [projectId, setProjectId] = useState(activeProject?.id || "");
  const [category, setCategory] = useState<Category>("workflow");
  const [editKey, setEditKey] = useState<string | null>(null);
  const [editName, setEditName] = useState<string>("");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [newMarketingKey, setNewMarketingKey] = useState("");

  // Local form state for email
  const [emailSubject, setEmailSubject] = useState("");
  const [emailBody, setEmailBody] = useState("");
  const [emailActive, setEmailActive] = useState(true);
  const [emailId, setEmailId] = useState<string | null>(null);
  const [emailPreview, setEmailPreview] = useState(false);

  // Local form state for WA
  const [waAskevaName, setWaAskevaName] = useState("");
  const [waLang, setWaLang] = useState("en");
  const [waType, setWaType] = useState("text");
  const [waActive, setWaActive] = useState(true);
  const [waId, setWaId] = useState<string | null>(null);

  const { templates: emailTemplates, loading: emailLoading, fetchTemplates: refetchEmail } =
    useCommunicationTemplates(projectId, category);
  const { templates: waTemplates, loading: waLoading, fetchTemplates: refetchWA, deleteTemplate: deleteWaTemplate } =
    useWhatsAppTemplates(projectId, category);

  useEffect(() => {
    if (activeProject?.id && !projectId) setProjectId(activeProject.id);
  }, [activeProject]);

  // Build list of rows to show
  const rows = category === "workflow"
    ? WORKFLOW_KEYS.map(def => {
        const email = emailTemplates.find(t => t.template_type === def.key) ?? null;
        const wa    = waTemplates.find(t => t.template_key === def.key) ?? null;
        return { key: def.key, name: def.name, trigger: def.trigger, email, wa };
      })
    : (() => {
        const keys = new Set([
          ...emailTemplates.map(t => t.template_type),
          ...waTemplates.map(t => t.template_key),
        ]);
        return [...keys].map(key => {
          const email = emailTemplates.find(t => t.template_type === key) ?? null;
          const wa    = waTemplates.find(t => t.template_key === key) ?? null;
          const name  = email?.template_name || wa?.template_name || key;
          return { key, name, trigger: "", email, wa };
        });
      })();

  const openEdit = (key: string, name: string, email: CommunicationTemplate | null, wa: WhatsAppTemplate | null) => {
    const defaults = !email ? EMAIL_DEFAULTS[key] : undefined;
    setEditKey(key);
    setEditName(name);
    setEmailSubject(email?.subject || defaults?.subject || "");
    setEmailBody(email?.email_body || defaults?.body || "");
    setEmailActive(email?.is_active ?? true);
    setEmailId(email?.id || null);
    setEmailPreview(false);
    setWaAskevaName(wa?.askeva_template_name || "");
    setWaLang(wa?.language_code || "en");
    setWaType(wa?.template_type || "text");
    setWaActive(wa?.is_active ?? true);
    setWaId(wa?.id || null);
    setSheetOpen(true);
  };

  const openNew = () => {
    setEditKey(null);
    setEditName("");
    setEmailSubject(""); setEmailBody(""); setEmailActive(true); setEmailId(null);
    setWaAskevaName(""); setWaLang("en"); setWaType("text"); setWaActive(true); setWaId(null);
    setEmailPreview(false);
    setSheetOpen(true);
  };

  const handleDelete = async (email: CommunicationTemplate | null, wa: WhatsAppTemplate | null, name: string) => {
    if (!window.confirm(`Delete template "${name}"? This cannot be undone.`)) return;
    if (email?.id) {
      const { error } = await supabase.from("communication_templates").delete().eq("id", email.id);
      if (error) { toast({ title: "Error deleting email template", description: error.message, variant: "destructive" }); return; }
    }
    if (wa?.id) {
      await deleteWaTemplate(wa.id);
    }
    if (!wa?.id) toast({ title: "Template deleted" });
    refetchEmail();
    refetchWA();
  };

  const { data: { user } } = { data: { user: null as any } };

  const saveEmail = async () => {
    if (!emailSubject.trim() || !emailBody.trim()) return;
    const key = editKey || newMarketingKey.trim();
    if (!key) return;
    const { data: { user: u } } = await supabase.auth.getUser();
    const payload = {
      project_id: projectId,
      template_type: key,
      template_name: editName || key,
      subject: emailSubject,
      email_body: emailBody,
      is_active: emailActive,
      template_category: category,
    };
    if (emailId) {
      await supabase.from("communication_templates").update(payload).eq("id", emailId);
    } else {
      await supabase.from("communication_templates").insert({ ...payload, created_by: u?.id });
    }
  };

  const saveWA = async () => {
    if (!waAskevaName.trim()) return;
    const key = editKey || newMarketingKey.trim();
    if (!key) return;
    const { data: { user: u } } = await supabase.auth.getUser();
    const payload = {
      project_id: projectId,
      template_key: key,
      template_name: editName || key,
      askeva_template_name: waAskevaName,
      language_code: waLang,
      template_type: waType,
      is_active: waActive,
      body_variables: [],
      template_category: category,
    };
    if (waId) {
      await supabase.from("whatsapp_templates").update(payload).eq("id", waId);
    } else {
      await supabase.from("whatsapp_templates").insert({ ...payload, created_by: (await supabase.auth.getUser()).data.user?.id });
    }
  };

  const handleSave = async () => {
    const key = editKey || newMarketingKey.trim();
    if (!key) { toast({ title: "Error", description: "Template key is required", variant: "destructive" }); return; }
    setSaving(true);
    try {
      const tasks: Promise<any>[] = [];
      if (emailSubject.trim() && emailBody.trim()) tasks.push(saveEmail());
      if (waAskevaName.trim()) tasks.push(saveWA());
      await Promise.all(tasks);
      await Promise.all([refetchEmail(), refetchWA()]);
      setSheetOpen(false);
      if (category === "marketing") setNewMarketingKey("");
      toast({ title: "Saved", description: "Template updated successfully." });
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const displayKey = editKey || newMarketingKey;

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Template Management</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Each template name is shared across Email and WhatsApp — configure both channels in one place.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Select value={projectId} onValueChange={setProjectId}>
              <SelectTrigger className="w-52">
                <SelectValue placeholder="Select project" />
              </SelectTrigger>
              <SelectContent>
                {projects.map(p => (
                  <SelectItem key={p.id} value={p.id}>{p.project_name} ({p.project_year})</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Category toggle */}
        <div className="flex items-center gap-2 mb-6">
          <button
            onClick={() => setCategory("workflow")}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors border ${
              category === "workflow"
                ? "bg-indigo-600 text-white border-indigo-600"
                : "bg-white text-muted-foreground border-border hover:border-indigo-300 hover:text-indigo-600"
            }`}
          >
            <Workflow className="h-3.5 w-3.5" /> Workflow Templates
          </button>
          <button
            onClick={() => setCategory("marketing")}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors border ${
              category === "marketing"
                ? "bg-orange-500 text-white border-orange-500"
                : "bg-white text-muted-foreground border-border hover:border-orange-300 hover:text-orange-600"
            }`}
          >
            <Megaphone className="h-3.5 w-3.5" /> Templates
          </button>
          {category === "marketing" && (
            <Button size="sm" onClick={openNew} className="ml-auto flex items-center gap-1.5">
              <Plus className="h-3.5 w-3.5" /> New Template
            </Button>
          )}
        </div>

        {/* Context hint */}
        <div className={`mb-4 px-4 py-2.5 rounded-lg text-xs ${
          category === "workflow"
            ? "bg-indigo-50 text-indigo-700 border border-indigo-100"
            : "bg-orange-50 text-orange-700 border border-orange-100"
        }`}>
          {category === "workflow"
            ? "Workflow templates are sent automatically when a school's status changes. Set up the Email body and/or WhatsApp AskEVA template name for each trigger."
            : "Templates used for bulk messaging — announcements, updates, reminders. They never appear in workflow automation."}
        </div>

        {/* Template table */}
        {(emailLoading || waLoading) ? (
          <div className="text-sm text-muted-foreground py-8 text-center">Loading templates…</div>
        ) : (
          <div className="rounded-xl border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 border-b">
                <tr>
                  <th className="text-left px-4 py-3 font-semibold text-muted-foreground text-xs uppercase tracking-wider">Template Name</th>
                  {category === "workflow" && (
                    <th className="text-left px-4 py-3 font-semibold text-muted-foreground text-xs uppercase tracking-wider hidden md:table-cell">Auto-triggers when</th>
                  )}
                  <th className="text-center px-4 py-3 font-semibold text-muted-foreground text-xs uppercase tracking-wider w-24">
                    <Mail className="h-3.5 w-3.5 inline mr-1" />Email
                  </th>
                  <th className="text-center px-4 py-3 font-semibold text-muted-foreground text-xs uppercase tracking-wider w-28">
                    <MessageSquare className="h-3.5 w-3.5 inline mr-1 text-green-600" />WhatsApp
                  </th>
                  <th className="w-20" />
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.length === 0 ? (
                  <tr><td colSpan={5} className="px-4 py-10 text-center text-muted-foreground text-sm">
                    No templates yet. Click <strong>+ New Template</strong> to create one.
                  </td></tr>
                ) : rows.map(row => (
                  <tr key={row.key} className="hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-3">
                      <div className="font-medium text-foreground">{row.name}</div>
                      <div className="text-[11px] text-muted-foreground font-mono mt-0.5">{row.key}</div>
                    </td>
                    {category === "workflow" && (
                      <td className="px-4 py-3 text-xs text-muted-foreground hidden md:table-cell">{row.trigger}</td>
                    )}
                    <td className="px-4 py-3 text-center">
                      <StatusPill active={row.email ? row.email.is_active : null} label="email" />
                    </td>
                    <td className="px-4 py-3 text-center">
                      <StatusPill active={row.wa ? row.wa.is_active : null} label="wa" />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-xs"
                          onClick={() => openEdit(row.key, row.name, row.email, row.wa)}
                        >
                          <Edit2 className="h-3.5 w-3.5 mr-1" />
                          {row.email || row.wa ? "Edit" : "Setup"}
                        </Button>
                        {(row.email || row.wa) && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 w-7 p-0 text-red-400 hover:text-red-600 hover:bg-red-50"
                            onClick={() => handleDelete(row.email, row.wa, row.name)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Edit Sheet */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent className="w-full sm:max-w-2xl overflow-y-auto" side="right">
          <SheetHeader className="mb-4">
            <SheetTitle>{editKey ? `Edit: ${editKey === displayKey ? "" : ""}${rows.find(r => r.key === editKey)?.name || editKey}` : "New Template"}</SheetTitle>
            <SheetDescription>
              Configure the Email and/or WhatsApp message for this template. Both share the same key so they trigger together.
            </SheetDescription>
          </SheetHeader>

          {/* New marketing template: key input */}
          {!editKey && category === "marketing" && (
            <div className="mb-5 space-y-1.5">
              <Label>Template Name & Key</Label>
              <Input
                placeholder="e.g. Olympiad Launch 2026"
                value={editName}
                onChange={e => {
                  setEditName(e.target.value);
                  setNewMarketingKey(e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/_+$/, ''));
                }}
              />
              {newMarketingKey && (
                <p className="text-[11px] text-muted-foreground font-mono">Key: {newMarketingKey}</p>
              )}
            </div>
          )}

          <Tabs defaultValue="email">
            <TabsList className="w-full mb-5">
              <TabsTrigger value="email" className="flex-1 flex items-center gap-1.5">
                <Mail className="h-3.5 w-3.5" /> Email
                {emailId && <CheckCircle2 className="h-3 w-3 text-emerald-500" />}
              </TabsTrigger>
              <TabsTrigger value="whatsapp" className="flex-1 flex items-center gap-1.5">
                <MessageSquare className="h-3.5 w-3.5 text-green-600" /> WhatsApp
                {waId && <CheckCircle2 className="h-3 w-3 text-emerald-500" />}
              </TabsTrigger>
            </TabsList>

            {/* ── Email tab ── */}
            <TabsContent value="email" className="space-y-4">
              <div className="flex items-center justify-between">
                <Label className="text-base font-semibold">Email Content</Label>
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-muted-foreground">Active</span>
                  <Switch checked={emailActive} onCheckedChange={setEmailActive} />
                </div>
              </div>
              <div>
                <Label className="mb-1.5 block">Subject Line</Label>
                <Input
                  value={emailSubject}
                  onChange={e => setEmailSubject(e.target.value)}
                  placeholder="e.g. Your Registration is Confirmed — iPlus Olympiads {project_year}"
                />
              </div>
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <Label>Email Body (HTML)</Label>
                  <button
                    type="button"
                    className="text-xs text-indigo-600 hover:underline"
                    onClick={() => setEmailPreview(v => !v)}
                  >
                    {emailPreview ? "← Back to editor" : "Preview"}
                  </button>
                </div>
                {emailPreview ? (
                  <div
                    className="border rounded-lg p-4 bg-white max-h-96 overflow-y-auto text-sm"
                    dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(emailBody) }}
                  />
                ) : (
                  <Textarea
                    value={emailBody}
                    onChange={e => setEmailBody(e.target.value)}
                    rows={14}
                    className="font-mono text-xs"
                    placeholder="Paste your HTML email body here…"
                  />
                )}
              </div>
              <div className="text-xs text-muted-foreground bg-muted rounded-lg px-3 py-2">
                Available variables: <span className="font-mono">{"{school_name}"} {"{ss_no}"} {"{contact_person}"} {"{project_name}"} {"{project_year}"} {"{student_count}"} {"{payment_amount}"} {"{district}"} {"{state}"}</span>
              </div>
            </TabsContent>

            {/* ── WhatsApp tab ── */}
            <TabsContent value="whatsapp" className="space-y-4">
              <div className="flex items-center justify-between">
                <Label className="text-base font-semibold">WhatsApp (AskEVA)</Label>
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-muted-foreground">Active</span>
                  <Switch checked={waActive} onCheckedChange={setWaActive} />
                </div>
              </div>
              <div className="bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 text-xs text-amber-800">
                WhatsApp templates must first be approved by Meta/AskEVA. Enter the exact template name from your AskEVA dashboard after approval.
              </div>
              <div>
                <Label className="mb-1.5 block">AskEVA Template Name</Label>
                <Input
                  value={waAskevaName}
                  onChange={e => setWaAskevaName(e.target.value)}
                  placeholder="Exact name from AskEVA dashboard"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="mb-1.5 block">Language</Label>
                  <Select value={waLang} onValueChange={setWaLang}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {WHATSAPP_LANGUAGE_CODES.map(l => (
                        <SelectItem key={l.code} value={l.code}>{l.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="mb-1.5 block">Message Type</Label>
                  <Select value={waType} onValueChange={setWaType}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {WHATSAPP_TEMPLATE_TYPES.map(t => (
                        <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="text-xs text-muted-foreground bg-muted rounded-lg px-3 py-2">
                Body variables and media headers can be configured after saving via the advanced WhatsApp Templates editor in Admin → Templates.
              </div>
            </TabsContent>
          </Tabs>

          <div className="flex gap-3 mt-6 pt-4 border-t">
            <Button variant="outline" onClick={() => setSheetOpen(false)} className="flex-1">
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving} className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white">
              {saving ? "Saving…" : "Save Template"}
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
