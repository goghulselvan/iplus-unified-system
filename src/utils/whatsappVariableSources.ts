// Shared catalog of variable sources available for WhatsApp template body variables.
// Used by the admin UI dropdown AND mirrored in the edge function for resolution.

export interface VariableSource {
  key: string;
  label: string;
  description: string;
}

export const WHATSAPP_VARIABLE_SOURCES: VariableSource[] = [
  { key: "school_name", label: "School Name", description: "schools.school_name" },
  { key: "ss_no", label: "SS No", description: "schools.ss_no" },
  { key: "contact_person", label: "Contact Person", description: "schools.contact_person_name" },
  { key: "mobile1", label: "Mobile (Primary)", description: "schools.mobile1" },
  { key: "district", label: "District", description: "schools.district" },
  { key: "state", label: "State", description: "schools.state" },
  { key: "board", label: "Board", description: "schools.board" },
  { key: "project_name", label: "Project Name", description: "active project name" },
  { key: "project_year", label: "Project Year", description: "active project year" },
  { key: "student_count", label: "Student Count", description: "registered students for school+project" },
  { key: "payment_amount", label: "Payment Received", description: "school_project_workflow.payment_received" },
  { key: "payment_date", label: "Payment Date", description: "school_project_workflow.payment_date" },
  { key: "expected_amount", label: "Expected Amount", description: "school_project_workflow.expected_amount" },
  { key: "outstanding_balance", label: "Outstanding Balance", description: "school_project_workflow.outstanding_balance" },
  { key: "registration_status", label: "Registration Status", description: "school_project_workflow.registration_status" },
  { key: "custom", label: "Custom Text", description: "Free text entered by admin" },
];

export const WHATSAPP_TEMPLATE_TYPES = [
  { value: "text", label: "Text (no variables)" },
  { value: "text_with_vars", label: "Text with variables" },
  { value: "image", label: "Image (no variables)" },
  { value: "image_with_vars", label: "Image with variables" },
  { value: "video", label: "Video (no variables)" },
  { value: "video_with_vars", label: "Video with variables" },
  { value: "document", label: "Document (no variables)" },
  { value: "document_with_vars", label: "Document with variables" },
  { value: "authentication", label: "Authentication (OTP)" },
  { value: "carousel", label: "Carousel" },
] as const;

export const WHATSAPP_LANGUAGE_CODES = [
  { value: "en_US", label: "English US (en_US)" },
  { value: "en_GB", label: "English UK (en_GB)" },
  { value: "en", label: "English generic (en)" },
  { value: "ta", label: "Tamil (ta)" },
  { value: "hi", label: "Hindi (hi)" },
  { value: "te", label: "Telugu (te)" },
  { value: "ml", label: "Malayalam (ml)" },
  { value: "kn", label: "Kannada (kn)" },
  { value: "mr", label: "Marathi (mr)" },
];

export interface BodyVariable {
  index: number; // 1-based, matches {{1}}, {{2}}, ...
  source: string; // key from WHATSAPP_VARIABLE_SOURCES
  customText?: string; // only used when source === 'custom'
}

export const typeNeedsVariables = (t: string) =>
  t === "text_with_vars" ||
  t === "image_with_vars" ||
  t === "video_with_vars" ||
  t === "document_with_vars" ||
  t === "authentication";

export const typeHasMediaHeader = (t: string) =>
  t === "image" || t === "image_with_vars" ||
  t === "video" || t === "video_with_vars" ||
  t === "document" || t === "document_with_vars";

export const typeIsDocument = (t: string) =>
  t === "document" || t === "document_with_vars";
