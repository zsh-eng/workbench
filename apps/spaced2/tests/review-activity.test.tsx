import { afterEach, expect, setSystemTime, test } from "bun:test";
import { act, useState } from "react";
import { useActiveStartTime } from "@/components/hooks/inactivity";
import { click, render } from "./dom";
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

function ReviewTimer({ id }: { id?: string }) {
  const start = useActiveStartTime({ id });
  const [duration, setDuration] = useState<number>();
  return (
    <>
      <button onClick={() => setDuration(Date.now() - start)}>Grade</button>
      <output>{duration}</output>
    </>
  );
}

const intersectionObserverDescriptor = Object.getOwnPropertyDescriptor(
  globalThis,
  "IntersectionObserver",
);
const views: Awaited<ReturnType<typeof render>>[] = [];
afterEach(async () => {
  for (const view of views.splice(0)) await view.unmount();
  setSystemTime();
  if (intersectionObserverDescriptor) {
    Object.defineProperty(globalThis, "IntersectionObserver", intersectionObserverDescriptor);
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

async function flushActivity() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 1100));
  });
}

const epoch = new Date("2026-10-05T12:00:00Z").getTime();
function at(milliseconds: number) {
  setSystemTime(epoch + milliseconds);
}

test("an idle card's pending activity cannot shorten the next recorded review", async () => {
  at(0);
  Object.defineProperty(globalThis, "IntersectionObserver", {
    value: window.IntersectionObserver,
    configurable: true,
  });
  MemoryDB.putCard(card("activity-A", epoch - 2000));
  MemoryDB.putCard(card("activity-B", epoch - 1000));
  MemoryDB.notify();
  const view = await render(
    <MemoryRouter><ReviewRoute /></MemoryRouter>,
  );
  views.push(view);
  expect(view.container.textContent).toContain("Question activity-A");

  async function grade(cardId: string) {
    const button = [...view.container.querySelectorAll("button")].find(
      (button) => button.textContent?.includes("Good"),
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

  at(121000);
  await grade("activity-A");
  expect(view.container.textContent).toContain("Question activity-B");
  at(122000);
  await flushActivity();
  at(123000);
  window.dispatchEvent(new MouseEvent("mousemove"));
  at(124000);
  await flushActivity();
  at(126000);
  await grade("activity-B");
  const reviews = await rawDb.reviewLogOperations.toArray();
  expect(
    reviews.find((review) => review.payload.cardId === "activity-B")?.payload.duration,
  ).toBe(5000);
});

test("activity keeps a recent card's start and resets an idle card after the delay", async () => {
  at(0);
  const view = await render(<ReviewTimer id="A" />);
  views.push(view);
  at(10000);
  window.dispatchEvent(new MouseEvent("mousemove"));
  at(11000);
  await flushActivity();
  at(15000);
  await click(view.container.querySelector("button")!);
  expect(view.container.querySelector("output")?.textContent).toBe("15000");

  at(132000);
  window.dispatchEvent(new MouseEvent("mousemove"));
  at(133000);
  await flushActivity();
  at(138000);
  await click(view.container.querySelector("button")!);
  expect(view.container.querySelector("output")?.textContent).toBe("5000");
});
