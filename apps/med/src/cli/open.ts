import { parseArgs } from "node:util";
import { resolve } from "node:path";
import { findPort, readConnection, getStateDirectory } from "../host/runtime/connection";
import { localReadSchema } from "../shared/local-file";
import { request } from "./review";

export async function runOpenCommand(args: string[]) {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      line: { type: "string" },
      column: { type: "string" },
      edit: { type: "boolean" },
      port: { type: "string" },
      "state-dir": { type: "string" },
      help: { type: "boolean" },
    },
  });
  if (values.help) {
    console.log(
      "Usage: med-diff open <file> [--line N] [--column N] [--edit] [--port N] [--state-dir PATH]\nPrint a local file link using the running med host.",
    );
    return;
  }
  if (positionals.length !== 1) throw new Error("Use med-diff open <file>.");
  const stateDir = getStateDirectory(values["state-dir"]);
  const port = values.port === undefined ? await findPort(stateDir) : Number(values.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid port.");
  const connection = await readConnection(stateDir, port);
  const file = localReadSchema.parse(
    await request(connection, "/api/local-files/open", fetch, { path: resolve(positionals[0]!) }),
  );
  if (file.kind !== "text") throw new Error(file.reason ?? "This file cannot be opened as text.");
  const url = new URL(
    `/file${file.path.split("/").map(encodeURIComponent).join("/")}`,
    connection.origin,
  );
  for (const key of ["line", "column"] as const) {
    if (values[key] === undefined) continue;
    const value = Number(values[key]);
    if (!Number.isSafeInteger(value) || value < 1)
      throw new Error(`${key} must be a positive integer.`);
    url.searchParams.set(key, String(value));
  }
  if (values.edit) url.searchParams.set("edit", "1");
  console.log(`[Open file in med](${url.href})`);
}
