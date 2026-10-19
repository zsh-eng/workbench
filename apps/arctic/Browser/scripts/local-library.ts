/**
 * Copies the account's Arctic library from the Workbench Backup mirror into an
 * account on the local shared API (`bun run dev:shared`), for design work with
 * real titles and images. It writes only to http://localhost:8792.
 *
 *   bun scripts/local-library.ts <email> <password> [--copies <folder>]
 */
import { Database } from "bun:sqlite";
import { homedir } from "node:os";
import { join } from "node:path";

const API = "http://localhost:8792";
const [email, password] = process.argv.slice(2);
if (!email || !password) {
  console.error("Usage: bun scripts/local-library.ts <email> <password>");
  process.exit(2);
}
const headers = {
  "Content-Type": "application/json",
  Origin: "http://localhost:5186",
};
const auth = (path: string, body: object) =>
  fetch(`${API}/api/auth/${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
let response = await auth("sign-in/email", { email, password });
if (!response.ok)
  response = await auth("sign-up/email", {
    email,
    password,
    name: email.split("@")[0],
  });
if (!response.ok)
  throw new Error(
    `Local sign-in failed: ${response.status} ${await response.text()}`,
  );
const cookie = response.headers
  .getSetCookie()
  .map((value) => value.split(";")[0])
  .join("; ");

const backup =
  process.env.ARCTIC_BACKUP_DIR ??
  join(homedir(), "Library/Application Support/Workbench Backup");
const db = new Database(join(backup, "mirror.sqlite"), { readonly: true });
const rows = db
  .query<
    {
      key: string;
      value: string;
      schema_version: number;
      wall_time: number;
      counter: number;
    },
    []
  >(
    "SELECT key,value,schema_version,wall_time,counter FROM records WHERE namespace='arctic' AND is_deleted=0 ORDER BY server_seq",
  )
  .all();
db.close();

const scope = await (
  await fetch(`${API}/api/apps/arctic/sync/v3/state`, {
    headers: { Cookie: cookie },
  })
).json();
for (let start = 0; start < rows.length; start += 250) {
  const changes = rows.slice(start, start + 250).map((row) => ({
    key: row.key,
    value: row.value,
    isDeleted: false,
    schemaVersion: row.schema_version,
    hlc: { wallTimeMs: row.wall_time, counter: row.counter },
  }));
  const pushed = await fetch(`${API}/api/apps/arctic/sync/v3/push`, {
    method: "POST",
    headers: {
      ...headers,
      Cookie: cookie,
      "X-Device-ID": "mirror-copy",
      "X-Sync-Scope": JSON.stringify(scope),
    },
    body: JSON.stringify({ changes }),
  });
  if (!pushed.ok)
    throw new Error(`Push failed: ${pushed.status} ${await pushed.text()}`);
}
console.log(`Copied ${rows.length} Arctic records to ${email} on ${API}.`);
