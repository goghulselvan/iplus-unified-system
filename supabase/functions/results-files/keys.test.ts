import { assert, assertEquals } from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { isAllowedKey } from "./keys.ts";
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
