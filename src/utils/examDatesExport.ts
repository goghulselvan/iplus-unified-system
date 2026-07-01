import { ExamDateSummary } from "@/hooks/useExamDatesSummary";
import { format } from "date-fns";

export const exportExamDatesToCSV = (data: ExamDateSummary[], filename: string = "exam_dates.csv") => {
  // Create CSV header
  const headers = ["S.No", "SS No.", "School Name", "Exam Date", "Subjects"];
  const csvRows = [headers.join(",")];

  // Add data rows
  data.forEach((school, index) => {
    school.exam_dates.forEach((examDate, examIndex) => {
      const row = [
        examIndex === 0 ? (index + 1).toString() : "", // S.No only on first row for each school
        examIndex === 0 ? school.ss_no.toString() : "", // SS No only on first row
        examIndex === 0 ? `"${school.school_name}"` : "", // School Name only on first row
        format(new Date(examDate.date), "dd-MM-yyyy"),
        `"${examDate.subjects.join(", ")}"`,
      ];
      csvRows.push(row.join(","));
    });
  });

  // Create blob and download
  const csvContent = csvRows.join("\n");
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);

  link.setAttribute("href", url);
  link.setAttribute("download", filename);
  link.style.visibility = "hidden";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

export const exportSingleSchoolToCSV = (school: ExamDateSummary) => {
  const filename = `exam_dates_${school.ss_no}_${school.school_name.replace(/[^a-z0-9]/gi, "_").toLowerCase()}.csv`;
  exportExamDatesToCSV([school], filename);
};
