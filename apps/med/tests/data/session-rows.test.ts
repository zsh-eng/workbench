import { describe, expect, test } from "vitest";
import type { Thread } from "../../src/shared/threads";
import { sessionGroups, sessionRows, tabOrder } from "../../src/web/data/threads";
import { findPattern } from "../../src/web/data/search-highlights";

const thread = (id: string, updatedAt: number, sessions: string[], pinned?: number): Thread => ({
  id,
  title: id,
  createdAt: "2026-11-08T00:00:00.000Z",
  updatedAt,
  sessions: sessions.map((session) => ({ agent: "claude", id: session })) as Thread["sessions"],
  ...(pinned && { pinned }),
});

describe("a session's reviews", () => {
  // One session handed off three reviews; another session has its own; one
  // review has no session.
  const threads = [
    thread("search", 30, ["s1"]),
    thread("chips", 50, ["s1"]),
    thread("docs", 10, ["s2"]),
    // Forked from s1, so it is the same task.
    thread("tests", 20, ["s3", "s1"]),
    thread("alone", 40, []),
  ];

  test("group the threads that share a session, newest first", () => {
    expect(sessionGroups(threads).map((group) => group.map((each) => each.id))).toEqual([
      ["chips", "search", "tests"],
      ["docs"],
      ["alone"],
    ]);
  });

  test("are one row: the one on screen, else the newest, with the newest activity", () => {
    const rows = sessionRows(threads);
    expect(rows.map((row) => row.id)).toEqual(["chips", "docs", "alone"]);
    expect(rows[0]!.members).toEqual(["chips", "search", "tests"]);
    expect(rows[1]!.members).toBeUndefined();
    const shown = sessionRows(threads, "tests")[0]!;
    expect(shown.id).toBe("tests");
    expect(shown.updatedAt).toBe(50);
  });

  test("keep a pinned review's place in the sidebar's order", () => {
    const pinned = threads.map((each) => (each.id === "search" ? { ...each, pinned: 1 } : each));
    expect(tabOrder(pinned).map((row) => [row.id, row.pinned])).toEqual([
      ["search", 1],
      ["alone", undefined],
      ["docs", undefined],
    ]);
    // On screen, a review of the pinned session stands for it.
    expect(tabOrder(pinned, "chips")[0]!.id).toBe("chips");
  });

  test("keep the session's name and pin when another of its reviews is on screen", () => {
    const at = (day: number) => `2026-11-0${day}T00:00:00.000Z`;
    const named = [
      { ...thread("search", 30, ["s1"], 1), title: "Med", agentTitle: "Search", createdAt: at(2) },
      { ...thread("chips", 50, ["s1"]), createdAt: at(3) },
      { ...thread("docs", 10, ["s2"]), createdAt: at(1) },
    ];
    for (const current of [undefined, "search", "chips"]) {
      const row = tabOrder(named, current)[0]!;
      expect([row.title, row.agentTitle, row.pinned, row.owner]).toEqual([
        "Med",
        "Search",
        1,
        "search",
      ]);
    }
    expect(tabOrder(named, "chips")[0]!.id).toBe("chips");
    // Unnamed and unpinned, a session goes by the first review it handed off.
    const plain = named.map(({ agentTitle: _agentTitle, pinned: _pinned, ...each }) => ({
      ...each,
      title: each.id,
    }));
    expect(sessionRows(plain).map((row) => [row.id, row.title])).toEqual([
      ["chips", "search"],
      ["docs", "docs"],
    ]);
    expect(sessionRows(plain, "chips")[0]!.title).toBe("search");
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

  test("says why a regular expression does not work, and nothing for no query", () => {
    expect(all("(", { regexp: true })).toEqual({ error: "Not a valid pattern" });
    expect(findPattern("")).toBeNull();
  });
});
