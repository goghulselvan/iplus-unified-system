const KEY_RE = /^[0-9a-f-]{36}\/(papers|reports|exports|uploads)\/[A-Za-z0-9._-]+$/;

export function isAllowedKey(key: string): boolean {
  if (typeof key !== "string" || !KEY_RE.test(key)) return false;
  const name = key.split("/")[2];
  // A file name made only of dots ("." or "..") is a path traversal.
  return !/^\.+$/.test(name);
}

export const ALLOWED_UPLOAD_TYPES = ["application/pdf", "application/zip", "text/csv"];
