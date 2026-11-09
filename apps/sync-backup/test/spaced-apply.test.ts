import { test, expect } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/store";
import {
  applyPlan,
  changeRecords,
  parseChangeSet,
  planChangeSet,
  readSpaced,
} from "../src/spaced-apply";
// Spaced's own decoder: every record wb pushes must be one the app accepts.
import { syncTables } from "../../spaced2/src/lib/sync/records";

test("spaced apply pushes records Spaced decodes, skips stale cards, and its undo restores them", async () => {
  const directory = mkdtempSync(join(tmpdir(), "wb-spaced-apply-"));
  try {
    const store = new Store(directory);
    let seq = 0;
    const write = (key: string, value: string) =>
      store.db
        .query(
          "INSERT OR REPLACE INTO records VALUES('spaced',?,?,1,?,0,'d',?,0,'operations',?)",
        )
        .run(key, value, 1_700_000_000_000 + ++seq, seq, key);
    const op = (type: string, id: string, payload: object) => {
      const inner = JSON.stringify([type, id]);
      write(
        JSON.stringify(["operations", inner]),
        JSON.stringify({ type, payload, timestamp: 5, id: inner, isDeleted: false }),
      );
    };
    const card = (id: string, front: string) => {
      op("card", id, { id, due: "2026-11-01T00:00:00.000Z", stability: 3, difficulty: 5, elapsed_days: 1, scheduled_days: 3, learning_steps: 0, reps: 2, lapses: 0, state: "Review", last_review: "2026-10-29T00:00:00.000Z" });
      op("cardContent", id, { cardId: id, front, back: "A" });
    };
    card("retire", "Retire me");
    card("buried", "Buried");
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString();
    op("cardSuspended", "buried", { cardId: "buried", suspended: tomorrow });
    card("stale", "Stale");

    const pushed: { key: string; value: string }[][] = [];
    const push = async (changes: { key: string; value: string }[]) => {
      pushed.push(changes);
      for (const change of changes) write(change.key, change.value);
      return changes.map(() => true);
    };

    const set = parseChangeSet(
      JSON.stringify({
        version: "spaced-changes-v1",
        title: "Review",
        changes: [
          { action: "suspend", cardId: "retire" },
          { action: "unsuspend", cardId: "buried" },
          { action: "edit", cardId: "stale", front: "Stale", back: "B", expect: { front: "Stale", back: "Old" } },
          { action: "create", deck: "worldview", front: "Hook", back: "Idea" },
          { action: "suspend", cardId: "missing" },
        ],
      }),
    );
    const before = readSpaced(store.db);
    const plan = planChangeSet(set, before);
    expect(plan.items.map((item) => item.skip)).toEqual([
      undefined,
      undefined,
      "changed since this file was made",
      undefined,
      "card not found",
    ]);
    const result = await applyPlan(plan, before, push);
    expect(result).toMatchObject({ applied: 3, skipped: 2, failed: 0 });

    const records = pushed.flat();
    // deck, suspend, unsuspend, and the new card's card + content + membership
    expect(records.map((r) => JSON.parse(JSON.parse(r.key)[1])[0])).toEqual([
      "deck", "cardSuspended", "cardSuspended", "card", "cardContent", "updateDeckCard",
    ]);
    for (const record of records) expect(() => syncTables.operations.decode(record.value)).not.toThrow();

    const after = readSpaced(store.db);
    expect(Date.parse(after.cards.get("retire")!.suspended!)).toBeGreaterThan(Date.UTC(9999, 0));
    expect(after.cards.get("buried")!.suspended).toBe(new Date(0).toISOString());
    expect(after.decks.has("worldview")).toBe(true);
    const created = [...after.cards.values()].find((c) => c.front === "Hook")!;
    expect(created).toBeDefined();
    // Later pushes are newer than everything in the mirror.
    expect(after.clock.wallTimeMs).toBeGreaterThanOrEqual(before.clock.wallTimeMs);

    const undo = await applyPlan(planChangeSet(result.undo!, after), after, push);
    expect(undo).toMatchObject({ applied: 3, failed: 0 });
    const restored = readSpaced(store.db);
    expect(restored.cards.get("retire")!.suspended).toBe(new Date(0).toISOString());
    expect(restored.cards.get("buried")!.suspended).toBe(new Date(tomorrow).toISOString());
    expect(restored.cards.get(created.id)!.deleted).toBe(true);
    store.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a change set naming a card twice is refused before anything is pushed", async () => {
  const directory = mkdtempSync(join(tmpdir(), "wb-spaced-apply-"));
  try {
    const store = new Store(directory);
    const set = parseChangeSet(
      JSON.stringify({
        version: "spaced-changes-v1",
        changes: [
          { action: "suspend", cardId: "x" },
          { action: "unsuspend", cardId: "x" },
        ],
      }),
    );
    const spaced = readSpaced(store.db);
    const plan = planChangeSet(set, spaced);
    expect(plan.problems).toEqual(["Card x has more than one change."]);
    await expect(applyPlan(plan, spaced, async () => [])).rejects.toThrow("more than one change");
    expect(() => parseChangeSet('{"version":"v0","changes":[]}')).toThrow("Not a spaced-changes-v1 file");
    store.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a partly refused push keeps undo entries for every change that landed", async () => {
  const directory = mkdtempSync(join(tmpdir(), "wb-spaced-apply-"));
  try {
    const store = new Store(directory);
    let seq = 0;
    const op = (type: string, id: string, payload: object) => {
      const inner = JSON.stringify([type, id]);
      store.db
        .query("INSERT OR REPLACE INTO records VALUES('spaced',?,?,1,?,0,'d',?,0,'operations',?)")
        .run(JSON.stringify(["operations", inner]), JSON.stringify({ type, payload, timestamp: 5, id: inner, isDeleted: false }), ++seq, seq, inner);
    };
    const ids = Array.from({ length: 450 }, (_, i) => `c${i}`);
    for (const id of ids) {
      op("card", id, { id, state: "Review" });
      op("cardContent", id, { cardId: id, front: `Q${id}`, back: "A" });
    }
    const spaced = readSpaced(store.db);
    const plan = planChangeSet(
      { version: "spaced-changes-v1", changes: ids.map((id) => ({ action: "edit" as const, cardId: id, front: `Q${id}`, back: "B" })) },
      spaced,
    );
    const sizes: number[] = [];
    // The phone changed c1 meanwhile: the server keeps its version.
    const result = await applyPlan(plan, spaced, async (changes) => {
      sizes.push(changes.length);
      return changes.map((c) => !c.key.includes('\\"c1\\"'));
    });
    expect(sizes).toEqual([400, 50]);
    expect(result).toMatchObject({ applied: 449, failed: 1 });
    expect(result.error).toContain("changed elsewhere");
    expect(result.undo!.changes.length).toBe(449);
    store.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("created cards that share a note become siblings Spaced decodes", () => {
  const directory = mkdtempSync(join(tmpdir(), "wb-spaced-apply-"));
  try {
    const spaced = readSpaced(new Store(directory).db);
    const set = parseChangeSet(
      JSON.stringify({
        version: "spaced-changes-v1",
        changes: [
          { action: "create", deck: "quotes", front: "[...] is the root", back: "a", note: "q" },
          { action: "create", deck: "quotes", front: "b [...]", back: "b", note: "q" },
          { action: "create", deck: "quotes", front: "Term?", back: "Idea", note: "t", variant: "forward" },
          { action: "create", deck: "quotes", front: "Alone", back: "x" },
        ],
      }),
    );
    const { steps } = changeRecords(planChangeSet(set, spaced), spaced, 1_700_000_000_000);
    const meta = steps.map((step) => {
      const record = step.records.find((r) => JSON.parse(JSON.parse(r.key)[1])[0] === "cardMetadata");
      if (record) expect(() => syncTables.operations.decode(record.value)).not.toThrow();
      return record && JSON.parse(record.value).payload;
    });
    expect(meta[0].noteId).toBe(meta[1].noteId);
    expect(meta[2].noteId).not.toBe(meta[0].noteId);
    expect(meta.map((m) => m?.siblingTag)).toEqual(["c1", "c2", "forward", undefined]);
    expect(() =>
      parseChangeSet(JSON.stringify({ version: "spaced-changes-v1", changes: [{ action: "create", deck: "d", front: "f", back: "b", variant: "c1" }] })),
    ).toThrow("variant needs a note");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
