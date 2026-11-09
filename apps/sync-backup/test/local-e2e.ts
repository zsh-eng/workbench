/** Run against the isolated Worker configured in README. No production access. */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { expect } from "bun:test";
import { removeCredential } from "../src/auth";
const { chromium } = await import(
  Bun.resolveSync(
    "@playwright/test",
    join(import.meta.dirname, "../../sync-server"),
  )
);
const origin = process.env.WB_TEST_ORIGIN ?? "http://localhost:8812",
  directory = mkdtempSync(join(tmpdir(), "wb-e2e-"));
if (
  new URL(origin).protocol !== "http:" ||
  !["localhost", "127.0.0.1"].includes(new URL(origin).hostname)
)
  throw Error("Local fixtures require a loopback server");
const email = `cli-${crypto.randomUUID()}@example.test`,
  password = "local-cli-test-password";
const signup = await fetch(origin + "/api/auth/sign-up/email", {
  method: "POST",
  headers: { "Content-Type": "application/json", Origin: origin },
  body: JSON.stringify({ email, password, name: "CLI test" }),
});
if (!signup.ok) throw Error(`Signup failed ${signup.status}`);
const cookie = signup.headers
  .getSetCookie()
  .map((v) => v.split(";")[0])
  .join("; ");
const file = new TextEncoder().encode("test image"),
  fileId = `xxh64:${Bun.hash.xxHash64(file).toString(16).padStart(16, "0")}`;
for (const namespace of ["reader", "spaced"]) {
  const root = origin + "/api/apps/" + namespace;
  const scope = await (
    await fetch(root + "/sync/v3/state", { headers: { Cookie: cookie } })
  ).json();
  const headers = {
    Cookie: cookie,
    Origin: origin,
    "X-Device-ID": "fixture-writer",
    "X-Sync-Scope": JSON.stringify(scope),
    "Content-Type": "application/json",
  };
  const changes = Array.from({ length: 20 }, (_, i) => ({
    key: JSON.stringify([
      namespace === "reader" ? "books" : "operations",
      String(i),
    ]),
    value: JSON.stringify({ title: `Fixture ${i}`, fileId }),
    schemaVersion: 1,
    isDeleted: false,
    hlc: { wallTimeMs: Date.now(), counter: i },
  }));
  const p = await fetch(root + "/sync/v3/push", {
    method: "POST",
    headers,
    body: JSON.stringify({ changes }),
  });
  if (!p.ok) throw Error("Fixture push failed");
  const f = await fetch(root + "/files/" + fileId, {
    method: "PUT",
    headers: { ...headers, "Content-Type": "image/png" },
    body: file,
  });
  if (!f.ok) throw Error("Fixture upload failed");
}
const cli = join(import.meta.dirname, "../src/cli.ts");
const command = (args: string[]) =>
  Bun.spawn(
    ["bun", cli, ...args, "--origin", origin, "--data-dir", directory],
    { stdout: "pipe", stderr: "pipe" },
  );
const login = command(["auth", "login", "--no-browser"]);
const stderr = login.stderr.getReader();
let output = "";
while (!output.includes("Waiting for approval")) {
  const r = await stderr.read();
  if (r.done) throw Error("Login exited early");
  output += new TextDecoder().decode(r.value);
}
const code = /Enter code: ([A-Z0-9-]+)/.exec(output)![1];
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.goto(origin + "/device");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in locally" }).click();
  await page.getByLabel("Device code").fill(code);
  await page.getByRole("button", { name: "Approve access" }).click();
  await page.getByText("Approved. Return to your terminal.").waitFor();
  expect(await login.exited).toBe(0);
  for (const args of [
    ["auth", "status"],
    ["sync", "--namespace", "reader", "--table", "books", "--records-only"],
    ["sync"],
    ["sync"],
    ["tree"],
    ["namespace", "list"],
    ["table", "list", "--namespace", "spaced"],
    ["db", "schema"],
    ["snapshot", "create"],
  ]) {
    const process = command([...args, "--json"]);
    const out = await new Response(process.stdout).text();
    const err = await new Response(process.stderr).text();
    if ((await process.exited) !== 0) throw Error(err);
    const result = JSON.parse(out);
    if (args[0] === "sync" && args.length === 1)
      expect(result.coverage.complete).toBe(true);
    console.log(`${args.join(" ")}: passed`);
  }
  // wb spaced apply uploads a local image and links the new card to it.
  const changes = join(directory, "changes");
  mkdirSync(join(changes, "figs"), { recursive: true });
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 7]);
  const pngId = `xxh64:${Bun.hash.xxHash64(png).toString(16).padStart(16, "0")}`;
  writeFileSync(join(changes, "figs/raft.png"), png);
  writeFileSync(
    join(changes, "set.json"),
    JSON.stringify({
      version: "spaced-changes-v1",
      changes: [{ action: "create", deck: "e2e", front: "Leader? ![fig](./figs/raft.png)", back: "A" }],
    }),
  );
  for (const apply of [false, true]) {
    const run = command(["spaced", "apply", join(changes, "set.json"), "--json", ...(apply ? ["--apply"] : [])]);
    const out = await new Response(run.stdout).text();
    const err = await new Response(run.stderr).text();
    if ((await run.exited) !== 0) throw Error(out + err);
    const result = JSON.parse(out);
    expect(result.images).toEqual([{ path: "./figs/raft.png", id: pngId, type: "image/png", bytes: png.length }]);
    expect(result.applied).toBe(apply ? 1 : false);
  }
  const stored = await fetch(`${origin}/api/apps/spaced/files/${pngId}`, { headers: { Cookie: cookie } });
  expect(stored.headers.get("Content-Type")).toBe("image/png");
  expect(new Uint8Array(await stored.arrayBuffer())).toEqual(png);
  const pathRun = command(["spaced", "path"]);
  const spacedPath = (await new Response(pathRun.stdout).text()).trim();
  const spaced = new Database(spacedPath, { readonly: true });
  expect(spaced.query("SELECT front FROM cards WHERE front LIKE 'Leader?%'").all()).toEqual([
    { front: `Leader? ![fig](${origin}/api/apps/spaced/files/${pngId})` },
  ]);
  spaced.close();
  console.log("spaced apply with a local image: passed");
  const p = command(["auth", "logout"]);
  expect(await p.exited).toBe(0);
  console.log(
    "Device login → CLI → records/files → snapshot → revocation passed",
  );
} finally {
  await browser.close();
  login.kill();
  removeCredential(origin, directory);
  rmSync(directory, { recursive: true, force: true });
}
