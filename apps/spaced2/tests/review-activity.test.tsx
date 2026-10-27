import { afterEach, expect, setSystemTime, test } from "bun:test";
import { act } from "react";
import { render } from "./dom";
import { MemoryRouter } from "react-router";
import { createEmptyCard } from "ts-fsrs";
import ReviewRoute from "@/routes/Review";
import MemoryDB, { memoryReady } from "@/lib/db/memory";
import { rawDb } from "@/lib/db/persistence";
import type { CardWithMetadata } from "@/lib/types";

await memoryReady;

function card(id: string, due: number): CardWithMetadata {
  return {
    ...createEmptyCard(new Date(due)),
    id,
    front: `Question ${id}`,
    back: `Answer ${id}`,
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
afterEach(async () => {
  for (const view of views.splice(0)) await view.unmount();
  Reflect.deleteProperty(document, "visibilityState");
  setSystemTime();
  if (intersectionObserverDescriptor) {
    Object.defineProperty(
      globalThis,
      "IntersectionObserver",
      intersectionObserverDescriptor,
    );
  } else {
    Reflect.deleteProperty(globalThis, "IntersectionObserver");
  }
  for (const card of MemoryDB.getCards()) {
    MemoryDB.putCard({ ...card, deleted: true });
  }
  while (MemoryDB.popUndoGrade()) {
    // Drain the review undo stack between tests.
  }
  MemoryDB.notify();
  await Promise.all([
    rawDb.operations.clear(),
    rawDb.reviewLogOperations.clear(),
    rawDb._sync_outbox.clear(),
  ]);
});

const epoch = new Date("2026-10-05T12:00:00Z").getTime();
function at(milliseconds: number) {
  setSystemTime(epoch + milliseconds);
}

async function grade(container: HTMLElement, cardId: string) {
  const button = [...container.querySelectorAll("button")].find((button) =>
    button.textContent?.includes("Good"),
  )!;
  await act(async () => {
    button.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    button.click();
    for (let attempt = 0; attempt < 100; attempt++) {
      const reviews = await rawDb.reviewLogOperations.toArray();
      if (reviews.some((review) => review.payload.cardId === cardId)) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(`Review for ${cardId} did not save`);
  });
}

async function review(...cards: [string, number][]) {
  Object.defineProperty(globalThis, "IntersectionObserver", {
    value: window.IntersectionObserver,
    configurable: true,
  });
  for (const [id, due] of cards) MemoryDB.putCard(card(id, epoch + due));
  MemoryDB.notify();
  const view = await render(
    <MemoryRouter>
      <ReviewRoute />
    </MemoryRouter>,
  );
  views.push(view);
  return view;
}

async function duration(cardId: string) {
  const reviews = await rawDb.reviewLogOperations.toArray();
  return reviews.find((review) => review.payload.cardId === cardId)?.payload
    .duration;
}

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: state,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

test("a card's time is the time between actions; a silent card over three minutes counts nothing", async () => {
  at(0);
  const view = await review(["activity-A", -2000], ["activity-B", -1000]);
  expect(view.container.textContent).toContain("Question activity-A");

  at(181000);
  await grade(view.container, "activity-A");
  expect(view.container.textContent).toContain("Question activity-B");
  at(183000);
  window.dispatchEvent(new MouseEvent("mousemove"));
  at(186000);
  await grade(view.container, "activity-B");
  expect(await duration("activity-A")).toBe(0);
  expect(await duration("activity-B")).toBe(5000);
});

test("a long pause on a card drops only the pause", async () => {
  at(0);
  const view = await review(["activity-gap", -1000]);
  at(30000);
  window.dispatchEvent(new MouseEvent("mousemove"));
  at(240000);
  window.dispatchEvent(new MouseEvent("mousemove"));
  at(250000);
  await grade(view.container, "activity-gap");
  expect(await duration("activity-gap")).toBe(40000);
});

test("a hidden tab pauses the card and keeps the time before it", async () => {
  at(0);
  const view = await review(["activity-resume", -1000]);
  expect(view.container.textContent).toContain("Question activity-resume");

  at(10000);
  await act(async () => setVisibility("hidden"));
  at(600000);
  await act(async () => setVisibility("visible"));
  at(605000);
  await grade(view.container, "activity-resume");
  expect(await duration("activity-resume")).toBe(15000);
});
