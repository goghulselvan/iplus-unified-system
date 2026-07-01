import { useState, useEffect } from "react";
import Navbar from "@/components/layout/Navbar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { Mail, MessageSquare, Send, Download, Eye, AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import DOMPurify from "dompurify";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useActiveProject } from "@/hooks/useOlympiadProjects";
import { useCommunicationTemplates } from "@/hooks/useCommunicationTemplates";
import { useWhatsAppTemplates } from "@/hooks/useWhatsAppTemplates";
import { useBulkEmailSend } from "@/hooks/useBulkEmailSend";
import { useBulkWhatsAppSend } from "@/hooks/useBulkWhatsAppSend";
import { downloadCSV } from "@/utils/csvExport";

interface School {
  id: string;
  school_name: string;
  district: string;
  email: string | null;
  mobile1: string | null;
  registration_status: string | null;
  payment_status: string | null;
}

const REG_STATUSES = ["Pending", "Confirmed", "In Progress"] as const;
const PAY_STATUSES = ["Pending", "Partial", "Received"] as const;

export default function MarketingMessages() {
  const { toast } = useToast();
  const { data: activeProject } = useActiveProject();
  const projectId = activeProject?.id;

  // Channel & template selection (can select both)
  const [sendEmail, setSendEmail] = useState(true);
  const [sendWhatsApp, setSendWhatsApp] = useState(false);
  const [emailTemplateType, setEmailTemplateType] = useState<string>("");
  const [waTemplateKey, setWaTemplateKey] = useState<string>("");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewChannel, setPreviewChannel] = useState<"email" | "whatsapp">("email");

  // Filter state
  const [districts, setDistricts] = useState<string[]>([]);
  const [districtOptions, setDistrictOptions] = useState<string[]>([]);
  const [regStatuses, setRegStatuses] = useState<string[]>([]);
  const [payStatuses, setPayStatuses] = useState<string[]>([]);
  const [requireContact, setRequireContact] = useState(true);
  const [matched, setMatched] = useState<School[]>([]);
  const [previewLoading, setPreviewLoading] = useState(false);

  // Send state
  const [confirmOpen, setConfirmOpen] = useState(false);
  const emailSend = useBulkEmailSend();
  const whatsappSend = useBulkWhatsAppSend();

  // Load templates
  const { templates: emailTemplates } = useCommunicationTemplates(projectId, "marketing");
  const { templates: waTemplates } = useWhatsAppTemplates(projectId, "marketing");

  // Load district options
  useEffect(() => {
    if (!projectId) return;
    supabase
      .from("school_project_workflow")
      .select("schools(district)")
      .eq("project_id", projectId)
      .then(({ data }) => {
        const opts = [...new Set((data ?? []).map((r: any) => r.schools?.district).filter(Boolean))].sort() as string[];
        setDistrictOptions(opts);
      });
  }, [projectId]);

  // Get current templates
  const currentEmailTemplate = emailTemplates.find(t => t.template_type === emailTemplateType);
  const currentWaTemplate = waTemplates.find(t => t.template_key === waTemplateKey);

  const toggle = (arr: string[], val: string, set: (a: string[]) => void) =>
    set(arr.includes(val) ? arr.filter(x => x !== val) : [...arr, val]);

  // Build recipient list
  const buildPreview = async () => {
    if (!projectId) return;
    setPreviewLoading(true);
    let q = supabase
      .from("school_project_workflow")
      .select("schools(id,school_name,district,email,mobile1,registration_status,payment_status)")
      .eq("project_id", projectId);

    if (regStatuses.length) q = q.in("registration_status", regStatuses);
    if (payStatuses.length) q = q.in("payment_status", payStatuses);

    const { data } = await q;
    let schools = (data ?? []).map((r: any) => r.schools).filter(Boolean) as School[];
    if (districts.length) schools = schools.filter(s => districts.includes(s.district));

    // Filter by contact availability
    if (requireContact) {
      if (sendEmail && sendWhatsApp) {
        schools = schools.filter(s => s.email || s.mobile1); // Either is fine if sending both
      } else if (sendEmail) {
        schools = schools.filter(s => s.email);
      } else if (sendWhatsApp) {
        schools = schools.filter(s => s.mobile1);
      }
    }

    setMatched(schools);
    setPreviewLoading(false);
  };

  const handleSend = async () => {
    if (matched.length === 0) return;

    const tasks: Promise<any>[] = [];

    if (sendEmail && emailTemplateType) {
      tasks.push(emailSend.run(matched, emailTemplateType));
    }

    if (sendWhatsApp && waTemplateKey) {
      tasks.push(whatsappSend.run(matched, waTemplateKey));
    }

    const [emailResult, waResult] = await Promise.all(tasks);

    const summary = [];
    if (sendEmail && emailResult) summary.push(`Email: ${emailResult.sent} sent, ${emailResult.failed} failed`);
    if (sendWhatsApp && waResult) summary.push(`WhatsApp: ${waResult.sent} sent, ${waResult.failed} failed`);

    toast({ title: "Campaign Complete", description: summary.join(" | ") });
    setConfirmOpen(false);
  };

  const templatesReady = (sendEmail && emailTemplateType) || (sendWhatsApp && waTemplateKey);
  const totalMatchedCount = matched.length;
  const pageSize = 50;
  const displayedSchools = matched.slice(0, pageSize);
  const remainingCount = matched.length - pageSize;

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-foreground">Bulk Messaging</h1>
          <p className="text-muted-foreground mt-1">
            Send bulk emails and WhatsApp messages to registered CRM schools. For outreach to all prospect schools, use the Prospect Schools module.
          </p>
        </div>

        {/* ═══ STEP 1: Channel & Template ═══ */}
        <Card className="mb-6 border-2 border-indigo-200 bg-indigo-50/30">
          <CardHeader>
            <div className="flex items-center gap-3">
              <Badge className="bg-indigo-600 text-white text-base h-8 w-8 flex items-center justify-center rounded-full">
                1
              </Badge>
              <div>
                <CardTitle>Select Channels & Templates</CardTitle>
                <CardDescription>Choose which channels to use and pick your templates</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Channel selection (checkboxes for both) */}
            <div>
              <Label className="text-base font-semibold mb-3 block">Channels</Label>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Checkbox id="send-email" checked={sendEmail} onCheckedChange={v => setSendEmail(!!v)} />
                  <Label htmlFor="send-email" className="flex items-center gap-2 cursor-pointer text-base font-medium">
                    <Mail className="h-4 w-4 text-indigo-600" /> Email
                  </Label>
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox id="send-wa" checked={sendWhatsApp} onCheckedChange={v => setSendWhatsApp(!!v)} />
                  <Label htmlFor="send-wa" className="flex items-center gap-2 cursor-pointer text-base font-medium">
                    <MessageSquare className="h-4 w-4 text-green-600" /> WhatsApp
                  </Label>
                </div>
              </div>
            </div>

            {/* Email template selection */}
            {sendEmail && (
              <div className="p-4 bg-indigo-50 rounded-lg border border-indigo-200 space-y-3">
                <Label className="text-sm font-semibold">Email Template</Label>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
                  <div className="md:col-span-2">
                    <select
                      value={emailTemplateType}
                      onChange={e => setEmailTemplateType(e.target.value)}
                      className="w-full h-10 px-3 rounded-md border border-input bg-white"
                    >
                      <option value="">-- Select email template --</option>
                      {emailTemplates.map(t => (
                        <option key={t.id} value={t.template_type}>
                          {t.template_name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <Button
                    onClick={() => {
                      setPreviewChannel("email");
                      setPreviewOpen(true);
                    }}
                    disabled={!emailTemplateType}
                    variant="outline"
                    className="h-10"
                  >
                    <Eye className="h-4 w-4 mr-1" /> Preview
                  </Button>
                </div>
                {emailTemplateType && <p className="text-xs text-indigo-700">✓ {currentEmailTemplate?.template_name}</p>}
              </div>
            )}

            {/* WhatsApp template selection */}
            {sendWhatsApp && (
              <div className="p-4 bg-green-50 rounded-lg border border-green-200 space-y-3">
                <Label className="text-sm font-semibold">WhatsApp Template</Label>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
                  <div className="md:col-span-2">
                    <select
                      value={waTemplateKey}
                      onChange={e => setWaTemplateKey(e.target.value)}
                      className="w-full h-10 px-3 rounded-md border border-input bg-white"
                    >
                      <option value="">-- Select WhatsApp template --</option>
                      {waTemplates.map(t => (
                        <option key={t.id} value={t.template_key}>
                          {t.template_name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <Button
                    onClick={() => {
                      setPreviewChannel("whatsapp");
                      setPreviewOpen(true);
                    }}
                    disabled={!waTemplateKey}
                    variant="outline"
                    className="h-10"
                  >
                    <Eye className="h-4 w-4 mr-1" /> Preview
                  </Button>
                </div>
                {waTemplateKey && <p className="text-xs text-green-700">✓ {currentWaTemplate?.template_name}</p>}
              </div>
            )}
          </CardContent>
        </Card>

        {/* ═══ STEP 2: Filter Recipients ═══ */}
        <Card className="mb-6 border-2 border-amber-200 bg-amber-50/30">
          <CardHeader>
            <div className="flex items-center gap-3">
              <Badge className="bg-amber-600 text-white text-base h-8 w-8 flex items-center justify-center rounded-full">
                2
              </Badge>
              <div>
                <CardTitle>Filter Recipients</CardTitle>
                <CardDescription>Select which schools should receive this campaign</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {/* Districts */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <Label className="text-sm font-semibold">Districts</Label>
                  <div className="space-x-1">
                    <button
                      onClick={() => setDistricts([...districtOptions])}
                      className="text-xs text-indigo-600 hover:underline font-medium"
                    >
                      All
                    </button>
                    <span className="text-xs text-muted-foreground">•</span>
                    <button
                      onClick={() => setDistricts([])}
                      className="text-xs text-indigo-600 hover:underline font-medium"
                    >
                      Clear
                    </button>
                  </div>
                </div>
                <div className="space-y-1.5 max-h-48 overflow-y-auto pr-2 border rounded-lg p-2 bg-white">
                  {districtOptions.length === 0 ? (
                    <p className="text-xs text-muted-foreground py-2">No districts found</p>
                  ) : (
                    districtOptions.map(d => (
                      <div key={d} className="flex items-center gap-2">
                        <Checkbox id={`d-${d}`} checked={districts.includes(d)} onCheckedChange={() => toggle(districts, d, setDistricts)} />
                        <label htmlFor={`d-${d}`} className="text-sm cursor-pointer">
                          {d}
                        </label>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Registration Status */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <Label className="text-sm font-semibold">Registration Status</Label>
                  <div className="space-x-1">
                    <button
                      onClick={() => setRegStatuses([...REG_STATUSES])}
                      className="text-xs text-indigo-600 hover:underline font-medium"
                    >
                      All
                    </button>
                    <span className="text-xs text-muted-foreground">•</span>
                    <button
                      onClick={() => setRegStatuses([])}
                      className="text-xs text-indigo-600 hover:underline font-medium"
                    >
                      Clear
                    </button>
                  </div>
                </div>
                <div className="space-y-1.5 border rounded-lg p-2 bg-white">
                  {REG_STATUSES.map(s => (
                    <div key={s} className="flex items-center gap-2">
                      <Checkbox id={`rs-${s}`} checked={regStatuses.includes(s)} onCheckedChange={() => toggle(regStatuses, s, setRegStatuses)} />
                      <label htmlFor={`rs-${s}`} className="text-sm cursor-pointer">
                        {s}
                      </label>
                    </div>
                  ))}
                </div>
              </div>

              {/* Payment Status */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <Label className="text-sm font-semibold">Payment Status</Label>
                  <div className="space-x-1">
                    <button
                      onClick={() => setPayStatuses([...PAY_STATUSES])}
                      className="text-xs text-indigo-600 hover:underline font-medium"
                    >
                      All
                    </button>
                    <span className="text-xs text-muted-foreground">•</span>
                    <button
                      onClick={() => setPayStatuses([])}
                      className="text-xs text-indigo-600 hover:underline font-medium"
                    >
                      Clear
                    </button>
                  </div>
                </div>
                <div className="space-y-1.5 border rounded-lg p-2 bg-white">
                  {PAY_STATUSES.map(s => (
                    <div key={s} className="flex items-center gap-2">
                      <Checkbox id={`ps-${s}`} checked={payStatuses.includes(s)} onCheckedChange={() => toggle(payStatuses, s, setPayStatuses)} />
                      <label htmlFor={`ps-${s}`} className="text-sm cursor-pointer">
                        {s}
                      </label>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Contact requirement */}
            <div className="flex items-center gap-2 p-3 bg-white rounded-lg border">
              <Checkbox id="req-contact" checked={requireContact} onCheckedChange={v => setRequireContact(!!v)} />
              <label htmlFor="req-contact" className="text-sm cursor-pointer flex-1">
                Only schools with valid contact info (email {sendEmail ? "and/or" : "or"} mobile)
              </label>
            </div>

            {/* Action buttons */}
            <div className="flex items-center gap-3">
              <Button
                onClick={buildPreview}
                disabled={previewLoading || !templatesReady}
                className="bg-amber-600 hover:bg-amber-700 text-white"
              >
                {previewLoading ? "Loading..." : "Preview Recipients"}
              </Button>
              {totalMatchedCount > 0 && (
                <Badge variant="secondary" className="text-base px-3 py-1">
                  {totalMatchedCount} school{totalMatchedCount !== 1 ? "s" : ""} matched
                </Badge>
              )}
            </div>
          </CardContent>
        </Card>

        {/* ═══ STEP 3: Review & Send ═══ */}
        {totalMatchedCount > 0 && (
          <Card className="border-2 border-emerald-200 bg-emerald-50/30">
            <CardHeader>
              <div className="flex items-center gap-3">
                <Badge className="bg-emerald-600 text-white text-base h-8 w-8 flex items-center justify-center rounded-full">
                  3
                </Badge>
                <div>
                  <CardTitle>Review & Send Campaign</CardTitle>
                  <CardDescription>Confirm details before sending to all recipients</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Campaign summary */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="p-4 rounded-lg bg-white border">
                  <p className="text-xs text-muted-foreground font-semibold uppercase mb-1">Channels</p>
                  <div className="space-y-1">
                    {sendEmail && <p className="text-sm font-medium flex items-center gap-1"><Mail className="h-3 w-3" /> Email</p>}
                    {sendWhatsApp && <p className="text-sm font-medium flex items-center gap-1"><MessageSquare className="h-3 w-3" /> WhatsApp</p>}
                  </div>
                </div>
                {sendEmail && (
                  <div className="p-4 rounded-lg bg-indigo-50 border border-indigo-200">
                    <p className="text-xs text-indigo-700 font-semibold uppercase mb-1">Email Template</p>
                    <p className="text-sm font-semibold text-indigo-900">{currentEmailTemplate?.template_name}</p>
                  </div>
                )}
                {sendWhatsApp && (
                  <div className="p-4 rounded-lg bg-green-50 border border-green-200">
                    <p className="text-xs text-green-700 font-semibold uppercase mb-1">WhatsApp Template</p>
                    <p className="text-sm font-semibold text-green-900">{currentWaTemplate?.template_name}</p>
                  </div>
                )}
                <div className="p-4 rounded-lg bg-white border">
                  <p className="text-xs text-muted-foreground font-semibold uppercase mb-1">Recipients</p>
                  <p className="text-base font-semibold text-foreground">{totalMatchedCount} schools</p>
                </div>
              </div>

              {/* Recipients table */}
              <div className="border rounded-lg overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/50">
                      <TableHead>School</TableHead>
                      <TableHead>District</TableHead>
                      {sendEmail && <TableHead>Email</TableHead>}
                      {sendWhatsApp && <TableHead>Mobile</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {displayedSchools.map(s => (
                      <TableRow key={s.id} className="hover:bg-muted/30">
                        <TableCell className="font-medium text-sm">{s.school_name}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{s.district}</TableCell>
                        {sendEmail && <TableCell className="text-xs">{s.email ?? "—"}</TableCell>}
                        {sendWhatsApp && <TableCell className="text-xs">{s.mobile1 ?? "—"}</TableCell>}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {remainingCount > 0 && (
                  <div className="px-4 py-3 text-center text-xs text-muted-foreground bg-muted/20 border-t">
                    … and {remainingCount} more schools
                  </div>
                )}
              </div>

              {/* Send buttons */}
              <div className="flex gap-3 pt-2">
                <Button variant="outline" size="sm" onClick={() => downloadCSV(displayedSchools, `marketing-campaign`)}>
                  <Download className="h-3.5 w-3.5 mr-1.5" /> Export List
                </Button>
                <Button onClick={() => setConfirmOpen(true)} disabled={emailSend.running || whatsappSend.running} className="ml-auto flex items-center gap-2 bg-red-600 hover:bg-red-700 text-white font-semibold px-6">
                  <AlertTriangle className="h-4 w-4" /> Send to {totalMatchedCount} Schools
                </Button>
              </div>

              {/* Progress for Email */}
              {(emailSend.running || emailSend.progress.done) && sendEmail && (
                <div className="space-y-2 p-4 bg-indigo-50 rounded-lg border border-indigo-200">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium flex items-center gap-1"><Mail className="h-3.5 w-3.5" /> Email Progress</span>
                    <span className="text-muted-foreground">
                      {emailSend.progress.sent + emailSend.progress.failed + emailSend.progress.skipped} / {emailSend.progress.total}
                    </span>
                  </div>
                  <Progress
                    value={
                      emailSend.progress.total > 0
                        ? Math.round(((emailSend.progress.sent + emailSend.progress.failed + emailSend.progress.skipped) / emailSend.progress.total) * 100)
                        : 0
                    }
                  />
                  <div className="flex gap-4 text-xs font-medium">
                    <span className="flex items-center gap-1 text-emerald-700">
                      <CheckCircle2 className="h-3 w-3" /> {emailSend.progress.sent} sent
                    </span>
                    <span className="flex items-center gap-1 text-red-600">
                      <XCircle className="h-3 w-3" /> {emailSend.progress.failed} failed
                    </span>
                  </div>
                </div>
              )}

              {/* Progress for WhatsApp */}
              {(whatsappSend.running || whatsappSend.progress.done) && sendWhatsApp && (
                <div className="space-y-2 p-4 bg-green-50 rounded-lg border border-green-200">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium flex items-center gap-1"><MessageSquare className="h-3.5 w-3.5" /> WhatsApp Progress</span>
                    <span className="text-muted-foreground">
                      {whatsappSend.progress.sent + whatsappSend.progress.failed + whatsappSend.progress.skipped} / {whatsappSend.progress.total}
                    </span>
                  </div>
                  <Progress
                    value={
                      whatsappSend.progress.total > 0
                        ? Math.round(((whatsappSend.progress.sent + whatsappSend.progress.failed + whatsappSend.progress.skipped) / whatsappSend.progress.total) * 100)
                        : 0
                    }
                  />
                  <div className="flex gap-4 text-xs font-medium">
                    <span className="flex items-center gap-1 text-emerald-700">
                      <CheckCircle2 className="h-3 w-3" /> {whatsappSend.progress.sent} sent
                    </span>
                    <span className="flex items-center gap-1 text-red-600">
                      <XCircle className="h-3 w-3" /> {whatsappSend.progress.failed} failed
                    </span>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      {/* Template Preview Modal */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {previewChannel === "email" ? (
                <div className="flex items-center gap-2">
                  <Mail className="h-5 w-5 text-indigo-600" />
                  {currentEmailTemplate?.template_name}
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <MessageSquare className="h-5 w-5 text-green-600" />
                  {currentWaTemplate?.template_name}
                </div>
              )}
            </DialogTitle>
            <DialogDescription>Template preview</DialogDescription>
          </DialogHeader>

          {previewChannel === "email" && currentEmailTemplate ? (
            <div className="space-y-4 mt-2">
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase mb-2 block">Subject Line</p>
                <div className="bg-muted p-3 rounded border font-mono text-sm text-foreground break-words">
                  {currentEmailTemplate.subject}
                </div>
              </div>
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase mb-2 block">Email Body Preview</p>
                <div className="border rounded-lg p-4 bg-white max-h-96 overflow-y-auto text-sm" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(currentEmailTemplate.email_body) }} />
              </div>
            </div>
          ) : previewChannel === "whatsapp" && currentWaTemplate ? (
            <div className="space-y-4 mt-2">
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase mb-2 block">AskEVA Template Name</p>
                <div className="bg-muted p-3 rounded border font-mono text-sm text-foreground">
                  {currentWaTemplate.askeva_template_name}
                </div>
              </div>
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase mb-2 block">Language</p>
                <div className="text-sm font-medium">{currentWaTemplate.language_code.toUpperCase()}</div>
              </div>
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase mb-2 block">Message Type</p>
                <div className="text-sm font-medium capitalize">{currentWaTemplate.template_type}</div>
              </div>
              <div className="p-3 bg-amber-50 border border-amber-200 rounded text-xs text-amber-800">
                WhatsApp template content is configured in AskEVA. Edit in Template Management → WhatsApp Templates tab to add variables and headers.
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* Send Confirmation Dialog */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-red-600" /> Send Campaign to All Recipients?
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-4 mt-4">
              <div>
                <p className="font-semibold text-foreground mb-2">Campaign Details:</p>
                <ul className="space-y-1 text-sm">
                  <li>
                    <strong>Recipients:</strong> {totalMatchedCount} schools
                  </li>
                  {sendEmail && (
                    <li>
                      <strong>Email:</strong> {currentEmailTemplate?.template_name}
                    </li>
                  )}
                  {sendWhatsApp && (
                    <li>
                      <strong>WhatsApp:</strong> {currentWaTemplate?.template_name}
                    </li>
                  )}
                </ul>
              </div>
              <p className="text-xs text-muted-foreground">This action cannot be undone. All recipients will receive the message(s) immediately.</p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleSend} disabled={emailSend.running || whatsappSend.running} className="bg-red-600 hover:bg-red-700 text-white flex items-center gap-1.5">
              <Send className="h-4 w-4" /> {emailSend.running || whatsappSend.running ? "Sending…" : "Send Now"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
