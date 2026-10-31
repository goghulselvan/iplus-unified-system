import { supabase } from "@/integrations/supabase/client";

export type UploadKind = "pdf" | "zip" | "csv";

const MAX_BYTES = 50 * 1024 * 1024;
const CONTENT_TYPES: Record<UploadKind, string> = {
  pdf: "application/pdf",
  zip: "application/zip",
  csv: "text/csv",
};
const FAILED = "Upload failed — check the internet connection and try again";
const CANCELLED = "Upload cancelled";

type PresignBody = { action: "upload"; key: string; contentType: string };
type PresignResult = {
  data: { url?: string; expiresIn?: number; error?: string } | null;
  error: unknown;
};
export interface UploadDeps {
  presign: (body: PresignBody) => Promise<PresignResult>;
}

const defaultDeps: UploadDeps = {
  presign: (body) =>
    supabase.functions.invoke("results-files", { body }) as unknown as Promise<PresignResult>,
};

// functions.invoke does not reject on HTTP errors: the plain-English message
// lives in data.error, or in the error's response body for non-2xx replies.
async function presignMessage(r: PresignResult): Promise<string | null> {
  if (r.data?.error) return r.data.error;
  if (r.error) {
    try {
      const ctx = (r.error as { context?: Response }).context;
      const body = ctx && (await ctx.json());
      if (body && typeof body.error === "string") return body.error;
    } catch {
      /* fall through to the generic message */
    }
    return FAILED;
  }
  if (!r.data?.url) return FAILED;
  return null;
}

export async function uploadWithProgress(
  file: File,
  key: string,
  onProgress: (pct: number) => void,
  signal?: AbortSignal,
  accept: UploadKind[] = ["pdf"],
  deps: UploadDeps = defaultDeps,
): Promise<void> {
  const ext = file.name.includes(".") ? file.name.split(".").pop()!.toLowerCase() : "";
  const kind = accept.find((k) => k === ext);
  if (!kind) {
    throw new Error(`Only ${accept.map((k) => k.toUpperCase()).join(" or ")} files can be uploaded here`);
  }
  if (file.size > MAX_BYTES) throw new Error("The file is larger than 50 MB");
  if (signal?.aborted) throw new Error(CANCELLED);

  const contentType = CONTENT_TYPES[kind];
  let presigned: PresignResult;
  try {
    presigned = await deps.presign({ action: "upload", key, contentType });
  } catch {
    throw new Error(signal?.aborted ? CANCELLED : FAILED);
  }
  const problem = await presignMessage(presigned);
  if (problem) throw new Error(problem);
  if (signal?.aborted) throw new Error(CANCELLED);
  const url = presigned.data!.url!;

  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let last = 0;
    const report = (pct: number) => {
      const n = Math.max(0, Math.min(99, Math.floor(pct))); // 100 only after onload succeeds
      if (n > last) {
        last = n;
        onProgress(n);
      }
    };
    const onAbortSignal = () => xhr.abort();
    const done = () => signal?.removeEventListener("abort", onAbortSignal);

    xhr.upload.onprogress = (e: ProgressEvent) => {
      if (e.lengthComputable && e.total > 0) report((e.loaded / e.total) * 100);
    };
    xhr.onload = () => {
      done();
      if (xhr.status >= 200 && xhr.status < 300) {
        if (last < 100) {
          last = 100;
          onProgress(100);
        }
        resolve();
      } else {
        reject(new Error(FAILED));
      }
    };
    xhr.onerror = () => { done(); reject(new Error(FAILED)); };
    xhr.onabort = () => { done(); reject(new Error(CANCELLED)); };

    signal?.addEventListener("abort", onAbortSignal);
    try {
      xhr.open("PUT", url);
      xhr.setRequestHeader("Content-Type", contentType);
      xhr.send(file);
    } catch {
      done();
      reject(new Error(FAILED));
    }
  });
}
