import { test, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/store";
import { buildSpaced, LEDGER } from "../src/spaced";

test("spaced build folds the latest records into cards, decks and reviews", () => {
  const directory = mkdtempSync(join(tmpdir(), "wb-spaced-"));
  try {
    const store = new Store(directory);
    const insert = store.db.query(
      "INSERT INTO records VALUES('spaced',?,?,1,0,0,'d',?,?,?,?)",
    );
    let seq = 0;
    const put = (type: string, id: string, payload: object, deleted = false) =>
      insert.run(
        JSON.stringify([type, id]),
        JSON.stringify({ type, payload, timestamp: 1_700_000_000_000 }),
        ++seq,
        deleted ? 1 : 0,
        "operations",
        id,
      );
    const lastReview = "2026-11-01T00:00:00.000Z";
    put("deck", "d1", { id: "d1", name: "systems", deleted: false });
    put("deck", "d2", { id: "d2", name: "gone", deleted: true });
    for (const id of ["c1", "c2"]) {
      put("card", id, {
        id,
        state: "Review",
        stability: 10,
        difficulty: 5,
        reps: 3,
        lapses: 0,
        due: "2026-11-11T00:00:00.000Z",
        last_review: lastReview,
      });
      put("cardContent", id, { cardId: id, front: `Q ${id}`, back: `A ${id}` });
      put("updateDeckCard", `d1:${id}`, {
        deckId: "d1",
        cardId: id,
        present: true,
      });
      put("updateDeckCard", `d2:${id}`, {
        deckId: "d2",
        cardId: id,
        present: true,
      });
    }
    put("cardSuspended", "c2", {
      cardId: "c2",
      suspended: "9999-12-31T00:00:00.000Z",
    });
    put("reviewLog", "r1", {
      id: "r1",
      cardId: "c1",
      grade: "Good",
      review: lastReview,
      duration: 5000,
    });
    put("reviewLog", "r2", {
      id: "r2",
      cardId: "c1",
      grade: "Again",
      review: lastReview,
      duration: 3000,
    });
    put("reviewLogDeleted", "r2", { reviewLogId: "r2", deleted: true });
    // A tombstoned record is not live and must not appear.
    put("cardContent", "c3", { cardId: "c3", front: "x", back: "y" }, true);

    const path = join(directory, "spaced.sqlite");
    // Ten days after the last review, at stability 10, recall is 0.9 by definition.
    const result = buildSpaced(
      store.db,
      path,
      Date.parse(lastReview) + 10 * 86_400_000,
    );
    store.close();
    expect(result).toMatchObject({ decks: 1, cards: 2, active: 1, reviews: 1 });

    const out = new Database(path, { readonly: true });
    expect(
      out
        .query(
          "SELECT card_id,front,decks,suspended_forever,retrievability FROM cards ORDER BY card_id",
        )
        .all(),
    ).toEqual([
      {
        card_id: "c1",
        front: "Q c1",
        decks: "systems",
        suspended_forever: 0,
        retrievability: 0.9,
      },
      {
        card_id: "c2",
        front: "Q c2",
        decks: "systems",
        suspended_forever: 1,
        retrievability: 0.9,
      },
    ]);
    expect(
      out
        .query(
          "SELECT card_id,reviews,agains FROM card_stats WHERE card_id='c1'",
        )
        .get(),
    ).toEqual({
      card_id: "c1",
      reviews: 1,
      agains: 0,
    });
    expect(
      out.query("SELECT deck,cards,active,suspended FROM deck_summary").all(),
    ).toEqual([{ deck: "systems", cards: 2, active: 1, suspended: 1 }]);
    out.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("spaced build credits wb spaced apply records to the ledger, and only while they are current", () => {
  const directory = mkdtempSync(join(tmpdir(), "wb-spaced-"));
  try {
    const store = new Store(directory);
    const insert = store.db.query(
      "INSERT OR REPLACE INTO records VALUES('spaced',?,?,1,0,0,?,?,0,'operations',?)",
    );
    let seq = 0;
    const put = (device: string, type: string, id: string, payload: object) => {
      const key = JSON.stringify(["operations", JSON.stringify([type, id])]);
      insert.run(key, JSON.stringify({ type, payload, timestamp: 1_700_000_000_000 }), device, ++seq, id);
      return key;
    };
    for (const id of ["c1", "c2"]) {
      put("phone", "card", id, { id, state: "New" });
      put("phone", "cardContent", id, { cardId: id, front: `Q ${id}`, back: "A" });
    }
    const keys = [
      put("wb-spaced", "cardContent", "c1", { cardId: "c1", front: "Rewritten", back: "A" }),
      put("wb-spaced", "cardSuspended", "c2", { cardId: "c2", suspended: "9999-12-31T00:00:00.000Z" }),
      put("wb-spaced", "cardContent", "c2", { cardId: "c2", front: "Agent edit", back: "A" }),
    ];
    // The user edits c2 again on the phone: its content is theirs, the suspension is not.
    put("phone", "cardContent", "c2", { cardId: "c2", front: "My edit", back: "A" });
    writeFileSync(
      join(directory, LEDGER),
      JSON.stringify({ at: "2026-11-09T01:00:00.000Z", model: "claude-opus-5-5", effort: "high", keys }) + "\n",
    );
    const path = join(directory, "spaced.sqlite");
    buildSpaced(store.db, path);
    const out = new Database(path, { readonly: true });
    try {
      expect(
        out.query("SELECT card_id,front,content_by,suspended_by,deleted_by FROM cards ORDER BY card_id").all(),
      ).toEqual([
        { card_id: "c1", front: "Rewritten", content_by: "claude-opus-5-5 · high · 2026-11-09", suspended_by: null, deleted_by: null },
        { card_id: "c2", front: "My edit", content_by: null, suspended_by: "claude-opus-5-5 · high · 2026-11-09", deleted_by: null },
      ]);
    } finally {
      out.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
