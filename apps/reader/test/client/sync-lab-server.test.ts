import { MemorySyncServer } from "@/features/sync-lab/core/memory-server";
import { computeFileId } from "@/lib/files/file-id";
import {
  MAX_SYNC_FUTURE_CLOCK_SKEW_MS,
  type SyncPushChange,
} from "@zsh-eng/local-sync";
import { describe, expect, it } from "vitest";

const change = (
  key: string,
  wallTimeMs = 100,
  isDeleted = false,
): SyncPushChange => ({
  key,
  value: JSON.stringify({ id: key }),
  schemaVersion: 1,
  isDeleted,
  hlc: { wallTimeMs, counter: 0 },
});
const pull = { cursor: 0, excludeOwnDevice: false };

describe("Sync Lab server production protocol contract", () => {
  it("orders versions by clock, counter, device and retains tombstones", async () => {
    const server = new MemorySyncServer();
    await server.push("a", [change("note")]);
    expect(
      (await server.push("b", [change("note")])).results[0]?.accepted,
    ).toBe(true);
    expect(
      (await server.push("a", [change("note")])).results[0]?.accepted,
    ).toBe(false);
    await server.push("a", [
      { ...change("note", 100, true), hlc: { wallTimeMs: 100, counter: 1 } },
    ]);
    const response = await server.pull("c", pull);
    expect(response.records).toHaveLength(1);
    expect(response.records[0]).toMatchObject({
      isDeleted: true,
      deviceId: "a",
      serverSeq: 4,
    });
  });

  it("keeps retry winners stable while consuming SQLite sequence attempts", async () => {
    const server = new MemorySyncServer();
    const first = await server.push("a", [change("one")]);
    const retry = await server.push("a", [change("one")]);
    expect(retry.results[0]).toEqual({
      accepted: false,
      winner: first.results[0]!.winner,
    });
    expect((await server.pull("b", pull)).head).toBe(1);
    expect(
      (await server.push("a", [change("two")])).results[0]?.winner.serverSeq,
    ).toBe(3);
  });

  it("uses fixed heads with compacted rows and catches concurrent changes on the next pull", async () => {
    const server = new MemorySyncServer();
    await server.push("a", [change("one"), change("two"), change("three")]);
    const first = await server.pull("b", { ...pull, limit: 1 });
    expect(first).toMatchObject({ head: 3, cursor: 1, hasMore: true });
    await server.push("a", [change("two", 101), change("four")]);
    const second = await server.pull("b", {
      ...pull,
      cursor: first.cursor,
      head: first.head,
      limit: 1,
    });
    expect(second).toMatchObject({ head: 3, cursor: 3, hasMore: false });
    expect(second.records.map((record) => record.key)).toEqual(["three"]);
    expect(
      (await server.pull("b", { ...pull, cursor: 3 })).records.map(
        (record) => record.key,
      ),
    ).toEqual(["two", "four"]);
  });

  it("filters own device before pagination and advances empty pages to head", async () => {
    const server = new MemorySyncServer();
    await server.push("a", [change("one"), change("two")]);
    await server.push("b", [change("three")]);
    expect(
      await server.pull("a", { ...pull, excludeOwnDevice: true, limit: 1 }),
    ).toMatchObject({
      cursor: 3,
      head: 3,
      hasMore: false,
      records: [{ key: "three" }],
    });
    expect(
      await server.pull("b", { cursor: 2, excludeOwnDevice: true }),
    ).toEqual({ records: [], cursor: 3, head: 3, hasMore: false });
  });

  it("validates whole batches and future clock bounds before mutation", async () => {
    const server = new MemorySyncServer({ now: () => 100 });
    await expect(
      server.push("a", [change("one"), change("one")]),
    ).rejects.toThrow();
    await expect(
      server.push("a", [
        change("one"),
        change("future", 101 + MAX_SYNC_FUTURE_CLOCK_SKEW_MS),
      ]),
    ).rejects.toThrow("future");
    expect(server.snapshot().records).toEqual([]);
    await expect(server.pull("a", { ...pull, head: 1 })).rejects.toThrow(
      "exceeds",
    );
  });

  it("restores records, binary files and next sequence without aliasing metadata", async () => {
    const server = new MemorySyncServer();
    const blob = new Blob(["epub"], { type: "application/epub+zip" });
    const id = await computeFileId(blob);
    await server.push("a", [change("one")]);
    await server.files.put(id, blob, "application/epub+zip");
    const snapshot = server.snapshot();
    await server.files.delete(id);
    await server.push("a", [change("two")]);
    server.restore(snapshot);
    snapshot.records[0]!.value = "changed outside";
    expect((await server.pull("b", pull)).records[0]?.value).not.toBe(
      "changed outside",
    );
    expect((await server.files.get(id)).size).toBe(4);
    expect(
      (await server.push("a", [change("two")])).results[0]?.winner.serverSeq,
    ).toBe(2);
  });
});
