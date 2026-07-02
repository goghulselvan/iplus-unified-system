import { useState } from "react";
import DOMPurify from "dompurify";
import Navbar from "@/components/layout/Navbar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useCommunicationTemplates, CommunicationTemplate } from "@/hooks/useCommunicationTemplates";
import { useOlympiadProjects, useActiveProject } from "@/hooks/useOlympiadProjects";
import { Mail, Plus, Edit, Trash2, Eye, Save } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";

const TEMPLATE_TYPES = [
  { value: "interest_acknowledged",        label: "Interest Acknowledged" },
  { value: "registration_confirmed",       label: "Registration Confirmed" },
  { value: "payment_received",             label: "Payment Received" },
  { value: "payment_partial",              label: "Payment Partial" },
  { value: "name_list_received",           label: "Name List Received" },
  { value: "question_paper_sent_wa",       label: "Question Paper Sent" },
  { value: "answer_sheet_received_wa",     label: "Answer Sheets Received" },
  { value: "result_sent_wa",               label: "Results Sent" },
  { value: "portal_registration_approved", label: "Portal: Registration Approved" },
  { value: "portal_registration_rejected", label: "Portal: Registration Rejected" },
  { value: "exam_slot_confirmed",          label: "Portal: Exam Slot Confirmed" },
];

const DEFAULT_TEMPLATES = {
  interest_acknowledged: {
    subject: "Thank You for Your Interest — {project_name} {project_year}",
    email_body: `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#f4f4f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background-color:#f4f4f7;">
  <tr><td align="center" style="padding:20px 10px;">
    <table width="600" cellpadding="0" cellspacing="0" role="presentation" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
      <tr><td style="background:linear-gradient(135deg,#7C3AED 0%,#4F46E5 100%);padding:40px 32px 36px;text-align:center;">
        <div style="font-size:11px;font-weight:600;letter-spacing:3px;color:rgba(255,255,255,0.7);text-transform:uppercase;margin-bottom:16px;">iPlus Olympiads</div>
        <div style="font-size:30px;font-weight:700;color:#ffffff;line-height:1.25;margin-bottom:12px;">Thank You for<br/>Your Interest!</div>
        <div style="font-size:13px;color:rgba(255,255,255,0.8);font-style:italic;">Ignite Genius. Inspire Excellence.</div>
      </td></tr>
      <tr><td style="background:#f5f3ff;border-bottom:1px solid #ede9fe;padding:12px 32px;text-align:center;">
        <span style="font-size:11px;font-weight:700;letter-spacing:2px;color:#4F46E5;text-transform:uppercase;">&#10003;&nbsp;&nbsp;INTEREST ACKNOWLEDGED</span>
      </td></tr>
      <tr><td style="padding:32px 32px 8px;">
        <p style="margin:0 0 16px;font-size:16px;font-weight:700;color:#1a1a2e;">Dear {contact_person},</p>
        <p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#374151;">Thank you for expressing your interest in <strong>{project_name} {project_year}</strong>. We are delighted to have <strong>{school_name}</strong> as part of India's No. 1 Progressive Olympiad platform.</p>
        <p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#374151;">Every participant receives a <strong>skill-based analytical report</strong> with individual strengths, areas for improvement, and rankings at school and national level. Students also earn medals, merit certificates, and national recognition.</p>
      </td></tr>
      <tr><td style="padding:8px 32px 16px;">
        <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="border:1px solid #e5e7eb;border-left:3px solid #4F46E5;border-radius:8px;overflow:hidden;">
          <tr><td style="padding:16px 20px;">
            <div style="font-size:10px;font-weight:700;letter-spacing:2px;color:#4F46E5;text-transform:uppercase;margin-bottom:12px;">Interest Details</div>
            <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
              <tr><td style="padding:5px 0;font-size:13px;color:#6b7280;width:35%;">School</td><td style="padding:5px 0;font-size:13px;font-weight:600;color:#111827;">{school_name}</td></tr>
              <tr><td style="padding:5px 0;font-size:13px;color:#6b7280;">SS No.</td><td style="padding:5px 0;font-size:13px;font-weight:600;color:#111827;">{ss_no}</td></tr>
              <tr><td style="padding:5px 0;font-size:13px;color:#6b7280;">Programme</td><td style="padding:5px 0;font-size:13px;font-weight:600;color:#111827;">{project_name} {project_year}</td></tr>
              <tr><td style="padding:5px 0;font-size:13px;color:#6b7280;">District</td><td style="padding:5px 0;font-size:13px;font-weight:600;color:#111827;">{district}, {state}</td></tr>
            </table>
          </td></tr>
        </table>
      </td></tr>
      <tr><td style="padding:8px 32px 24px;">
        <p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#374151;">Our team will be in touch shortly to guide you through the registration process. The registration deadline is <strong>20 August 2026</strong>. In the meantime, please ensure your student data is ready for submission.</p>
      </td></tr>
      <tr><td style="padding:0 32px 32px;text-align:center;">
        <a href="https://iplusedu.in/school/register" style="display:inline-block;background:linear-gradient(135deg,#7C3AED 0%,#4F46E5 100%);color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;padding:14px 32px;border-radius:8px;">Register Your School &rarr;</a>
      </td></tr>
      <tr><td style="background:#f9fafb;border-top:1px solid #e5e7eb;padding:24px 32px;text-align:center;">
        <div style="font-size:14px;font-weight:600;color:#4F46E5;margin-bottom:6px;">iPlus Olympiads</div>
        <div style="font-size:12px;color:#6b7280;line-height:1.8;">Ivar Pro Learn for Universal Success Pvt. Ltd.<br/>115, GST Road, Guduvancheri, Chennai 603 202<br/><a href="mailto:support@iplusedu.in" style="color:#4F46E5;text-decoration:none;">support@iplusedu.in</a>&nbsp;|&nbsp;<a href="tel:+918111066556" style="color:#4F46E5;text-decoration:none;">+91 81110 66556</a></div>
        <div style="font-size:11px;color:#9ca3af;margin-top:10px;">&copy; 2026 iPlus Olympiads. All rights reserved.</div>
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`,
  },
  registration_confirmed: {
    subject: "Registration Confirmed - {project_name} {project_year}",
    email_body: `<p>Dear {contact_person},</p>
<p>Thank you for registering <strong>{school_name}</strong> (SS No: {ss_no}) for {project_name} {project_year}.</p>
<p>Your registration has been confirmed. We have received your namelist with <strong>{student_count} participants</strong>.</p>
<h3>Next Steps:</h3>
<ul>
  <li>Payment confirmation will be sent upon receipt</li>
  <li>Question papers will be dispatched before the exam date</li>
  <li>Results will be communicated after evaluation</li>
</ul>
<p>For queries, contact us at info@iplusedu.in</p>
<p>Best regards,<br/>IPLUS Education Team</p>`,
  },
  name_list_received: {
    subject: "Name List Received - {project_name} {project_year}",
    email_body: `<p>Dear {contact_person},</p>
<p>We acknowledge receipt of the name list from <strong>{school_name}</strong> (SS No: {ss_no}) for {project_name} {project_year}.</p>
<p>Number of students: <strong>{student_count}</strong></p>
<p>The list is being processed and verified. We will notify you once the verification is complete.</p>
<h3>Next Steps:</h3>
<ul>
  <li>Please ensure payment is made at the earliest</li>
  <li>Question papers will be dispatched after payment confirmation</li>
</ul>
<p>For queries, contact us at info@iplusedu.in</p>
<p>Best regards,<br/>IPLUS Education Team</p>`,
  },
  payment_received: {
    subject: "Payment Received - {project_name} {project_year}",
    email_body: `<p>Dear {contact_person},</p>
<p>We confirm receipt of payment for <strong>{school_name}</strong> (SS No: {ss_no}).</p>
<h3>Payment Details:</h3>
<ul>
  <li>Amount: ₹{payment_amount}</li>
  <li>Date: {payment_date}</li>
  <li>Number of Students: {student_count}</li>
</ul>
<p>Your official receipt has been generated and will be sent separately.</p>
<p>Thank you for your prompt payment.</p>
<p>Best regards,<br/>IPLUS Education Team</p>`,
  },
  question_paper_sent_wa: {
    subject: "Question Papers Dispatched - {project_name} {project_year}",
    email_body: `<p>Dear {contact_person},</p>
<p>This is to inform you that question papers for <strong>{school_name}</strong> (SS No: {ss_no}) have been dispatched via courier.</p>
<p>Number of student papers: <strong>{student_count}</strong></p>
<p>Please ensure the papers are received and stored securely until the exam date.</p>
<p>For any queries, contact us at info@iplusedu.in</p>
<p>Best regards,<br/>IPLUS Education Team</p>`,
  },
  answer_sheet_received_wa: {
    subject: "Answer Sheets Received - {project_name} {project_year}",
    email_body: `<p>Dear {contact_person},</p>
<p>We acknowledge receipt of answer sheets from <strong>{school_name}</strong> (SS No: {ss_no}).</p>
<p>Number of answer sheets received: <strong>{student_count}</strong></p>
<p>The evaluation process will begin shortly, and results will be communicated soon.</p>
<p>Thank you for your cooperation.</p>
<p>Best regards,<br/>IPLUS Education Team</p>`,
  },
  result_sent_wa: {
    subject: "Results Announced - {project_name} {project_year}",
    email_body: `<p>Dear {contact_person},</p>
<p>The results for <strong>{school_name}</strong> (SS No: {ss_no}) have been published.</p>
<p>You can view the results for your <strong>{student_count} participants</strong> in the portal.</p>
<p>Certificates will be dispatched shortly.</p>
<p>Congratulations to all participants!</p>
<p>Best regards,<br/>IPLUS Education Team</p>`,
  },
};

export function CommunicationTemplatesContent({ category = 'workflow' }: { category?: 'workflow' | 'marketing' }) {
  const { data: projects = [] } = useOlympiadProjects();
  const { data: activeProject } = useActiveProject();
  const [selectedProjectId, setSelectedProjectId] = useState<string>(activeProject?.id || "");
  const { templates, loading, createTemplate, updateTemplate, deleteTemplate } = useCommunicationTemplates(selectedProjectId, category);
  
  const [isEditing, setIsEditing] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<Partial<CommunicationTemplate> | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [templateToDelete, setTemplateToDelete] = useState<string | null>(null);
  const [previewMode, setPreviewMode] = useState(false);

  const handleCreateDefault = async (templateType: string) => {
    const defaultTemplate = DEFAULT_TEMPLATES[templateType as keyof typeof DEFAULT_TEMPLATES];
    const templateName = TEMPLATE_TYPES.find(t => t.value === templateType)?.label || templateType;
    
    await createTemplate({
      project_id: selectedProjectId,
      template_type: templateType,
      template_name: templateName,
      subject: defaultTemplate.subject,
      email_body: defaultTemplate.email_body,
      is_active: true,
      template_category: category,
    } as any);
  };

  const handleSave = async () => {
    if (!editingTemplate || !editingTemplate.template_type || !editingTemplate.template_name || 
        !editingTemplate.subject || !editingTemplate.email_body) {
      return;
    }
    
    if (editingTemplate.id) {
      await updateTemplate(editingTemplate.id, editingTemplate);
    } else {
      await createTemplate({
        project_id: selectedProjectId,
        template_type: editingTemplate.template_type,
        template_name: editingTemplate.template_name,
        subject: editingTemplate.subject,
        email_body: editingTemplate.email_body,
        is_active: editingTemplate.is_active ?? true,
        whatsapp_message: editingTemplate.whatsapp_message,
        template_category: category,
      } as any);
    }
    
    setIsEditing(false);
    setEditingTemplate(null);
  };

  const handleDelete = async () => {
    if (templateToDelete) {
      await deleteTemplate(templateToDelete);
      setDeleteDialogOpen(false);
      setTemplateToDelete(null);
    }
  };

  const renderPreview = (content: string) => {
    const sampleVariables: Record<string, string> = {
      "{school_name}": "Sample School Name",
      "{ss_no}": "12345",
      "{contact_person}": "Mr. John Doe",
      "{project_name}": activeProject?.project_name || "Olympiad",
      "{project_year}": activeProject?.project_year?.toString() || "2025",
      "{payment_amount}": "15000",
      "{payment_date}": "2025-01-15",
      "{student_count}": "100",
      "{district}": "Sample District",
      "{state}": "Sample State",
    };

    let preview = content;
    Object.entries(sampleVariables).forEach(([key, value]) => {
      preview = preview.replace(new RegExp(key.replace(/[{}]/g, "\\$&"), "g"), value);
    });
    
    return preview;
  };

  return (
    <div className="container mx-auto py-8 px-4">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold mb-2">Communication Templates</h1>
            <p className="text-muted-foreground">Manage email templates for automated communications</p>
          </div>
          <Button onClick={() => {
            setIsEditing(true);
            setEditingTemplate({ is_active: true });
          }}>
            <Plus className="h-4 w-4 mr-2" />
            New Template
          </Button>
        </div>

        <div className="mb-6">
          <Label>Select Project</Label>
          <Select value={selectedProjectId} onValueChange={setSelectedProjectId}>
            <SelectTrigger className="w-64">
              <SelectValue placeholder="Select project" />
            </SelectTrigger>
            <SelectContent>
              {projects.map((project) => (
                <SelectItem key={project.id} value={project.id}>
                  {project.project_name} ({project.project_year})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {!isEditing ? (
          <div className="grid gap-4">
            {TEMPLATE_TYPES.map((type) => {
              const existingTemplate = templates.find(t => t.template_type === type.value && t.is_active);
              
              return (
                <Card key={type.value}>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <div>
                        <CardTitle className="flex items-center gap-2">
                          <Mail className="h-5 w-5" />
                          {type.label}
                        </CardTitle>
                        <CardDescription>{type.value}</CardDescription>
                      </div>
                      <div className="flex gap-2">
                        {existingTemplate ? (
                          <>
                            <Badge variant="default">Active</Badge>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                setEditingTemplate(existingTemplate);
                                setIsEditing(true);
                              }}
                            >
                              <Edit className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                setTemplateToDelete(existingTemplate.id);
                                setDeleteDialogOpen(true);
                              }}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </>
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleCreateDefault(type.value)}
                          >
                            Create Default
                          </Button>
                        )}
                      </div>
                    </div>
                  </CardHeader>
                  {existingTemplate && (
                    <CardContent>
                      <p className="text-sm text-muted-foreground">
                        <strong>Subject:</strong> {existingTemplate.subject}
                      </p>
                    </CardContent>
                  )}
                </Card>
              );
            })}
          </div>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>{editingTemplate?.id ? "Edit Template" : "Create Template"}</CardTitle>
            </CardHeader>
            <CardContent>
              <Tabs defaultValue="edit" className="w-full">
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="edit">Edit</TabsTrigger>
                  <TabsTrigger value="preview">Preview</TabsTrigger>
                </TabsList>
                
                <TabsContent value="edit" className="space-y-4">
                  <div>
                    <Label>Template Type / Key</Label>
                    {category === 'marketing' ? (
                      <input
                        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        placeholder="e.g. olympiad_launch_2026, new_year_wishes"
                        value={editingTemplate?.template_type || ''}
                        onChange={(e) => setEditingTemplate({ ...editingTemplate, template_type: e.target.value })}
                      />
                    ) : (
                      <Select
                        value={editingTemplate?.template_type}
                        onValueChange={(value) => setEditingTemplate({ ...editingTemplate, template_type: value })}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select type" />
                        </SelectTrigger>
                        <SelectContent>
                          {TEMPLATE_TYPES.map((type) => (
                            <SelectItem key={type.value} value={type.value}>
                              {type.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </div>

                  <div>
                    <Label>Template Name</Label>
                    <Input
                      value={editingTemplate?.template_name || ""}
                      onChange={(e) => setEditingTemplate({ ...editingTemplate, template_name: e.target.value })}
                      placeholder="e.g., Registration Confirmation"
                    />
                  </div>

                  <div>
                    <Label>Subject</Label>
                    <Input
                      value={editingTemplate?.subject || ""}
                      onChange={(e) => setEditingTemplate({ ...editingTemplate, subject: e.target.value })}
                      placeholder="Email subject line"
                    />
                  </div>

                  <div>
                    <Label>Email Body (HTML)</Label>
                    <Textarea
                      value={editingTemplate?.email_body || ""}
                      onChange={(e) => setEditingTemplate({ ...editingTemplate, email_body: e.target.value })}
                      placeholder="Email content with HTML"
                      rows={15}
                      className="font-mono text-sm"
                    />
                    <p className="text-xs text-muted-foreground mt-2">
                      Available variables: {"{school_name}, {ss_no}, {contact_person}, {project_name}, {project_year}, {payment_amount}, {payment_date}, {student_count}"}
                    </p>
                  </div>

                  <div className="flex gap-2">
                    <Button onClick={handleSave}>
                      <Save className="h-4 w-4 mr-2" />
                      Save Template
                    </Button>
                    <Button variant="outline" onClick={() => {
                      setIsEditing(false);
                      setEditingTemplate(null);
                    }}>
                      Cancel
                    </Button>
                  </div>
                </TabsContent>
                
                <TabsContent value="preview" className="space-y-4">
                  <div className="border rounded-lg p-4 bg-muted">
                    <h3 className="font-semibold mb-2">Subject:</h3>
                    <p>{renderPreview(editingTemplate?.subject || "")}</p>
                    
                    <h3 className="font-semibold mt-4 mb-2">Email Body:</h3>
                    <div 
                      className="bg-background p-4 rounded border"
                      dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(renderPreview(editingTemplate?.email_body || "")) }}
                    />
                  </div>
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        )}

        <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete Template</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to delete this template? This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={handleDelete}>Delete</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
  );
}

export default function CommunicationTemplates() {
  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <CommunicationTemplatesContent />
    </div>
  );
}
