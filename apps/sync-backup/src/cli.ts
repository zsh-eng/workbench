#!/usr/bin/env bun
import { parseArgs } from "node:util";
import { existsSync, realpathSync } from "node:fs";
import { writerLock } from "./lock";
import { schedule } from "./schedule";
import { join, resolve } from "node:path";
import { Store } from "./store";
import {
  defaultDirectory,
  getCredential,
  login,
  normalizeOrigin,
  authRequest,
  removeCredential,
} from "./auth";
import { readFetch, identity, namespaces, pull, syncFiles } from "./sync";
import {
  completeness,
  snapshot,
  listSnapshots,
  verifySnapshot,
} from "./snapshot";
const help = `Workbench Backup — read-only sync and local SQLite inspection

Usage: wb <command> [options]

  auth login [--no-browser]      Authorize this CLI in your browser
  auth status                   Check the saved credential and identity
  auth logout                   Revoke this CLI credential; retain local data
  namespace list                List locally known namespaces (offline)
  table list --namespace NAME   List local domain tables and counts
  tree                          Show namespaces, tables, counts and coverage
  sync                          Pull all namespaces and all catalogued files
  status                        Show cursors, coverage, last success and files
  schedule install              Install hourly macOS sync (also runs at login)
  schedule status               Show the launchd job and log paths
  schedule uninstall            Remove the schedule; retain local data
  db path                       Print the SQLite path
  db schema [--table NAME]       Print physical SQLite schema
  snapshot create               Capture and verify dated records + files
  snapshot list                 List local snapshots
  snapshot verify ID            Verify SQLite and object checksums
  export --output DIRECTORY     Write a portable, verified snapshot

Options:
  --namespace NAME  Repeat to select namespaces (sync/table/tree)
  --table NAME      Repeat to select domain tables (sync); scans namespace
  --records-only    Skip file download; reported coverage remains explicit
  --origin URL      API origin (default https://api.zsheng.app)
  --data-dir PATH   Private local state, outside Git
  --json            Machine-readable output; progress remains on stderr
  --no-browser      Print login URL without opening it
  -h, --help        Show help
  --version         Print version

Sync is download-only. Table selections have independent cursors. Counts are
local, including tombstones. No remote restore, automatic pruning, or uploads.
`;
const options = {
  namespace: { type: "string", multiple: true },
  table: { type: "string", multiple: true },
  origin: { type: "string" },
  "data-dir": { type: "string" },
  output: { type: "string" },
  json: { type: "boolean" },
  "records-only": { type: "boolean" },
  "no-browser": { type: "boolean" },
  help: { type: "boolean", short: "h" },
  version: { type: "boolean" },
} as const;
function print(value: any, json: boolean) {
  if (typeof value === "string" && !json) console.log(value);
  else console.log(JSON.stringify(value, null, json ? undefined : 2));
}
function privateDestination(directory: string) {
  let ancestor = resolve(directory);
  while (!existsSync(ancestor)) ancestor = resolve(ancestor, "..");
  ancestor = realpathSync(ancestor);
  while (true) {
    if (existsSync(join(ancestor, ".git")))
      throw Error("Keep data and exports outside Git repositories");
    const parent = resolve(ancestor, "..");
    if (parent === ancestor) break;
    ancestor = parent;
  }
}
function table(rows: Record<string, unknown>[]) {
  if (!rows.length) return "No local data. Run wb sync.";
  const keys = Object.keys(rows[0]);
  const cells = rows.map((row) => keys.map((key) => String(row[key] ?? "—")));
  const widths = keys.map((key, i) =>
    Math.max(key.length, ...cells.map((row) => row[i].length)),
  );
  return [keys, ...cells]
    .map((row) => row.map((cell, i) => cell.padEnd(widths[i])).join("  "))
    .join("\n");
}
async function main() {
  const { values: v, positionals: p } = parseArgs({
    args: Bun.argv.slice(2),
    options,
    allowPositionals: true,
    strict: true,
  });
  if (v.version) {
    console.log("wb 0.1.0");
    return;
  }
  if (v.help || !p.length) {
    console.log(help);
    return;
  }
  const origin = normalizeOrigin(v.origin ?? "https://api.zsheng.app"),
    directory = resolve(v["data-dir"] ?? defaultDirectory),
    json = !!v.json;
  privateDestination(directory);
  if (v.output) privateDestination(resolve(v.output));
  const [command, sub, id] = p;
  const known =
    command === "schedule"
      ? ["install", "status", "uninstall"].includes(sub)
      : command === "auth"
        ? ["login", "status", "logout"].includes(sub)
        : command === "namespace" || command === "table"
          ? sub === "list"
          : command === "db"
            ? ["path", "schema"].includes(sub)
            : command === "snapshot"
              ? ["create", "list", "verify"].includes(sub)
              : ["sync", "status", "tree", "export"].includes(command) && !sub;
  if (!known) throw Error("Unknown command. Run wb --help.");
  if (v.namespace && !["sync", "table", "tree"].includes(command))
    throw Error("--namespace is only valid for sync, table list, and tree");
  if (
    v.table &&
    !(command === "sync" || (command === "db" && sub === "schema"))
  )
    throw Error("--table is only valid for sync and db schema");
  if (v.output && command !== "export")
    throw Error("--output is only valid for export");
  if (v["records-only"] && command !== "sync")
    throw Error("--records-only is only valid for sync");
  if (v["no-browser"] && !(command === "auth" && sub === "login"))
    throw Error("--no-browser is only valid for auth login");
  if (p.length > (command === "snapshot" && sub === "verify" ? 3 : sub ? 2 : 1))
    throw Error("Unexpected positional argument");
  if (v.table?.length && command === "sync" && v.namespace?.length !== 1)
    throw Error("--table requires exactly one --namespace");
  if (v.namespace?.some((n) => !["reader", "spaced"].includes(n)))
    throw Error("Supported namespaces: reader, spaced");
  if (command === "schedule") {
    print(schedule(sub, origin, directory), json);
    return;
  }
  if (command === "auth") {
    if (sub === "login") {
      await login(origin, directory, !!v["no-browser"]);
      print({ loggedIn: true, origin }, json);
      return;
    }
    const token = getCredential(origin, directory);
    if (!token) {
      if (sub === "status") throw Error("Not signed in. Run wb auth login.");
      print({ loggedOut: true }, json);
      return;
    }
    if (sub === "logout") {
      const r = await authRequest(origin, "/api/cli/revoke", {}, token);
      if (!r.response.ok)
        throw Error("Revocation failed; local credential retained");
      removeCredential(origin, directory);
      print({ loggedOut: true }, json);
      return;
    }
    print(await identity(readFetch(origin, token), origin), json);
    return;
  }
  if (command === "db" && sub === "path") {
    print(join(directory, "mirror.sqlite"), json);
    return;
  }
  if (command === "snapshot" && sub === "list") {
    print(listSnapshots(directory), json);
    return;
  }
  if (command === "snapshot" && sub === "verify") {
    if (!id || !/^[A-Za-z0-9T.:-]+$/.test(id))
      throw Error("Provide a snapshot ID from snapshot list");
    print(verifySnapshot(join(directory, "snapshots", id)), json);
    return;
  }
  const unlock = writerLock(directory);
  let store: Store | undefined;
  try {
    store = new Store(directory);
    if (command === "sync") {
      const token = getCredential(origin, directory);
      if (!token) throw Error("Not signed in. Run wb auth login.");
      const startedAt = new Date().toISOString();
      const start = performance.now(),
        send = readFetch(origin, token),
        me = await identity(send, origin);
      store.bindIdentity(origin, me.userId);
      const available = await namespaces(send, origin),
        selected = v.namespace ?? available;
      const results: any[] = [];
      for (const ns of [...new Set(selected)]) {
        if (!available.includes(ns))
          throw Error(`Namespace unavailable: ${ns}`);
        console.error(
          `Syncing ${ns}${v.table?.length ? " tables " + v.table.join(", ") : ""}…`,
        );
        const records = await pull(store, origin, token, ns, v.table ?? []);
        const files = v["records-only"]
          ? null
          : await syncFiles(store, origin, token, ns);
        results.push({ records, files });
      }
      const result = {
        startedAt,
        finishedAt: new Date().toISOString(),
        results,
        totalMs: Math.round((performance.now() - start) * 100) / 100,
        coverage: completeness(store),
      };
      store.db
        .query("INSERT INTO runs(started_at,result) VALUES(?,?)")
        .run(startedAt, JSON.stringify(result));
      print(
        json
          ? result
          : results
              .map(
                (r) =>
                  `${r.records.namespace}: ${r.records.saved} records received in ${(r.records.recordsMs / 1000).toFixed(2)}s (SQLite ${(r.records.sqliteMs / 1000).toFixed(3)}s)${r.files ? `; ${r.files.downloaded}/${r.files.catalogued} files downloaded in ${(r.files.filesMs / 1000).toFixed(2)}s` : "; files skipped"}`,
              )
              .join("\n") +
              `\nTotal ${(result.totalMs / 1000).toFixed(2)}s. Known missing files: ${result.coverage.missingFiles.length}.` +
              results
                .flatMap((r) => r.files?.errors ?? [])
                .map((e) => `\nError: ${e}`)
                .join(""),
        json,
      );
      if (results.some((r) => r.files?.errors.length)) process.exitCode = 1;
      return;
    }
    const summary: any = store.summary();
    if (command === "status") {
      const coverage = completeness(store);
      print(
        json
          ? { ...summary, coverage }
          : table(summary.cursors) +
              "\n\n" +
              table(summary.files) +
              `\n\nKnown missing files: ${coverage.missingFiles.length}. API coverage: ${coverage.complete ? "complete" : "partial"}.`,
        json,
      );
      return;
    }
    if (command === "namespace") {
      const rows = ["reader", "spaced"].map((namespace) => ({
        namespace,
        records: summary.tables
          .filter((t: any) => t.namespace === namespace)
          .reduce((n: number, t: any) => n + t.records, 0),
        coverage: summary.cursors.some(
          (c: any) =>
            c.namespace === namespace && c.selection === "*" && c.complete,
        )
          ? "full namespace"
          : "partial / not synced",
        last_success:
          summary.cursors.find(
            (c: any) => c.namespace === namespace && c.selection === "*",
          )?.last_success ?? "never",
      }));
      print(json ? rows : table(rows), json);
      return;
    }
    if (command === "table") {
      const rows = summary.tables.filter(
        (t: any) => !v.namespace || v.namespace.includes(t.namespace),
      );
      print(json ? rows : table(rows), json);
      return;
    }
    if (command === "tree") {
      if (json) {
        print(summary, json);
        return;
      }
      for (const ns of v.namespace ?? ["reader", "spaced"]) {
        const cursor = summary.cursors.find(
          (c: any) => c.namespace === ns && c.selection === "*",
        );
        console.log(
          `${ns} · ${cursor?.complete ? "full namespace" : "partial / not synced"} · last success ${cursor?.last_success ?? "never"}`,
        );
        const tables = summary.tables.filter((t: any) => t.namespace === ns);
        tables.forEach((t: any, i: number) =>
          console.log(
            `${i === tables.length - 1 ? "└──" : "├──"} ${t.table_name ?? "(opaque key)"}  ${t.records} records (${t.tombstones} tombstones)`,
          ),
        );
      }
      return;
    }
    if (command === "db") {
      const rows = store.db
        .query<{ name: string; sql: string }, []>(
          "SELECT name,sql FROM sqlite_schema WHERE sql IS NOT NULL ORDER BY type,name",
        )
        .all()
        .filter((r) => !v.table || v.table.includes(r.name));
      print(json ? rows : rows.map((r) => r.sql + ";").join("\n\n"), json);
      return;
    }
    if (command === "snapshot" || command === "export") {
      if (command === "export" && !v.output)
        throw Error("export requires --output DIRECTORY");
      const result = snapshot(
        store,
        command === "export" ? resolve(v.output!) : undefined,
      );
      print(
        json
          ? result
          : `Verified snapshot: ${result.path}\n${result.files.length} files. API coverage: ${result.coverage.complete ? "complete" : "partial"}.`,
        json,
      );
      return;
    }
  } finally {
    store?.close();
    unlock();
  }
}
main().catch((error) => {
  console.error(
    `wb: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
});
