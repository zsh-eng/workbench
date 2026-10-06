import { handleCardSuspend } from "@/lib/review/actions";
import { db, rawDb } from "@/lib/db/persistence";
import { gradeCardOperation, undoGradeCard } from "@/lib/sync/operation";
import { reviewSession } from "@/lib/review/session";
import { test, expect, afterEach, spyOn } from "bun:test";
import { act } from "react";
import { MemoryRouter } from "react-router";
import { createEmptyCard, Rating } from "ts-fsrs";
import { render } from "./dom";
import MemoryDB, { memoryReady } from "@/lib/db/memory";
import ReviewRoute from "@/routes/Review";
import type { CardWithMetadata } from "@/lib/types";
Object.defineProperty(globalThis, "IntersectionObserver", {
  value: window.IntersectionObserver,
  configurable: true,
});
await memoryReady;
const views: Awaited<ReturnType<typeof render>>[] = [];
function card(id: string, due = Date.now() - 1000): CardWithMetadata {
  return {
    ...createEmptyCard(new Date(due)),
    id,
    front: "Question " + id,
    back: "Answer " + id,
    deleted: false,
    bookmarked: false,
    cardLastModified: 0,
    cardContentLastModified: 0,
    cardDeletedLastModified: 0,
    cardBookmarkedLastModified: 0,
    cardSuspendedLastModified: 0,
    cardMetadataLastModified: 0,
    createdAt: 0,
  };
}
afterEach(async () => {
  for (const v of views.splice(0)) await v.unmount();
  for (const c of MemoryDB.getCards())
    MemoryDB.putCard({ ...c, deleted: true });
  MemoryDB.notify();
  while (MemoryDB.popUndoGrade()) {
    // Drain the undo stack between review scenarios.
  }
  await Promise.all([
    rawDb.operations.clear(),
    rawDb.reviewLogOperations.clear(),
    rawDb._sync_outbox.clear(),
  ]);
});
async function mount() {
  const v = await render(
    <MemoryRouter>
      <ReviewRoute />
    </MemoryRouter>,
  );
  views.push(v);
  expect(v.container.textContent).toContain("Question Y");
  return v;
}
test("keeps the active card when an earlier-sorted due card arrives", async () => {
  MemoryDB.putCard(card("Y"));
  MemoryDB.notify();
  const v = await mount();
  await act(async () => {
    MemoryDB.putCard(card("X"));
    MemoryDB.notify();
  });
  expect(v.container.textContent).toContain("Question Y");
  expect(v.container.textContent).not.toContain("Question X");
});
test("keeps the active card when another card becomes due", async () => {
  MemoryDB.putCard(card("Y"));
  MemoryDB.putCard(card("X", Date.now() + 300));
  MemoryDB.notify();
  const v = await mount();
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 350));
  });
  expect(v.container.textContent).toContain("Question Y");
  expect(v.container.textContent).not.toContain("Question X");
});

test("grade advances to the new queue head and Undo restores the graded card", async () => {
  const y = card("Y");
  MemoryDB.putCard(y);
  MemoryDB.notify();
  const v = await mount();
  await act(async () => {
    MemoryDB.putCard(card("X"));
    MemoryDB.notify();
  });
  expect(reviewSession.getSnapshot()?.id).toBe("Y");
  await act(async () => {
    await gradeCardOperation(y, Rating.Good);
  });
  expect(v.container.textContent).toContain("Question X");
  await act(async () => {
    await undoGradeCard();
  });
  expect(v.container.textContent).toContain("Question Y");
});
test("a remote deletion keeps the visible card and requires explicit next", async () => {
  const y = card("Y");
  MemoryDB.putCard(y);
  MemoryDB.notify();
  const v = await mount();
  await act(async () => {
    MemoryDB.putCard({ ...y, deleted: true });
    MemoryDB.putCard(card("X"));
    MemoryDB.notify();
  });
  expect(v.container.textContent).toContain("Question Y");
  expect(v.container.textContent).toContain("This card is no longer available");
  const next = [...v.container.querySelectorAll("button")].find(
    (b) => b.textContent === "Next card",
  )!;
  await act(async () => next.click());
  expect(v.container.textContent).toContain("Question X");
});
test("same-ID background content updates do not change the visible snapshot", async () => {
  const y = card("Y");
  MemoryDB.putCard(y);
  MemoryDB.notify();
  const v = await mount();
  await act(async () => {
    MemoryDB.putCard({ ...y, front: "Changed elsewhere" });
    MemoryDB.notify();
  });
  expect(v.container.textContent).toContain("Question Y");
  expect(v.container.textContent).not.toContain("Changed elsewhere");
});

test("Skip advances explicitly while a failed grade keeps the current card", async () => {
  const y = card("Y");
  MemoryDB.putCard(y);
  MemoryDB.notify();
  const v = await mount();
  await act(async () => {
    MemoryDB.putCard(card("X"));
    MemoryDB.notify();
  });
  const fail = spyOn(db.operations, "put").mockRejectedValue(
    new Error("Storage unavailable"),
  );
  try {
    await act(async () => {
      await expect(gradeCardOperation(y, Rating.Good)).rejects.toThrow(
        "Storage unavailable",
      );
    });
    expect(v.container.textContent).toContain("Question Y");
    expect(reviewSession.getSnapshot()?.id).toBe("Y");
  } finally {
    fail.mockRestore();
  }
  await act(async () => {
    await handleCardSuspend(y);
  });
  expect(v.container.textContent).toContain("Question X");
});
