/** Reads which table files each LevelDB level holds, from a store's MANIFEST. */
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";

export interface LevelSample {
  t: number;
  /** Files per level, L0 first. */
  files: number[];
  /** Bytes per level. */
  bytes: number[];
  /** Bytes in write-ahead logs. */
  log: number;
}

const BLOCK = 32_768;

function varint(data: Uint8Array, at: { i: number }) {
  let result = 0,
    shift = 1;
  for (;;) {
    const byte = data[at.i++]!;
    result += (byte & 0x7f) * shift;
    if (byte < 0x80) return result;
    shift *= 128;
  }
}

/** The whole records of a LevelDB log file. */
function logRecords(data: Uint8Array): Uint8Array[] {
  const records: Uint8Array[] = [];
  let parts: Uint8Array[] = [];
  let offset = 0;
  while (offset + 7 <= data.length) {
    const left = BLOCK - (offset % BLOCK);
    if (left < 7) {
      offset += left;
      continue;
    }
    const length = data[offset + 4]! | (data[offset + 5]! << 8);
    const type = data[offset + 6]!;
    if (type === 0 || offset + 7 + length > data.length) break;
    const body = data.subarray(offset + 7, offset + 7 + length);
    offset += 7 + length;
    if (type === 1) records.push(body);
    else if (type === 2) parts = [body];
    else if (type === 3) parts.push(body);
    else if (type === 4) {
      parts.push(body);
      const whole = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
      let at = 0;
      for (const part of parts) {
        whole.set(part, at);
        at += part.length;
      }
      records.push(whole);
      parts = [];
    }
  }
  return records;
}

export function readLevels(dir: string): Omit<LevelSample, "t"> | undefined {
  if (!existsSync(join(dir, "CURRENT"))) return undefined;
  const manifest = readFileSync(join(dir, "CURRENT"), "utf8").trim();
  if (!manifest) return undefined;
  const levels = Array.from({ length: 7 }, () => new Map<number, number>());
  for (const record of logRecords(readFileSync(join(dir, manifest)))) {
    const at = { i: 0 };
    while (at.i < record.length) {
      const tag = varint(record, at);
      if (tag === 1) at.i += varint(record, at) + 0;
      else if (tag === 2 || tag === 3 || tag === 4 || tag === 9)
        varint(record, at);
      else if (tag === 5) {
        varint(record, at);
        const length = varint(record, at);
        at.i += length;
      } else if (tag === 6) {
        const level = varint(record, at);
        levels[level]!.delete(varint(record, at));
      } else if (tag === 7) {
        const level = varint(record, at);
        const number = varint(record, at);
        const size = varint(record, at);
        at.i += varint(record, at);
        at.i += varint(record, at);
        levels[level]!.set(number, size);
      } else break;
    }
  }
  let log = 0;
  for (const name of readdirSync(dir))
    if (name.endsWith(".log")) {
      try {
        log += statSync(join(dir, name)).size;
      } catch {
        // Rotated away between the listing and the read.
      }
    }
  return {
    files: levels.map((level) => level.size),
    bytes: levels.map((level) =>
      [...level.values()].reduce((a, b) => a + b, 0),
    ),
    log,
  };
}
