/** Seed only the local emulator. Refuses any nonempty database. */
import { Database } from "bun:sqlite";
import { getPlatformProxy } from "wrangler";
import { resolve, join } from "node:path";
const folder = resolve(process.argv[2] ?? "consolidation.local/converted");
const source = new Database(join(folder, "backend.sqlite"), { readonly: true });
const proxy = await getPlatformProxy<{ DATABASE: D1Database; FILES: R2Bucket }>(
  {
    configPath: "wrangler.jsonc",
    environment: "local",
    remoteBindings: false,
    envFiles: [],
    persist: { path: "consolidation.local/state/v3" },
  },
);
try {
  const { results } = await proxy.env.DATABASE.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'",
  ).all();
  if (results.length)
    throw Error(
      "Local database is not empty; use a new isolated state directory",
    );
  for (const statement of (
    await Bun.file("drizzle/0000_generic_backend.sql").text()
  )
    .split(";")
    .map((s) => s.replace(/--> statement-breakpoint/g, "").trim())
    .filter(Boolean))
    await proxy.env.DATABASE.prepare(statement).run();
  for (const table of ["user", "account", "file_storage", "sync_records"]) {
    const rows = source.query(`SELECT * FROM "${table}"`).all() as Record<
      string,
      unknown
    >[];
    if (!rows.length) continue;
    const keys = Object.keys(rows[0]),
      sql = `INSERT INTO "${table}"(${keys.map((k) => '"' + k + '"').join(",")}) VALUES(${keys.map(() => "?").join(",")})`;
    for (let i = 0; i < rows.length; i += 100)
      await proxy.env.DATABASE.batch(
        rows
          .slice(i, i + 100)
          .map((row) =>
            proxy.env.DATABASE.prepare(sql).bind(...keys.map((k) => row[k])),
          ),
      );
    console.log(table, rows.length);
  }
  const files = await Bun.file(join(folder, "files.json")).json();
  for (const file of files)
    await proxy.env.FILES.put(
      file.key,
      await Bun.file(join(folder, file.localFile)).arrayBuffer(),
      { httpMetadata: { contentType: file.mediaType } },
    );
  // A separate local account avoids changing copied production credentials or user IDs.
  const now = Date.now(),
    hash =
      "legacy-pbkdf2:Xj+SO0CHAnpDOZyhr2+KAojZiIxA+ns2Oa3M8/uCxACqqWLH6PfCNTuEtuBfyUmt";
  await proxy.env.DATABASE.batch([
    proxy.env.DATABASE.prepare(
      "INSERT INTO user(id,name,email,email_verified,created_at,updated_at) VALUES(?,?,?,?,?,?)",
    ).bind("local-check-user", "Local test", "test@local.invalid", 1, now, now),
    proxy.env.DATABASE.prepare(
      "INSERT INTO account(id,account_id,provider_id,user_id,password,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
    ).bind(
      "local-check-account",
      "local-check-user",
      "credential",
      "local-check-user",
      hash,
      now,
      now,
    ),
  ]);
  console.log("Local seed complete", files.length, "files");
} finally {
  source.close();
  await proxy.dispose();
}
