import { parseArgs } from "node:util";
import { resolve, join } from "node:path";
import { readFile } from "node:fs/promises";
import { getStateDirectory } from "../host/runtime/connection";
import { SourceCatalogue } from "../host/vault/sources";
import { VaultIndex } from "../host/vault/index";
import { UsageError } from "./exit-status";

export const sourcesHelp = `Usage: med sources add <repo|vault> <directory> [--index]
       med sources list
       med sources remove <source-id>
       med vault index <source-id>
       med vault backlinks <source-id> <vault-relative-path>
Options: --state-dir <path> (or MED_STATE_DIR)

These older commands work without a server, so they work offline. Stop the
server first; while it runs, use med add, list, remove, and index.
--index builds the metadata cache of a vault at once.
Backlinks come from the last index: run vault index after edits that Med did
not see. Removing a registration keeps its cache and never deletes files.`;

export async function runSourcesCommand(command: string, args: string[], print = console.log) {
  const { values, positionals: parts } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      help: { type: "boolean", short: "h" },
      "state-dir": { type: "string" },
      index: { type: "boolean" },
    },
  });
  if (values.help) {
    print(sourcesHelp);
    return;
  }
  const [action, first, second] = parts;
  const valid =
    command === "sources"
      ? (action === "list" && parts.length === 1) ||
        (action === "remove" && parts.length === 2) ||
        (action === "add" && parts.length === 3 && (first === "repo" || first === "vault"))
      : (action === "index" && parts.length === 2) ||
        (action === "backlinks" && parts.length === 3);
  if (!valid || (values.index && !(command === "sources" && action === "add" && first === "vault")))
    throw new UsageError(sourcesHelp);
  const stateDir = getStateDirectory(values["state-dir"]);
  if (process.argv[2] !== "__index-worker") {
    let owner: number | undefined;
    try {
      owner = JSON.parse(await readFile(join(stateDir, "service.lock"), "utf8")).pid;
    } catch {}
    if (owner) {
      let alive = true;
      try {
        process.kill(owner, 0);
      } catch {
        alive = false;
      }
      if (alive)
        throw new Error(
          "A Med server owns this state. Use med add, list, remove, or index through that server.",
        );
    }
  }
  const sources = await SourceCatalogue.open(stateDir);
  try {
    if (command === "sources") {
      if (action === "list") {
        print(JSON.stringify({ sources: sources.list() }, null, 2));
        return;
      }
      if (action === "remove") {
        sources.remove(first!);
        print(JSON.stringify({ removed: first }));
        return;
      }
      const source = await sources.add(first as "repo" | "vault", resolve(second!));
      if (!values.index) {
        print(JSON.stringify(source, null, 2));
        return;
      }
      const index = await VaultIndex.open(source.path, sources.indexPath(source.id));
      try {
        print(JSON.stringify({ source, index: await index.refresh() }, null, 2));
      } finally {
        index.close();
      }
    } else {
      const source = await sources.require(first!, "vault");
      const index = await VaultIndex.open(source.path, sources.indexPath(source.id));
      try {
        if (action === "index") print(JSON.stringify(await index.refresh(), null, 2));
        else {
          const indexedAt = index.indexedAt();
          if (!indexedAt)
            throw new Error(
              "Index this vault before you ask for backlinks: med vault index <source-id>",
            );
          const rows = index.backlinks(second!);
          print(
            JSON.stringify(
              {
                path: second,
                backlinks: rows.slice(0, 1000),
                truncated: rows.length > 1000,
                scope: "last-index-run",
                indexedAt,
              },
              null,
              2,
            ),
          );
        }
      } finally {
        index.close();
      }
    }
  } finally {
    sources.close();
  }
}
