import { useState, useEffect } from "react";
import { School } from "@/types/database";
import { useExamSchedules, ExamSchedule } from "@/hooks/useExamSchedules";
import { ExamDateDialog } from "./ExamDateDialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Calendar, Plus, Edit2, Trash2, AlertCircle, Layers, Repeat } from "lucide-react";
import { format } from "date-fns";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useActiveProject } from "@/hooks/useOlympiadProjects";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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

interface ExamScheduleManagerProps {
  school: School;
}

export function ExamScheduleManager({ school }: ExamScheduleManagerProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState<ExamSchedule | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [scheduleToDelete, setScheduleToDelete] = useState<string | null>(null);

  const { examSchedules, isLoading, refetch, addExamDate, updateExamDate, deleteExamDate } = useExamSchedules(school.id);

  const queryClient = useQueryClient();
  const { data: activeProject } = useActiveProject();
  const slotProjectId = school.current_project_id ?? activeProject?.id ?? null;

  const { data: selectedSlot } = useQuery({
    queryKey: ["school-slot-booking-crm", school.id, slotProjectId],
    queryFn: async () => {
      const { data } = await supabase
        .from("exam_slots")
        .select("slot_template_id, exam_slot_templates(slot_name)")
        .eq("school_id", school.id)
        .eq("project_id", slotProjectId as string)
        .maybeSingle();
      return data as { slot_template_id: string | null; exam_slot_templates: { slot_name: string } | null } | null;
    },
    enabled: !!slotProjectId,
  });

  // Staff "Change exam slot" override --------------------------------------
  const { data: slotTemplates = [] } = useQuery({
    queryKey: ["exam-slot-templates-crm", slotProjectId],
    enabled: !!slotProjectId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("exam_slot_templates" as any)
        .select("id, slot_name, booking_deadline")
        .eq("project_id", slotProjectId as string)
        .eq("is_active", true)
        .order("slot_name", { ascending: true });
      if (error) throw error;
      return (data ?? []) as { id: string; slot_name: string; booking_deadline: string | null }[];
    },
  });

  const [slotChoice, setSlotChoice] = useState("");
  const [slotConfirmOpen, setSlotConfirmOpen] = useState(false);
  const [applyingSlot, setApplyingSlot] = useState(false);

  const handleApplySlot = async () => {
    if (!slotChoice || !slotProjectId) return;
    setApplyingSlot(true);
    try {
      const { error } = await supabase.rpc("apply_slot_template_to_school" as any, {
        p_school_id: school.id,
        p_template_id: slotChoice,
        p_project_id: slotProjectId,
      });
      if (error) throw error;

      const target = slotTemplates.find((t) => t.id === slotChoice);
      await supabase.from("activity_logs").insert({
        school_id: school.id,
        project_id: slotProjectId,
        user_id: (await supabase.auth.getUser()).data.user?.id || "",
        activity_type: "exam_slot_changed",
        field_name: "exam_slot",
        old_value: selectedSlot?.exam_slot_templates?.slot_name ?? null,
        new_value: target?.slot_name ?? null,
        description: `Staff set exam slot to ${target?.slot_name ?? "?"} (override of the school's portal choice)`,
      });

      queryClient.invalidateQueries({ queryKey: ["school-slot-booking-crm", school.id] });
      await refetch();
      toast.success(`Exam slot set to ${target?.slot_name ?? "the selected slot"}`);
      setSlotConfirmOpen(false);
      setSlotChoice("");
    } catch (e: any) {
      toast.error(e?.message ?? "Could not change the exam slot");
    } finally {
      setApplyingSlot(false);
    }
  };

  const slotOverrideCard =
    slotProjectId && slotTemplates.length > 0 ? (
      <>
        <Card className="border-dashed">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Repeat className="h-4 w-4 text-muted-foreground" />
              Change exam slot (staff override)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Current:{" "}
              <span className="font-medium text-foreground">
                {selectedSlot?.exam_slot_templates?.slot_name ?? "No slot selected"}
              </span>
              . Applying a slot here overrides the school's portal choice and re-fills its
              exam dates from that slot — it works even if the school's own slot-selection
              window has closed.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Select value={slotChoice} onValueChange={setSlotChoice}>
                <SelectTrigger className="w-[220px]">
                  <SelectValue placeholder="Select a slot…" />
                </SelectTrigger>
                <SelectContent>
                  {slotTemplates.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.slot_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant="secondary"
                disabled={
                  !slotChoice ||
                  slotChoice === selectedSlot?.slot_template_id ||
                  applyingSlot
                }
                onClick={() => setSlotConfirmOpen(true)}
              >
                Apply
              </Button>
            </div>
          </CardContent>
        </Card>

        <AlertDialog open={slotConfirmOpen} onOpenChange={setSlotConfirmOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Change this school's exam slot?</AlertDialogTitle>
              <AlertDialogDescription>
                This sets the school to{" "}
                <span className="font-semibold">
                  {slotTemplates.find((t) => t.id === slotChoice)?.slot_name ?? "the selected slot"}
                </span>
                , replaces any exam dates already on file with that slot's dates, and
                overrides whatever the school picked on the portal. It's recorded in the
                school's activity log.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={applyingSlot}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={(e) => {
                  e.preventDefault();
                  handleApplySlot();
                }}
                disabled={applyingSlot}
              >
                {applyingSlot ? "Applying…" : "Change slot"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </>
    ) : null;

  // Check eligibility
  const isEligible =
    school.registration_status === "Confirmed" &&
    school.payment_status === "Received" &&
    school.name_list_status === "Uploaded";

  // Auto-populate exam dates from slot template once eligible + slot selected + no dates yet
  useEffect(() => {
    if (!isEligible || !selectedSlot?.slot_template_id || !school.current_project_id) return;
    if (examSchedules.length > 0) return;
    supabase.rpc("populate_exam_schedule_from_slot", {
      p_school_id: school.id,
      p_project_id: school.current_project_id,
    }).then(({ error }) => {
      if (!error) refetch();
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEligible, selectedSlot?.slot_template_id, examSchedules.length]);

  const handleAddClick = () => {
    setEditingSchedule(null);
    setDialogOpen(true);
  };

  const handleEditClick = (schedule: ExamSchedule) => {
    setEditingSchedule(schedule);
    setDialogOpen(true);
  };

  const handleDeleteClick = (scheduleId: string) => {
    setScheduleToDelete(scheduleId);
    setDeleteDialogOpen(true);
  };

  const handleConfirmDelete = () => {
    if (scheduleToDelete) {
      deleteExamDate.mutate(scheduleToDelete);
      setDeleteDialogOpen(false);
      setScheduleToDelete(null);
    }
  };

  const handleSave = (data: { exam_date: string; subjects: string[]; notes?: string }) => {
    if (editingSchedule) {
      updateExamDate.mutate(
        { id: editingSchedule.id, school_id: school.id, project_id: school.current_project_id || undefined, ...data },
        {
          onSuccess: () => {
            setDialogOpen(false);
            setEditingSchedule(null);
          },
        }
      );
    } else {
      addExamDate.mutate(
        { school_id: school.id, project_id: school.current_project_id || undefined, ...data },
        {
          onSuccess: () => {
            setDialogOpen(false);
          },
        }
      );
    }
  };

  if (!isEligible) {
    return (
      <div className="space-y-3">
        {selectedSlot?.exam_slot_templates && (
          <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-indigo-50 border border-indigo-100 text-sm">
            <Layers className="h-4 w-4 text-indigo-600 flex-shrink-0" />
            <span className="text-indigo-800">
              School selected via portal:{" "}
              <span className="font-semibold">{selectedSlot.exam_slot_templates.slot_name}</span>
              {" — "}exam dates will be auto-populated when Registration, Payment and Name List are all confirmed.
            </span>
          </div>
        )}
        {slotOverrideCard}
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            To add exam dates, the school must have:
            <ul className="mt-2 ml-4 list-disc space-y-1">
              <li>Registration Status: Confirmed</li>
              <li>Payment Status: Received</li>
              <li>Name List Status: Uploaded</li>
            </ul>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {selectedSlot?.exam_slot_templates && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-indigo-50 border border-indigo-100 text-sm">
          <Layers className="h-4 w-4 text-indigo-600 flex-shrink-0" />
          <span className="text-indigo-800">
            School selected via portal:{" "}
            <span className="font-semibold">{selectedSlot.exam_slot_templates.slot_name}</span>
            {" — "}dates auto-filled from slot. Edit individual dates below if needed.
          </span>
        </div>
      )}
      {slotOverrideCard}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Exam Schedule</h3>
          <p className="text-sm text-muted-foreground">
            {examSchedules.length} of 10 exam dates added
          </p>
        </div>
        <Button onClick={handleAddClick} disabled={examSchedules.length >= 10}>
          <Plus className="mr-2 h-4 w-4" />
          Add Exam Date
        </Button>
      </div>

      {isLoading ? (
        <div className="text-center py-8 text-muted-foreground">Loading exam schedules...</div>
      ) : examSchedules.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            <Calendar className="mx-auto h-12 w-12 mb-2 opacity-50" />
            <p>No exam dates added yet</p>
            <p className="text-sm">Click "Add Exam Date" to schedule exams for this school</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {examSchedules.map((schedule) => (
            <Card key={schedule.id}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    <Calendar className="h-5 w-5 text-primary" />
                    <CardTitle className="text-base">
                      {format(new Date(schedule.exam_date), "EEEE, MMMM d, yyyy")}
                    </CardTitle>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleEditClick(schedule)}
                    >
                      <Edit2 className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleDeleteClick(schedule.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <div>
                    <p className="text-sm font-medium mb-1">Subjects:</p>
                    <div className="flex flex-wrap gap-1">
                      {schedule.subjects.map((subject) => (
                        <Badge key={subject} variant="secondary">
                          {subject}
                        </Badge>
                      ))}
                    </div>
                  </div>
                  {schedule.notes && (
                    <div>
                      <p className="text-sm font-medium mb-1">Notes:</p>
                      <p className="text-sm text-muted-foreground">{schedule.notes}</p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <ExamDateDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSave={handleSave}
        editingSchedule={editingSchedule}
      />

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Exam Date</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this exam date? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
