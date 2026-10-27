import { afterEach, expect, test, setSystemTime } from "bun:test";
import { act } from "react";
import { MemoryRouter } from "react-router";
import { createEmptyCard, Rating } from "ts-fsrs";
import { render } from "./dom";
import { CardWithMetadata } from "@/lib/types";
import {
  gradeCardOperation,
  undoGradeCard,
  updateSuspendedClientSide,
  handleClientOperation,
  operationSchema,
} from "@/lib/sync/operation";
import { db, rawDb } from "@/lib/db/persistence";
import MemoryDB from "@/lib/db/memory";
import ReviewRoute from "@/routes/Review";
import { COMPACT_QUERY } from "@workbench/elements/size-class";
import { processReviewLogOperations } from "@/lib/review/review";
function card(id = crypto.randomUUID()): CardWithMetadata {
  return {
    ...createEmptyCard(new Date(Date.now() - 1000)),
    id,
    front: "Question",
    back: "Answer",
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
const intersectionObserverDescriptor = Object.getOwnPropertyDescriptor(
  globalThis,
  "IntersectionObserver",
);
const views: Awaited<ReturnType<typeof render>>[] = [];
async function mount(node: Parameters<typeof render>[0]) {
  const view = await render(node);
  views.push(view);
  return view;
}
afterEach(async () => {
  for (const view of views.splice(0)) await view.unmount();
  setSystemTime();
  if (intersectionObserverDescriptor)
    Object.defineProperty(
      globalThis,
      "IntersectionObserver",
      intersectionObserverDescriptor,
    );
  else Reflect.deleteProperty(globalThis, "IntersectionObserver");
  for (const existing of MemoryDB.getCards())
    MemoryDB.putCard({ ...existing, deleted: true });
  while (MemoryDB.popUndoGrade()) {
    /* empty the test undo stack */
  }
  MemoryDB.notify();
  await Promise.all([
    rawDb.operations.clear(),
    rawDb._sync_outbox.clear(),
    rawDb.reviewLogOperations.clear(),
  ]);
});

test("Undo restores all changed siblings and its inverse survives storage and JSON replay", async () => {
  setSystemTime(new Date("2026-09-13T04:00:00Z"));
  const current = { ...card(), noteId: "undo-note" };
  const expired = new Date(Date.now() - 10000);
  const siblings = [
    { ...card(), noteId: current.noteId },
    { ...card(), noteId: current.noteId, suspended: expired },
  ];
  for (const item of [current, ...siblings]) MemoryDB.putCard(item);
  await gradeCardOperation(current, Rating.Good, 100);
  for (const sibling of siblings) {
    expect(
      MemoryDB.getCardById(sibling.id)?.suspended!.getTime(),
    ).toBeGreaterThan(Date.now());
  }
  expect(await undoGradeCard()).toEqual({ applied: true });
  expect(MemoryDB.getCardById(siblings[0].id)?.suspended).toEqual(new Date(0));
  expect(MemoryDB.getCardById(siblings[1].id)?.suspended).toEqual(expired);
  expect(
    processReviewLogOperations(await db.reviewLogOperations.toArray()),
  ).toHaveLength(0);
  const persisted = await db.operations.toArray();
  const pending = (await db._sync_outbox.toArray()).map((row) =>
    operationSchema.parse(JSON.parse(row.value)),
  );
  expect(persisted.filter((op) => op.type === "cardSuspended")).toHaveLength(2);
  expect(pending.filter((op) => op.type === "cardSuspended")).toHaveLength(2);
  for (const operations of [persisted, pending]) {
    for (const item of [current, ...siblings]) MemoryDB.putCard(item);
    for (const operation of operations) {
      handleClientOperation(
        operationSchema.parse(JSON.parse(JSON.stringify(operation))),
      );
    }
    expect(MemoryDB.getCardById(siblings[0].id)?.suspended).toEqual(
      new Date(0),
    );
    expect(MemoryDB.getCardById(siblings[1].id)?.suspended).toEqual(expired);
    expect(MemoryDB.getCardById(current.id)?.reps).toBe(current.reps);
  }
});

test("Undo preserves existing long suspensions and subsequent sibling changes", async () => {
  setSystemTime(new Date("2026-09-13T04:00:00Z"));
  const current = { ...card(), noteId: "preserve-note" };
  const permanent = {
    ...card(),
    noteId: current.noteId,
    suspended: new Date("9999-01-01"),
  };
  const later = { ...card(), noteId: current.noteId };
  const edited = { ...card(), noteId: current.noteId };
  for (const item of [current, permanent, later, edited])
    MemoryDB.putCard(item);
  await gradeCardOperation(current, Rating.Good);
  const autoSuspension = MemoryDB.getCardById(later.id)!.suspended!;
  // A manual change to the same value in the same millisecond is still newer.
  await updateSuspendedClientSide(later.id, autoSuspension);
  const laterRevision = MemoryDB.getCardById(
    later.id,
  )!.cardSuspendedLastModified;
  MemoryDB.putCard({
    ...MemoryDB.getCardById(edited.id)!,
    front: "Edited later",
  });
  await undoGradeCard();
  expect(MemoryDB.getCardById(permanent.id)?.suspended).toEqual(
    permanent.suspended,
  );
  expect(MemoryDB.getCardById(later.id)?.suspended).toEqual(autoSuspension);
  expect(MemoryDB.getCardById(later.id)?.cardSuspendedLastModified).toBe(
    laterRevision,
  );
  expect(MemoryDB.getCardById(edited.id)?.front).toBe("Edited later");
  expect(MemoryDB.getCardById(edited.id)?.suspended).toEqual(new Date(0));
  const restores = (await db._sync_outbox.toArray())
    .map((row) => operationSchema.parse(JSON.parse(row.value)))
    .filter(
      (op) =>
        op.type === "cardSuspended" && op.payload.suspended.getTime() === 0,
    );
  expect(restores).toHaveLength(1);
});

for (const width of [599, 599.5, 600, 601]) {
  test(`review content and controls agree at ${width}px`, async () => {
    Object.defineProperty(globalThis, "IntersectionObserver", {
      value: window.IntersectionObserver,
      configurable: true,
      writable: true,
    });
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      ...originalMatchMedia.call(window, query),
      matches: query === COMPACT_QUERY ? width < 600 : false,
      media: query,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
      dispatchEvent() {
        return true;
      },
      onchange: null,
    })) as typeof window.matchMedia;
    try {
      MemoryDB.putCard(card());
      MemoryDB.notify();
      const view = await mount(
        <MemoryRouter>
          <ReviewRoute />
        </MemoryRouter>,
      );
      await act(async () => {});
      expect(
        view.container.querySelector('[aria-roledescription="carousel"]') !==
          null,
      ).toBe(width < 600);
      expect(
        view.container.querySelector('button[aria-label="Hard"]') !== null,
      ).toBe(width < 600);
      // Only one content surface is mounted, so both mobile and desktop cannot show.
      expect(
        view.container.querySelectorAll('[aria-roledescription="carousel"]'),
      ).toHaveLength(width < 600 ? 1 : 0);
    } finally {
      window.matchMedia = originalMatchMedia;
    }
  });
}
