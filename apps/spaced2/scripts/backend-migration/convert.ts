/** Build a fresh generic backend from read-only Spaced and R2 backups. No network access. */
import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  existsSync,
  copyFileSync,
  chmodSync,
  writeFileSync,
  renameSync,
} from "node:fs";
import { resolve, join } from "node:path";
import { convertRow, legacyTables } from "../sync-migration/convert";
import { computeFileId } from "../../server/lib/files";

type LegacyUser = {
  id: string;
  is_active: number;
  display_name: string | null;
  email: string;
  image_url: string | null;
  last_modified: number;
  password_hash: string | null;
};
type LegacyOAuthAccount = {
  id: string;
  provider_user_id: string;
  provider: string;
  user_id: string;
  created_at: number;
};
type ConvertedFile = {
  id: string;
  userId: string;
  key: string;
  localFile: string;
  sha256: string;
  size: number;
  mediaType: string;
};

const [databasePath, backupPath, outputPath] = process.argv.slice(2);
if (!databasePath || !backupPath || !outputPath)
  throw Error(
    "Usage: bun scripts/backend-migration/convert.ts source.sqlite backup-directory new-output-directory",
  );
const output = resolve(outputPath),
  backup = resolve(backupPath);
if (existsSync(output) || existsSync(output + ".partial"))
  throw Error("Output must be a new directory");
const temporary = output + ".partial";
mkdirSync(temporary, { mode: 0o700 });
mkdirSync(join(temporary, "files"));
const source = new Database(databasePath, { readonly: true }),
  target = new Database(join(temporary, "backend.sqlite"));
chmodSync(join(temporary, "backend.sqlite"), 0o600);
target.exec(
  await Bun.file(
    new URL("../../drizzle/0000_generic_backend.sql", import.meta.url),
  ).text(),
);
target.exec("PRAGMA foreign_keys=ON");
const users = source.query("SELECT * FROM users").all() as LegacyUser[];
if (users.some((u) => !u.is_active))
  throw Error("Inactive accounts need an explicit blocked-account migration");
let passwords = 0,
  providers = 0;
target.transaction(() => {
  const insert = target.prepare(
    "INSERT INTO user(id,name,email,email_verified,image,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
  );
  const account = target.prepare(
    "INSERT INTO account(id,account_id,provider_id,user_id,password,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
  );
  for (const u of users) {
    insert.run(
      u.id,
      u.display_name ?? u.email.split("@")[0],
      u.email.toLowerCase(),
      1,
      u.image_url,
      u.last_modified,
      u.last_modified,
    );
    if (u.password_hash) {
      account.run(
        `credential:${u.id}`,
        u.id,
        "credential",
        u.id,
        `legacy-pbkdf2:${u.password_hash}`,
        u.last_modified,
        u.last_modified,
      );
      passwords++;
    }
  }
  for (const a of source.query("SELECT * FROM oauth_accounts").all() as LegacyOAuthAccount[]) {
    account.run(
      `oauth:${a.id}`,
      a.provider_user_id,
      a.provider,
      a.user_id,
      null,
      a.created_at,
      a.created_at,
    );
    providers++;
  }
})();
const manifest = await Bun.file(join(backup, "r2-manifest.json")).json();
const files: ConvertedFile[] = [],
  aliases = new Map<string, string>(),
  seen = new Map<string, string>(),
  owners = new Set(users.map((u) => u.id));
for (const object of manifest.objects) {
  const path = resolve(backup, object.local_file);
  if (!path.startsWith(backup + "/")) throw Error("Invalid backup object path");
  const bytes = await Bun.file(path).arrayBuffer();
  const sha256 = createHash("sha256")
    .update(new Uint8Array(bytes))
    .digest("hex");
  if (bytes.byteLength !== object.size || sha256 !== object.sha256)
    throw Error("Backup object checksum mismatch");
  const userId = object.key.split("/")[0];
  if (!owners.has(userId)) throw Error("Unknown file owner");
  const id = await computeFileId(bytes),
    key = `files/${userId}/${id}`;
  if (seen.has(key) && seen.get(key) !== sha256)
    throw Error("Content ID collision");
  aliases.set(object.key, id);
  if (seen.has(key)) continue;
  seen.set(key, sha256);
  const localFile = `files/${sha256}.bin`;
  copyFileSync(path, join(temporary, localFile));
  chmodSync(join(temporary, localFile), 0o600);
  const metadata = source
    .query("SELECT last_modified,file_type FROM files WHERE user_id=? AND id=?")
    .get(userId, object.key.split("/")[1]) as { last_modified: number; file_type: string | null } | null;
  const mediaType =
    object.http_metadata?.contentType ??
    metadata?.file_type ??
    "application/octet-stream";
  const createdAt = metadata?.last_modified ?? Date.parse(object.last_modified);
  target
    .prepare(
      "INSERT INTO file_storage(id,user_id,r2_key,file_size,media_type,created_at) VALUES(?,?,?,?,?,?)",
    )
    .run(id, userId, key, bytes.byteLength, mediaType, createdAt);
  files.push({
    id,
    userId,
    key,
    localFile,
    sha256,
    size: bytes.byteLength,
    mediaType,
  });
}
let sequence = 0,
  references = 0,
  changedContents = 0;
const counts: Record<string, number> = {};
target.transaction(() => {
  const insert = target.prepare(
    "INSERT INTO sync_records(server_seq,user_id,key,value,schema_version,hlc_wall_time_ms,hlc_counter,device_id,is_deleted) VALUES(?,?,?,?,?,?,?,?,?)",
  );
  for (const table of legacyTables) {
    const rows = source
      .query(`SELECT * FROM ${table} ORDER BY user_id,seq_no`)
      .all() as Parameters<typeof convertRow>[1][];
    counts[table] = rows.length;
    for (const input of rows) {
      const row = { ...input };
      if (table === "card_contents") {
        let changed = false;
        for (const field of ["front", "back"])
          row[field] = (row[field] as string).replace(
            /https?:\/\/api\.spaced2\.zsheng\.app\/api\/files\/([a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+)/g,
            (_: string, oldKey: string) => {
              const id = aliases.get(oldKey);
              if (!id) throw Error("Referenced image is missing from backup");
              if (!oldKey.startsWith(row.user_id + "/"))
                throw Error("Cross-account image reference");
              references++;
              changed = true;
              return `/api/files/${id}`;
            },
          );
        if (changed) changedContents++;
      }
      const { userId, record: r } = convertRow(table, row, ++sequence);
      insert.run(
        r.serverSeq,
        userId,
        r.key,
        r.value,
        r.schemaVersion,
        r.hlc.wallTimeMs,
        r.hlc.counter,
        r.deviceId,
        Number(r.isDeleted),
      );
    }
  }
})();
if (
  JSON.stringify(target.query("PRAGMA integrity_check").all()) !==
    '[{"integrity_check":"ok"}]' ||
  target.query("PRAGMA foreign_key_check").all().length
)
  throw Error("Database validation failed");
const report = {
  sourceSha256: createHash("sha256")
    .update(new Uint8Array(await Bun.file(databasePath).arrayBuffer()))
    .digest("hex"),
  users: users.length,
  passwords,
  providers,
  records: sequence,
  counts,
  sourceObjects: manifest.objects.length,
  files: files.length,
  rewrittenReferences: references,
  changedContents,
  sessions: 0,
  integrity: "ok",
};
writeFileSync(join(temporary, "files.json"), JSON.stringify(files, null, 2), {
  mode: 0o600,
});
writeFileSync(join(temporary, "report.json"), JSON.stringify(report, null, 2), {
  mode: 0o600,
});
writeFileSync(
  join(temporary, "aliases.json"),
  JSON.stringify(Object.fromEntries(aliases), null, 2),
  { mode: 0o600 },
);
source.close();
target.close();
renameSync(temporary, output);
console.log(report);
