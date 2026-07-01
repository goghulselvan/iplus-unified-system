import { useMemo, useState } from "react";
import Navbar from "@/components/layout/Navbar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useWhatsAppTemplates, WhatsAppTemplate } from "@/hooks/useWhatsAppTemplates";
import { useOlympiadProjects, useActiveProject } from "@/hooks/useOlympiadProjects";
import {
  WHATSAPP_VARIABLE_SOURCES, WHATSAPP_TEMPLATE_TYPES, WHATSAPP_LANGUAGE_CODES,
  BodyVariable, typeNeedsVariables, typeHasMediaHeader, typeIsDocument,
} from "@/utils/whatsappVariableSources";
import { MessageSquare, Plus, Edit, Trash2, Save, X, Power } from "lucide-react";

type Editing = Partial<WhatsAppTemplate> & { body_variables?: BodyVariable[] };

const emptyTemplate: Editing = {
  template_key: "",
  template_name: "",
  askeva_template_name: "",
  language_code: "en",
  template_type: "text",
  header_media_url: "",
  header_document_filename: "",
  body_variables: [],
  raw_payload_template: null,
  is_active: true,
};

export function WhatsAppTemplatesContent({ category = 'workflow' }: { category?: 'workflow' | 'marketing' }) {
  const { data: projects = [] } = useOlympiadProjects();
  const { data: activeProject } = useActiveProject();
  const [selectedProjectId, setSelectedProjectId] = useState<string>(activeProject?.id || "");
  const projectId = selectedProjectId || activeProject?.id || "";
  const { templates, loading, createTemplate, updateTemplate, deleteTemplate } =
    useWhatsAppTemplates(projectId, category);

  const [editing, setEditing] = useState<Editing | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [rawPayloadText, setRawPayloadText] = useState("");

  const startNew = () => {
    setEditing({ ...emptyTemplate });
    setRawPayloadText("");
  };

  const startEdit = (t: WhatsAppTemplate) => {
    setEditing({ ...t, body_variables: (t.body_variables as any) || [] });
    setRawPayloadText(t.raw_payload_template ? JSON.stringify(t.raw_payload_template, null, 2) : "");
  };

  const cancel = () => {
    setEditing(null);
    setRawPayloadText("");
  };

  const addVariable = () => {
    const next = [...(editing?.body_variables || [])];
    next.push({ index: next.length + 1, source: "school_name" });
    setEditing({ ...editing!, body_variables: next });
  };

  const updateVariable = (i: number, patch: Partial<BodyVariable>) => {
    const next = [...(editing?.body_variables || [])];
    next[i] = { ...next[i], ...patch };
    setEditing({ ...editing!, body_variables: next });
  };

  const removeVariable = (i: number) => {
    const next = (editing?.body_variables || []).filter((_, idx) => idx !== i)
      .map((v, idx) => ({ ...v, index: idx + 1 }));
    setEditing({ ...editing!, body_variables: next });
  };

  const handleSave = async () => {
    if (!editing || !projectId) return;
    if (!editing.template_key || !editing.template_name || !editing.askeva_template_name) {
      return;
    }

    let parsedPayload: any = null;
    if ((editing.template_type === "carousel" || editing.template_type === "authentication") && rawPayloadText.trim()) {
      try {
        parsedPayload = JSON.parse(rawPayloadText);
      } catch {
        alert("Raw payload JSON is invalid");
        return;
      }
    }

    const payload = {
      project_id: projectId,
      template_key: editing.template_key!.trim(),
      template_name: editing.template_name!.trim(),
      askeva_template_name: editing.askeva_template_name!.trim(),
      language_code: editing.language_code || "en",
      template_type: editing.template_type || "text",
      header_media_url: typeHasMediaHeader(editing.template_type || "")
        ? (editing.header_media_url || null) : null,
      header_document_filename: typeIsDocument(editing.template_type || "")
        ? (editing.header_document_filename || null) : null,
      body_variables: typeNeedsVariables(editing.template_type || "")
        ? (editing.body_variables || []) : [],
      raw_payload_template: parsedPayload,
      is_active: editing.is_active ?? true,
      template_category: category,
    };

    if (editing.id) {
      await updateTemplate(editing.id, payload as any);
    } else {
      await createTemplate(payload as any);
    }
    cancel();
  };

  const sortedTemplates = useMemo(
    () => [...templates].sort((a, b) => a.template_name.localeCompare(b.template_name)),
    [templates]
  );

  return (
    <div className="container mx-auto py-8 px-4">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold mb-2">WhatsApp Templates</h1>
            <p className="text-muted-foreground">
              Manage AskEVA WhatsApp templates per project. Templates must already be approved in your AskEVA dashboard.
            </p>
          </div>
          {!editing && (
            <Button onClick={startNew} disabled={!projectId}>
              <Plus className="h-4 w-4 mr-2" />
              New Template
            </Button>
          )}
        </div>

        <div className="mb-6 max-w-md">
          <Label>Select Project</Label>
          <Select value={projectId} onValueChange={setSelectedProjectId}>
            <SelectTrigger>
              <SelectValue placeholder="Select project" />
            </SelectTrigger>
            <SelectContent>
              {projects.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.project_name} ({p.project_year})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Card className="mb-6 border-blue-200 bg-blue-50/50 dark:bg-blue-950/20">
          <CardContent className="py-4 text-sm">
            <p className="font-semibold mb-2">📲 Auto-trigger on workflow status change</p>
            <p className="text-muted-foreground mb-2">
              When a school's status changes, the system can offer to send a WhatsApp message
              automatically — but only if a template with the matching <code>template_key</code> exists
              and is active. Use these exact keys:
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-1 text-xs font-mono">
              <div>registration_interest → Interested: <code>interest_acknowledged</code></div>
              <div>registration_status → Confirmed: <code>registration_confirmed</code></div>
              <div>payment_status → Received: <code>payment_received</code></div>
              <div>payment_status → Partial: <code>payment_partial</code></div>
              <div>name_list_status → Received: <code>name_list_received</code></div>
              <div>question_paper_sent → Sent: <code>question_paper_sent_wa</code></div>
              <div>answer_sheet_status → Received: <code>answer_sheet_received_wa</code></div>
              <div>result_status → Sent: <code>result_sent_wa</code></div>
            </div>
          </CardContent>
        </Card>

        {!editing ? (
          <div className="grid gap-4">
            {loading && <p className="text-muted-foreground">Loading templates…</p>}
            {!loading && sortedTemplates.length === 0 && (
              <Card>
                <CardContent className="py-10 text-center text-muted-foreground">
                  No WhatsApp templates yet for this project. Click <strong>New Template</strong> to add one.
                </CardContent>
              </Card>
            )}
            {sortedTemplates.map((t) => (
              <Card key={t.id}>
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div>
                      <CardTitle className="flex items-center gap-2">
                        <MessageSquare className="h-5 w-5" />
                        {t.template_name}
                      </CardTitle>
                      <CardDescription className="mt-1">
                        Key: <code>{t.template_key}</code> · AskEVA: <code>{t.askeva_template_name}</code>
                      </CardDescription>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={t.is_active ? "default" : "secondary"}>
                        {t.is_active ? "Active" : "Inactive"}
                      </Badge>
                      <Badge variant="outline">{t.language_code}</Badge>
                      <Badge variant="outline">{t.template_type}</Badge>
                      <Button variant="outline" size="sm"
                        onClick={() => updateTemplate(t.id, { is_active: !t.is_active })}>
                        <Power className="h-4 w-4" />
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => startEdit(t)}>
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => setDeleteId(t.id)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                {(t.body_variables?.length || 0) > 0 && (
                  <CardContent>
                    <p className="text-sm text-muted-foreground">
                      Variables: {t.body_variables.map((v) =>
                        `{{${v.index}}}=${v.source === "custom" ? `"${v.customText || ""}"` : v.source}`
                      ).join(", ")}
                    </p>
                  </CardContent>
                )}
              </Card>
            ))}
          </div>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>{editing.id ? "Edit Template" : "Create Template"}</CardTitle>
              <CardDescription>
                Make sure the AskEVA template name, language, type and variable order match exactly what is approved in your AskEVA dashboard.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Tabs defaultValue="edit">
                <TabsList>
                  <TabsTrigger value="edit">Edit</TabsTrigger>
                  <TabsTrigger value="preview">Preview Payload</TabsTrigger>
                </TabsList>

                <TabsContent value="edit" className="space-y-4 mt-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label>Template Key (internal slug) *</Label>
                      <Input
                        value={editing.template_key || ""}
                        onChange={(e) => setEditing({ ...editing, template_key: e.target.value })}
                        placeholder="e.g. registration_confirmation"
                      />
                    </div>
                    <div>
                      <Label>Template Display Name *</Label>
                      <Input
                        value={editing.template_name || ""}
                        onChange={(e) => setEditing({ ...editing, template_name: e.target.value })}
                        placeholder="e.g. Registration Confirmation"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label>AskEVA Template Name *</Label>
                      <Input
                        value={editing.askeva_template_name || ""}
                        onChange={(e) => setEditing({ ...editing, askeva_template_name: e.target.value })}
                        placeholder="exact name from AskEVA dashboard"
                      />
                    </div>
                    <div>
                      <Label>Language Code *</Label>
                      <Select
                        value={editing.language_code || "en"}
                        onValueChange={(v) => setEditing({ ...editing, language_code: v })}
                      >
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {WHATSAPP_LANGUAGE_CODES.map((l) => (
                            <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div>
                    <Label>Template Type *</Label>
                    <Select
                      value={editing.template_type || "text"}
                      onValueChange={(v) => setEditing({ ...editing, template_type: v })}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {WHATSAPP_TEMPLATE_TYPES.map((t) => (
                          <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {typeHasMediaHeader(editing.template_type || "") && (
                    <div className="border rounded p-3 space-y-3 bg-muted/30">
                      <Label className="text-sm font-semibold">Header Media</Label>
                      <div>
                        <Label>Media URL</Label>
                        <Input
                          value={editing.header_media_url || ""}
                          onChange={(e) => setEditing({ ...editing, header_media_url: e.target.value })}
                          placeholder="https://..."
                        />
                      </div>
                      {typeIsDocument(editing.template_type || "") && (
                        <div>
                          <Label>Document Filename</Label>
                          <Input
                            value={editing.header_document_filename || ""}
                            onChange={(e) => setEditing({ ...editing, header_document_filename: e.target.value })}
                            placeholder="brochure.pdf"
                          />
                        </div>
                      )}
                    </div>
                  )}

                  {typeNeedsVariables(editing.template_type || "") && (
                    <div className="border rounded p-3 space-y-3 bg-muted/30">
                      <div className="flex items-center justify-between">
                        <Label className="text-sm font-semibold">Body Variables (in order)</Label>
                        <Button type="button" size="sm" variant="outline" onClick={addVariable}>
                          <Plus className="h-4 w-4 mr-1" /> Add variable
                        </Button>
                      </div>
                      {(editing.body_variables || []).length === 0 && (
                        <p className="text-xs text-muted-foreground">No variables yet. Add one for each <code>{`{{n}}`}</code> placeholder in the AskEVA template.</p>
                      )}
                      {(editing.body_variables || []).map((v, i) => (
                        <div key={i} className="flex items-end gap-2">
                          <div className="w-16">
                            <Label className="text-xs">Slot</Label>
                            <Input value={`{{${v.index}}}`} disabled />
                          </div>
                          <div className="flex-1">
                            <Label className="text-xs">Source</Label>
                            <Select value={v.source} onValueChange={(val) => updateVariable(i, { source: val })}>
                              <SelectTrigger><SelectValue /></SelectTrigger>
                              <SelectContent>
                                {WHATSAPP_VARIABLE_SOURCES.map((s) => (
                                  <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          {v.source === "custom" && (
                            <div className="flex-1">
                              <Label className="text-xs">Custom Text</Label>
                              <Input
                                value={v.customText || ""}
                                onChange={(e) => updateVariable(i, { customText: e.target.value })}
                                placeholder="Static text"
                              />
                            </div>
                          )}
                          <Button type="button" size="icon" variant="ghost" onClick={() => removeVariable(i)}>
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}

                  {(editing.template_type === "carousel" || editing.template_type === "authentication") && (
                    <div>
                      <Label>Raw Payload Template (JSON)</Label>
                      <Textarea
                        value={rawPayloadText}
                        onChange={(e) => setRawPayloadText(e.target.value)}
                        rows={10}
                        className="font-mono text-xs"
                        placeholder='{"components":[...]}'
                      />
                      <p className="text-xs text-muted-foreground mt-1">
                        Refer to the AskEVA documentation for carousel/authentication payloads. Variables can be embedded as plain text.
                      </p>
                    </div>
                  )}

                  <div className="flex items-center gap-2">
                    <Switch
                      checked={editing.is_active ?? true}
                      onCheckedChange={(c) => setEditing({ ...editing, is_active: c })}
                    />
                    <Label>Active</Label>
                  </div>

                  <div className="flex gap-2 pt-2">
                    <Button onClick={handleSave}>
                      <Save className="h-4 w-4 mr-2" /> Save Template
                    </Button>
                    <Button variant="outline" onClick={cancel}>Cancel</Button>
                  </div>
                </TabsContent>

                <TabsContent value="preview" className="mt-4">
                  <pre className="bg-muted p-4 rounded text-xs overflow-auto">
{JSON.stringify(
  {
    template: {
      name: editing.askeva_template_name || "<askeva_template_name>",
      language: { policy: "deterministic", code: editing.language_code || "en" },
    },
    type: editing.template_type,
    header: typeHasMediaHeader(editing.template_type || "")
      ? { url: editing.header_media_url, filename: editing.header_document_filename || undefined }
      : undefined,
    body_variables: editing.body_variables,
    raw_payload_template: rawPayloadText ? "(JSON provided)" : null,
  },
  null,
  2
)}
                  </pre>
                  <p className="text-xs text-muted-foreground mt-2">
                    The actual payload is finalized server-side, with variables resolved from the school being messaged.
                  </p>
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        )}

        <AlertDialog open={!!deleteId} onOpenChange={(o) => !o && setDeleteId(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete WhatsApp Template</AlertDialogTitle>
              <AlertDialogDescription>
                This will permanently delete the template. Any auto-send rules referring to this template key will silently stop firing.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={async () => {
                if (deleteId) await deleteTemplate(deleteId);
                setDeleteId(null);
              }}>Delete</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
  );
}

export default function WhatsAppTemplates() {
  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <WhatsAppTemplatesContent />
    </div>
  );
}
