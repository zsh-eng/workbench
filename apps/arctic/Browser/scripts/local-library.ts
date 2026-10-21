/**
 * Copies the account's Arctic library from the Workbench Backup mirror into an
 * account on the local shared API (`bun run dev:shared`), for design work with
 * real titles and images. With --text it also copies the article text
 * (`arctic-content` records and files). It writes only to
 * http://localhost:8792.
 *
 *   bun scripts/local-library.ts <email> <password> [--text]
 */
import { Database } from "bun:sqlite";
import { homedir } from "node:os";
import { join } from "node:path";

const API = "http://localhost:8792";
const [email, password] = process.argv.slice(2);
const withText = process.argv.includes("--text");
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
type Row = {
  key: string;
  value: string;
  schema_version: number;
  wall_time: number;
  counter: number;
};
const records = (namespace: string) =>
  db
    .query<
      Row,
      [string]
    >("SELECT key,value,schema_version,wall_time,counter FROM records WHERE namespace=? AND is_deleted=0 ORDER BY server_seq")
    .all(namespace);

await push("arctic", records("arctic"));
if (withText) {
  const files = db
    .query<
      { id: string; sha256: string },
      []
    >("SELECT id,sha256 FROM files WHERE namespace='arctic-content' AND active=1")
    .all();
  for (const file of files) {
    const body = await Bun.file(join(backup, "objects", file.sha256)).bytes();
    const put = await fetch(`${API}/api/apps/arctic-content/files/${file.id}`, {
      method: "PUT",
      headers: { Cookie: cookie, "Content-Type": "text/html; charset=utf-8" },
      body,
    });
    if (!put.ok)
      throw new Error(`Upload failed: ${put.status} ${await put.text()}`);
  }
  await push("arctic-content", records("arctic-content"));
}
db.close();

async function push(namespace: string, rows: Row[]) {
  const scope = await (
    await fetch(`${API}/api/apps/${namespace}/sync/v3/state`, {
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
    const pushed = await fetch(`${API}/api/apps/${namespace}/sync/v3/push`, {
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
  console.log(`Copied ${rows.length} ${namespace} records to ${email}.`);
}
