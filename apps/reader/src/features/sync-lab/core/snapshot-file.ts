import { z } from "zod";
import { computeFileId } from "@/lib/files/file-id";
import { SYNC_V2_STORES, SYNC_V2_SYNCED_TABLES } from "@/lib/sync-v2/db";
import { SYNC_CLIENT_STATE_STORAGE_KEY } from "@/lib/sync-v2/client-state";
import {
  decodeSyncKey,
  syncClientStateSchema,
  syncPushChangeSchema,
  syncRecordSchema,
} from "@zsh-eng/local-sync";
import type { LabSnapshot } from "./controller";

const MAX_ROWS = 50_000;
const MAX_BYTES = 100 * 1024 * 1024;
const safeNumber = z.number().finite().min(0).max(Number.MAX_SAFE_INTEGER);
const fileId = z.string().regex(/^xxh64:[a-f0-9]{16}$/);
const clientId = z.string().regex(/^lab-[a-zA-Z0-9_-]{1,120}$/);
const metadata = z.strictObject({
  id: fileId,
  fileSize: safeNumber,
  mediaType: z.string().max(256),
  createdAt: safeNumber,
});
const schema = z.strictObject({
  version: z.literal(1),
  name: z.string().max(200),
  capturedAt: safeNumber,
  elapsedMs: safeNumber,
  server: z.strictObject({
    nextSequence: safeNumber.int().positive(),
    records: z.array(syncRecordSchema).max(MAX_ROWS),
    files: z
      .array(
        z.strictObject({
          metadata,
          blob: z.custom<Blob>((value) => value instanceof Blob),
        }),
      )
      .max(2000),
  }),
  clients: z
    .array(
      z.strictObject({
        id: clientId,
        name: z.string().max(100),
        preset: z.enum(["empty", "metadata", "downloaded", "position"]),
        storage: z.record(z.string().max(200), z.string().max(100_000)),
        network: z.strictObject({
          online: z.boolean(),
          latencyMs: safeNumber.max(60_000),
          failNext: z.boolean(),
          loseNextResponse: z.boolean(),
        }),
        clockOffset: z
          .number()
          .finite()
          .min(-86400000 * 365)
          .max(86400000 * 365),
        reconnectAfterMs: safeNumber.max(86400000).optional(),
        database: z.record(
          z.string(),
          z.array(z.record(z.string(), z.unknown())).max(MAX_ROWS),
        ),
      }),
    )
    .max(4),
});

/** Reject an invalid import before the controller clears any existing clients. */
export function validateLabSnapshot(value: unknown): LabSnapshot {
  const result = schema.parse(value);
  const ids = new Set<string>();
  const sequences = new Set<number>();
  const keys = new Set<string>();
  let totalRows = result.server.records.length;
  for (const record of result.server.records) {
    const [table, recordId] = decodeSyncKey(record.key);
    const domainValue: unknown = JSON.parse(record.value);
    if (
      !domainValue ||
      typeof domainValue !== "object" ||
      Array.isArray(domainValue) ||
      (domainValue as Record<string, unknown>).id !== recordId
    )
      throw new Error("Server record value does not match its key");
    if (!(SYNC_V2_SYNCED_TABLES as readonly string[]).includes(table))
      throw new Error(`Unknown synchronized table: ${table}`);
    if (
      sequences.has(record.serverSeq) ||
      keys.has(record.key) ||
      record.serverSeq >= result.server.nextSequence
    )
      throw new Error("Invalid server sequence or duplicate key");
    sequences.add(record.serverSeq);
    keys.add(record.key);
  }
  const head = Math.max(0, ...sequences);
  for (const client of result.clients) {
    if (ids.has(client.id)) throw new Error("Duplicate client ID");
    ids.add(client.id);
    if (Object.keys(client.storage).length > 100)
      throw new Error("Too many storage keys");
    const encodedState = client.storage[SYNC_CLIENT_STATE_STORAGE_KEY];
    if (!encodedState) throw new Error("Missing client sync state");
    const state = syncClientStateSchema.parse(JSON.parse(encodedState));
    if (state.deviceId !== client.id || state.pullCursor > head)
      throw new Error("Client identity or cursor does not match the snapshot");
    for (const [table, rows] of Object.entries(client.database)) {
      if (!Object.hasOwn(SYNC_V2_STORES, table))
        throw new Error(`Unknown database table: ${table}`);
      totalRows += rows.length;
      const primaryKey =
        table === "_sync_outbox"
          ? "key"
          : [
                "bookTextCache",
                "bookChapterSourceCache",
                "bookMaterializations",
                "bookStructures",
              ].includes(table)
            ? "bookId"
            : "id";
      const rowIds = new Set<string>();
      const bookFileIds = new Set<string>();
      for (const row of rows) {
        const id = row[primaryKey];
        if (typeof id !== "string" || !id.length || rowIds.has(id))
          throw new Error(`Invalid or duplicate key in ${table}`);
        rowIds.add(id);
        if (table === "books") {
          if (
            !fileId.safeParse(row.sourceFileId).success ||
            bookFileIds.has(row.sourceFileId as string)
          )
            throw new Error("Invalid or duplicate Book source file ID");
          bookFileIds.add(row.sourceFileId as string);
        }
        if (
          (SYNC_V2_SYNCED_TABLES as readonly string[]).includes(table) &&
          typeof row.isDeleted !== "boolean"
        )
          throw new Error(`Missing deletion state in ${table}`);
        if (table === "_sync_outbox") {
          const change = syncPushChangeSchema.parse(row);
          const [domain] = decodeSyncKey(change.key);
          if (!(SYNC_V2_SYNCED_TABLES as readonly string[]).includes(domain))
            throw new Error("Unknown outbox domain");
        }
        if (
          table === "files" &&
          (!(row.blob instanceof Blob) ||
            row.size !== row.blob.size ||
            !fileId.safeParse(row.id).success)
        )
          throw new Error("Invalid local file bytes");
        if (table === "bookFiles" && !(row.content instanceof Blob))
          throw new Error("Invalid expanded book bytes");
      }
    }
  }
  if (totalRows > MAX_ROWS) throw new Error("Snapshot has too many rows");
  const fileIds = new Set<string>();
  for (const file of result.server.files) {
    if (
      file.blob.size !== file.metadata.fileSize ||
      fileIds.has(file.metadata.id)
    )
      throw new Error("Invalid or duplicate server file");
    fileIds.add(file.metadata.id);
  }
  return result as LabSnapshot;
}

type Encoded =
  | null
  | boolean
  | number
  | string
  | Encoded[]
  | { type: string; value: Encoded; mediaType?: string };
async function encode(value: unknown, depth = 0): Promise<Encoded> {
  if (depth > 50) throw new Error("Snapshot nesting exceeds limit");
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value === undefined) return { type: "undefined", value: null };
  if (value instanceof Blob) {
    const bytes = new Uint8Array(await value.arrayBuffer());
    let binary = "";
    for (let i = 0; i < bytes.length; i += 8192)
      binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    return { type: "blob", value: btoa(binary), mediaType: value.type };
  }
  if (Array.isArray(value))
    return Promise.all(value.map((entry) => encode(entry, depth + 1)));
  if (value instanceof Map)
    return { type: "map", value: await encode(Array.from(value), depth + 1) };
  if (value instanceof Date)
    return { type: "date", value: value.toISOString() };
  if (typeof value === "object")
    return {
      type: "object",
      value: await encode(Object.entries(value), depth + 1),
    };
  throw new Error("Unsupported snapshot value");
}
function decode(
  value: unknown,
  budget: { nodes: number; bytes: number },
  depth = 0,
): unknown {
  if (++budget.nodes > 1_000_000 || depth > 50)
    throw new Error("Snapshot structure exceeds limit");
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    typeof value === "number"
  )
    return value;
  if (Array.isArray(value))
    return value.map((entry) => decode(entry, budget, depth + 1));
  if (!value || typeof value !== "object")
    throw new Error("Invalid snapshot encoding");
  const node = value as Record<string, unknown>;
  if (node.type === "undefined" && node.value === null) return undefined;
  if (
    node.type === "blob" &&
    typeof node.value === "string" &&
    typeof node.mediaType === "string"
  ) {
    if (
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
        node.value,
      )
    )
      throw new Error("Invalid binary encoding");
    const binary = atob(node.value);
    budget.bytes += binary.length;
    if (budget.bytes > MAX_BYTES)
      throw new Error("Snapshot files exceed limit");
    return new Blob([Uint8Array.from(binary, (char) => char.charCodeAt(0))], {
      type: node.mediaType,
    });
  }
  if (
    node.type === "date" &&
    typeof node.value === "string" &&
    Number.isFinite(Date.parse(node.value))
  )
    return new Date(node.value);
  if (
    (node.type === "object" || node.type === "map") &&
    Array.isArray(node.value)
  ) {
    const entries = decode(node.value, budget, depth + 1) as unknown[];
    const pairs = entries.map((entry) => {
      if (!Array.isArray(entry) || entry.length !== 2)
        throw new Error("Invalid object entry");
      if (
        node.type === "object" &&
        (typeof entry[0] !== "string" ||
          ["__proto__", "constructor", "prototype"].includes(entry[0]))
      )
        throw new Error("Invalid object key");
      return entry as [string, unknown];
    });
    if (new Set(pairs.map(([key]) => key)).size !== pairs.length)
      throw new Error("Duplicate object key");
    return node.type === "map" ? new Map(pairs) : Object.fromEntries(pairs);
  }
  throw new Error("Invalid snapshot node");
}

export async function serializeLabSnapshot(
  snapshot: LabSnapshot,
): Promise<string> {
  // Normalize values from child windows into this realm before Blob/Map checks.
  snapshot = structuredClone(snapshot);
  validateLabSnapshot(snapshot);
  const json = JSON.stringify({
    format: "reader-sync-lab",
    version: 1,
    payload: await encode(snapshot),
  });
  if (json.length > MAX_BYTES * 1.5)
    throw new Error("Snapshot export exceeds 150 MB");
  return json;
}
export async function deserializeLabSnapshot(
  text: string,
): Promise<LabSnapshot> {
  if (text.length > MAX_BYTES * 1.5)
    throw new Error("Snapshot import exceeds 150 MB");
  const envelope = z
    .strictObject({
      format: z.literal("reader-sync-lab"),
      version: z.literal(1),
      payload: z.unknown(),
    })
    .parse(JSON.parse(text));
  const snapshot = validateLabSnapshot(
    decode(envelope.payload, { nodes: 0, bytes: 0 }),
  );
  const files = [
    ...snapshot.server.files.map(({ metadata, blob }) => ({
      id: metadata.id,
      blob,
    })),
    ...snapshot.clients.flatMap((client) =>
      (client.database.files ?? []).map(
        (row) => row as { id: string; blob: Blob },
      ),
    ),
  ];
  for (const file of files) {
    if ((await computeFileId(file.blob)) !== file.id)
      throw new Error("Snapshot file bytes do not match their file ID");
  }
  return snapshot;
}
