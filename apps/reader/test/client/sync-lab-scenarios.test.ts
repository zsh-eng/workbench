import { Blob as NodeBlob } from "node:buffer";
import { SyncLabController } from "@/features/sync-lab/core/controller";
import {
  createLabScenario,
  type ScenarioKind,
} from "@/features/sync-lab/core/scenarios";
import { createDemoSeed } from "@/features/sync-lab/core/seed";
import type { ClientInspection } from "@/features/sync-lab/types";
import { readSyncClientState } from "@/lib/sync-v2/client-state";
import {
  createSyncV2ApplicationDb,
  EPUBReaderSyncV2DB,
  SYNC_V2_SYNCED_TABLES,
} from "@/lib/sync-v2/db";
import { SyncV2Client } from "@/lib/sync-v2/sync";
import { afterEach, describe, expect, it, vi } from "vitest";

const labs: SyncLabController[] = [];
const bookId = "sync-lab-demo";
const noteId = `lab-note:${bookId}`;

afterEach(async () => {
  for (const lab of labs.splice(0)) await lab.dispose();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** Use separate application/raw connections so every scenario write uses sync middleware. */
async function attach(lab: SyncLabController, id: string) {
  const config = lab.connect(id);
  const app = createSyncV2ApplicationDb(config.databaseName, {
    deviceId: config.deviceId,
    storage: config.storage,
    now: config.now,
  });
  const raw = new EPUBReaderSyncV2DB(config.databaseName);
  await Promise.all([app.open(), raw.open()]);
  const sync = new SyncV2Client({
    syncDb: raw,
    remote: config.syncRemote,
    stateStorage: config.storage,
  });
  lab.attach(id, {
    async inspect() {
      return {
        rows: Object.fromEntries(
          await Promise.all(
            SYNC_V2_SYNCED_TABLES.map(async (table) => [
              table,
              await raw.table(table).toArray(),
            ]),
          ),
        ),
        outbox: await raw._sync_outbox.toArray(),
        files: (await raw.files.toArray()).map(({ id, size }) => ({
          id,
          size,
        })),
        materialized: [],
        state: readSyncClientState(config.storage),
      } as ClientInspection;
    },
    async command(command) {
      if (command.type === "sync") {
        await sync.sync();
        return;
      }
      if (command.type === "pull") {
        await sync.pull();
        return;
      }
      if (command.type === "push") {
        await sync.push();
        return;
      }
      const book = await app.books.get(command.bookId);
      if (!book || book.isDeleted)
        throw new Error("Select an available book first.");
      if (command.type === "download") {
        const blob = await config.fileRemote.get(book.sourceFileId);
        await raw.files.put({
          id: book.sourceFileId,
          blob,
          size: blob.size,
          mediaType: blob.type,
          storedAt: config.now(),
          remotePresent: true,
        });
        return;
      }
      if (command.type === "checkpoint") {
        await app.readingCheckpoints.put({
          id: `resume:${id}:${bookId}`,
          bookId,
          deviceId: id,
          currentSpineIndex: 0,
          scrollProgress: command.progress,
          lastRead: config.now(),
          isDeleted: false,
        });
        return;
      }
      if (command.type === "delete-note") {
        await app.notes.delete(noteId);
        return;
      }
      const existing = await app.notes.get(noteId);
      await app.notes.put({
        id: noteId,
        bookId,
        kind: "note",
        content: command.content,
        anchor: {
          spineItemId: book.spine[0]!.idref,
          startOffset: 0,
          endOffset: 0,
          textBefore: "",
          textAfter: "",
        },
        createdAt: existing?.createdAt ?? config.now(),
        updatedAt: config.now(),
        isDeleted: false,
      });
    },
    async snapshot() {
      return Object.fromEntries(
        await Promise.all(
          raw.tables.map(async (table) => [table.name, await table.toArray()]),
        ),
      );
    },
    async stop() {
      app.close();
      raw.close();
    },
  });
  return { app, raw };
}

async function setup(kind: ScenarioKind) {
  vi.stubGlobal("Blob", NodeBlob);
  const lab = new SyncLabController();
  labs.push(lab);
  await lab.setSeed(await createDemoSeed());
  const ids = [await lab.spawn("metadata"), await lab.spawn("metadata")];
  const endpoints = new Map<string, Awaited<ReturnType<typeof attach>>>();
  async function reconnect() {
    for (const id of ids) endpoints.set(id, await attach(lab, id));
  }
  await reconnect();
  // The browser remounts frames after both operations. Reconnect fresh databases
  // here, after the real controller has closed the preceding connections.
  const checkpoint = lab.checkpoint.bind(lab);
  vi.spyOn(lab, "checkpoint").mockImplementation(async (name) => {
    const snapshot = await checkpoint(name);
    await reconnect();
    return snapshot;
  });
  const restore = lab.restore.bind(lab);
  vi.spyOn(lab, "restore").mockImplementation(async (snapshot) => {
    await restore(snapshot);
    await reconnect();
  });
  const plan = createLabScenario(lab, bookId, kind);
  const initial = ids.map((id) => endpoints.get(id)!);
  await plan.prepare();
  expect(initial.every(({ app, raw }) => !app.isOpen() && !raw.isOpen())).toBe(
    true,
  );
  await lab.refresh();
  return {
    lab,
    plan,
    ids,
    a: () => endpoints.get(ids[0]!)!.raw,
    b: () => endpoints.get(ids[1]!)!.raw,
  };
}

describe("Sync Lab scenario recipes with real records and transport", () => {
  it.each<ScenarioKind>(["offline-edit", "conflict", "deletion"])(
    "prepares %s without sending its pending edit, then converges",
    async (kind) => {
      const { lab, plan, a, b, ids } = await setup(kind);
      expect(lab.connect(ids[0]!).isOnline()).toBe(false);
      expect(await a()._sync_outbox.count()).toBe(1);
      expect(await b().notes.get(noteId)).toMatchObject({
        content:
          kind === "conflict"
            ? "Written offline on Client B"
            : "Initial shared note",
        isDeleted: false,
      });
      if (kind === "deletion")
        expect(await a().notes.get(noteId)).toMatchObject({ isDeleted: true });
      if (kind === "conflict") {
        expect(lab.connect(ids[1]!).isOnline()).toBe(false);
        expect(await b()._sync_outbox.count()).toBe(1);
      }
      for (const step of plan.steps) await step.run();
      const resolved = await a().notes.get(noteId);
      expect(await b().notes.get(noteId)).toEqual(resolved);
      expect(resolved).toMatchObject(
        kind === "deletion"
          ? { isDeleted: true }
          : {
              content:
                kind === "conflict"
                  ? "Written offline on Client B"
                  : "Written on Client A",
              isDeleted: false,
            },
      );
      expect(await a()._sync_outbox.count()).toBe(0);
      expect(await b()._sync_outbox.count()).toBe(0);
    },
  );

  it("retains the outbox after a lost response and retries without another server record", async () => {
    const { lab, plan, a, b } = await setup("lost-response");
    await plan.steps[0]!.run();
    expect(plan.steps[0]!.pauseAfter).toBe(true);
    expect(await a()._sync_outbox.count()).toBe(1);
    expect(await b().notes.get(noteId)).toMatchObject({
      content: "Initial shared note",
    });
    const committed = lab.server.snapshot();
    expect(
      committed.records.map((row) => JSON.parse(row.value)),
    ).toContainEqual(
      expect.objectContaining({ id: noteId, content: "Written on Client A" }),
    );
    for (const step of plan.steps.slice(1)) await step.run();
    expect(lab.server.snapshot().records).toEqual(committed.records);
    expect(await a()._sync_outbox.count()).toBe(0);
    expect(await b().notes.get(noteId)).toEqual(await a().notes.get(noteId));
  });

  it("leaves a rejected future write pending until the clocks catch up", async () => {
    const { lab, plan, a, b } = await setup("clock-skew");
    const before = lab.server.snapshot();
    await plan.steps[0]!.run();
    expect(plan.steps[0]!.pauseAfter).toBe(true);
    expect(lab.server.snapshot()).toEqual(before);
    expect(await a()._sync_outbox.count()).toBe(1);
    for (const step of plan.steps.slice(1)) await step.run();
    expect(await a()._sync_outbox.count()).toBe(0);
    expect(await b().notes.get(noteId)).toMatchObject({
      content: "Written on Client A",
    });
  });

  it("downloads A's book and transfers B's newer position without overwriting A's checkpoint", async () => {
    const { plan, a, b, ids } = await setup("handoff");
    expect(await a().files.count()).toBe(1);
    expect(await b().files.count()).toBe(0);
    const original = await a().readingCheckpoints.get(
      `resume:${ids[0]}:${bookId}`,
    );
    expect(original).toMatchObject({ scrollProgress: 15 });
    for (const step of plan.steps) await step.run();
    expect(
      await a().readingCheckpoints.get(`resume:${ids[0]}:${bookId}`),
    ).toEqual(original);
    expect(
      await a().readingCheckpoints.get(`resume:${ids[1]}:${bookId}`),
    ).toMatchObject({ scrollProgress: 65 });
  });
});
