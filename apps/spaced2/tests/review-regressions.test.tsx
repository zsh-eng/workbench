import { studyDayKey } from "@/lib/study-day";
import { afterEach, expect, test, setSystemTime } from "bun:test";
import { act } from "react";
import { MemoryRouter } from "react-router";
import { createEmptyCard, Rating, State } from "ts-fsrs";
import { render, click } from "./dom";
import {
  gradeCard,
  previewGradeSchedule,
  processReviewLogOperations,
  reviewLogToReviewLogOperation,
} from "@/lib/review/review";
import { CardWithMetadata } from "@/lib/types";
import { FSRS6_PERSONAL_PARAMETERS } from "@/lib/review/fsrs6-personal-parameters";
import { Operation, gradeCardOperation } from "@/lib/sync/operation";
import { db, rawDb } from "@/lib/db/persistence";
import MemoryDB from "@/lib/db/memory";
import ReviewRoute from "@/routes/Review";
import MobileGradeButtons from "@/components/review/mobile-grade-buttons";
import { usePressableAction } from "@/components/hooks/use-pressable-action";
import { useReviewActionTarget } from "@/components/hooks/use-review-action-target";
import { useReviewCards } from "@/components/hooks/query";
import { useClock } from "@/components/hooks/use-clock";
import { BasicStats } from "@/components/stats/basic";
import { ReviewChart } from "@/components/stats/review-chart";
import { Heatmap } from "@/components/stats/heatmap";

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

test("new history retains each selected grade and undo uses its portable ID", () => {
  const operations: Operation[] = [];
  for (const [grade, label] of [
    [Rating.Again, "Again"],
    [Rating.Hard, "Hard"],
    [Rating.Good, "Good"],
    [Rating.Easy, "Easy"],
  ] as const) {
    const operation = reviewLogToReviewLogOperation(
      gradeCard(card(), grade).reviewLog,
      "card",
      50,
    );
    expect(operation.payload.grade).toBe(label);
    operations.push(operation);
  }
  const undone = operations[3];
  if (undone.type !== "reviewLog") throw new Error("Expected log");
  operations.push({
    type: "reviewLogDeleted",
    payload: { reviewLogId: undone.payload.id, deleted: true },
    timestamp: Date.now(),
  });
  expect(
    processReviewLogOperations(operations).map((log) => log.rating),
  ).toEqual([Rating.Again, Rating.Hard, Rating.Good]);
  operations.push({
    type: "reviewLogDeleted",
    payload: { reviewLogId: undone.payload.id, deleted: false },
    timestamp: Date.now(),
  });
  expect(processReviewLogOperations(operations)).toHaveLength(4);
});

test("preview and grade share the maximum interval for a mature card", () => {
  const mature = {
    ...card(),
    state: State.Review,
    stability: 1000,
    difficulty: 1,
    reps: 100,
    last_review: new Date(Date.now() - 86400000 * 90),
  };
  const now = new Date();
  const preview = previewGradeSchedule(mature, now);
  // ts-fsrs can overshoot the cap by a day or two when separating grades.
  expect(preview[Rating.Easy].card.scheduled_days).toBeLessThan(
    FSRS6_PERSONAL_PARAMETERS.maximum_interval + 10,
  );
  expect(gradeCard(mature, Rating.Easy, now).nextCard).toEqual({
    ...mature,
    ...preview[Rating.Easy].card,
  });
});

test("last-card Undo remains available on the empty review page and removes persisted history", async () => {
  Object.defineProperty(globalThis, "IntersectionObserver", {
    value: window.IntersectionObserver,
    configurable: true,
    writable: true,
  });
  const current = card();
  MemoryDB.putCard(current);
  MemoryDB.notify();
  await gradeCardOperation(current, Rating.Easy, 100);
  const view = await mount(
    <MemoryRouter>
      <ReviewRoute />
    </MemoryRouter>,
  );
  expect(view.container.textContent).toContain("done for now");
  const undo = view.container.querySelector<HTMLButtonElement>(
    'button[aria-label="Undo last grade"]',
  );
  expect(undo).not.toBeNull();
  await click(undo!);
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 25));
  });
  expect(MemoryDB.getCardById(current.id)?.due.getTime()).toBe(
    current.due.getTime(),
  );
  expect(
    processReviewLogOperations(await db.reviewLogOperations.toArray()),
  ).toHaveLength(0);
});

test("mobile grades expose four named buttons and invoke the selected grade", async () => {
  const grades: number[] = [];
  const view = await mount(
    <MobileGradeButtons onGrade={(grade) => grades.push(grade)} />,
  );
  const buttons = [...view.container.querySelectorAll("button")];
  expect(
    buttons.map(
      (button) => button.getAttribute("aria-label") ?? button.textContent,
    ),
  ).toEqual(["Hard", "Again", "Good", "Easy"]);
  for (const button of buttons) await click(button);
  expect(grades).toEqual([Rating.Hard, Rating.Again, Rating.Good, Rating.Easy]);
});

function Press({
  enabled = true,
  onAction,
}: {
  enabled?: boolean;
  onAction: () => void;
}) {
  const { pressed, pressableProps } = usePressableAction({
    key: "1",
    enabled,
    onAction,
  });
  return (
    <>
      <button {...pressableProps}>{String(pressed)}</button>
      <input />
    </>
  );
}
async function key(type: string, target: EventTarget = window) {
  await act(async () => {
    target.dispatchEvent(new KeyboardEvent(type, { key: "1", bubbles: true }));
  });
}
test("interrupted grade keys cancel on blur, input focus, disabled state, and unpaired release", async () => {
  let actions = 0;
  const onAction = () => actions++;
  const view = await mount(<Press onAction={onAction} />);
  await key("keyup");
  expect(actions).toBe(0);
  await key("keydown");
  await act(async () => {
    window.dispatchEvent(new Event("blur"));
  });
  await key("keyup");
  expect(actions).toBe(0);
  await key("keydown");
  await key("keyup", view.container.querySelector("input")!);
  expect(actions).toBe(0);
  expect(view.container.querySelector("button")?.textContent).toBe("false");
  await key("keydown");
  await act(async () => {
    view.container.querySelector("input")!.focus();
  });
  await key("keyup");
  expect(actions).toBe(0);
  await key("keydown");
  await view.rerender(<Press enabled={false} onAction={onAction} />);
  await key("keyup");
  expect(actions).toBe(0);
  await view.rerender(<Press onAction={onAction} />);
  await key("keydown");
  await key("keyup");
  expect(actions).toBe(1);
});

test("an open action keeps its original card after a queue change and rejects a removed target", async () => {
  const original = card("original"),
    next = card("next");
  let action: ReturnType<typeof useReviewActionTarget>;
  function Target({
    cards,
    current,
  }: {
    cards: CardWithMetadata[];
    current: CardWithMetadata;
  }) {
    action = useReviewActionTarget(cards, current);
    return <button onClick={action.capture}>Open</button>;
  }
  const view = await mount(
    <Target cards={[original, next]} current={original} />,
  );
  await click(view.container.querySelector("button")!);
  await view.rerender(<Target cards={[original, next]} current={next} />);
  expect(action!.target?.id).toBe("original");
  expect(action!.getTarget(true)?.id).toBe("original");
  await view.rerender(<Target cards={[next]} current={next} />);
  expect(() => action!.getTarget(true)).toThrow("no longer available");
});

test("review eligibility and suspended view clocks refresh at expiry without a database write", async () => {
  const suspended = { ...card(), suspended: new Date(Date.now() + 75) };
  MemoryDB.putCard(suspended);
  MemoryDB.notify();
  function Queue() {
    const reviews = useReviewCards();
    const now = useClock([suspended.suspended.getTime()]);
    return (
      <div>
        {reviews.length}:
        {suspended.suspended.getTime() > now ? "suspended" : "active"}
      </div>
    );
  }
  const view = await mount(<Queue />);
  expect(view.container.textContent).toBe("0:suspended");
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 110));
  });
  expect(view.container.textContent).toBe("1:active");
});

test("statistics refresh the current streak after a resumed day boundary", async () => {
  setSystemTime(new Date(2026, 8, 8, 3, 59, 59));
  const log = gradeCard(card(), Rating.Good).reviewLog;
  const view = await mount(<BasicStats reviewLogs={[log]} />);
  const streak = () =>
    [...view.container.querySelectorAll("span")].find(
      (node) => node.textContent === "Current Streak",
    )?.previousElementSibling?.textContent;
  expect(streak()?.trim()).toBe("1");
  setSystemTime(new Date(2026, 8, 8, 4, 0, 1));
  await act(async () => {
    window.dispatchEvent(new Event("focus"));
  });
  expect(streak()?.trim()).toBe("0");
});

test("activity includes all four true states and heatmap squares have date/count names", async () => {
  const log = gradeCard(card(), Rating.Good).reviewLog;
  const logs = [
    State.New,
    State.Learning,
    State.Review,
    State.Relearning,
  ].flatMap((state) =>
    Array.from({ length: state + 1 }, () => ({ ...log, state })),
  );
  const view = await mount(
    <>
      <ReviewChart reviewLogs={logs} />
      <Heatmap reviewLogs={logs} />
    </>,
  );
  const tabs = [...view.container.querySelectorAll("button[data-active]")];
  expect(tabs.map((node) => node.textContent)).toEqual([
    "New1",
    "Learning2",
    "Review3",
    "Relearning4",
  ]);
  const date = studyDayKey(log.review);
  expect(
    view.container.querySelector(`button[aria-label="10 reviews on ${date}"]`),
  ).not.toBeNull();
});
