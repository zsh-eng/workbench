import { describe, expect, test, vi } from "vitest";
import {
  createFileWorkspace,
  TAB_LIMIT,
  type OpenFileTab,
} from "../../src/web/data/file-workspace";
import type { BrowseApi } from "../../src/web/data/browse";
import type { BrowseRead, BrowseSource } from "../../src/shared/browse";
const A: BrowseSource = { kind: "worktree", repo: "/first" };
const B: BrowseSource = { kind: "worktree", repo: "/second" };
function result(source: BrowseSource, path: string, kind: BrowseRead["kind"] = "text"): BrowseRead {
  return {
    source,
    path,
    kind,
    size: 12,
    identity: `${source.repo}:${path}`,
    ...(kind === "text" ? { text: source.repo } : {}),
  };
}
function fixture(options: { held?: (tab: OpenFileTab) => boolean } = {}) {
  const pending: {
    source: BrowseSource;
    path: string;
    signal?: AbortSignal;
    resolve(value: BrowseRead): void;
    reject(error: Error): void;
  }[] = [];
  const api: BrowseApi = {
    list: vi.fn<BrowseApi["list"]>(),
    read: (source, path, signal) =>
      new Promise((resolve, reject) => pending.push({ source, path, signal, resolve, reject })),
  };
  return { workspace: createFileWorkspace(api, options), pending };
}
async function settle() {
  await Promise.resolve();
  await Promise.resolve();
}

describe("file workspace", () => {
  test("removing a repository forgets its tabs and rejects pending file contents", async () => {
    const { workspace, pending } = fixture();
    const key = JSON.stringify(["first-repository", "branch", "main"]);
    workspace.configure(key, A, "First");
    workspace.open("same.ts");
    workspace.forgetRepository("first-repository");
    expect(pending[0]!.signal?.aborted).toBe(true);
    pending[0]!.resolve(result(A, "same.ts"));
    await settle();
    expect(workspace.getSnapshot().file).toBeNull();
    workspace.configure(key, A, "First");
    expect(workspace.getSnapshot().tabs).toEqual([]);
    expect(workspace.getSnapshot().recentPaths).toEqual([]);
    workspace.dispose();
  });
  test("symbol jumps retain their exact source and column, then clear column for a line-only jump", () => {
    const { workspace } = fixture();
    const commit: BrowseSource = { kind: "commit", repo: A.repo, oid: "a".repeat(40) };
    workspace.configure("first", A, "First");
    workspace.open("same.ts", 12, commit, "Commit aaaaaaaa", 9);
    expect(workspace.getSnapshot().tabs[0]).toMatchObject({ source: commit, line: 12, column: 9 });
    workspace.open("same.ts", 18, commit);
    expect(workspace.getSnapshot().tabs[0]).toMatchObject({ line: 18, column: undefined });
    workspace.dispose();
  });
  test("close others and close all affect only the current workspace and retain recent paths", async () => {
    const { workspace, pending } = fixture();
    workspace.configure("first", A, "First");
    workspace.open("one.ts");
    workspace.open("two.ts");
    const active = workspace.getSnapshot().active;
    workspace.closeOthers();
    expect(workspace.getSnapshot().tabs.map((tab) => tab.id)).toEqual([active]);
    expect(workspace.getSnapshot().recentPaths).toEqual(["two.ts", "one.ts"]);
    workspace.configure("second", B, "Second");
    expect(workspace.getSnapshot().recentPaths).toEqual([]);
    workspace.open("other.ts");
    workspace.closeAll();
    expect(pending.at(-1)?.signal?.aborted).toBe(true);
    pending.at(-1)!.resolve(result(B, "other.ts"));
    await settle();
    expect(workspace.getSnapshot().file).toBeNull();
    expect(workspace.getSnapshot().tabs).toEqual([]);
    workspace.configure("first", A, "First");
    expect(workspace.getSnapshot().tabs.map((tab) => tab.id)).toEqual([active]);
    expect(workspace.getSnapshot().recentPaths).toEqual(["two.ts", "one.ts"]);
    workspace.dispose();
  });
  test("each open keeps its tab, and a second open shows the file's tab without reading it again", async () => {
    const { workspace, pending } = fixture();
    workspace.configure("first", A, "First");
    workspace.open("one.ts");
    workspace.open("two.ts");
    expect(workspace.getSnapshot().tabs.map((tab) => tab.path)).toEqual(["one.ts", "two.ts"]);
    pending.at(-1)!.resolve(result(A, "two.ts"));
    await settle();
    const reads = pending.length;
    workspace.open("two.ts");
    expect(pending).toHaveLength(reads);
    workspace.open("one.ts", 12);
    expect(workspace.getSnapshot().tabs.map((tab) => tab.path)).toEqual(["one.ts", "two.ts"]);
    expect(workspace.getSnapshot().tabs[0]!.line).toBe(12);
    expect(workspace.getSnapshot().active).toBe(workspace.getSnapshot().tabs[0]!.id);
    workspace.dispose();
  });
  test("closing gives the screen back to the tab that showed before, skipping tabs the row lost", () => {
    let notes = true;
    const { workspace, pending } = fixture();
    workspace.setAvailable((id) => id !== "brief" || notes);
    workspace.configure("first", A, "First");
    for (const name of ["one.ts", "two.ts", "three.ts"]) workspace.open(name);
    const [one, two, three] = workspace.getSnapshot().tabs;
    workspace.select("changes");
    workspace.select(one!.id);
    workspace.select(three!.id);
    workspace.close(three!.id);
    expect(workspace.getSnapshot().active).toBe(one!.id);
    expect(pending.at(-1)?.path).toBe("one.ts");
    workspace.close(one!.id);
    expect(workspace.getSnapshot().active).toBe("changes");
    // A background close leaves the screen and its read alone.
    workspace.select("brief");
    workspace.select(two!.id);
    const reads = pending.length;
    workspace.open("four.ts", undefined, undefined, undefined, undefined, { background: true });
    workspace.close(workspace.getSnapshot().tabs.at(-1)!.id);
    expect(workspace.getSnapshot().active).toBe(two!.id);
    expect(pending).toHaveLength(reads);
    // Notes left the row, so the file goes back to Changes.
    notes = false;
    workspace.close(two!.id);
    expect(workspace.getSnapshot().active).toBe("changes");
    // Commit goes back the same way.
    workspace.open("five.ts");
    workspace.select("commit");
    expect(workspace.previous()).toBe(workspace.getSnapshot().tabs.at(-1)!.id);
    workspace.dispose();
  });
  test("each workspace has one Search tab, which keeps its query and closes like a file", () => {
    const { workspace } = fixture();
    workspace.configure("first", A, "First");
    workspace.open("one.ts");
    workspace.openSearch("needle");
    expect(workspace.getSnapshot()).toMatchObject({ active: "search", search: "needle" });
    workspace.setSearch("needles");
    workspace.open("two.ts");
    // A second open keeps the tab and its query; a new query replaces it.
    workspace.openSearch();
    expect(workspace.getSnapshot()).toMatchObject({ active: "search", search: "needles" });
    // Match case belongs to the workspace, with its query.
    workspace.setSearchCase(true);
    workspace.configure("second", B, "Second");
    expect(workspace.getSnapshot().search).toBeUndefined();
    expect(workspace.getSnapshot().searchCase).toBeUndefined();
    workspace.configure("first", A, "First");
    expect(workspace.getSnapshot()).toMatchObject({
      active: "search",
      search: "needles",
      searchCase: true,
    });
    // Close all files keeps Search; closing Search shows the tab before it.
    workspace.closeAll();
    expect(workspace.getSnapshot()).toMatchObject({ active: "search", tabs: [] });
    workspace.select("commit");
    workspace.select("search");
    workspace.close("search");
    expect(workspace.getSnapshot()).toMatchObject({ active: "commit", search: undefined });
    workspace.select("search");
    expect(workspace.getSnapshot().active).toBe("commit");
    // The option stays for the next Search tab, as in VS Code.
    workspace.openSearch();
    expect(workspace.getSnapshot()).toMatchObject({ search: "", searchCase: true });
    workspace.dispose();
  });
  test("close all and close others go back the same way", () => {
    const { workspace, pending } = fixture();
    workspace.configure("first", A, "First");
    workspace.select("brief");
    for (const name of ["one.ts", "two.ts", "three.ts"]) workspace.open(name);
    const [one, two] = workspace.getSnapshot().tabs;
    // Close others from a tab that does not show: that tab shows.
    workspace.closeOthers(one!.id);
    expect(workspace.getSnapshot().tabs.map((tab) => tab.id)).toEqual([one!.id]);
    expect(workspace.getSnapshot().active).toBe(one!.id);
    expect(pending.at(-1)?.path).toBe("one.ts");
    workspace.open("two.ts");
    workspace.select("changes");
    workspace.closeOthers(two!.id);
    expect(workspace.getSnapshot().active).toBe("changes");
    workspace.select(two!.id);
    workspace.closeAll();
    expect(workspace.getSnapshot().tabs).toEqual([]);
    expect(workspace.getSnapshot().active).toBe("changes");
    workspace.open("one.ts");
    workspace.select("brief");
    workspace.select(one!.id);
    workspace.closeAll();
    expect(workspace.getSnapshot().active).toBe("brief");
    workspace.dispose();
  });
  test("background opens add tabs without changing selection or cancelling reads", async () => {
    const { workspace, pending } = fixture();
    const background = { background: true };
    workspace.configure("first", A, "First");
    workspace.open("one.ts", undefined, undefined, undefined, undefined, background);
    expect(workspace.getSnapshot().active).toBe("changes");
    expect(pending).toHaveLength(0);
    workspace.open("shown.ts");
    const active = workspace.getSnapshot().active;
    workspace.open("two.ts", undefined, undefined, undefined, undefined, background);
    expect(workspace.getSnapshot().active).toBe(active);
    expect(workspace.getSnapshot().tabs.map((tab) => tab.path)).toEqual([
      "one.ts",
      "shown.ts",
      "two.ts",
    ]);
    expect(pending).toHaveLength(1);
    expect(pending[0]!.signal!.aborted).toBe(false);
    pending[0]!.resolve(result(A, "shown.ts"));
    await settle();
    workspace.open("one.ts", undefined, undefined, undefined, undefined, background);
    expect(workspace.getSnapshot().tabs).toHaveLength(3);
    expect(workspace.getSnapshot().file?.path).toBe("shown.ts");
    workspace.dispose();
  });
  test("restores tabs by worktree and rejects late bytes from the previous scope", async () => {
    const { workspace, pending } = fixture();
    workspace.configure("first", A, "First");
    workspace.open("same.ts");
    workspace.configure("second", B, "Second");
    workspace.open("same.ts");
    expect(pending[0]!.signal!.aborted).toBe(true);
    pending[1]!.resolve(result(B, "same.ts", "binary"));
    await settle();
    expect(workspace.getSnapshot().file?.kind).toBe("binary");
    expect(workspace.getSnapshot().file?.identity).toBe("/second:same.ts");
    pending[0]!.resolve(result(A, "same.ts"));
    await settle();
    expect((workspace.getSnapshot().file?.source as BrowseSource | undefined)?.repo).toBe(
      "/second",
    );
    workspace.configure("first", A, "First");
    expect((workspace.getSnapshot().tabs[0]!.source as BrowseSource).repo).toBe("/first");
    expect(workspace.getSnapshot().file).toBeNull();
    pending[2]!.resolve(result(A, "same.ts"));
    await settle();
    expect(workspace.getSnapshot().file?.text).toBe("/first");
    workspace.dispose();
  });
  test("accepts equivalent source field order but rejects a different source or path", async () => {
    const { workspace, pending } = fixture();
    workspace.configure("first", A, "First");
    workspace.open("same.ts");
    pending[0]!.resolve(result({ repo: "/first", kind: "worktree" }, "same.ts"));
    await settle();
    expect(workspace.getSnapshot().error).toBeNull();
    expect(workspace.getSnapshot().file?.path).toBe("same.ts");
    workspace.open("next.ts");
    pending[1]!.resolve(result(B, "next.ts", "missing"));
    await settle();
    expect(workspace.getSnapshot().error).toContain("does not match");
    expect(workspace.getSnapshot().file).toBeNull();
    workspace.open("next.ts");
    pending[2]!.resolve(result(A, "wrong.ts"));
    await settle();
    expect(workspace.getSnapshot().error).toContain("does not match");
    workspace.dispose();
  });
  test("a full row gives up the tab that showed least recently and has no draft, and workspace history is bounded", () => {
    const { workspace } = fixture({ held: (tab) => tab.path === "0.ts" });
    workspace.configure("first", A, "First");
    for (let i = 0; i < TAB_LIMIT; i++) workspace.open(`${i}.ts`);
    // 1.ts showed again, so 2.ts showed least recently of the tabs without a draft.
    workspace.open("1.ts");
    workspace.open(`${TAB_LIMIT}.ts`);
    expect(workspace.getSnapshot().tabs).toHaveLength(TAB_LIMIT);
    expect(
      workspace
        .getSnapshot()
        .tabs.map((tab) => tab.path)
        .slice(0, 3),
    ).toEqual(["0.ts", "1.ts", "3.ts"]);
    expect(workspace.getSnapshot().error).toBeNull();
    for (let i = 0; i < 32; i++)
      workspace.configure(`workspace-${i}`, { kind: "worktree", repo: `/repo-${i}` }, "Other");
    workspace.configure("first", A, "First");
    expect(workspace.getSnapshot().tabs).toHaveLength(0);
    expect(workspace.getSnapshot().active).toBe("changes");
    workspace.dispose();
  });
  test("retains file navigation across ten repository branch tabs without retaining bytes", async () => {
    const { workspace, pending } = fixture();
    for (let i = 0; i < 10; i++) {
      const source: BrowseSource = { kind: "worktree", repo: `/repo-${i}` };
      workspace.configure(JSON.stringify([`repository-${i}`, "branch", "main"]), source, "main");
      workspace.open("same.ts");
      pending.at(-1)!.resolve(result(source, "same.ts"));
      await settle();
    }
    const source: BrowseSource = { kind: "worktree", repo: "/repo-0" };
    workspace.configure(JSON.stringify(["repository-0", "branch", "main"]), source, "main");
    expect(workspace.getSnapshot().tabs).toHaveLength(1);
    expect(workspace.getSnapshot().tabs[0]).toMatchObject({
      source,
      path: "same.ts",
    });
    expect(workspace.getSnapshot().active).toBe(workspace.getSnapshot().tabs[0]!.id);
    expect(workspace.getSnapshot().file).toBeNull();
    pending.at(-1)!.resolve(result(source, "same.ts"));
    await settle();
    expect((workspace.getSnapshot().file?.source as BrowseSource | undefined)?.repo).toBe(
      "/repo-0",
    );
    workspace.dispose();
  });
  test("selecting Changes and disposal cancel reads and prevent stale errors", async () => {
    const { workspace, pending } = fixture();
    workspace.configure("first", A, "First");
    workspace.open("a.ts");
    workspace.select("changes");
    pending[0]!.reject(new Error("Late read failure"));
    await settle();
    expect(workspace.getSnapshot().error).toBeNull();
    expect(workspace.getSnapshot().loading).toBe(false);
    workspace.open("b.ts");
    const before = workspace.getSnapshot();
    workspace.dispose();
    expect(pending[1]!.signal!.aborted).toBe(true);
    pending[1]!.resolve(result(A, "b.ts"));
    await settle();
    expect(workspace.getSnapshot()).toBe(before);
  });
});
