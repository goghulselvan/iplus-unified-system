import { isAllowedKey, resultsKeyPrefix } from "../results-files/keys.ts";
import { buildEmail, buildWhatsAppParams, type Link, type ResultsFile, type WaVar } from "./message.ts";

export class SendError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export type ItemStatus = "pending" | "sending" | "sent" | "failed" | "unknown";
export interface Batch { id: string; project_id: string; channel: "email" | "whatsapp"; test_target: string | null; status: "staged" | "sending" | "done"; approved_by?: string | null; approved_at?: string | null }
export interface Item {
  id: string; batch_id: string; school_id: string | null; target: string | null;
  // contactName / projectName are snapshotted when the files are attached (staging time).
  payload: { schoolName?: string; ssNo?: string; contactName?: string | null; projectName?: string | null; files?: ResultsFile[]; [k: string]: unknown };
  status: ItemStatus; error: string | null; attempts: number;
}

export interface CommsRow {
  school_id: string; project_id: string; user_id: string; channel: "email" | "whatsapp";
  message: string; ok: boolean; mobile?: string | null; wamid?: string | null;
}

export interface Store {
  getBatch(id: string): Promise<Batch | null>;
  /** Atomically moves the batch from `from` to 'sending'. False if it was not in `from`. */
  claim(id: string, from: "staged" | "done", userId: string): Promise<boolean>;
  /** Candidate items (ids and current status). Rows are re-read when claimed. */
  items(batchId: string): Promise<Item[]>;
  /**
   * UPDATE ... SET status='sending', attempts=attempts+1 WHERE id=$1 AND status=$from RETURNING *.
   * Null when the row was not in `from` (someone else got it, or it was already sent).
   */
  claimItem(id: string, from: "pending" | "failed"): Promise<Item | null>;
  isReleased(projectId: string, schoolId: string): Promise<boolean>;
  /** UPDATE ... WHERE id=$1 AND status='sending'. False when no row matched (never overwrites sent/failed). */
  markItem(id: string, patch: { status: "sent" | "failed"; error: string | null }): Promise<boolean>;
  finish(id: string): Promise<void>;
  logCommunication(row: CommsRow): Promise<void>;
}

export interface SendResult { error?: string | null; rateLimited?: boolean; id?: string | null }
export interface Senders {
  /** Resend: must resolve (never throw) with `error` set on failure. The text is never stored. */
  email(m: { to: string; subject: string; html: string; text: string }): Promise<SendResult>;
  whatsapp(m: { to: string; params: string[] }): Promise<SendResult>;
  /** Presigned GET, 7-day expiry. */
  presignGet(key: string): Promise<string>;
  /** Pause between sends (Resend allows about 2 requests a second). */
  sleep?(ms: number): Promise<void>;
}

export interface WhatsAppConfig { vars: WaVar[] }
export interface SendRequest {
  batchId: string; userId: string;
  /** Retry mode: only these items, and only if they are 'failed'. */
  retryItemIds?: string[];
  whatsapp?: WhatsAppConfig | null;
}
export interface SendSummary {
  sent: number; failed: number; skipped: number;
  /** Provider accepted the message but we could not save 'sent'. Row stays 'sending'; close the stuck send to review it. */
  unrecorded: number;
  results: { itemId: string; status: "sent" | "failed"; error: string | null }[];
}

export const SEND_GAP_MS = 550;
export const RATE_LIMIT_WAIT_MS = 2500;

/** Fixed messages only: provider and network error text is never stored (it can contain tokens or addresses). */
export const MSG = {
  unreleased: "School was unreleased before sending.",
  noSchool: "This school no longer exists.",
  noEmail: "This school has no email address on file.",
  noMobile: "This school has no mobile number on file.",
  noFiles: "No result files were uploaded for this school.",
  badFiles: "The result files for this school are not valid. Prepare the batch again.",
  email: "The email service did not accept this message.",
  whatsapp: "The WhatsApp service did not accept this message.",
  busy: "The service was busy. Try again in a minute.",
  other: "The message could not be sent.",
} as const;

/** Defence in depth for any text kept from elsewhere: removes token=... and caps the length. */
export const scrub = (s: string) => s.replace(/token=[^&\s)"']+/gi, "token=***").slice(0, 300);

export const STUCK_MSG = "Unknown. Check with the school before retrying.";
export const STUCK_AFTER_MS = 15 * 60 * 1000;

export async function runSend(store: Store, senders: Senders, req: SendRequest): Promise<SendSummary> {
  const sleep = senders.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
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
  const from = retry ? "failed" : "pending";
  const wanted = retry ? new Set(req.retryItemIds) : null;
  // Candidates only; the real decision is the atomic claim below.
  const todo = all.filter((it) => (retry ? wanted!.has(it.id) : true) && it.status === from).map((it) => it.id);
  let skipped = retry ? wanted!.size - todo.length : 0;

  if (!(await store.claim(batch.id, retry ? "done" : "staged", req.userId))) {
    throw new SendError(409, "This send has already been started by someone else.");
  }

  const results: SendSummary["results"] = [];
  let unrecorded = 0;
  const one = async (id: string) => {
    // Atomic per-item claim; items are read from the claimed row, not from the earlier snapshot.
    const it = await store.claimItem(id, from);
    if (!it) { skipped++; return; }
    const fail = async (error: string) => {
      const ok = await store.markItem(it.id, { status: "failed", error });
      if (ok) results.push({ itemId: it.id, status: "failed", error });
    };
    let accepted: SendResult | null = null;
    let to = "";
    let subject = "";
    try {
      if (!it.school_id) return await fail(MSG.noSchool);
      // The release can still change between this check and the send; that small window is accepted.
      if (!(await store.isReleased(batch.project_id, it.school_id))) return await fail(MSG.unreleased);
      const t = batch.test_target ?? it.target; // test mode: every item goes to the one typed target
      if (!t) return await fail(batch.channel === "email" ? MSG.noEmail : MSG.noMobile);
      to = t;
      const files = it.payload.files ?? [];
      if (files.length === 0) return await fail(MSG.noFiles);
      const prefix = resultsKeyPrefix(batch.project_id, it.payload.ssNo);
      if (!files.every((f) => f.key.startsWith(prefix) && isAllowedKey(f.key))) return await fail(MSG.badFiles);
      const links: Link[] = [];
      for (const f of files) links.push({ label: f.label, url: await senders.presignGet(f.key) });
      const info = {
        schoolName: it.payload.schoolName ?? "your school", contactName: it.payload.contactName ?? null,
        projectName: it.payload.projectName ?? null, links,
      };
      const msg = batch.channel === "email" ? buildEmail({ ...info, testMode: batch.test_target != null }) : null;
      subject = msg?.subject ?? "Results link";
      const attempt = () => msg
        ? senders.email({ to, subject: msg.subject, html: msg.html, text: msg.text })
        : senders.whatsapp({ to, params: buildWhatsAppParams(req.whatsapp!.vars, info) });
      let r = await attempt();
      if (r.error && r.rateLimited) { await sleep(RATE_LIMIT_WAIT_MS); r = await attempt(); } // one back-off retry, before anything is recorded
      if (r.error) return await fail(r.rateLimited ? MSG.busy : batch.channel === "email" ? MSG.email : MSG.whatsapp);
      accepted = r;
    } catch (_e) {
      return await fail(MSG.other);
    }
    // The provider accepted the message. From here on it is never marked failed.
    let saved = false;
    for (let k = 0; k < 3 && !saved; k++) {
      try { saved = await store.markItem(it.id, { status: "sent", error: null }); } catch { /* retry */ }
    }
    if (!saved) {
      unrecorded++;
      console.error(`results-send: item ${it.id} was accepted by the provider but 'sent' could not be saved`);
    } else {
      results.push({ itemId: it.id, status: "sent", error: null });
    }
    if (!batch.test_target && it.school_id) {
      try {
        await store.logCommunication({
          school_id: it.school_id, project_id: batch.project_id, user_id: req.userId, channel: batch.channel,
          message: subject, ok: true, mobile: batch.channel === "whatsapp" ? to : null, wamid: accepted.id ?? null,
        });
      } catch { /* logging must never change the outcome */ }
    }
  };

  // One at a time, spaced out, so Resend's rate limit is respected. Batch finishes only after every item has settled.
  try {
    const settled: PromiseSettledResult<void>[] = [];
    for (let i = 0; i < todo.length; i++) {
      if (i > 0) await sleep(SEND_GAP_MS);
      const [s] = await Promise.allSettled([one(todo[i])]);
      settled.push(s);
    }
  } finally {
    await store.finish(batch.id);
  }
  return {
    sent: results.filter((r) => r.status === "sent").length,
    failed: results.filter((r) => r.status === "failed").length,
    skipped, unrecorded, results,
  };
}

/** Superadmin "Close a stuck send": only for a batch left in 'sending' for a while. */
export async function closeStuck(
  store: Pick<Store, "getBatch" | "items" | "finish"> & { setUnknown(ids: string[], msg: string): Promise<void>; failPending(ids: string[], msg: string): Promise<void> },
  batchId: string, now = Date.now(),
): Promise<{ unknown: number; notSent: number }> {
  const b = await store.getBatch(batchId);
  if (!b) throw new SendError(404, "This send could not be found.");
  if (b.status !== "sending") throw new SendError(409, "This send is not stuck.");
  if (b.approved_at && now - new Date(b.approved_at).getTime() < STUCK_AFTER_MS) {
    throw new SendError(409, "This send started less than 15 minutes ago. Give it more time.");
  }
  const items = await store.items(b.id);
  const sending = items.filter((i) => i.status === "sending").map((i) => i.id);
  const waiting = items.filter((i) => i.status === "pending").map((i) => i.id);
  await store.setUnknown(sending, STUCK_MSG);
  await store.failPending(waiting, "Not sent: the send stopped before reaching this school.");
  await store.finish(b.id);
  return { unknown: sending.length, notSent: waiting.length };
}
