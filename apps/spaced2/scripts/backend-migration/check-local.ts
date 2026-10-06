/** End-to-end checks against the local Wrangler server and console email log. */
import assert from "node:assert/strict";
import type { SyncPullResponse } from "@zsh-eng/local-sync";
import { computeFileId } from "../../server/lib/files";
const base = "http://localhost:8791";
const origin = "http://localhost:5180";
function client() {
  let cookie = "";
  return async (
    path: string,
    method = "GET",
    body?: unknown,
    headers: Record<string, string> = {},
  ) => {
    const raw = body instanceof Uint8Array;
    const response = await fetch(base + "/api" + path, {
      signal: AbortSignal.timeout(30000),
      method,
      headers: {
        Origin: origin,
        Cookie: cookie,
        ...(body === undefined
          ? {}
          : { "Content-Type": raw ? "text/html" : "application/json" }),
        ...headers,
      },
      body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
      redirect: "manual",
    });
    const cookies = response.headers.getSetCookie();
    if (cookies.length) cookie = cookies.map((c) => c.split(";")[0]).join("; ");
    return response;
  };
}
const a = client(),
  b = client();
assert.equal((await a("/me")).status, 401);
assert.equal(
  (
    await a("/auth/sign-in/email", "POST", {
      email: "test@local.invalid",
      password: "wrong-password",
    })
  ).status,
  401,
);
assert.equal(
  (
    await a("/auth/sign-in/email", "POST", {
      email: "test@local.invalid",
      password: "test-user-password",
    })
  ).status,
  200,
);
assert.equal((await (await a("/me")).json<{ userId: string }>()).userId, "local-check-user");
const email = `check-${Date.now()}@local.invalid`,
  password = "local-test-password";
assert.equal(
  (
    await b("/auth/sign-up/email", "POST", {
      name: "Local test",
      email,
      password,
    })
  ).status,
  200,
);
assert.equal((await b("/me")).status, 401);
assert.equal(
  (await b("/auth/sign-in/email", "POST", { email, password })).status,
  403,
);
const log = await Bun.file("consolidation.local/server.log").text();
const codes = [
  ...log.matchAll(
    new RegExp(
      `LOCAL verification code ${email.replaceAll(".", "\\.")} (\\d{8})`,
      "g",
    ),
  ),
];
assert.ok(codes.length, "Local console verification code");
assert.equal(
  (await b("/auth/email-otp/verify-email", "POST", { email, otp: "invalid" }))
    .status,
  400,
);
assert.equal(
  (
    await b("/auth/email-otp/verify-email", "POST", {
      email,
      otp: codes.at(-1)![1],
    })
  ).status,
  200,
);
assert.equal((await b("/me")).status, 200);
const bytes = new TextEncoder().encode("<script>test</script>"),
  id = await computeFileId(bytes.buffer as ArrayBuffer);
assert.equal((await a("/files/" + id, "PUT", bytes)).status, 200);
assert.equal(
  (await (await a("/files/" + id, "PUT", bytes)).json<{ alreadyExists: boolean }>()).alreadyExists,
  true,
);
assert.equal(
  (await a("/files/xxh64:0000000000000000", "PUT", bytes)).status,
  400,
);
assert.equal((await a("/files/not-a-hash", "PUT", bytes)).status, 400);
assert.equal(
  (await a("/files/" + id, "PUT", new Uint8Array(2 * 1024 * 1024 + 1))).status,
  413,
);
const download = await a("/files/" + id);
assert.equal(await download.text(), new TextDecoder().decode(bytes));
assert.equal(download.headers.get("Content-Disposition"), "attachment");
assert.ok(download.headers.get("Content-Security-Policy")?.includes("sandbox"));
assert.equal((await b("/files/" + id)).status, 404);
assert.equal((await b("/files/" + id, "DELETE")).status, 404);
assert.equal((await a("/files/" + id, "DELETE")).status, 204);
assert.equal((await a("/files/" + id)).status, 404);
assert.equal((await a("/files/" + id, "PUT", bytes)).status, 200);
const device = "local-http-check",
  headers = { "X-Device-ID": device };
const record = {
  key: "opaque-check-" + Date.now(),
  value: "any domain-independent payload",
  schemaVersion: 1,
  hlc: { wallTimeMs: Date.now(), counter: 0 },
  isDeleted: false,
};
const push = await a("/sync/v2/push", "POST", { changes: [record] }, headers);
assert.equal(push.status, 200, await push.clone().text());
const pull = await (
  await a(
    "/sync/v2/pull?cursor=0&limit=100&excludeOwnDevice=false",
    "GET",
    undefined,
    headers,
  )
).json<SyncPullResponse>();
assert.ok(
  pull.records?.some(
    (r) => r.key === record.key && r.value === record.value,
  ),
  JSON.stringify(pull),
);
assert.equal(
  (
    await (
      await b(
        "/sync/v2/pull?cursor=0&limit=100&excludeOwnDevice=false",
        "GET",
        undefined,
        headers,
      )
    ).json<SyncPullResponse>()
  ).records.length,
  0,
);
assert.equal(
  (
    await a(
      "/sync/v2/push",
      "POST",
      {
        changes: [
          { ...record, value: "stale", hlc: { wallTimeMs: 1, counter: 0 } },
        ],
      },
      headers,
    )
  ).status,
  200,
);
const again = await (
  await a(
    "/sync/v2/pull?cursor=0&limit=100&excludeOwnDevice=false",
    "GET",
    undefined,
    headers,
  )
).json<SyncPullResponse>();
assert.equal(
  again.records.find((r) => r.key === record.key)!.value,
  record.value,
);
assert.equal((await a("/unknown")).status, 404);
assert.equal((await a("/auth/sign-out", "POST", {})).status, 200);
assert.equal((await a("/me")).status, 401);
console.log(
  "PASS: legacy sign-in, verification, sessions, file integrity/limits/isolation, opaque sync, LWW and sign-out",
);
