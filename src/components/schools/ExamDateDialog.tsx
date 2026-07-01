import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CalendarIcon } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { ExamSchedule } from "@/hooks/useExamSchedules";

interface ExamDateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (data: { exam_date: string; subjects: string[]; notes?: string }) => void;
  editingSchedule?: ExamSchedule | null;
}

const SUBJECTS = [
  { value: "KidsPO", label: "KidsPO" },
  { value: "EPO", label: "EPO" },
  { value: "MPO", label: "MPO" },
  { value: "SPO", label: "SPO" },
  { value: "GKSSPO", label: "GKSSPO" },
];

export function ExamDateDialog({ open, onOpenChange, onSave, editingSchedule }: ExamDateDialogProps) {
  const [examDate, setExamDate] = useState<Date | undefined>(
    editingSchedule ? new Date(editingSchedule.exam_date) : undefined
  );
  const [selectedSubjects, setSelectedSubjects] = useState<string[]>(
    editingSchedule?.subjects || []
  );
  const [notes, setNotes] = useState(editingSchedule?.notes || "");

  const handleSubjectToggle = (subject: string) => {
    setSelectedSubjects((prev) =>
      prev.includes(subject)
        ? prev.filter((s) => s !== subject)
        : [...prev, subject]
    );
  };

  const handleSave = () => {
    if (!examDate) {
      return;
    }

    if (selectedSubjects.length === 0) {
      return;
    }

    onSave({
      exam_date: format(examDate, "yyyy-MM-dd"),
      subjects: selectedSubjects,
      notes: notes || undefined,
    });

    // Reset form
    setExamDate(undefined);
    setSelectedSubjects([]);
    setNotes("");
  };

  const handleCancel = () => {
    setExamDate(editingSchedule ? new Date(editingSchedule.exam_date) : undefined);
    setSelectedSubjects(editingSchedule?.subjects || []);
    setNotes(editingSchedule?.notes || "");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{editingSchedule ? "Edit Exam Date" : "Add Exam Date"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Date Picker */}
          <div className="space-y-2">
            <Label>Exam Date *</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn(
                    "w-full justify-start text-left font-normal",
                    !examDate && "text-muted-foreground"
                  )}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {examDate ? format(examDate, "PPP") : <span>Pick a date</span>}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={examDate}
                  onSelect={setExamDate}
                  initialFocus
                  className="pointer-events-auto"
                />
              </PopoverContent>
            </Popover>
          </div>

          {/* Subject Selection */}
          <div className="space-y-2">
            <Label>Subjects * (Select at least one)</Label>
            <div className="space-y-2 border rounded-md p-3">
              {SUBJECTS.map((subject) => (
                <div key={subject.value} className="flex items-center space-x-2">
                  <Checkbox
                    id={subject.value}
                    checked={selectedSubjects.includes(subject.value)}
                    onCheckedChange={() => handleSubjectToggle(subject.value)}
                  />
                  <Label
                    htmlFor={subject.value}
                    className="text-sm font-normal cursor-pointer"
                  >
                    {subject.label}
                  </Label>
                </div>
              ))}
            </div>
            {selectedSubjects.length === 0 && examDate && (
              <p className="text-sm text-destructive">Please select at least one subject</p>
            )}
          </div>

          {/* Notes */}
          <div className="space-y-2">
            <Label htmlFor="notes">Notes (Optional)</Label>
            <Textarea
              id="notes"
              placeholder="Add any additional notes about this exam date..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleCancel}>
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={!examDate || selectedSubjects.length === 0}
          >
            {editingSchedule ? "Update" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
