import { assert, assertEquals, assertRejects } from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { closeStuck, MSG, runSend, scrub, SendError, type Batch, type CommsRow, type Item, type Senders, type SendResult, type Store } from "./handler.ts";
import { buildEmail, buildWhatsAppParams } from "./message.ts";

const P = "123e4567-e89b-12d3-a456-426614174000";

function fixture(opts: { batch?: Partial<Batch>; items: Partial<Item>[]; released?: string[] }) {
  const batch: Batch = { id: "b1", project_id: P, channel: "email", test_target: null, status: "staged", ...opts.batch };
  const rows: Item[] = opts.items.map((p, n) => ({
    id: `i${n + 1}`, batch_id: "b1", school_id: `s${n + 1}`, target: `school${n + 1}@example.com`,
    payload: { schoolName: `School ${n + 1}`, ssNo: `SS${n + 1}`, contactName: "Mr Rao", projectName: "iPlus 2026", files: [{ key: `${P}/SS${n + 1}/results/a.zip`, label: "Score sheets - Part 1 of 1" }] },
    status: "pending", error: null, attempts: 0, ...p,
  }));
  const released = new Set(opts.released ?? rows.map((i) => i.school_id!));
  const comms: CommsRow[] = [];
  const failSave = { on: false };
  // The store hands out COPIES, like a database does, and claims are compare-and-set.
  const store: Store = {
    getBatch: async () => ({ ...batch }),
    claim: async (_id, from) => { if (batch.status !== from) return false; batch.status = "sending"; return true; },
    items: async () => rows.map((r) => ({ ...r, payload: { ...r.payload } })),
    claimItem: async (id, from) => {
      const r = rows.find((x) => x.id === id)!;
      if (r.status !== from) return null;
      r.status = "sending"; r.attempts++; r.error = null;
      return { ...r, payload: { ...r.payload } };
    },
    isReleased: async (_p, s) => released.has(s),
    markItem: async (id, patch) => {
      if (failSave.on && patch.status === "sent") throw new Error("db down");
      const r = rows.find((x) => x.id === id)!;
      if (r.status !== "sending") return false;
      r.status = patch.status; r.error = patch.error; return true;
    },
    finish: async () => { batch.status = "done"; },
    logCommunication: async (c) => { comms.push(c); },
  };
  const sent: { to: string; subject: string; html: string; text: string }[] = [];
  const sleeps: number[] = [];
  const senders: Senders & { failFor: Set<string>; replies: SendResult[] } = {
    failFor: new Set(), replies: [],
    presignGet: async (k) => `https://r2.example/${k}?X-Amz-Expires=604800`,
    sleep: async (ms) => { sleeps.push(ms); },
    email: async (m) => {
      const queued = senders.replies.shift();
      if (queued) { if (!queued.error) sent.push(m); return queued; }
      if (senders.failFor.has(m.to)) return { error: "Mailbox does not exist token=SECRET123" };
      sent.push(m); return { error: null };
    },
    whatsapp: async () => ({ error: null, id: "wamid.1" }),
  };
  return { batch, rows, store, senders, sent, sleeps, comms, failSave };
}

const req = (extra = {}) => ({ batchId: "b1", userId: "u1", ...extra });

Deno.test("sends pending items once and never resends 'sent' items", async () => {
  const f = fixture({ items: [{}, { status: "sent" }, {}] });
  const r1 = await runSend(f.store, f.senders, req());
  assertEquals(r1.sent, 2);
  assertEquals(f.sent.map((m) => m.to), ["school1@example.com", "school3@example.com"]);
  assertEquals(f.batch.status, "done");
  await assertRejects(() => runSend(f.store, f.senders, req()), SendError, "already been sent");
  assertEquals(f.sent.length, 2);
});

Deno.test("two interleaved Retries on the same failed row send exactly once", async () => {
  const f = fixture({ batch: { status: "done" }, items: [{ status: "failed", error: "x", attempts: 1 }] });
  // Both read the row as 'failed' before either claims the batch; the second claim wins only after the first finished.
  const a = runSend(f.store, f.senders, req({ retryItemIds: ["i1"] }));
  const b = runSend(f.store, f.senders, req({ retryItemIds: ["i1"] })).catch((e) => e);
  await Promise.all([a, b]);
  assertEquals(f.sent.length, 1);
  assertEquals(f.rows[0].status, "sent");
  assertEquals(f.rows[0].attempts, 2);
  // A third retry after the batch is done again: the item is 'sent', so nothing goes out.
  const r = await runSend(f.store, f.senders, req({ retryItemIds: ["i1"] }));
  assertEquals(f.sent.length, 1);
  assertEquals(r.skipped, 1);
});

Deno.test("a stale snapshot cannot resend: claim fails when the row moved on", async () => {
  const f = fixture({ batch: { status: "done" }, items: [{ status: "failed" }] });
  const realItems = f.store.items;
  f.store.items = async () => { const s = await realItems(); f.rows[0].status = "sent"; return s; }; // row becomes 'sent' after the snapshot
  const r = await runSend(f.store, f.senders, req({ retryItemIds: ["i1"] }));
  assertEquals(f.sent.length, 0);
  assertEquals(r.skipped, 1);
  assertEquals(f.rows[0].status, "sent");
});

Deno.test("an unreleased school is skipped as failed with the plain reason", async () => {
  const f = fixture({ items: [{}, {}], released: ["s2"] });
  const r = await runSend(f.store, f.senders, req());
  assertEquals(r.sent, 1);
  assertEquals(f.rows[0].status, "failed");
  assertEquals(f.rows[0].error, "School was unreleased before sending.");
});

Deno.test("test mode routes every item to the one test address and logs nothing to communications", async () => {
  const f = fixture({ batch: { test_target: "me@example.com" }, items: [{}, {}, { target: null }] });
  await runSend(f.store, f.senders, req());
  assertEquals(f.sent.map((m) => m.to), ["me@example.com", "me@example.com", "me@example.com"]);
  assert(f.sent.every((m) => m.subject.startsWith("[TEST] ")));
  assertEquals(f.comms.length, 0);
});

Deno.test("a real send logs one communications row per sent item", async () => {
  const f = fixture({ items: [{}, {}] });
  await runSend(f.store, f.senders, req());
  assertEquals(f.comms.length, 2);
  assertEquals(f.comms[0].channel, "email");
  assertEquals(f.comms[0].user_id, "u1");
});

Deno.test("a provider error is recorded as a fixed message; provider text and tokens are never stored", async () => {
  const f = fixture({ items: [{}, {}, {}] });
  f.senders.failFor = new Set(["school2@example.com"]);
  const r = await runSend(f.store, f.senders, req());
  assertEquals([r.sent, r.failed], [2, 1]);
  assertEquals(f.rows[1].status, "failed");
  assertEquals(f.rows[1].error, MSG.email);
  assert(!JSON.stringify(f.rows).includes("SECRET123"));
  assertEquals(f.batch.status, "done");
  assertEquals(scrub("fetch failed https://x/y?token=abc123&a=1"), "fetch failed https://x/y?token=***&a=1");
});

Deno.test("sends are spaced out and a 429 is retried once before anything is recorded", async () => {
  const f = fixture({ items: [{}, {}] });
  f.senders.replies = [{ error: "slow", rateLimited: true }, { error: null }, { error: null }];
  const r = await runSend(f.store, f.senders, req());
  assertEquals(r.sent, 2);
  assert(f.sleeps.includes(550));
  assert(f.sleeps.includes(2500));
  assertEquals(f.rows[0].attempts, 1); // one claim, though two provider calls
});

Deno.test("if the provider accepted the message but 'sent' cannot be saved, it is never marked failed", async () => {
  const f = fixture({ items: [{}] });
  f.failSave.on = true;
  const r = await runSend(f.store, f.senders, req());
  assertEquals(f.sent.length, 1);
  assertEquals(r.failed, 0);
  assertEquals(r.unrecorded, 1);
  assertEquals(f.rows[0].status, "sending"); // stuck; the superadmin closes it as 'unknown'
});

Deno.test("retry sends only the listed failed rows, never sent or unknown ones", async () => {
  const f = fixture({ batch: { status: "done" }, items: [{ status: "sent" }, { status: "failed", error: "x", attempts: 1 }, { status: "failed", error: "y" }, { status: "unknown" }] });
  const r = await runSend(f.store, f.senders, req({ retryItemIds: ["i1", "i2", "i4"] }));
  assertEquals(f.sent.map((m) => m.to), ["school2@example.com"]);
  assertEquals(r.skipped, 2);
  assertEquals(f.rows[2].status, "failed");
  assertEquals(f.rows[3].status, "unknown");
});

Deno.test("a batch that is not staged cannot be sent; a staged batch cannot be 'retried'", async () => {
  const sending = fixture({ batch: { status: "sending" }, items: [{}] });
  await assertRejects(() => runSend(sending.store, sending.senders, req()), SendError, "already running");
  const staged = fixture({ items: [{ status: "failed" }] });
  await assertRejects(() => runSend(staged.store, staged.senders, req({ retryItemIds: ["i1"] })), SendError);
  assertEquals(staged.sent.length, 0);
});

Deno.test("items that failed while staging stay failed on a first send", async () => {
  const f = fixture({ items: [{ status: "failed", target: null, error: "This school has no email address on file." }, {}] });
  const r = await runSend(f.store, f.senders, req());
  assertEquals(r.sent, 1);
  assertEquals(f.rows[0].error, "This school has no email address on file.");
});

Deno.test("no files, wrong-school files and thrown errors fail with fixed messages", async () => {
  const f = fixture({ items: [{ payload: { files: [] } }, { payload: { ssNo: "SS2", files: [{ key: `${P}/SS99/results/a.zip`, label: "x" }] } }, {}] });
  f.senders.presignGet = async () => { throw new Error("R2 down https://a?token=zzz"); };
  await runSend(f.store, f.senders, req());
  assertEquals(f.rows[0].error, MSG.noFiles);
  assertEquals(f.rows[1].error, MSG.badFiles);
  assertEquals(f.rows[2].error, MSG.other);
});

Deno.test("preview and send use the staged snapshot of contact and project name", async () => {
  const f = fixture({ items: [{}] });
  await runSend(f.store, f.senders, req());
  assert(f.sent[0].text.startsWith("Dear Mr Rao,"));
  assert(f.sent[0].subject.includes("iPlus 2026"));
});

Deno.test("WhatsApp without a configured template is refused before anything is claimed", async () => {
  const f = fixture({ batch: { channel: "whatsapp" }, items: [{}] });
  await assertRejects(() => runSend(f.store, f.senders, req()), SendError, "WhatsApp template not set up yet");
  assertEquals(f.batch.status, "staged");
});

Deno.test("closing a stuck send marks 'sending' rows unknown, never retryable, and finishes the batch", async () => {
  const f = fixture({ batch: { status: "sending", approved_at: "2026-11-01T00:00:00Z" }, items: [{ status: "sending" }, { status: "pending" }, { status: "sent" }] });
  const unknown: string[] = [], notSent: string[] = [];
  const r = await closeStuck({ ...f.store, setUnknown: async (ids) => { unknown.push(...ids); }, failPending: async (ids) => { notSent.push(...ids); } }, "b1", Date.parse("2026-11-02T00:00:00Z"));
  assertEquals(r, { unknown: 1, notSent: 1 });
  assertEquals(unknown, ["i1"]);
  assertEquals(f.batch.status, "done");
  const young = fixture({ batch: { status: "sending", approved_at: new Date().toISOString() }, items: [{ status: "sending" }] });
  await assertRejects(() => closeStuck({ ...young.store, setUnknown: async () => {}, failPending: async () => {} }, "b1"), SendError, "15 minutes");
});

Deno.test("message builders escape html, include every link and never produce empty WhatsApp params", () => {
  const m = buildEmail({ schoolName: "A <b>&</b> School", links: [{ label: "Score sheets", url: "https://x/y?a=1&b=2" }], testMode: false, projectName: null });
  assert(m.html.includes("A &lt;b&gt;&amp;&lt;/b&gt; School"));
  assert(m.html.includes('href="https://x/y?a=1&amp;b=2"'));
  const p = buildWhatsAppParams([{ index: 1, source: "contact_person" }, { index: 2, source: "custom", customText: " " }], { schoolName: "S", links: [] });
  assertEquals(p, ["S", "-"]);
});
