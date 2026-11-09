import { describe, expect, test } from "vitest";
import {
  threadAttention,
  waitOver,
  waitState,
  type Thread,
  type WaitState,
} from "../../src/shared/threads";

const thread = (patch: Partial<Thread> = {}): Thread => ({
  id: "r_000000000000000000000001",
  title: "Glossary",
  createdAt: "2026-11-09T00:00:00.000Z",
  updatedAt: 2_000,
  seen: 2_000,
  ...patch,
});

describe("what a thread asks of the reader", () => {
  test("needs you, then done since you looked, then working, then idle", () => {
    expect(threadAttention(thread({ state: "waiting" }))).toBe("needs-you");
    expect(threadAttention(thread({ halt: { kind: "stopped" } }))).toBe("needs-you");
    expect(threadAttention(thread({ turn: { endedAt: 1_500, asks: true } }))).toBe("needs-you");
    expect(threadAttention(thread({ seen: 1_000 }))).toBe("done");
    expect(threadAttention(thread({ state: "working", seen: 1_000 }))).toBe("working");
    expect(threadAttention(thread())).toBe("idle");
    // A thread without marks, as in history, has nothing new.
    expect(threadAttention(thread({ seen: undefined }))).toBe("idle");
  });

  test("an answer to the question ends needs-you", () => {
    const answered = thread({
      turn: { endedAt: 1_500, asks: true },
      replied: { at: 1_600, text: "Yes", delivery: "delivered" },
    });
    expect(threadAttention(answered)).toBe("idle");
  });
});

describe("a wait", () => {
  test("counts a message that Med sent as work until the turn that reads it ends", () => {
    const sent = { at: 1_600, text: "Go on", delivery: "delivered" as const };
    expect(waitState(thread({ turn: { endedAt: 1_500 }, replied: sent }))).toBe("working");
    expect(waitState(thread({ turn: { endedAt: 1_700 }, replied: sent }))).toBe("finished");
    expect(
      waitState(thread({ turn: { endedAt: 1_500 }, replied: { ...sent, delivery: "failed" } })),
    ).toBe("finished");
    expect(waitState(undefined)).toBe("closed");
  });

  const states = (entries: [string, WaitState][]) => new Map(entries);

  test("ends at once when nothing works, and otherwise on a change", () => {
    const quiet = states([
      ["a", "finished"],
      ["b", "needs-you"],
    ]);
    for (const until of ["stopped", "needs-you", "done", "idle"] as const)
      expect(waitOver(until, undefined, quiet)).toBe(true);
    const busy = states([
      ["a", "working"],
      ["b", "needs-you"],
    ]);
    // A thread that needed the reader already does not end the wait.
    expect(waitOver("stopped", undefined, busy)).toBe(false);
    expect(waitOver("stopped", busy, busy)).toBe(false);
  });

  test("ends on the change that --until names", () => {
    const before = states([
      ["a", "working"],
      ["b", "working"],
    ]);
    const finished = states([
      ["a", "finished"],
      ["b", "working"],
    ]);
    const asks = states([
      ["a", "working"],
      ["b", "needs-you"],
    ]);
    expect(waitOver("stopped", before, finished)).toBe(true);
    expect(waitOver("stopped", before, asks)).toBe(true);
    expect(waitOver("done", before, finished)).toBe(true);
    expect(waitOver("done", before, asks)).toBe(false);
    expect(waitOver("needs-you", before, asks)).toBe(true);
    expect(waitOver("needs-you", before, finished)).toBe(false);
    // idle waits until none of them works.
    expect(waitOver("idle", before, finished)).toBe(false);
    expect(
      waitOver(
        "idle",
        finished,
        states([
          ["a", "finished"],
          ["b", "closed"],
        ]),
      ),
    ).toBe(true);
  });
});
