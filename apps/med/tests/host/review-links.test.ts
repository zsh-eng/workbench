import { afterEach, expect, test } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startHost, type RunningHost } from "../../src/host/server";

const directories: string[] = [];
const hosts: RunningHost[] = [];
afterEach(async () => {
  await Promise.all(hosts.splice(0).map((host) => host.close()));
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});
const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_AUTHOR_NAME: "Test",
      GIT_AUTHOR_EMAIL: "test@example.invalid",
      GIT_COMMITTER_NAME: "Test",
      GIT_COMMITTER_EMAIL: "test@example.invalid",
    },
  }).trim();
async function fixture(names = ["one"]) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "med saved links ")));
  directories.push(directory);
  const repos: string[] = [];
  for (const name of names) {
    const repo = join(directory, name);
    await mkdir(repo);
    git(repo, "init", "-b", "main");
    git(repo, "config", "commit.gpgsign", "false");
    await writeFile(join(repo, "same.ts"), `export const name = "${name} before";\n`);
    git(repo, "add", ".");
    git(repo, "commit", "-m", "baseline");
    await writeFile(join(repo, "same.ts"), `export const name = "${name} after";\n`);
    repos.push(repo);
  }
  const stateDir = join(directory, "state");
  const launch = async () => {
    const host = await startHost({ repo: repos[0]!, repos, stateDir, port: 0 });
    hosts.push(host);
    const origin = `http://127.0.0.1:${host.port}`;
    const api = (path: string, body?: unknown) =>
      fetch(`${origin}${path}`, {
        headers: { authorization: `Bearer ${host.token}`, "content-type": "application/json" },
        method: body === undefined ? "GET" : "POST",
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    return { host, origin, api };
  };
  return { repos, launch, stateDir };
}

test("cookie access rejects cross-origin writes and never exposes the launch token", async () => {
  const { launch } = await fixture();
  const { host, api, origin } = await launch();
  expect((await fetch(`${origin}/api/repositories`)).status).toBe(401);
  const auth = await api("/api/auth", {});
  const cookie = auth.headers.get("set-cookie")!;
  expect(cookie).toContain("HttpOnly");
  expect(cookie).toContain("SameSite=Strict");
  const headers = { cookie: cookie.split(";")[0]! };
  expect((await fetch(`${origin}/api/repositories`, { headers })).status).toBe(200);
  expect(
    (
      await fetch(`${origin}/api/repositories`, {
        method: "POST",
        headers: {
          ...headers,
          origin: "https://untrusted.example",
          "content-type": "application/json",
        },
        body: JSON.stringify({ path: "/" }),
      })
    ).status,
  ).toBe(403);
  expect((await fetch(`${origin}/api/auth`, { method: "POST", headers })).status).toBe(401);
  const deep = await fetch(`${origin}/review/r_example`);
  expect(deep.status).toBe(200);
  expect(deep.headers.get("cache-control") ?? "").not.toContain("immutable");
  expect((await deep.text()).includes(host.token)).toBe(false);
});

test("a link does not register unrelated repository paths", async () => {
  const { launch } = await fixture();
  const { api } = await launch();
  const response = await api("/api/reviews", {
    title: "Unknown",
    targets: [{ repo: "/not-registered", comparison: { kind: "working" } }],
  });
  expect(response.status).toBe(403);
});

test("saved metadata allows recovery while source access waits for repository registration", async () => {
  const { repos, launch } = await fixture();
  const { api, host, origin } = await launch();
  const saved = await (
    await api("/api/reviews", {
      title: "Recover review",
      targets: [{ repo: repos[0], comparison: { kind: "working" } }],
    })
  ).json();
  const target = saved.targets[0];
  const removed = await fetch(`${origin}/api/repositories?id=${target.repositoryId}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${host.token}` },
  });
  expect(removed.status).toBe(200);
  expect((await api(`/api/reviews/${saved.id}`)).status).toBe(200);
  expect((await api(`/api/reviews/${saved.id}/targets/${target.id}/review`)).status).toBe(409);
  expect((await api(`/api/reviews/${saved.id}/clear`, { expectedRevision: 0 })).status).toBe(409);
  expect((await api("/api/repositories", { path: repos[0] })).status).toBe(200);
  expect((await api(`/api/reviews/${saved.id}/targets/${target.id}/review`)).status).toBe(200);
});

test("concurrent comments and clear reject stale requests without losing accepted writes", async () => {
  const { repos, launch } = await fixture();
  const { api } = await launch();
  const saved = await (
    await api("/api/reviews", {
      title: "Concurrent writers",
      targets: [{ repo: repos[0], comparison: { kind: "working" } }],
    })
  ).json();
  const path = `/api/reviews/${saved.id}/targets/${saved.targets[0].id}/notes`;
  const add = (text: string, expectedRevision = 0) =>
    api(path, {
      expectedRevision,
      mutation: { type: "add", note: { path: "same.ts", side: "new", line: 1, text } },
    });
  const competing = await Promise.all([add("First"), add("Second")]);
  expect(competing.map((response) => response.status).sort()).toEqual([200, 409]);
  const accepted = await (await api(path)).json();
  expect(accepted.notes).toHaveLength(1);
  await add("Newer comment", 1);
  expect((await api(`/api/reviews/${saved.id}/clear`, { expectedRevision: 1 })).status).toBe(409);
  expect((await (await api(path)).json()).notes).toHaveLength(2);
  expect((await api(`/api/reviews/${saved.id}/clear`, { expectedRevision: 2 })).status).toBe(200);
  expect((await add("Outdated tab", 2)).status).toBe(409);
  expect((await (await api(path)).json()).notes).toEqual([]);
});

test("captures symbolic inclusive ranges once and writes private saved records", async () => {
  const { repos, launch, stateDir } = await fixture();
  const repo = repos[0]!;
  git(repo, "commit", "-am", "second");
  const { api } = await launch();
  const saved = await (
    await api("/api/reviews", {
      title: "Inclusive range",
      targets: [
        { repo, comparison: { kind: "range", base: "main", head: "main", includeBase: true } },
      ],
    })
  ).json();
  const target = saved.targets[0];
  await writeFile(join(repo, "same.ts"), "later content\n");
  git(repo, "commit", "-am", "third");
  const review = await (await api(`/api/reviews/${saved.id}/targets/${target.id}/review`)).json();
  expect(review.patch).toContain('-export const name = "one before";');
  expect(review.patch).toContain('+export const name = "one after";');
  expect(review.patch).not.toContain("later content");
  expect(review.base).toBe(git(repo, "rev-parse", "HEAD~2"));
  expect(review.head).toBe(git(repo, "rev-parse", "HEAD~1"));
  expect((await stat(join(stateDir, "reviews"))).mode & 0o777).toBe(0o700);
  expect((await stat(join(stateDir, "reviews", `${saved.id}.json`))).mode & 0o777).toBe(0o600);
});

test("browsed comments skip gitlinks, reject invalid first notes atomically, and survive removed worktrees", async () => {
  const { repos, launch } = await fixture();
  const repo = repos[0]!;
  const link = `${repo}-linked`;
  const base = git(repo, "rev-parse", "HEAD");
  git(repo, "worktree", "add", "-b", "linked-topic", link, base);
  await writeFile(join(link, "same.ts"), "export const linked = true;\n");
  git(link, "add", "same.ts");
  git(link, "update-index", "--add", "--cacheinfo", `160000,${base},submodule`);
  git(link, "commit", "-m", "text and gitlink");
  const connection = await launch();
  const saved = await (
    await connection.api("/api/reviews", {
      title: "Edge cases",
      targets: [{ repo, comparison: { kind: "working" } }],
    })
  ).json();
  const review = await (
    await connection.api("/api/review", {
      repo: link,
      comparison: { kind: "commit", commit: git(link, "rev-parse", "HEAD") },
    })
  ).json();
  const path = `/api/reviews/${saved.id}/browsing/${review.id}/notes`;
  const request = (line: number) => ({
    reviewId: review.id,
    expectedRevision: 0,
    mutation: { type: "add", note: { path: "same.ts", side: "new", line, text: "Linked comment" } },
  });
  expect((await connection.api(path, request(9999))).status).toBe(400);
  expect(await (await connection.api(`/api/reviews/${saved.id}`)).json()).toEqual(saved);
  const response = await connection.api(path, request(1));
  expect(response.status).toBe(200);
  git(repo, "worktree", "remove", "--force", link);
  await connection.api("/api/repositories");
  const notes = await connection.api(path);
  expect(notes.status).toBe(200);
  expect((await notes.json()).notes[0].text).toBe("Linked comment");
  expect((await (await connection.api(`/api/reviews/${saved.id}/feedback`)).json()).text).toContain(
    "export const linked = true;",
  );
  expect(
    (await (await connection.api(`/api/reviews/${saved.id}/feedback`)).json()).repositoryCount,
  ).toBe(1);
});

test("reads pull request comments with gh, read-only, as threads, conversation, and reviews", async () => {
  const { repos, launch, stateDir } = await fixture();
  const bin = join(stateDir, "..", "bin");
  await mkdir(bin, { recursive: true });
  const log = join(bin, "calls.jsonl");
  const line = (value: unknown) => JSON.stringify(value);
  const replies: Record<string, string[]> = {
    "pulls/7/comments": [
      line({
        id: 1,
        author: "ada",
        body: "Rename this.",
        createdAt: "2026-10-01T10:00:00Z",
        url: "https://github.com/acme/med/pull/7#discussion_r1",
        reply: null,
        path: "same.ts",
        line: 1,
        startLine: null,
        originalLine: 1,
        side: "RIGHT",
      }),
      line({
        id: 2,
        author: "sam",
        body: "Done.",
        createdAt: "2026-10-01T11:00:00Z",
        url: "https://github.com/acme/med/pull/7#discussion_r2",
        reply: 1,
        path: "same.ts",
        line: 1,
        startLine: null,
        originalLine: 1,
        side: "RIGHT",
      }),
      line({
        id: 3,
        author: "ada",
        body: "Old line.",
        createdAt: "2026-09-30T10:00:00Z",
        url: "https://github.com/acme/med/pull/7#discussion_r3",
        reply: null,
        path: "same.ts",
        line: null,
        startLine: null,
        originalLine: 4,
        side: "LEFT",
      }),
    ],
    "issues/7/comments": [
      line({
        id: 10,
        author: "lin",
        body: "Looks good overall.",
        createdAt: "2026-10-02T09:00:00Z",
        url: "https://github.com/acme/med/pull/7#issuecomment-10",
      }),
    ],
    "pulls/7/reviews": [
      line({
        id: 20,
        author: "ada",
        body: "",
        createdAt: "2026-10-02T12:00:00Z",
        url: "https://github.com/acme/med/pull/7#pullrequestreview-20",
        state: "APPROVED",
      }),
    ],
  };
  // A stand-in for gh: it records its arguments and answers each API path.
  await writeFile(
    join(bin, "gh"),
    `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(args) + "\\n");
const path = args.find((arg) => arg.startsWith("repos/acme/med/")).replace("repos/acme/med/", "").split("?")[0];
const replies = ${JSON.stringify(replies)};
process.stdout.write(path === "pulls/7" ? "abc123\\n" : (replies[path] ?? []).join("\\n") + "\\n");
`,
    { mode: 0o755 },
  );
  const path = process.env.PATH;
  process.env.PATH = `${bin}:${path}`;
  try {
    const { api } = await launch();
    const saved = await (
      await api("/api/reviews", {
        title: "Pull request",
        pullRequestUrl: "https://github.com/acme/med/pull/7",
        targets: [{ repo: repos[0], comparison: { kind: "working" } }],
      })
    ).json();
    const comments = await (await api(`/api/reviews/${saved.id}/pull-request`)).json();
    expect(comments).toMatchObject({
      url: "https://github.com/acme/med/pull/7",
      head: "abc123",
      threads: [
        {
          id: 1,
          path: "same.ts",
          side: "new",
          line: 1,
          comments: [
            { author: "ada", body: "Rename this." },
            { author: "sam", body: "Done." },
          ],
        },
        { id: 3, side: "old", line: null, originalLine: 4 },
      ],
      conversation: [{ author: "lin", body: "Looks good overall." }],
      reviews: [{ author: "ada", state: "APPROVED", body: "" }],
    });
    // Every call is a GET through gh api; nothing writes to GitHub.
    const calls = (await readFile(log, "utf8"))
      .trim()
      .split("\n")
      .map((entry) => JSON.parse(entry));
    expect(calls).toHaveLength(4);
    for (const call of calls) {
      expect(call.slice(0, 3)).toEqual(["api", "--hostname", "github.com"]);
      expect(call).not.toContain("--method");
      expect(call).not.toContain("-X");
      expect(call.some((arg: string) => /^-(f|F)$|^--(field|raw-field|input)$/.test(arg))).toBe(
        false,
      );
    }
  } finally {
    process.env.PATH = path;
  }
});
