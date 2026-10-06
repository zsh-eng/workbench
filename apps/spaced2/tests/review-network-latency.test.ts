import { test, expect } from "bun:test";
import SyncEngine from "@/lib/sync/engine";
import { db, rawDb } from "@/lib/db/persistence";
import MemoryDB, { memoryReady } from "@/lib/db/memory";
import { gradeCardOperation } from "@/lib/sync/operation";
import { createEmptyCard, Rating } from "ts-fsrs";
import type { CardWithMetadata } from "@/lib/types";

for (const phase of ["identity", "pull", "push"] as const) {
  test(`a grade commits locally while ${phase} waits for the network`, async () => {
    await memoryReady;
    const originalFetch = globalThis.fetch;
    let release!: () => void, entered!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const waiting = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const card: CardWithMetadata = {
      ...createEmptyCard(new Date(Date.now() - 1000)),
      id: crypto.randomUUID(),
      front: "Local",
      back: "Answer",
      deleted: false,
      bookmarked: false,
      createdAt: 0,
      cardLastModified: 0,
      cardContentLastModified: 0,
      cardDeletedLastModified: 0,
      cardBookmarkedLastModified: 0,
      cardSuspendedLastModified: 0,
      cardMetadataLastModified: 0,
    };
    MemoryDB.putCard(card);
    MemoryDB.notify();
    // Ensure push also has something to send before pausing its response.
    if (phase === "push") await gradeCardOperation(card, Rating.Good);
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      const current = url.endsWith("/me")
        ? "identity"
        : url.includes("/push")
          ? "push"
          : "pull";
      if (current === phase) {
        entered();
        await gate;
      }
      if (current === "identity")
        return Response.json({
          userId: "latency-fixture",
          expiresAt: new Date(Date.now() + 86400000).toISOString(),
        });
      if (current === "push")
        throw new Error("Deliberate offline push; retain outbox");
      return new Response(
        '{"records":[],"cursor":0,"head":0,"hasMore":false}\n{"type":"end"}\n',
        { headers: { "content-type": "application/x-ndjson" } },
      );
    }) as typeof fetch;
    let sync: Promise<unknown> | undefined;
    try {
      sync = SyncEngine.syncFromServer().catch(() => {});
      await waiting;
      const started = performance.now();
      const grade = gradeCardOperation(
        MemoryDB.getCardById(card.id)!,
        Rating.Good,
      );
      let timer: ReturnType<typeof setTimeout>;
      const completed = await Promise.race([
        grade.then(() => true),
        new Promise<boolean>((resolve) => {
          timer = setTimeout(() => resolve(false), 500);
        }),
      ]);
      clearTimeout(timer!);
      const ms = performance.now() - started;
      release();
      await grade;
      expect(completed).toBe(true);
      expect(await db._sync_outbox.count()).toBeGreaterThan(0);
      console.log(`${phase} network held open: local grade ${ms.toFixed(1)}ms`);
    } finally {
      release();
      await sync;
      globalThis.fetch = originalFetch;
      await Promise.all([
        rawDb.operations.clear(),
        rawDb.reviewLogOperations.clear(),
        rawDb._sync_outbox.clear(),
        rawDb.metadataKv.delete("owner"),
      ]);
      for (const c of MemoryDB.getCards())
        MemoryDB.putCard({ ...c, deleted: true });
      while (MemoryDB.popUndoGrade()) {
        // Drain the undo stack between network phases.
      }
      MemoryDB.notify();
    }
  });
}
