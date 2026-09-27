import { parseArgs } from "node:util";
import { resolve } from "node:path";
import { getStateDirectory } from "../host/runtime/connection";
import { SourceCatalogue } from "../host/vault/sources";
import { VaultIndex } from "../host/vault/index";

export const sourcesHelp = `Usage: med-diff sources add <repo|vault> <directory> [--index]
       med-diff sources list
       med-diff sources remove <source-id>
       med-diff vault index <source-id>
       med-diff vault backlinks <source-id> <vault-relative-path>
Options: --state-dir <directory> (or MED_STATE_DIR)
Registration persists locally. --index builds a vault metadata cache without starting a host.
The vault commands are CLI-only; the browser vault mode is not implemented yet.
Backlinks reflect the last index run. Run vault index after external edits.
Removing a registration keeps its rebuildable cache and never deletes source files.`;

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
    throw new Error(sourcesHelp);
  const sources = await SourceCatalogue.open(getStateDirectory(values["state-dir"]));
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
              "Index this vault before querying backlinks: med-diff vault index <source-id>",
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
