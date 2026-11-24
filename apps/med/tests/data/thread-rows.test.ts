import { describe, expect, test } from "vitest";
import type { Thread } from "../../src/shared/threads";
import { tabOrder, threadInput, workspaceThread } from "../../src/web/data/threads";
import { findPattern } from "../../src/web/data/search-highlights";
import { overlayAddress } from "../../src/web/data/workspaces";
import { withSentMessages } from "../../src/web/data/agent-inbox";
import type { SessionItem } from "../../src/web/data/session-store";

const thread = (id: string, updatedAt: number, change: Partial<Thread> = {}): Thread => ({
  id,
  kind: "session",
  title: id,
  createdAt: "2026-11-08T00:00:00.000Z",
  updatedAt,
  reviews: [],
  ...change,
});

describe("the sidebar's threads", () => {
  test("list the pinned ones in the order they were pinned, then the newest first", () => {
    const threads = [
      thread("claude-a", 30),
      thread("claude-b", 50, { pinned: 2 }),
      thread("r_000000000000000000000001", 40, { kind: "review" }),
      thread("codex-c", 10, { pinned: 1 }),
    ];
    expect(tabOrder(threads).map((row) => row.id)).toEqual([
      "codex-c",
      "claude-b",
      "r_000000000000000000000001",
      "claude-a",
    ]);
  });

  test("open a session where it works now, whichever repository that is", () => {
    const session = thread("claude-a", 30, {
      session: { agent: "claude", id: "a", cwd: "/work/elevation/src" },
      repository: { id: "elevation", name: "elevation", path: "/work/elevation" },
      checkout: "/work/elevation",
      branch: "tiles",
    });
    expect(threadInput(session)).toEqual({
      kind: "thread",
      threadId: "claude-a",
      title: "claude-a",
      path: "/work/elevation",
      repositoryId: "elevation",
      repository: "elevation",
      branch: "tiles",
    });
    // A session that works outside any checkout opens without a place.
    expect(threadInput(thread("claude-b", 30))).toEqual({
      kind: "thread",
      threadId: "claude-b",
      title: "claude-b",
    });
    expect(workspaceThread({ id: "thread-claude-a", ...threadInput(session) })).toBe("claude-a");
    expect(workspaceThread(undefined)).toBeUndefined();
  });
});

describe("the find bar's pattern", () => {
  const all = (query: string, options = {}) => {
    const pattern = findPattern(query, options);
    return pattern instanceof RegExp
      ? [..."Trail trails TRAIL a.b axb".matchAll(pattern)].map((match) => match[0])
      : pattern;
  };

  test("finds text as typed, any case", () => {
    expect(all("trail")).toEqual(["Trail", "trail", "TRAIL"]);
    expect(all("a.b")).toEqual(["a.b"]);
  });

  test("matches case, whole words, and regular expressions", () => {
    expect(all("trail", { caseSensitive: true })).toEqual(["trail"]);
    expect(all("trail", { wholeWord: true })).toEqual(["Trail", "TRAIL"]);
    expect(all("a.b", { regexp: true })).toEqual(["a.b", "axb"]);
    expect(all("trails?", { regexp: true, wholeWord: true })).toEqual(["Trail", "trails", "TRAIL"]);
  });
});

describe("overlay routes and truncated history", () => {
  test("treats /usage as an overlay address so opening Usage keeps the active thread", () => {
    expect(overlayAddress("/usage")).toBe(true);
    expect(overlayAddress("/dashboards")).toBe(true);
    expect(overlayAddress("/review/claude-a")).toBe(false);
  });

  test("does not splice older delivered Med messages above a truncated session tail", () => {
    const tail: SessionItem[] = [
      {
        kind: "user",
        id: "u-recent",
        at: Date.parse("2026-11-24T10:10:00.000Z"),
        content: [{ type: "text", text: "Recent prompt" }],
      },
      {
        kind: "agent",
        id: "a-recent",
        at: Date.parse("2026-11-24T10:10:05.000Z"),
        text: "Recent reply",
      },
    ];
    const sent = [
      {
        id: "m-old",
        sessionId: "s1",
        agent: "claude" as const,
        text: "Very old prompt from unloaded page",
        noteIds: [],
        attachmentCount: 0,
        createdAt: "2026-11-24T09:00:00.000Z",
        deliveredAt: "2026-11-24T09:00:01.000Z",
        delivery: "delivered" as const,
      },
      {
        id: "m-queued",
        sessionId: "s1",
        agent: "claude" as const,
        text: "Queued follow-up",
        noteIds: [],
        attachmentCount: 0,
        createdAt: "2026-11-24T10:11:00.000Z",
        delivery: "pending" as const,
      },
    ];
    const merged = withSentMessages(tail, sent, { truncated: true });
    expect(merged.map((item) => item.id)).toEqual(["u-recent", "a-recent", "med-m-queued"]);
    // Once all earlier pages load (truncated = false), older delivered messages merge normally.
    const full = withSentMessages(tail, sent, { truncated: false });
    expect(full.map((item) => item.id)).toEqual([
      "med-m-old",
      "u-recent",
      "a-recent",
      "med-m-queued",
    ]);
  });
});
