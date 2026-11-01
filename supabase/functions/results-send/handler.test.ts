import { assert, assertEquals, assertRejects } from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { runSend, SendError, type Batch, type Item, type Senders, type Store } from "./handler.ts";
import { buildEmail, buildWhatsAppParams } from "./message.ts";

const P = "proj-1";

function fixture(opts: { batch?: Partial<Batch>; items: Partial<Item>[]; released?: string[] }) {
  const batch: Batch = { id: "b1", project_id: P, channel: "email", test_target: null, status: "staged", ...opts.batch };
  const items: Item[] = opts.items.map((p, n) => ({
    id: `i${n + 1}`, batch_id: "b1", school_id: `s${n + 1}`, target: `school${n + 1}@example.com`,
    payload: { schoolName: `School ${n + 1}`, ssNo: `SS${n + 1}`, files: [{ key: `${P}/SS${n + 1}/results/a.zip`, label: "Score sheets - Part 1 of 1" }] },
    status: "pending", error: null, attempts: 0, ...p,
  }));
  const released = new Set(opts.released ?? items.map((i) => i.school_id!));
  const store: Store = {
    getBatch: async () => batch,
    claim: async (_id, from) => { if (batch.status !== from) return false; batch.status = "sending"; return true; },
    items: async () => items,
    isReleased: async (_p, s) => released.has(s),
    school: async (s) => ({ school_name: `School ${s}`, contact_person_name: null, principal_name: null }),
    markItem: async (id, patch) => { Object.assign(items.find((i) => i.id === id)!, patch); },
    finish: async () => { batch.status = "done"; },
  };
  const sent: { to: string; subject: string; html: string }[] = [];
  const senders: Senders & { failFor?: Set<string> } = {
    presignGet: async (k) => `https://r2.example/${k}?X-Amz-Expires=604800`,
    email: async (m) => {
      if (senders.failFor?.has(m.to)) return { error: "Mailbox does not exist" };
      sent.push(m); return { error: null };
    },
    whatsapp: async () => ({ error: null }),
  };
  return { batch, items, store, senders, sent };
}

const req = (extra = {}) => ({ batchId: "b1", userId: "u1", projectName: "iPlus Olympiads 2026", ...extra });

Deno.test("sends pending items once and never resends 'sent' items", async () => {
  const f = fixture({ items: [{}, { status: "sent" }, {}] });
  const r1 = await runSend(f.store, f.senders, req());
  assertEquals(r1.sent, 2);
  assertEquals(f.sent.map((m) => m.to), ["school1@example.com", "school3@example.com"]);
  assertEquals(f.batch.status, "done");
  // second call on the finished batch is refused and sends nothing more
  await assertRejects(() => runSend(f.store, f.senders, req()), SendError, "already been sent");
  assertEquals(f.sent.length, 2);
});

Deno.test("an unreleased school is skipped as failed with the plain reason", async () => {
  const f = fixture({ items: [{}, {}], released: ["s2"] });
  const r = await runSend(f.store, f.senders, req());
  assertEquals(r.sent, 1);
  assertEquals(f.items[0].status, "failed");
  assertEquals(f.items[0].error, "School was unreleased before sending.");
  assertEquals(f.sent.length, 1);
});

Deno.test("test mode routes every item to the one test address", async () => {
  const f = fixture({ batch: { test_target: "me@example.com" }, items: [{}, {}, { target: null }] });
  await runSend(f.store, f.senders, req());
  assertEquals(f.sent.map((m) => m.to), ["me@example.com", "me@example.com", "me@example.com"]);
  assert(f.sent.every((m) => m.subject.startsWith("[TEST] ")));
});

Deno.test("a Resend { error } is recorded as failed, others are sent, nothing auto-resent", async () => {
  const f = fixture({ items: [{}, {}, {}] });
  f.senders.failFor = new Set(["school2@example.com"]);
  const r = await runSend(f.store, f.senders, req());
  assertEquals([r.sent, r.failed], [2, 1]);
  assertEquals(f.items[1].status, "failed");
  assertEquals(f.items[1].error, "Mailbox does not exist");
  assertEquals(f.items[1].attempts, 1);
  assertEquals(f.batch.status, "done");
});

Deno.test("retry sends only the listed failed rows, never sent ones", async () => {
  const f = fixture({ batch: { status: "done" }, items: [{ status: "sent" }, { status: "failed", error: "x", attempts: 1 }, { status: "failed", error: "y", attempts: 1 }] });
  const r = await runSend(f.store, f.senders, req({ retryItemIds: ["i1", "i2"] }));
  assertEquals(f.sent.map((m) => m.to), ["school2@example.com"]); // i1 is 'sent', i3 not listed
  assertEquals(r.skipped, 1);
  assertEquals(f.items[1].status, "sent");
  assertEquals(f.items[1].attempts, 2);
  assertEquals(f.items[2].status, "failed");
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
  assertEquals(f.items[0].error, "This school has no email address on file.");
});

Deno.test("a school with no uploaded files fails; a thrown error is recorded", async () => {
  const f = fixture({ items: [{ payload: { files: [] } }, {}] });
  f.senders.presignGet = async () => { throw new Error("R2 down"); };
  await runSend(f.store, f.senders, req());
  assertEquals(f.items[0].error, "No result files were uploaded for this school.");
  assertEquals(f.items[1].error, "R2 down");
});

Deno.test("WhatsApp without a configured template is refused before anything is claimed", async () => {
  const f = fixture({ batch: { channel: "whatsapp" }, items: [{}] });
  await assertRejects(() => runSend(f.store, f.senders, req()), SendError, "WhatsApp template not set up yet");
  assertEquals(f.batch.status, "staged");
});

Deno.test("message builders escape html, include every link and never produce empty WhatsApp params", () => {
  const m = buildEmail({ schoolName: "A <b>&</b> School", links: [{ label: "Score sheets", url: "https://x/y?a=1&b=2" }], testMode: false, projectName: null });
  assert(m.html.includes("A &lt;b&gt;&amp;&lt;/b&gt; School"));
  assert(m.html.includes('href="https://x/y?a=1&amp;b=2"'));
  assert(m.text.includes("7 days"));
  const p = buildWhatsAppParams([{ index: 1, source: "contact_person" }, { index: 2, source: "custom", customText: " " }], { schoolName: "S", links: [] });
  assertEquals(p, ["S", "-"]);
});
