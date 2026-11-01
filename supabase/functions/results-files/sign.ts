import { AwsClient } from "npm:aws4fetch@1";

export const EXPIRES_IN = 900;

export interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
}

export function objectUrl(cfg: R2Config, key: string): string {
  return `https://${cfg.accountId}.r2.cloudflarestorage.com/${cfg.bucket}/${key}`;
}

function client(cfg: R2Config): AwsClient {
  return new AwsClient({
    accessKeyId: cfg.accessKeyId,
    secretAccessKey: cfg.secretAccessKey,
    service: "s3",
    region: "auto",
  });
}

/** Returns a presigned URL (query-signed, valid 900 s unless expiresIn is given) for GET or PUT. */
export async function presign(
  cfg: R2Config,
  method: "GET" | "PUT",
  key: string,
  contentType?: string,
  expiresIn: number = EXPIRES_IN,
): Promise<string> {
  const url = `${objectUrl(cfg, key)}?X-Amz-Expires=${expiresIn}`;
  const headers: Record<string, string> = {};
  if (method === "PUT" && contentType) headers["Content-Type"] = contentType;
  const signed = await client(cfg).sign(url, {
    method,
    headers,
    aws: { signQuery: true },
  });
  return signed.url;
}

/** Performs a signed DELETE server-side. */
export async function deleteObject(cfg: R2Config, key: string): Promise<Response> {
  return await client(cfg).fetch(objectUrl(cfg, key), { method: "DELETE" });
}
