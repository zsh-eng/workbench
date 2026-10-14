import { afterEach, expect, test, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, realpath, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startHost, type RunningHost } from "../../src/host/server";
import { ZoektSearchService } from "../../src/host/search/service";
import type { RegisteredRepository } from "../../src/shared/protocol";

const temporary: string[] = [];
const hosts: RunningHost[] = [];
const git = (repo: string, ...args: string[]) =>
  execFileSync("git", args, {
    cwd: repo,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_AUTHOR_NAME: "Test",
      GIT_AUTHOR_EMAIL: "test@example.com",
      GIT_COMMITTER_NAME: "Test",
      GIT_COMMITTER_EMAIL: "test@example.com",
    },
  }).trim();
async function fixture() {
  const parent = await realpath(await mkdtemp(join(tmpdir(), "med multi repo ")));
  temporary.push(parent);
  const repo = join(parent, "first");
  await mkdir(repo);
  git(repo, "init", "-b", "main");
  git(repo, "config", "commit.gpgsign", "false");
  await writeFile(join(repo, "shared.txt"), "same committed content\n");
  git(repo, "add", ".");
  git(repo, "commit", "-m", "initial");
  const clone = join(parent, "second");
  git(parent, "clone", repo, clone);
  const linked = join(parent, "linked");
  git(repo, "worktree", "add", "-b", "feature", linked);
  return { parent, repo, clone, linked };
}
async function launch(repo: string, repos: string[] = []) {
  const host = await startHost({ repo, repos, search: { binDir: "/no-med-test-search-tools" } });
  hosts.push(host);
  const base = `http://127.0.0.1:${host.port}`;
  const headers = { authorization: `Bearer ${host.token}`, "content-type": "application/json" };
  const request = (path: string, body?: unknown, method = body === undefined ? "GET" : "POST") =>
    fetch(`${base}${path}`, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const catalogue = async () =>
    (await (await request("/api/repositories")).json()).repositories as RegisteredRepository[];
  return { host, base, headers, request, catalogue };
}
afterEach(async () => {
  await Promise.all(hosts.splice(0).map((host) => host.close()));
  vi.restoreAllMocks();
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

test("deduplicates linked worktrees but keeps same-commit clones distinct and isolates reads", async () => {
  const { repo, clone, linked } = await fixture();
  const { request, catalogue } = await launch(repo, [linked, clone]);
  const entries = await catalogue();
  expect(entries).toHaveLength(2);
  expect(entries[0]!.worktrees.map((tree) => tree.path)).toContain(linked);
  expect(entries[0]!.id).not.toBe(entries[1]!.id);
  expect(
    entries.map((entry) => entry.branches.find((branch) => branch.name === "main")!.head),
  ).toEqual([git(repo, "rev-parse", "HEAD"), git(repo, "rev-parse", "HEAD")]);
  const session = await (await request(`/api/session?repo=${encodeURIComponent(clone)}`)).json();
  expect(session.repositoryId).toBe(entries[1]!.id);
  expect(session.repositories).toHaveLength(2);
  await writeFile(join(repo, "shared.txt"), "first working content\n");
  await writeFile(join(clone, "shared.txt"), "second working content\n");
  for (const [path, content] of [
    [repo, "first working content\n"],
    [clone, "second working content\n"],
  ]) {
    const file = await (
      await request("/api/browse/read", {
        source: { kind: "worktree", repo: path },
        path: "shared.txt",
      })
    ).json();
    expect(file.text).toBe(content);
  }
  const reviews = await Promise.all(
    [repo, clone].map(async (path) =>
      (
        await request("/api/review", { repo: path, comparison: { kind: "commit", commit: "HEAD" } })
      ).json(),
    ),
  );
  expect(reviews[0].id).not.toBe(reviews[1].id);
  const note = await request("/api/notes", {
    reviewId: reviews[0].id,
    expectedRevision: 0,
    mutation: {
      type: "add",
      note: { path: "shared.txt", side: "new", line: 1, text: "First repository only" },
    },
  });
  expect(note.status).toBe(200);
  expect((await (await request(`/api/notes?reviewId=${reviews[1].id}`)).json()).notes).toEqual([]);
});

test("registers through authenticated API, serializes duplicate adds, and refreshes worktree ownership", async () => {
  const { repo, clone, linked, parent } = await fixture();
  const { request, catalogue, base, headers } = await launch(repo);
  expect(
    (
      await fetch(`${base}/api/repositories`, {
        method: "POST",
        body: JSON.stringify({ path: clone }),
      })
    ).status,
  ).toBe(401);
  expect(
    (
      await fetch(`${base}/api/repositories`, {
        method: "POST",
        headers: { ...headers, origin: "https://example.com" },
        body: JSON.stringify({ path: clone }),
      })
    ).status,
  ).toBe(403);
  expect((await request(`/api/history?repo=${encodeURIComponent(clone)}`)).status).toBe(403);
  const adds = await Promise.all(
    [clone, clone, linked].map((path) => request("/api/repositories", { path })),
  );
  expect(adds.map((response) => response.status)).toEqual([200, 200, 200]);
  expect(await catalogue()).toHaveLength(2);
  const next = join(parent, "new-worktree");
  git(repo, "worktree", "add", "-b", "new-branch", next);
  expect(
    (await catalogue())[0]!.branches.find((branch) => branch.name === "new-branch")?.worktreePath,
  ).toBe(next);
  expect((await request(`/api/session?repo=${encodeURIComponent(next)}`)).status).toBe(200);
  git(repo, "worktree", "remove", next);
  const refreshed = await catalogue();
  expect(refreshed[0]!.worktrees.some((tree) => tree.path === next)).toBe(false);
  expect(
    refreshed[0]!.branches.find((branch) => branch.name === "new-branch")?.worktreePath,
  ).toBeUndefined();
  expect((await request(`/api/session?repo=${encodeURIComponent(next)}`)).status).toBe(403);
});

test("removal revokes review, source, notes, worktrees, and search without affecting another clone", async () => {
  const { repo, clone, linked } = await fixture();
  const { request, catalogue } = await launch(repo, [clone]);
  const entries = await catalogue();
  const review = await (
    await request("/api/review", { repo: linked, comparison: { kind: "commit", commit: "HEAD" } })
  ).json();
  const other = await (
    await request("/api/review", { repo: clone, comparison: { kind: "commit", commit: "HEAD" } })
  ).json();
  expect((await request(`/api/source?reviewId=${review.id}&path=shared.txt`)).status).toBe(200);
  expect(
    (await request(`/api/repositories?id=${entries[0]!.id}`, undefined, "DELETE")).status,
  ).toBe(200);
  for (const path of [repo, linked]) {
    expect((await request(`/api/session?repo=${encodeURIComponent(path)}`)).status).toBe(403);
    expect((await request(`/api/search/status?repo=${encodeURIComponent(path)}`)).status).toBe(403);
    expect(
      (
        await request("/api/browse/read", {
          source: { kind: "worktree", repo: path },
          path: "shared.txt",
        })
      ).status,
    ).toBe(403);
  }
  expect((await request(`/api/source?reviewId=${review.id}&path=shared.txt`)).status).toBe(409);
  expect((await request(`/api/notes?reviewId=${review.id}`)).status).toBe(409);
  expect(
    (
      await request("/api/notes", {
        reviewId: review.id,
        expectedRevision: 0,
        mutation: {
          type: "add",
          note: { path: "shared.txt", side: "new", line: 1, text: "No access" },
        },
      })
    ).status,
  ).toBe(409);
  expect((await request(`/api/source?reviewId=${other.id}&path=shared.txt`)).status).toBe(200);
  expect((await (await request("/api/session")).json()).repository.path).toBe(clone);
  expect(
    (await request(`/api/repositories?id=${entries[1]!.id}`, undefined, "DELETE")).status,
  ).toBe(200);
  expect(await catalogue()).toEqual([]);
  expect((await request("/api/repositories", { path: repo })).status).toBe(200);
});

test("rejects a registered path replaced with another Git repository", async () => {
  const { repo, clone, parent } = await fixture();
  const { request, catalogue } = await launch(repo);
  await rename(repo, join(parent, "old-first"));
  await rename(clone, repo);
  expect(
    (await request("/api/browse/read", { source: { kind: "worktree", repo }, path: "shared.txt" }))
      .status,
  ).toBe(403);
  // The common directory path is the same after this replacement, but the real
  // directory identity must change. See the registry identity check.
  expect((await catalogue())[0]!.error).toBeTruthy();
});

test("search services start on demand, dispatch by repository, and share bounded retention", async () => {
  const started: string[] = [];
  const closed: string[] = [];
  vi.spyOn(ZoektSearchService.prototype, "start").mockImplementation(async function (
    this: ZoektSearchService,
  ) {
    started.push((this as unknown as { repo: string }).repo);
  });
  vi.spyOn(ZoektSearchService.prototype, "close").mockImplementation(async function (
    this: ZoektSearchService,
  ) {
    closed.push((this as unknown as { repo: string }).repo);
  });
  vi.spyOn(ZoektSearchService.prototype, "status").mockImplementation(function (
    this: ZoektSearchService,
  ) {
    return {
      state: "unavailable",
      branches: [],
      message: (this as unknown as { repo: string }).repo,
    };
  });
  const { repo, clone, linked, parent } = await fixture();
  const more: string[] = [];
  for (let index = 0; index < 3; index++) {
    const path = join(parent, `clone-${index}`);
    git(parent, "clone", repo, path);
    more.push(path);
  }
  const { request, catalogue } = await launch(repo, [clone, ...more]);
  await catalogue();
  expect(started).toEqual([]);
  for (const path of [repo, linked, clone, ...more]) {
    const result = await (
      await request(`/api/search/status?repo=${encodeURIComponent(path)}`)
    ).json();
    expect(result.message).toBe(path === linked ? repo : path);
  }
  expect(started).toEqual([repo, clone, ...more]);
  expect(closed).toEqual([repo]);
  expect(
    (
      await request("/api/browse/search", {
        source: { kind: "commit", repo: clone, oid: git(clone, "rev-parse", "HEAD") },
        query: "same",
      })
    ).status,
  ).toBe(200);
});

test("a newer search in the same stream stops the last one and frees its host slot", async () => {
  vi.spyOn(ZoektSearchService.prototype, "start").mockImplementation(async () => {});
  const entered = new Map<string, () => void>();
  const stopped: string[] = [];
  vi.spyOn(ZoektSearchService.prototype, "search").mockImplementation(
    async (source, query, signal) => {
      entered.get(query)?.();
      // As a slow Git search, each query but the last ends only when stopped.
      if (query !== "relative")
        await new Promise((_, fail) =>
          signal!.addEventListener("abort", () => (stopped.push(query), fail(signal!.reason)), {
            once: true,
          }),
        );
      return { source, query, matches: [], truncated: false };
    },
  );
  const { repo } = await fixture();
  const { base, headers } = await launch(repo);
  // The page never cancels its requests, as a host under Bun never hears of it.
  const search = async (query: string, stream: string) => {
    const started = new Promise<void>((done) => entered.set(query, done));
    const response = fetch(`${base}/api/browse/search`, {
      method: "POST",
      headers: { ...headers, "x-med-latest": stream },
      body: JSON.stringify({ source: { kind: "worktree", repo }, query }),
    });
    await Promise.race([started, response]);
    return { response };
  };
  const other = search("other", "search:another-page");
  const typed = [];
  for (const query of ["r", "re", "rel", "rela", "relat", "relati", "relativ"])
    typed.push(await search(query, "search:page"));
  // More queries than the host's eight slots: each one stopped the one before.
  const last = await (await search("relative", "search:page")).response;
  expect(last.status).toBe(200);
  expect(await last.json()).toMatchObject({ query: "relative" });
  expect(stopped).toEqual(["r", "re", "rel", "rela", "relat", "relati", "relativ"]);
  const statuses = await Promise.all(typed.map(async ({ response }) => (await response).status));
  expect(statuses).toEqual(Array(7).fill(499));
  void (await other).response.catch(() => {});
});

test("removal cancels an in-flight review response and prevents its notes from being adopted", async () => {
  const { repo, clone } = await fixture();
  const { request, catalogue } = await launch(repo, [clone]);
  const entries = await catalogue();
  const { ReviewService } = await import("../../src/host/repository/review");
  const original = ReviewService.prototype.load;
  let release!: () => void;
  let entered!: (id: string) => void;
  const ready = new Promise<string>((done) => {
    entered = done;
  });
  const blocked = new Promise<void>((done) => {
    release = done;
  });
  vi.spyOn(ReviewService.prototype, "load").mockImplementation(async function (
    this: InstanceType<typeof ReviewService>,
    input,
    signal,
  ) {
    const review = await original.call(this, input, signal);
    entered(review.id);
    await blocked;
    return review;
  });
  const pending = request("/api/review", { repo, comparison: { kind: "commit", commit: "HEAD" } });
  const reviewId = await ready;
  expect(
    (await request(`/api/repositories?id=${entries[0]!.id}`, undefined, "DELETE")).status,
  ).toBe(200);
  release();
  expect((await pending).status).toBe(499);
  expect((await request(`/api/source?reviewId=${reviewId}&path=shared.txt`)).status).toBe(409);
  expect((await request(`/api/notes?reviewId=${reviewId}`)).status).toBe(409);
});

test("index work is serialized across repositories and queued work cancels without waiting", async () => {
  const { RepositoryRegistry } = await import("../../src/host/repository/registry");
  const { repo, clone } = await fixture();
  vi.spyOn(ZoektSearchService.prototype, "start").mockResolvedValue();
  vi.spyOn(ZoektSearchService.prototype, "close").mockResolvedValue();
  const registry = new RepositoryRegistry();
  try {
    await registry.register(repo);
    await registry.register(clone);
    type Schedule = NonNullable<
      import("../../src/host/search/service").SearchOptions["scheduleIndex"]
    >;
    const scheduler = (path: string) =>
      registry.withSearch(
        path,
        (service) =>
          (service as unknown as { options: { scheduleIndex: Schedule } }).options.scheduleIndex,
      );
    const firstSchedule = await scheduler(repo);
    const secondSchedule = await scheduler(clone);
    let release!: () => void;
    let entered!: () => void;
    const ready = new Promise<void>((done) => {
      entered = done;
    });
    const blocked = new Promise<void>((done) => {
      release = done;
    });
    const order: string[] = [];
    const first = firstSchedule(async () => {
      order.push("first starts");
      entered();
      await blocked;
      order.push("first ends");
    }, new AbortController().signal);
    await ready;
    const cancellation = new AbortController();
    const skipped = secondSchedule(async () => {
      order.push("cancelled starts");
    }, cancellation.signal);
    cancellation.abort();
    await expect(skipped).rejects.toMatchObject({ name: "AbortError" });
    const second = secondSchedule(async () => {
      order.push("second starts");
    }, new AbortController().signal);
    expect(order).toEqual(["first starts"]);
    release();
    await Promise.all([first, second]);
    expect(order).toEqual(["first starts", "first ends", "second starts"]);
  } finally {
    await registry.close();
  }
});

test("active event streams keep their watchers while inactive sources are evicted", async () => {
  const watching = await import("../../src/host/runtime/watch");
  const stopped: string[] = [];
  vi.spyOn(watching, "watchRepository").mockImplementation(async (path) => async () => {
    stopped.push(path);
  });
  const { repo, parent } = await fixture();
  const paths = [repo];
  for (let index = 0; index < 9; index++) {
    const path = join(parent, `watched-${index}`);
    git(repo, "worktree", "add", "-b", `watched-${index}`, path);
    paths.push(path);
  }
  const { request, base, headers } = await launch(repo);
  const controllers: AbortController[] = [];
  const readers: ReadableStreamDefaultReader<Uint8Array>[] = [];
  const openEvents = async (path: string) => {
    const controller = new AbortController();
    controllers.push(controller);
    const stream = await fetch(`${base}/api/events?repo=${encodeURIComponent(path)}`, {
      headers,
      signal: controller.signal,
    });
    expect(stream.status).toBe(200);
    // Retain the stream as a browser client would; GC can cancel an unreferenced response.
    const reader = stream.body!.getReader();
    readers.push(reader);
    expect((await reader.read()).done).toBe(false);
  };
  try {
    await openEvents(repo);
    for (const path of paths.slice(1))
      expect(
        (await request("/api/browse/list", { source: { kind: "worktree", repo: path } })).status,
      ).toBe(200);
    expect(stopped.length).toBeGreaterThan(0);
    expect(stopped).not.toContain(repo);
    // Pin the seven most recent sources as well. All eight watchers now have clients.
    for (const path of paths.slice(-7)) await openEvents(path);
    const stopCount = stopped.length;
    expect(
      (await request("/api/browse/list", { source: { kind: "worktree", repo: paths[1] } })).status,
    ).toBe(503);
    expect(stopped).toHaveLength(stopCount);
  } finally {
    for (const controller of controllers) controller.abort();
    await Promise.allSettled(readers.map((reader) => reader.cancel()));
  }
});

test.each(["refresh", "register"])(
  "a deleted registration worktree recovers its family through %s",
  async (recovery) => {
    const started: string[] = [];
    const closed: string[] = [];
    vi.spyOn(ZoektSearchService.prototype, "start").mockImplementation(async function (
      this: ZoektSearchService,
    ) {
      started.push((this as unknown as { repo: string }).repo);
    });
    vi.spyOn(ZoektSearchService.prototype, "close").mockImplementation(async function (
      this: ZoektSearchService,
    ) {
      closed.push((this as unknown as { repo: string }).repo);
    });
    const { repo, linked } = await fixture();
    const { request, catalogue } = await launch(linked);
    const original = (await catalogue())[0]!;
    expect(original.path).toBe(linked);
    expect((await request(`/api/search/status?repo=${encodeURIComponent(linked)}`)).status).toBe(
      200,
    );
    expect(started).toEqual([linked]);
    git(repo, "worktree", "remove", linked);
    const recovered =
      recovery === "register"
        ? await request("/api/repositories", { path: repo })
        : await request("/api/repositories");
    expect(recovered.status).toBe(200);
    const entries = await catalogue();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ id: original.id, path: repo });
    expect(entries[0]!.error).toBeUndefined();
    expect(entries[0]!.worktrees.map((tree) => tree.path)).toEqual([repo]);
    expect(closed).toEqual([linked]);
    expect((await request(`/api/session?repo=${encodeURIComponent(repo)}`)).status).toBe(200);
    expect((await request(`/api/session?repo=${encodeURIComponent(linked)}`)).status).toBe(403);
    expect((await request(`/api/search/status?repo=${encodeURIComponent(repo)}`)).status).toBe(200);
    expect(started).toEqual([linked, repo]);
    const registered = await (await request("/api/repositories", { path: repo })).json();
    expect(registered.repositories).toHaveLength(1);
    expect(registered.repositories[0].id).toBe(original.id);
  },
);
