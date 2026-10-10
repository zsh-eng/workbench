import { createReadStream, existsSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";

/**
 * Local real data: serve the Workbench Backup mirror as the Reader API.
 *
 * The browser installs the data the way a new device does: it signs in as a
 * local user, pulls every record, and downloads book files on demand. The
 * mirror opens read-only. Writes from the browser stay in this process, so
 * the backup and the production API never change.
 */
export const DEFAULT_BACKUP_DIR = path.join(
  os.homedir(),
  "Library/Application Support/Workbench Backup",
);

/** Its own origin keeps the real-data IndexedDB apart from everyday dev. */
export const LOCAL_DATA_PORT = 5177;
const NAMESPACE = "reader";
const PULL_LIMIT = 500;
const LOCAL_USER_ID = "local-reader";

interface LocalRecord {
  key: string;
  value: string;
  isDeleted: boolean;
  schemaVersion: number;
  hlc: { wallTimeMs: number; counter: number };
  deviceId: string;
  serverSeq: number;
}

interface LocalFile {
  id: string;
  fileSize: number;
  mediaType: string;
  createdAt: number;
  /** A mirror object, or bytes uploaded during this run. */
  source: { kind: "object"; path: string } | { kind: "upload"; bytes: Buffer };
}

interface BackupSnapshot {
  records: Map<string, LocalRecord>;
  files: Map<string, LocalFile>;
  head: number;
}

export async function readBackupSnapshot(
  backupDir: string,
): Promise<BackupSnapshot> {
  const databasePath = path.join(backupDir, "mirror.sqlite");
  if (!existsSync(databasePath)) {
    throw new Error(
      `No Workbench Backup mirror at ${databasePath}. Set READER_BACKUP_DIR to its folder.`,
    );
  }
  // Loaded on use: everyday dev imports this file but never opens a backup.
  const { DatabaseSync } = await import("node:sqlite");
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const records = new Map<string, LocalRecord>();
    let head = 0;
    const rows = database
      .prepare(
        `SELECT key, value, is_deleted, schema_version, wall_time, counter,
                device_id, server_seq
           FROM records WHERE namespace = ? ORDER BY server_seq`,
      )
      .all(NAMESPACE) as {
      key: string;
      value: string;
      is_deleted: number;
      schema_version: number;
      wall_time: number;
      counter: number;
      device_id: string;
      server_seq: number;
    }[];
    for (const row of rows) {
      records.set(row.key, {
        key: row.key,
        value: row.value,
        isDeleted: row.is_deleted === 1,
        schemaVersion: row.schema_version,
        hlc: { wallTimeMs: row.wall_time, counter: row.counter },
        deviceId: row.device_id,
        serverSeq: row.server_seq,
      });
      head = Math.max(head, row.server_seq);
    }
    const files = new Map<string, LocalFile>();
    const fileRows = database
      .prepare(
        `SELECT id, size, media_type, created_at, sha256
           FROM files WHERE namespace = ? AND active = 1`,
      )
      .all(NAMESPACE) as {
      id: string;
      size: number;
      media_type: string;
      created_at: number;
      sha256: string;
    }[];
    for (const row of fileRows) {
      files.set(row.id, {
        id: row.id,
        fileSize: row.size,
        mediaType: row.media_type,
        createdAt: row.created_at,
        source: {
          kind: "object",
          path: path.join(backupDir, "objects", row.sha256),
        },
      });
    }
    return { records, files, head };
  } finally {
    database.close();
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

/** Newer clocks win, as on the server; the device id breaks a tie. */
function isNewer(incoming: LocalRecord, current: LocalRecord | undefined) {
  if (!current) return true;
  if (incoming.hlc.wallTimeMs !== current.hlc.wallTimeMs)
    return incoming.hlc.wallTimeMs > current.hlc.wallTimeMs;
  if (incoming.hlc.counter !== current.hlc.counter)
    return incoming.hlc.counter > current.hlc.counter;
  return incoming.deviceId > current.deviceId;
}

export function readerBackupApi(backupDir = DEFAULT_BACKUP_DIR): Plugin {
  let snapshot: BackupSnapshot;
  return {
    name: "reader-backup-api",
    // Vite reads env files after this hook, so these settings hold for the client.
    config() {
      // Local data never reaches the shared production API, whatever the shell sets.
      delete process.env.VITE_SHARED_API_URL;
      process.env.VITE_BETTER_AUTH_URL = `http://localhost:${LOCAL_DATA_PORT}`;
      return {
        cacheDir: "node_modules/.vite-local-data",
        // No .env file applies: one could name a remote API.
        envDir: path.dirname(fileURLToPath(import.meta.url)),
        server: { port: LOCAL_DATA_PORT, strictPort: true },
      };
    },
    async configureServer(server) {
      snapshot = await readBackupSnapshot(backupDir);
      server.config.logger.info(
        `  Local data: ${snapshot.records.size} records and ${snapshot.files.size} files from ${backupDir} (read-only)`,
      );
      server.middlewares.use("/api", (req, res) => {
        void handle(req, res).catch((error: unknown) => {
          server.config.logger.error(String(error));
          sendJson(res, 500, { error: "Local data API failed" });
        });
      });
    },
  };

  async function handle(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? "/", "http://localhost");
    const route = url.pathname;
    const method = req.method ?? "GET";
    const deviceId = String(req.headers["x-device-id"] ?? "local-browser");

    if (route === "/auth/get-session") {
      const now = new Date().toISOString();
      return sendJson(res, 200, {
        user: {
          id: LOCAL_USER_ID,
          name: "Local reader",
          email: "reader@local.test",
          emailVerified: true,
          createdAt: now,
          updatedAt: now,
        },
        session: {
          id: "local-session",
          userId: LOCAL_USER_ID,
          token: "local-data",
          expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
          createdAt: now,
          updatedAt: now,
        },
      });
    }
    if (route.startsWith("/auth/")) return sendJson(res, 200, {});
    if (route === "/devices") return sendJson(res, 200, { devices: [] });

    if (route === "/sync/v2/pull" && method === "GET") {
      const cursor = Number(url.searchParams.get("cursor") ?? 0);
      const head = Number(url.searchParams.get("head") ?? snapshot.head);
      const limit = Math.min(
        Number(url.searchParams.get("limit") ?? PULL_LIMIT),
        PULL_LIMIT,
      );
      if (cursor > head || head > snapshot.head)
        return sendJson(res, 409, {
          error: "Cursor or head exceeds the current stream",
        });
      const excludeOwn = url.searchParams.get("excludeOwnDevice") === "true";
      const pending = [...snapshot.records.values()]
        .filter(
          (record) =>
            record.serverSeq > cursor &&
            record.serverSeq <= head &&
            !(excludeOwn && record.deviceId === deviceId),
        )
        .sort((a, b) => a.serverSeq - b.serverSeq);
      const records = pending.slice(0, limit);
      const hasMore = pending.length > limit;
      return sendJson(res, 200, {
        records,
        cursor: hasMore ? records.at(-1)!.serverSeq : head,
        head,
        hasMore,
      });
    }

    if (route === "/sync/v2/push" && method === "POST") {
      const { changes } = JSON.parse((await readBody(req)).toString()) as {
        changes: Omit<LocalRecord, "deviceId" | "serverSeq">[];
      };
      const results = changes.map((change) => {
        const incoming = { ...change, deviceId, serverSeq: 0 };
        const current = snapshot.records.get(change.key);
        if (!isNewer(incoming, current))
          return { accepted: false, winner: current };
        incoming.serverSeq = ++snapshot.head;
        snapshot.records.set(change.key, incoming);
        return { accepted: true, winner: incoming };
      });
      return sendJson(res, 200, { results });
    }

    if (route === "/files" && method === "GET") {
      return sendJson(res, 200, {
        files: [...snapshot.files.values()].map(
          ({ id, fileSize, mediaType, createdAt }) => ({
            id,
            fileSize,
            mediaType,
            createdAt,
          }),
        ),
      });
    }

    const fileMatch = /^\/files\/([^/]+)$/.exec(route);
    if (fileMatch) {
      const id = decodeURIComponent(fileMatch[1]);
      const file = snapshot.files.get(id);
      if (method === "PUT") {
        const bytes = await readBody(req);
        const uploaded: LocalFile = file ?? {
          id,
          fileSize: bytes.length,
          mediaType: String(
            req.headers["content-type"] ?? "application/octet-stream",
          ),
          createdAt: Date.now(),
          source: { kind: "upload", bytes },
        };
        snapshot.files.set(id, uploaded);
        const { fileSize, mediaType, createdAt } = uploaded;
        return sendJson(res, 200, {
          id,
          fileSize,
          mediaType,
          createdAt,
          alreadyExists: Boolean(file),
        });
      }
      if (method === "DELETE") {
        snapshot.files.delete(id);
        return sendJson(res, 200, { deleted: true });
      }
      if (!file) return sendJson(res, 404, { error: "File not found" });
      res.setHeader("Content-Type", file.mediaType);
      res.setHeader("Content-Length", String(file.fileSize));
      if (file.source.kind === "upload") return res.end(file.source.bytes);
      if (!existsSync(file.source.path))
        return sendJson(res, 404, { error: "File not found in the backup" });
      createReadStream(file.source.path).pipe(res);
      return;
    }

    return sendJson(res, 404, {
      error: `No local route for ${method} ${route}`,
    });
  }
}
