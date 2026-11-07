const UUID = "[0-9a-f-]{36}";
const KEY_RE = new RegExp(`^${UUID}/(papers|reports|exports|uploads)/[A-Za-z0-9._-]+$`);
// Results zips sent to schools: {project_id}/{ss_no}/results/{file}
const RESULTS_KEY_RE = new RegExp(`^${UUID}/[A-Za-z0-9_-]{1,40}/results/[A-Za-z0-9._-]+$`);

const dotsOnly = (name: string) => /^\.+$/.test(name);

export function isAllowedKey(key: string): boolean {
  if (typeof key !== "string") return false;
  if (KEY_RE.test(key)) {
    // A file name made only of dots ("." or "..") is a path traversal.
    return !dotsOnly(key.split("/")[2]);
  }
  if (RESULTS_KEY_RE.test(key)) return !dotsOnly(key.split("/")[3]);
  return false;
}

/** The school folder in a results key: the school's SS number reduced to safe characters. */
export const ssSegment = (ssNo: string | number | null | undefined): string =>
  String(ssNo ?? "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40);

/** File name part of a results key: anything unsafe becomes an underscore. */
export const resultsFileName = (name: string): string =>
  name.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^\.+/, "_").slice(0, 150) || "results.zip";

export const resultsKeyPrefix = (projectId: string, ssNo: string | number | null | undefined): string =>
  `${projectId}/${ssSegment(ssNo)}/results/`;

export const ALLOWED_UPLOAD_TYPES = ["application/pdf", "application/zip", "text/csv"];

// Official answer key for a paper: {project_id}/papers/{paper_id}-key.{pdf|jpg|jpeg|png}
const ANSWER_KEY_RE = new RegExp(`^(${UUID})/papers/(${UUID})-key\\.(pdf|jpg|jpeg|png)$`);
const KEY_MEDIA: Record<string, "application/pdf" | "image/jpeg" | "image/png"> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
};

/** The answer-key file of one paper, or null when `key` is not one. */
export function parseAnswerKeyKey(
  key: string,
): { projectId: string; paperId: string; mediaType: "application/pdf" | "image/jpeg" | "image/png" } | null {
  if (typeof key !== "string") return null;
  const m = ANSWER_KEY_RE.exec(key);
  if (!m || !isAllowedKey(key)) return null;
  return { projectId: m[1], paperId: m[2], mediaType: KEY_MEDIA[m[3]] };
}

export const answerKeyKey = (projectId: string, paperId: string, ext: "pdf" | "jpg" | "jpeg" | "png"): string =>
  `${projectId}/papers/${paperId}-key.${ext}`;

/**
 * Upload content types: PDF / ZIP / CSV anywhere allowed; JPEG / PNG only for an
 * answer-key photo, and only when the type matches the file extension.
 */
export function isAllowedUpload(key: string, contentType: string | undefined): boolean {
  if (!contentType) return false;
  if (ALLOWED_UPLOAD_TYPES.includes(contentType)) return true;
  const k = parseAnswerKeyKey(key);
  return !!k && k.mediaType === contentType;
}
