import { useState, useEffect } from "react";
import { School } from "@/types/database";
import { useExamSchedules, ExamSchedule } from "@/hooks/useExamSchedules";
import { ExamDateDialog } from "./ExamDateDialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Calendar, Plus, Edit2, Trash2, AlertCircle, Layers } from "lucide-react";
import { format } from "date-fns";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
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

  const { data: selectedSlot } = useQuery({
    queryKey: ["school-slot-booking-crm", school.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("exam_slots")
        .select("slot_template_id, exam_slot_templates(slot_name)")
        .eq("school_id", school.id)
        .eq("project_id", school.current_project_id ?? "")
        .maybeSingle();
      return data as { slot_template_id: string | null; exam_slot_templates: { slot_name: string } | null } | null;
    },
    enabled: !!school.current_project_id,
  });

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
