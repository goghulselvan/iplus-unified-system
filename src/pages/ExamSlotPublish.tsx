import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useActiveProject } from "@/hooks/useOlympiadProjects";
import Navbar from "@/components/layout/Navbar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Calendar, Plus, EyeOff, Eye, Users, ChevronDown, ChevronUp, Trash2, Pencil, Check, X } from "lucide-react";
import { format } from "date-fns";

const SUBJECT_OPTIONS = [
  { code: "EPO", label: "EPO – English Plus Olympiad" },
  { code: "MPO", label: "MPO – Mathematics Plus Olympiad" },
  { code: "SPO", label: "SPO – Science Plus Olympiad" },
  { code: "GKSSPO", label: "GKSSPO – GK & Social Studies" },
  { code: "LRPO", label: "LRPO – Logical Reasoning" },
  { code: "KidsPO", label: "KidsPO – Kids Plus" },
];

const SESSION_OPTIONS = [
  { value: "_none", label: "No specific session" },
  { value: "Morning", label: "Morning" },
  { value: "Afternoon", label: "Afternoon" },
];

interface SlotTemplate {
  id: string;
  project_id: string;
  slot_name: string;
  booking_deadline: string | null;
  is_active: boolean;
  created_at: string;
  subjects: SlotSubject[];
  school_count: number;
}

interface SlotSubject {
  id: string;
  template_id: string;
  subject_code: string;
  exam_date: string;
  session: string | null;
  sort_order: number;
}

interface SubjectForm {
  code: string;
  date: string;
  session: string;
}

export default function ExamSlotPublish() {
  const { data: activeProject } = useActiveProject();
  const qc = useQueryClient();

  const [newSlotName, setNewSlotName] = useState("");
  const [newDeadline, setNewDeadline] = useState("");
  const [slotError, setSlotError] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [subjectForms, setSubjectForms] = useState<Record<string, SubjectForm>>({});
  const [editingSubjectId, setEditingSubjectId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<{ date: string; session: string }>({ date: "", session: "" });

  const { data: templates = [], isLoading } = useQuery({
    queryKey: ["exam-slot-templates", activeProject?.id],
    enabled: !!activeProject,
    queryFn: async () => {
      const [templatesRes, subjectsRes, bookingsRes] = await Promise.all([
        supabase
          .from("exam_slot_templates")
          .select("*")
          .eq("project_id", activeProject!.id)
          .order("created_at", { ascending: true }),
        supabase
          .from("exam_slot_template_subjects")
          .select("*")
          .order("sort_order", { ascending: true }),
        supabase
          .from("exam_slots")
          .select("slot_template_id")
          .eq("project_id", activeProject!.id)
          .not("slot_template_id", "is", null),
      ]);
      if (templatesRes.error) throw templatesRes.error;

      const subsByTemplate: Record<string, SlotSubject[]> = {};
      for (const s of (subjectsRes.data ?? []) as SlotSubject[]) {
        if (!subsByTemplate[s.template_id]) subsByTemplate[s.template_id] = [];
        subsByTemplate[s.template_id].push(s);
      }

      const countByTemplate: Record<string, number> = {};
      for (const b of bookingsRes.data ?? []) {
        if (b.slot_template_id) {
          countByTemplate[b.slot_template_id] = (countByTemplate[b.slot_template_id] ?? 0) + 1;
        }
      }

      return (templatesRes.data as Omit<SlotTemplate, "subjects" | "school_count">[]).map(t => ({
        ...t,
        subjects: subsByTemplate[t.id] ?? [],
        school_count: countByTemplate[t.id] ?? 0,
      })) as SlotTemplate[];
    },
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("exam_slot_templates").insert({
        project_id: activeProject!.id,
        slot_name: newSlotName.trim(),
        booking_deadline: newDeadline || null,
        is_active: true,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setNewSlotName("");
      setNewDeadline("");
      setSlotError("");
      qc.invalidateQueries({ queryKey: ["exam-slot-templates"] });
    },
    onError: (err: any) => {
      setSlotError(
        err.message?.includes("unique")
          ? "A slot with that name already exists."
          : "Failed to create slot."
      );
    },
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error } = await supabase
        .from("exam_slot_templates")
        .update({ is_active: !is_active })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["exam-slot-templates"] }),
  });

  const deleteTemplateMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("exam_slot_templates").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["exam-slot-templates"] });
      setExpandedId(null);
    },
  });

  const addSubjectMutation = useMutation({
    mutationFn: async ({
      templateId, code, date, session, sortOrder,
    }: { templateId: string; code: string; date: string; session: string; sortOrder: number }) => {
      const { error } = await supabase.from("exam_slot_template_subjects").insert({
        template_id: templateId,
        subject_code: code,
        exam_date: date,
        session: session && session !== "_none" ? session : null,
        sort_order: sortOrder,
      });
      if (error) throw error;
    },
    onSuccess: (_, vars) => {
      setSubjectForms(prev => ({
        ...prev,
        [vars.templateId]: { code: "", date: "", session: "" },
      }));
      qc.invalidateQueries({ queryKey: ["exam-slot-templates"] });
    },
  });

  const deleteSubjectMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("exam_slot_template_subjects").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["exam-slot-templates"] }),
  });

  const updateSubjectMutation = useMutation({
    mutationFn: async ({ id, date, session }: { id: string; date: string; session: string }) => {
      const { error } = await supabase
        .from("exam_slot_template_subjects")
        .update({ exam_date: date, session: session && session !== "_none" ? session : null })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      setEditingSubjectId(null);
      qc.invalidateQueries({ queryKey: ["exam-slot-templates"] });
    },
  });

  function startEdit(subject: SlotSubject) {
    setEditingSubjectId(subject.id);
    setEditForm({ date: subject.exam_date, session: subject.session ?? "_none" });
  }

  function handleCreate() {
    setSlotError("");
    if (!newSlotName.trim()) { setSlotError("Enter a slot name."); return; }
    createMutation.mutate();
  }

  function getSubjectLabel(code: string) {
    return SUBJECT_OPTIONS.find(s => s.code === code)?.label ?? code;
  }

  function updateForm(templateId: string, patch: Partial<SubjectForm>) {
    setSubjectForms(prev => ({
      ...prev,
      [templateId]: { code: "", date: "", session: "", ...prev[templateId], ...patch },
    }));
  }

  return (
    <>
      <Navbar />
      <div className="container mx-auto p-6 space-y-6">
        <div>
          <h1 className="text-3xl font-bold">Exam Slot Management</h1>
          {activeProject && (
            <p className="text-muted-foreground mt-1">
              {activeProject.project_name} ({activeProject.project_year}) — publish exam slots for schools to choose from
            </p>
          )}
        </div>

        {/* Create slot */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Plus className="h-4 w-4" />
              Create New Slot
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
              <div>
                <label className="block text-sm font-medium mb-1.5">
                  Slot Name <span className="text-red-500">*</span>
                </label>
                <Input
                  value={newSlotName}
                  onChange={e => setNewSlotName(e.target.value)}
                  placeholder="e.g. Slot A, Slot B, November Slot"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1.5">
                  Booking Deadline{" "}
                  <span className="text-muted-foreground font-normal">(optional)</span>
                </label>
                <Input
                  type="date"
                  value={newDeadline}
                  onChange={e => setNewDeadline(e.target.value)}
                />
              </div>
              <Button
                onClick={handleCreate}
                disabled={createMutation.isPending || !activeProject}
              >
                <Plus className="h-4 w-4 mr-1.5" />
                {createMutation.isPending ? "Creating…" : "Create Slot"}
              </Button>
            </div>
            {slotError && <p className="text-sm text-red-600 mt-2">{slotError}</p>}
          </CardContent>
        </Card>

        {/* Slot list */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Calendar className="h-4 w-4" />
              Published Slots ({templates.filter(t => t.is_active).length} active)
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="text-center py-10 text-muted-foreground text-sm">Loading…</div>
            ) : templates.length === 0 ? (
              <div className="text-center py-10">
                <Calendar className="mx-auto h-10 w-10 text-muted-foreground opacity-40 mb-3" />
                <p className="text-muted-foreground text-sm">No slots published yet for this project.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {templates.map(template => {
                  const isExpanded = expandedId === template.id;
                  const form = subjectForms[template.id] ?? { code: "", date: "", session: "" };
                  const usedCodes = new Set(template.subjects.map(s => s.subject_code));
                  const availableSubjects = SUBJECT_OPTIONS.filter(s => !usedCodes.has(s.code));

                  return (
                    <div
                      key={template.id}
                      className={`border rounded-xl transition-all ${
                        template.is_active ? "bg-white border-border" : "bg-muted/40 border-border/50 opacity-60"
                      }`}
                    >
                      {/* Header */}
                      <div className="flex items-center justify-between p-4">
                        <div className="flex items-center gap-3 flex-wrap">
                          <div>
                            <p className="font-semibold">{template.slot_name}</p>
                            {template.booking_deadline && (
                              <p className="text-xs text-muted-foreground mt-0.5">
                                Deadline: {format(new Date(template.booking_deadline), "d MMM yyyy")}
                              </p>
                            )}
                          </div>
                          <Badge variant={template.is_active ? "default" : "secondary"}>
                            {template.is_active ? "Active" : "Hidden"}
                          </Badge>
                          <Badge variant="outline" className="gap-1">
                            <Users className="h-3 w-3" />
                            {template.school_count} {template.school_count === 1 ? "school" : "schools"}
                          </Badge>
                          <Badge variant="outline">
                            {template.subjects.length}/6 subjects
                          </Badge>
                        </div>
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              toggleMutation.mutate({ id: template.id, is_active: template.is_active })
                            }
                            disabled={toggleMutation.isPending}
                          >
                            {template.is_active ? (
                              <><EyeOff className="h-4 w-4 mr-1.5" />Hide</>
                            ) : (
                              <><Eye className="h-4 w-4 mr-1.5" />Show</>
                            )}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setExpandedId(isExpanded ? null : template.id)}
                          >
                            {isExpanded
                              ? <ChevronUp className="h-4 w-4" />
                              : <ChevronDown className="h-4 w-4" />}
                          </Button>
                          {template.school_count === 0 && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => deleteTemplateMutation.mutate(template.id)}
                              disabled={deleteTemplateMutation.isPending}
                              className="text-destructive hover:text-destructive"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      </div>

                      {/* Expanded subjects */}
                      {isExpanded && (
                        <div className="border-t px-4 pb-4 pt-3 space-y-3">
                          {template.subjects.length > 0 && (
                            <div className="rounded-lg border overflow-hidden">
                              <table className="w-full text-sm">
                                <thead className="bg-muted/50">
                                  <tr>
                                    <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Subject</th>
                                    <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Exam Date</th>
                                    <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Session</th>
                                    <th className="w-10" />
                                  </tr>
                                </thead>
                                <tbody>
                                  {template.subjects.map((subject, i) => {
                                    const isEditing = editingSubjectId === subject.id;
                                    return (
                                    <tr
                                      key={subject.id}
                                      className={`border-b last:border-0 ${i % 2 !== 0 ? "bg-muted/20" : ""}`}
                                    >
                                      <td className="px-3 py-2.5 font-medium">
                                        {getSubjectLabel(subject.subject_code)}
                                      </td>
                                      {isEditing ? (
                                        <>
                                          <td className="px-3 py-2">
                                            <Input
                                              type="date"
                                              className="h-8 text-sm"
                                              value={editForm.date}
                                              onChange={e => setEditForm(f => ({ ...f, date: e.target.value }))}
                                            />
                                          </td>
                                          <td className="px-3 py-2">
                                            <Select
                                              value={editForm.session}
                                              onValueChange={v => setEditForm(f => ({ ...f, session: v }))}
                                            >
                                              <SelectTrigger className="h-8 text-sm">
                                                <SelectValue />
                                              </SelectTrigger>
                                              <SelectContent>
                                                {SESSION_OPTIONS.map(s => (
                                                  <SelectItem key={s.value} value={s.value}>
                                                    {s.label}
                                                  </SelectItem>
                                                ))}
                                              </SelectContent>
                                            </Select>
                                          </td>
                                          <td className="px-3 py-2.5">
                                            <div className="flex gap-1">
                                              <Button
                                                variant="ghost"
                                                size="icon"
                                                className="h-6 w-6 text-emerald-600 hover:text-emerald-600"
                                                disabled={!editForm.date || updateSubjectMutation.isPending}
                                                onClick={() =>
                                                  updateSubjectMutation.mutate({
                                                    id: subject.id,
                                                    date: editForm.date,
                                                    session: editForm.session,
                                                  })
                                                }
                                              >
                                                <Check className="h-3.5 w-3.5" />
                                              </Button>
                                              <Button
                                                variant="ghost"
                                                size="icon"
                                                className="h-6 w-6"
                                                onClick={() => setEditingSubjectId(null)}
                                              >
                                                <X className="h-3.5 w-3.5" />
                                              </Button>
                                            </div>
                                          </td>
                                        </>
                                      ) : (
                                        <>
                                          <td className="px-3 py-2.5">
                                            {format(new Date(subject.exam_date), "EEE, d MMM yyyy")}
                                          </td>
                                          <td className="px-3 py-2.5 text-muted-foreground">
                                            {subject.session ?? "—"}
                                          </td>
                                          <td className="px-3 py-2.5">
                                            <div className="flex gap-1">
                                              <Button
                                                variant="ghost"
                                                size="icon"
                                                className="h-6 w-6"
                                                onClick={() => startEdit(subject)}
                                              >
                                                <Pencil className="h-3.5 w-3.5" />
                                              </Button>
                                              <Button
                                                variant="ghost"
                                                size="icon"
                                                className="h-6 w-6 text-destructive hover:text-destructive"
                                                onClick={() => deleteSubjectMutation.mutate(subject.id)}
                                                disabled={deleteSubjectMutation.isPending}
                                              >
                                                <Trash2 className="h-3.5 w-3.5" />
                                              </Button>
                                            </div>
                                          </td>
                                        </>
                                      )}
                                    </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          )}

                          {/* Add subject form */}
                          {availableSubjects.length > 0 ? (
                            <div className="grid grid-cols-1 md:grid-cols-4 gap-2 items-end bg-muted/30 rounded-lg p-3">
                              <div>
                                <label className="block text-xs font-medium mb-1">Subject</label>
                                <Select
                                  value={form.code}
                                  onValueChange={v => updateForm(template.id, { code: v })}
                                >
                                  <SelectTrigger className="h-8 text-sm">
                                    <SelectValue placeholder="Select subject…" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {availableSubjects.map(s => (
                                      <SelectItem key={s.code} value={s.code}>
                                        {s.label}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>
                              <div>
                                <label className="block text-xs font-medium mb-1">Exam Date</label>
                                <Input
                                  type="date"
                                  className="h-8 text-sm"
                                  value={form.date}
                                  onChange={e => updateForm(template.id, { date: e.target.value })}
                                />
                              </div>
                              <div>
                                <label className="block text-xs font-medium mb-1">Session</label>
                                <Select
                                  value={form.session || "_none"}
                                  onValueChange={v => updateForm(template.id, { session: v })}
                                >
                                  <SelectTrigger className="h-8 text-sm">
                                    <SelectValue placeholder="Optional" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {SESSION_OPTIONS.map(s => (
                                      <SelectItem key={s.value} value={s.value}>
                                        {s.label}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>
                              <Button
                                size="sm"
                                disabled={!form.code || !form.date || addSubjectMutation.isPending}
                                onClick={() =>
                                  addSubjectMutation.mutate({
                                    templateId: template.id,
                                    code: form.code,
                                    date: form.date,
                                    session: form.session,
                                    sortOrder: template.subjects.length,
                                  })
                                }
                              >
                                <Plus className="h-3.5 w-3.5 mr-1" />
                                {addSubjectMutation.isPending ? "Adding…" : "Add"}
                              </Button>
                            </div>
                          ) : (
                            <p className="text-xs text-muted-foreground text-center py-1">
                              All 6 subjects added to this slot.
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
