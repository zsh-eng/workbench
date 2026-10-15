import { describe, expect, test } from "vitest";
import type { Comparison, RegisteredRepository } from "../../src/shared/protocol";
import { createReviewController } from "../../src/web/data/controller";

const A = "a".repeat(40);
const B = "b".repeat(40);
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
function repository(id: string): RegisteredRepository {
  return {
    id,
    path: `/${id}`,
    name: "same-name",
    branches: [
      { name: "main", head: A, worktreePath: `/${id}`, current: true },
      { name: "feature", head: B, worktreePath: `/${id}-linked`, current: false },
      { name: "topic", head: B, current: false },
    ],
    worktrees: [
      { path: `/${id}`, head: A, branch: "main" },
      { path: `/${id}-linked`, head: B, branch: "feature" },
      { path: `/${id}-detached`, head: B, branch: "Detached HEAD" },
    ],
  };
}
function fixture(options: { events?: (repo: string) => Response } = {}) {
  let repositories = [repository("one"), repository("two")];
  let gate: { path: string; promise: Promise<void> } | null = null;
  let catalogueGate: Promise<void> | null = null;
  let reviewGate: { path: string; promise: Promise<void> } | null = null;
  const reviews: { repo: string; comparison: Comparison }[] = [];
  const controller = createReviewController({
    events: Boolean(options.events),
    parsePatch: async () => [],
    fetch: async (input, init) => {
      const url = new URL(String(input), "http://localhost");
      const repo = url.searchParams.get("repo") ?? "/one";
      if (url.pathname === "/api/repositories") {
        if (init?.method === "DELETE")
          repositories = repositories.filter((entry) => entry.id !== url.searchParams.get("id"));
        if (init?.method === "POST") {
          const path = JSON.parse(String(init.body)).path as string;
          if (path === "/invalid")
            return Response.json({ error: { message: "Not a Git repository." } }, { status: 400 });
          repositories = [...repositories, repository(path.slice(1))];
        }
        const result = structuredClone(repositories);
        await catalogueGate;
        return Response.json({ repositories: result });
      }
      if (url.pathname === "/api/events" && options.events) return options.events(repo);
      const owner = repositories.find(
        (entry) => entry.path === repo || entry.worktrees.some((tree) => tree.path === repo),
      );
      if (url.pathname === "/api/session") {
        if (!owner)
          return Response.json(
            { error: { message: "Add a repository to continue." } },
            { status: 403 },
          );
        const result = {
          protocol: 1,
          repositoryId: owner?.id,
          repositories: structuredClone(repositories),
          repository: {
            path: repo,
            name: "same-name",
            head: A,
            branch: owner?.worktrees.find((tree) => tree.path === repo)?.branch ?? "main",
            shallow: false,
            git: true,
          },
          worktrees: owner?.worktrees ?? [],
        };
        if (gate?.path === repo) await gate.promise;
        return Response.json(result);
      }
      if (url.pathname === "/api/branches") return Response.json(owner?.branches ?? []);
      if (url.pathname === "/api/history")
        return Response.json({ commits: [], cursor: null, hasMore: false });
      if (url.pathname === "/api/review") {
        const request = JSON.parse(String(init?.body)) as { repo: string; comparison: Comparison };
        reviews.push(request);
        if (reviewGate?.path === request.repo) await reviewGate.promise;
        return Response.json({
          id: JSON.stringify(request),
          ...request,
          base: A,
          head: B,
          label: "Review",
          files: ["a.ts", "b.ts"].map((path) => ({
            path,
            status: "M",
            additions: 1,
            deletions: 1,
            binary: false,
          })),
          patch: "",
          warnings: [],
          metrics: { gitMs: 0, totalMs: 0, patchBytes: 0, cacheHit: false },
        });
      }
      if (url.pathname === "/api/notes")
        return Response.json({
          reviewId: url.searchParams.get("reviewId"),
          revision: 0,
          notes: [],
        });
      throw new Error(`Unexpected request: ${url}`);
    },
  });
  return {
    controller,
    reviews,
    gateSession(path: string, promise: Promise<void>) {
      gate = { path, promise };
    },
    gateReview(path: string, promise: Promise<void>) {
      reviewGate = { path, promise };
    },
    gateCatalogue(promise: Promise<void> | null) {
      catalogueGate = promise;
    },
    setRepositories(next: RegisteredRepository[]) {
      repositories = next;
    },
  };
}

describe("multi-repository targets", () => {
  test("keeps identical repository names and branch names separate, using each repository's own root", async () => {
    const { controller, reviews } = fixture();
    await controller.initialize();
    expect(controller.getSnapshot().repositories).toHaveLength(2);
    await controller.selectBranch("feature", "two");
    expect(reviews.at(-1)?.repo).toBe("/two-linked");
    await controller.selectBranch("topic", "two");
    expect(reviews.at(-1)).toEqual({ repo: "/two", comparison: { kind: "commit", commit: B } });
    await controller.selectBranch("topic", "one");
    expect(reviews.at(-1)).toEqual({ repo: "/one", comparison: { kind: "commit", commit: B } });
    expect(controller.getSnapshot().activeRepositoryId).toBe("one");
    controller.dispose();
  });

  test("restores each target's comparison, file filter, and selected file", async () => {
    const { controller } = fixture();
    await controller.initialize();
    await controller.selectComparison({ kind: "staged" });
    controller.setFilter(".ts");
    controller.revealFile(controller.getSnapshot().files[1]!.id);
    await controller.selectBranch("main", "two");
    expect(controller.getSnapshot().comparison).toEqual({ kind: "working" });
    expect(controller.getSnapshot().filter).toBe("");
    await controller.selectComparison({ kind: "commit", commit: B });
    await controller.selectBranch("main", "one");
    const restored = controller.getSnapshot();
    expect(restored.comparison).toEqual({ kind: "staged" });
    expect(restored.review?.repo).toBe("/one");
    expect(restored.filter).toBe(".ts");
    expect(restored.selectedFileId).toBe(restored.files[1]!.id);
    expect(restored.semantic?.selection.fileKey).toBe(restored.selectedFileId);
    expect(restored.semantic?.filter).toBe(".ts");
    await controller.selectBranch("main", "two");
    expect(controller.getSnapshot().comparison).toEqual({ kind: "commit", commit: B });
    controller.dispose();
  });

  test("ignores a late session from another repository", async () => {
    const f = fixture();
    await f.controller.initialize();
    const gate = deferred<void>();
    f.gateSession("/two", gate.promise);
    const old = f.controller.selectBranch("main", "two");
    await f.controller.selectBranch("topic", "one");
    gate.resolve();
    await old;
    expect(f.controller.getSnapshot().activeRepositoryId).toBe("one");
    expect(f.controller.getSnapshot().activeBranch).toBe("topic");
    expect(f.controller.getSnapshot().review?.repo).toBe("/one");
    f.controller.dispose();
  });

  test("refreshes all picker targets and isolates detached worktree navigation", async () => {
    const f = fixture();
    await f.controller.initialize();
    const next = [repository("one"), repository("two")];
    next[1]!.branches.push({ name: "new", head: B, current: false });
    f.setRepositories(next);
    await f.controller.refreshRepositories();
    expect(f.controller.getSnapshot().repositories[1]?.branches.at(-1)?.name).toBe("new");
    await f.controller.selectWorktree("/one-detached", "one");
    await f.controller.selectComparison({ kind: "staged" });
    await f.controller.selectWorktree("/two-detached", "two");
    // A detached checkout opens on its changes since the base branch.
    expect(f.controller.getSnapshot().comparison).toEqual({ kind: "working", base: "main" });
    await f.controller.selectWorktree("/one-detached", "one");
    expect(f.controller.getSnapshot().comparison).toEqual({ kind: "staged" });
    expect(f.controller.getSnapshot().activeBranch).toBeNull();
    f.controller.dispose();
  });

  test("removes the active target, clears the last repository, and accepts a new repository", async () => {
    const { controller } = fixture();
    await controller.initialize();
    await controller.selectComparison({ kind: "staged" });
    await controller.removeRepository("one");
    expect(controller.getSnapshot().activeRepositoryId).toBe("two");
    await controller.removeRepository("two");
    expect(controller.getSnapshot()).toMatchObject({
      session: null,
      activeRepositoryId: null,
      review: null,
      files: [],
      status: "idle",
    });
    await controller.addRepository("/one");
    expect(controller.getSnapshot().activeRepositoryId).toBe("one");
    expect(controller.getSnapshot().comparison).toEqual({ kind: "working" });
    await expect(controller.addRepository("/invalid")).rejects.toThrow("Not a Git repository");
    controller.dispose();
  });

  test("a late catalogue refresh cannot restore a removed repository", async () => {
    const f = fixture();
    await f.controller.initialize();
    const gate = deferred<void>();
    f.gateCatalogue(gate.promise);
    const oldRefresh = f.controller.refreshRepositories();
    f.gateCatalogue(null);
    await f.controller.removeRepository("two");
    gate.resolve();
    await oldRefresh;
    expect(f.controller.getSnapshot().repositories.map((entry) => entry.id)).toEqual(["one"]);
    f.controller.dispose();
  });

  test("ignores a late review after changing repositories", async () => {
    const f = fixture();
    await f.controller.initialize();
    const gate = deferred<void>();
    f.gateReview("/one", gate.promise);
    const previous = f.controller.selectComparison({ kind: "staged" });
    await f.controller.selectBranch("main", "two");
    gate.resolve();
    await previous;
    expect(f.controller.getSnapshot().review?.repo).toBe("/two");
    expect(f.controller.getSnapshot().comparison).toEqual({ kind: "working" });
    f.controller.dispose();
  });

  test("reconciles removal by another client and clears the final active repository", async () => {
    const f = fixture();
    await f.controller.initialize();
    await f.controller.selectComparison({ kind: "staged" });
    f.setRepositories([repository("two")]);
    await f.controller.refreshRepositories();
    expect(f.controller.getSnapshot().activeRepositoryId).toBe("two");
    expect(f.controller.getSnapshot().review?.repo).toBe("/two");
    f.setRepositories([]);
    await f.controller.refreshRepositories();
    expect(f.controller.getSnapshot()).toMatchObject({
      repositories: [],
      activeRepositoryId: null,
      session: null,
      review: null,
    });
    await f.controller.addRepository("/one");
    expect(f.controller.getSnapshot().comparison).toEqual({ kind: "working" });
    f.controller.dispose();
  });

  test("an event-stream rejection for a removed repository refreshes the catalogue", async () => {
    const f = fixture({
      events: (repo) => {
        if (repo === "/one") {
          f.setRepositories([repository("two")]);
          return new Response(null, { status: 403 });
        }
        return new Response(new ReadableStream<Uint8Array>());
      },
    });
    await f.controller.initialize();
    await expect.poll(() => f.controller.getSnapshot().activeRepositoryId).toBe("two");
    await expect.poll(() => f.controller.getSnapshot().review?.repo).toBe("/two");
    expect(f.controller.getSnapshot().error).toBeNull();
    f.controller.dispose();
  });

  test("a fresh browser with an empty registry can add a repository without a startup error", async () => {
    const f = fixture();
    f.setRepositories([]);
    await f.controller.initialize();
    expect(f.controller.getSnapshot()).toMatchObject({
      repositories: [],
      session: null,
      activeRepositoryId: null,
      status: "idle",
      error: null,
    });
    await f.controller.addRepository("/one");
    expect(f.controller.getSnapshot().review?.repo).toBe("/one");
    f.controller.dispose();
  });

  test("initial authentication errors do not fall back to the repository catalogue", async () => {
    const requests: string[] = [];
    const controller = createReviewController({
      events: false,
      fetch: async (input) => {
        requests.push(String(input));
        return Response.json(
          { error: { message: "Open the launch URL with its access token." } },
          { status: 401 },
        );
      },
    });
    await controller.initialize();
    expect(requests).toEqual(["/api/session"]);
    expect(controller.getSnapshot().status).toBe("error");
    expect(controller.getSnapshot().error).toContain("access token");
    controller.dispose();
  });
});
