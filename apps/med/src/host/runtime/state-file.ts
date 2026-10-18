import { randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

// Med's state files follow one rule. A write goes to a temporary file that
// then replaces the old one, so a crash leaves the old file or the new one,
// never a part of one. A read checks each record on its own, so one bad
// record costs only itself. A file that Med cannot read in full gets a copy
// beside it before Med writes the file again, so nothing is lost.

/** Writes `text` to `file` in one step, readable only by the user. */
export async function writeStateFile(file: string, text: string) {
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, text, { mode: 0o600, flag: "wx" });
    await rename(temporary, file);
  } catch (error) {
    await unlink(temporary).catch(() => {});
    throw error;
  }
}

/** Copies a file that Med could not read in full to
 * `<file>.unreadable-<time>`, and says so on the host's error output. */
export async function keepAside(file: string) {
  const aside = `${file}.unreadable-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  await copyFile(file, aside).catch(() => {});
  console.error(`Med could not read all of ${file}; it kept a copy at ${aside}.`);
  return aside;
}

/**
 * The records of a state file that holds one JSON object of records by ID.
 * `check` returns a record, or undefined for one that Med cannot use, which
 * is left out. Undefined when the file does not exist.
 */
export async function readRecords<T>(
  file: string,
  check: (id: string, value: unknown) => T | undefined,
): Promise<Record<string, T> | undefined> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    raw = undefined;
  }
  const records: Record<string, T> = {};
  let dropped = !raw || typeof raw !== "object" || Array.isArray(raw);
  for (const [id, value] of dropped ? [] : Object.entries(raw as object)) {
    const record = check(id, value);
    if (record === undefined) dropped = true;
    else records[id] = record;
  }
  if (dropped) await keepAside(file);
  return records;
}
