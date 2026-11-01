import { assert, assertEquals } from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { isAllowedKey, resultsFileName, resultsKeyPrefix, ssSegment } from "./keys.ts";
import { presign } from "./sign.ts";

const U = "123e4567-e89b-12d3-a456-426614174000";

Deno.test("accepts valid keys", () => {
  assert(isAllowedKey(`${U}/papers/${U}.pdf`));
  assert(isAllowedKey(`${U}/uploads/smoke-test.pdf`));
  assert(isAllowedKey(`${U}/exports/a_b.csv`));
});

Deno.test("rejects bad keys", () => {
  for (const k of ["../x", "/abs", `${U}/papers/../../etc`, "", `${U}/other/x.pdf`, `${U}/papers/..`, `${U}/papers/x.pdf\n`]) {
    assertEquals(isAllowedKey(k), false, k);
  }
});

Deno.test("presign url has expiry, signature and exact key path", async () => {
  const key = `${U}/uploads/smoke-test.pdf`;
  const url = await presign(
    { accountId: "acct", accessKeyId: "AKID", secretAccessKey: "SECRET", bucket: "bkt" },
    "PUT", key, "application/pdf",
  );
  assert(url.startsWith(`https://acct.r2.cloudflarestorage.com/bkt/${key}?`));
  assert(url.includes("X-Amz-Expires=900"));
  assert(url.includes("X-Amz-Signature="));
});

Deno.test("accepts school results keys and rejects look-alikes", () => {
  assert(isAllowedKey(`${U}/SS0123/results/School_-_Score_sheets_-_Part_1_of_2.zip`));
  for (const k of [`${U}/SS 01/results/a.zip`, `${U}/SS01/results/..`, `${U}/../results/a.zip`, `${U}/SS01/other/a.zip`, `${U}/SS01/results/a/b.zip`, `${U}//results/a.zip`]) {
    assertEquals(isAllowedKey(k), false, k);
  }
});

Deno.test("results key helpers produce keys that pass isAllowedKey", () => {
  const key = resultsKeyPrefix(U, "SS 0123/x") + resultsFileName("St Mary's – Score sheets – Part 1 of 2.zip");
  assert(isAllowedKey(key), key);
  assertEquals(ssSegment("SS 0123/x"), "SS0123x");
});

Deno.test("presign honours a custom expiry", async () => {
  const url = await presign(
    { accountId: "acct", accessKeyId: "AKID", secretAccessKey: "SECRET", bucket: "bkt" },
    "GET", `${U}/SS1/results/a.zip`, undefined, 604800,
  );
  assert(url.includes("X-Amz-Expires=604800"));
});
