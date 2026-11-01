import { buildEmail, buildWhatsAppParams, type Link, type ResultsFile, type WaVar } from "./message.ts";

export class SendError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export interface Batch { id: string; project_id: string; channel: "email" | "whatsapp"; test_target: string | null; status: "staged" | "sending" | "done" }
export interface Item {
  id: string; batch_id: string; school_id: string | null; target: string | null;
  payload: { schoolName?: string; ssNo?: string; files?: ResultsFile[]; [k: string]: unknown };
  status: "pending" | "sent" | "failed"; error: string | null; attempts: number;
}
export interface SchoolInfo { school_name: string | null; contact_person_name: string | null; principal_name: string | null }

export interface Store {
  getBatch(id: string): Promise<Batch | null>;
  /** Atomically moves the batch from `from` to 'sending'. False if it was not in `from`. */
  claim(id: string, from: "staged" | "done", userId: string): Promise<boolean>;
  items(batchId: string): Promise<Item[]>;
  isReleased(projectId: string, schoolId: string): Promise<boolean>;
  school(schoolId: string): Promise<SchoolInfo | null>;
  markItem(id: string, patch: { status: "sent" | "failed"; error: string | null; attempts: number }): Promise<void>;
  finish(id: string): Promise<void>;
}

export interface Senders {
  /** Resend: must resolve (never throw) with { error } set on failure. */
  email(m: { to: string; subject: string; html: string; text: string }): Promise<{ error?: string | null }>;
  whatsapp(m: { to: string; params: string[] }): Promise<{ error?: string | null }>;
  /** Presigned GET, 7-day expiry. */
  presignGet(key: string): Promise<string>;
}

export interface WhatsAppConfig { vars: WaVar[] }

export interface SendRequest {
  batchId: string;
  userId: string;
  /** Retry mode: only these items, and only if they are 'failed'. */
  retryItemIds?: string[];
  projectName?: string | null;
  whatsapp?: WhatsAppConfig | null;
}

export interface SendSummary { sent: number; failed: number; skipped: number; results: { itemId: string; status: "sent" | "failed"; error: string | null }[] }

const CONCURRENCY = 4;

export async function runSend(store: Store, senders: Senders, req: SendRequest): Promise<SendSummary> {
  const batch = await store.getBatch(req.batchId);
  if (!batch) throw new SendError(404, "This send could not be found.");
  const retry = !!req.retryItemIds;
  if (retry) {
    if (req.retryItemIds!.length === 0) throw new SendError(400, "Choose the failed rows to retry.");
    if (batch.status !== "done") throw new SendError(409, batch.status === "sending" ? "This send is still running." : "Only a finished send can be retried.");
  } else if (batch.status !== "staged") {
    throw new SendError(409, batch.status === "sending" ? "This send is already running." : "This send has already been sent.");
  }
  if (batch.channel === "whatsapp" && !req.whatsapp) throw new SendError(400, "WhatsApp template not set up yet.");

  const all = await store.items(batch.id);
  // Never 'sent' items; never anything but 'pending' on a first send (rows that failed
  // while staging, e.g. no address, stay failed); on retry only the listed 'failed' rows.
  const wanted = retry ? new Set(req.retryItemIds) : null;
  const todo = all.filter((it) => (retry ? wanted!.has(it.id) && it.status === "failed" : it.status === "pending"));
  const skipped = (retry ? wanted!.size : 0) - (retry ? todo.length : 0);

  if (!(await store.claim(batch.id, retry ? "done" : "staged", req.userId))) {
    throw new SendError(409, "This send has already been started by someone else.");
  }

  const results: SendSummary["results"] = [];
  const one = async (it: Item) => {
    const attempts = it.attempts + 1;
    const fail = async (error: string) => {
      await store.markItem(it.id, { status: "failed", error, attempts });
      results.push({ itemId: it.id, status: "failed", error });
    };
    try {
      if (!it.school_id || !(await store.isReleased(batch.project_id, it.school_id))) {
        return await fail("School was unreleased before sending.");
      }
      const to = batch.test_target ?? it.target; // test mode: every item goes to the one typed target
      if (!to) return await fail(batch.channel === "email" ? "This school has no email address on file." : "This school has no mobile number on file.");
      const files = it.payload.files ?? [];
      if (files.length === 0) return await fail("No result files were uploaded for this school.");
      const links: Link[] = [];
      for (const f of files) links.push({ label: f.label, url: await senders.presignGet(f.key) });
      const school = await store.school(it.school_id);
      const schoolName = school?.school_name ?? it.payload.schoolName ?? "your school";
      const contactName = school?.contact_person_name || school?.principal_name || null;
      const testMode = batch.test_target != null;
      const r = batch.channel === "email"
        ? await senders.email({ to, ...buildEmail({ schoolName, contactName, projectName: req.projectName, links, testMode }) })
        : await senders.whatsapp({ to, params: buildWhatsAppParams(req.whatsapp!.vars, { schoolName, contactName, projectName: req.projectName, links }) });
      if (r.error) return await fail(String(r.error).slice(0, 500));
      await store.markItem(it.id, { status: "sent", error: null, attempts });
      results.push({ itemId: it.id, status: "sent", error: null });
    } catch (e) {
      await fail((e instanceof Error ? e.message : String(e)).slice(0, 500) || "The message could not be sent.");
    }
  };

  try {
    const queue = [...todo];
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
      for (let it = queue.shift(); it; it = queue.shift()) await one(it);
    }));
  } finally {
    await store.finish(batch.id);
  }
  return {
    sent: results.filter((r) => r.status === "sent").length,
    failed: results.filter((r) => r.status === "failed").length,
    skipped,
    results,
  };
}
