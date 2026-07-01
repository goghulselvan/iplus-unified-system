import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/useAuth";
import {
  useSourceStudentByRegNumber,
  useStudentReport,
  useStartAnalysisJob,
} from "@/hooks/useOlympiadResults";
import { RefreshCw } from "lucide-react";
import { stripSubjectPrefix } from "@/utils/registrationNumberFormatter";

interface Props {
  registrationNumber: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const StudentResultModal = ({ registrationNumber, open, onOpenChange }: Props) => {
  const { profile } = useAuth();
  const isSuperadmin = profile?.role === "superadmin";

  const studentQ = useSourceStudentByRegNumber(registrationNumber || undefined);
  const reportQ = useStudentReport(studentQ.data?.id);
  const startJob = useStartAnalysisJob();

  const handleRegen = () => {
    if (!studentQ.data) return;
    startJob.mutate({
      school_id: studentQ.data.school_id || undefined,
      class_code: studentQ.data.class_code || undefined,
      subject_code: studentQ.data.subject_code ?? undefined,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {studentQ.data?.student_name || "Student Result"}
          </DialogTitle>
        </DialogHeader>

        {studentQ.isLoading ? (
          <Skeleton className="h-40" />
        ) : !studentQ.data ? (
          <p className="text-sm text-muted-foreground">
            No student found with this registration number.
          </p>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2 text-sm">
              <Badge variant="outline">Reg: {stripSubjectPrefix(studentQ.data.registration_number)}</Badge>
              {studentQ.data.class_code && (
                <Badge variant="outline">Class: {studentQ.data.class_code}</Badge>
              )}
              {studentQ.data.subject_code !== null &&
                studentQ.data.subject_code !== undefined && (
                  <Badge variant="outline">Subject: {studentQ.data.subject_code}</Badge>
                )}
            </div>

            <div className="border-t pt-4">
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-semibold">AI Report</h3>
                {isSuperadmin && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleRegen}
                    disabled={startJob.isPending}
                  >
                    <RefreshCw className="h-3 w-3 mr-1" />
                    Regenerate
                  </Button>
                )}
              </div>
              {reportQ.isLoading ? (
                <Skeleton className="h-32" />
              ) : !reportQ.data ? (
                <p className="text-sm text-muted-foreground">
                  No AI report generated yet.
                </p>
              ) : (
                <div className="space-y-3 text-sm">
                  {reportQ.data.motivational_message && (
                    <Section label="Message" body={reportQ.data.motivational_message} />
                  )}
                  {reportQ.data.strengths && (
                    <Section label="Strengths" body={reportQ.data.strengths} />
                  )}
                  {reportQ.data.focus_areas && (
                    <Section label="Focus Areas" body={reportQ.data.focus_areas} />
                  )}
                  {reportQ.data.short_term_goals && (
                    <Section label="Short-Term Goals" body={reportQ.data.short_term_goals} />
                  )}
                  {reportQ.data.quick_tips && (
                    <Section label="Quick Tips" body={reportQ.data.quick_tips} />
                  )}
                  {reportQ.data.ai_feedback && (
                    <Section label="Detailed Feedback" body={reportQ.data.ai_feedback} />
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

const Section = ({ label, body }: { label: string; body: string }) => (
  <div>
    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
      {label}
    </p>
    <p className="mt-1 whitespace-pre-wrap">{body}</p>
  </div>
);
