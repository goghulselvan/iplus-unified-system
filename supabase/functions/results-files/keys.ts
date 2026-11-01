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
