import { afterEach, expect, test, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Comparison, ReviewResponse } from "../../src/shared/protocol";
import type { SavedReview } from "../../src/shared/saved-review";
import type { ThreadList } from "../../src/shared/threads";
import { startHost, type RunningHost } from "../../src/host/server";
import { claudeProjectFolder } from "../../src/host/found-sessions";
import { readServerEvents } from "../../src/web/data/sse";

// A thread's live Changes through the production host: the branch's changes,
// and in a checkout that sessions share, only one session's files, from its
// Claude Code or Codex transcript. Keep in Med and adopt capture nothing.

const directories: string[] = [];
const hosts: RunningHost[] = [];
const streams: AbortController[] = [];
afterEach(async () => {
  for (const stream of streams.splice(0)) stream.abort();
  await Promise.all(hosts.splice(0).map((host) => host.close()));
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
  vi.unstubAllEnvs();
});

const git = (cwd: string, args: string[]) =>
  execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_AUTHOR_NAME: "Med",
      GIT_AUTHOR_EMAIL: "med@example.invalid",
      GIT_COMMITTER_NAME: "Med",
      GIT_COMMITTER_EMAIL: "med@example.invalid",
    },
  }).trim();
const lines = (records: unknown[]) =>
  records.map((entry) => JSON.stringify(entry)).join("\n") + "\n";
const now = () => new Date().toISOString();
const ids = {
  mainClaude: "11111111-1111-4111-8111-111111111111",
  mainCodex: "22222222-2222-4222-8222-222222222222",
  branch: "33333333-3333-4333-8333-333333333333",
  old: "44444444-4444-4444-8444-444444444444",
};

/** A Claude Code session that edits files with Edit, Write, and MultiEdit,
 * and a subagent that edits one more. */
async function claude(home: string, cwd: string, id: string, edits: string[], sub: string[] = []) {
  const folder = join(home, ".claude", "projects", claudeProjectFolder(cwd));
  await mkdir(join(folder, id, "subagents"), { recursive: true });
  const base = { cwd, sessionId: id, timestamp: now() };
  const tools = ["Edit", "Write", "MultiEdit"];
  const call = (path: string, index: number) => ({
    ...base,
    type: "assistant",
    uuid: `${id}-${index}`,
    message: {
      role: "assistant",
      content: [
        { type: "tool_use", id: `t${index}`, name: "Read", input: { file_path: join(cwd, "x") } },
        {
          type: "tool_use",
          id: `e${index}`,
          name: tools[index % tools.length],
          input: { file_path: join(cwd, path) },
        },
      ],
    },
  });
  const path = join(folder, `${id}.jsonl`);
  await writeFile(
    path,
    lines([
      { ...base, type: "user", uuid: `${id}-u`, message: { role: "user", content: "Edit." } },
      ...edits.map(call),
      {
        ...base,
        type: "assistant",
        uuid: `${id}-end`,
        message: {
          role: "assistant",
          stop_reason: "end_turn",
          content: [{ type: "text", text: "Done." }],
        },
      },
    ]),
  );
  if (sub.length)
    await writeFile(join(folder, id, "subagents", "agent-a1.jsonl"), lines(sub.map(call)));
  return path;
}

/** A Codex rollout whose patches go through apply_patch, a shell heredoc,
 * and an exec program, with paths relative to the turn's directory. */
async function codex(home: string, cwd: string, id: string) {
  const day = new Date();
  const folder = join(
    home,
    ".codex",
    "sessions",
    String(day.getFullYear()),
    String(day.getMonth() + 1).padStart(2, "0"),
    String(day.getDate()).padStart(2, "0"),
  );
  await mkdir(folder, { recursive: true });
  const patch = (path: string) =>
    `*** Begin Patch\n*** Update File: ${path}\n@@\n-old\n+new\n*** End Patch\n`;
  const item = (payload: unknown) => ({ timestamp: now(), type: "response_item", payload });
  await writeFile(
    join(folder, `rollout-2026-10-15T09-00-00-${id}.jsonl`),
    lines([
      {
        timestamp: now(),
        type: "session_meta",
        // Codex's instructions mention patches too; they are not edits.
        payload: { id, cwd, base_instructions: { text: patch("not-an-edit.ts") } },
      },
      { timestamp: now(), type: "turn_context", payload: { cwd } },
      item({ type: "message", role: "user", content: [{ type: "input_text", text: "Edit b." }] }),
      item({ type: "custom_tool_call", call_id: "c1", name: "apply_patch", input: patch("b.ts") }),
      item({
        type: "function_call",
        call_id: "c2",
        name: "shell",
        arguments: JSON.stringify({
          command: ["bash", "-lc", `apply_patch <<'EOF'\n${patch("src/c.ts")}EOF`],
          workdir: cwd,
        }),
      }),
      item({
        type: "function_call",
        call_id: "c3",
        name: "exec",
        arguments: JSON.stringify({
          input: `await tools.apply_patch(${JSON.stringify(patch(join(cwd, "d.ts")))});`,
        }),
      }),
      { timestamp: now(), type: "event_msg", payload: { type: "task_complete" } },
    ]),
  );
}

async function fixture() {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "med thread changes ")));
  directories.push(directory);
  const repo = join(directory, "tide");
  await mkdir(join(repo, "src"), { recursive: true });
  git(repo, ["init", "-q", "-b", "main"]);
  for (const name of ["a.ts", "b.ts", "src/c.ts", "d.ts", "e.ts", "other.ts"])
    await writeFile(join(repo, name), "old\n");
  git(repo, ["add", "."]);
  git(repo, ["commit", "-q", "-m", "Start"]);
  const feature = join(directory, "tide.worktrees", "feature");
  git(repo, ["worktree", "add", "-q", "-b", "feature", feature]);
  const home = join(directory, "home");
  vi.stubEnv("MED_HOME_DIR", home);
  const host = await startHost({
    repo,
    repos: [repo],
    stateDir: join(directory, "state"),
    port: 0,
  });
  hosts.push(host);
  const api = async <T>(path: string, body?: unknown) => {
    const response = await fetch(`http://127.0.0.1:${host.port}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { authorization: `Bearer ${host.token}`, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, data: (await response.json()) as T };
  };
  const changes = async (repoPath: string, comparison: Comparison) => {
    const response = await api<ReviewResponse>("/api/review", { repo: repoPath, comparison });
    expect(response.status).toBe(200);
    expect(response.data.comparison).toEqual(comparison);
    return response.data.files.map((file) => file.path).sort();
  };
  const list = async () => {
    const response = await fetch(`http://127.0.0.1:${host.port}/api/threads/events`, {
      headers: { authorization: `Bearer ${host.token}` },
    });
    const latest: { value: ThreadList | null } = { value: null };
    const controller = new AbortController();
    streams.push(controller);
    void readServerEvents(
      response.body!,
      (event) => (latest.value = JSON.parse(event.data) as ThreadList),
      controller.signal,
    ).catch(() => {});
    await vi.waitFor(() => expect(latest.value).not.toBeNull());
    return latest;
  };
  return { api, changes, list, repo, feature, home };
}

test("Changes show a branch's changes, and in a shared checkout only one session's files", async () => {
  const { api, changes, list, repo, feature, home } = await fixture();
  // Two sessions and the user change the main checkout.
  for (const name of ["a.ts", "b.ts", "src/c.ts", "d.ts", "e.ts", "other.ts"])
    await writeFile(join(repo, name), "new\n");
  await claude(home, repo, ids.mainClaude, ["a.ts", "e.ts", "gone.ts"], ["sub.ts"]);
  await writeFile(join(repo, "sub.ts"), "from the subagent\n");
  await codex(home, repo, ids.mainCodex);
  // A branch worktree: one commit and one uncommitted change.
  await writeFile(join(feature, "a.ts"), "feature\n");
  git(feature, ["commit", "-q", "-am", "Feature"]);
  await writeFile(join(feature, "b.ts"), "uncommitted\n");
  await claude(home, feature, ids.branch, ["a.ts", "b.ts"]);

  // Working: the checkout's uncommitted changes. Branch: since it left main.
  expect(await changes(feature, { kind: "working" })).toEqual(["b.ts"]);
  expect(await changes(feature, { kind: "working", base: "main" })).toEqual(["a.ts", "b.ts"]);
  // Branch names its HEAD commit and the files whose lines differ from it,
  // which keep a pull request's threads off their lines (data/pull-request.ts).
  const branchChanges = () =>
    api<ReviewResponse>("/api/review", {
      repo: feature,
      comparison: { kind: "working", base: "main" },
    });
  expect((await branchChanges()).data).toMatchObject({
    headCommit: git(feature, ["rev-parse", "HEAD"]),
    uncommitted: ["b.ts"],
  });
  expect(await changes(repo, { kind: "working" })).toEqual([
    "a.ts",
    "b.ts",
    "d.ts",
    "e.ts",
    "other.ts",
    "src/c.ts",
    "sub.ts",
  ]);
  // Only this session's files: Claude Code's Edit, Write, and MultiEdit, and
  // its subagent's; a file that has no change does not show.
  expect(
    await changes(repo, { kind: "working", session: { agent: "claude", id: ids.mainClaude } }),
  ).toEqual(["a.ts", "e.ts", "sub.ts"]);
  // Codex's apply_patch, also through a shell and an exec program.
  expect(
    await changes(repo, { kind: "working", session: { agent: "codex", id: ids.mainCodex } }),
  ).toEqual(["b.ts", "d.ts", "src/c.ts"]);
  // The filter goes with any comparison, and with paths it keeps both.
  expect(
    await changes(repo, {
      kind: "unstaged",
      paths: ["a.ts", "b.ts"],
      session: { agent: "claude", id: ids.mainClaude },
    }),
  ).toEqual(["a.ts"]);
  // An empty list keeps no file; an unknown session edited none.
  expect(await changes(repo, { kind: "working", paths: [] })).toEqual([]);
  expect(
    await changes(repo, {
      kind: "working",
      session: { agent: "claude", id: "99999999-9999-4999-8999-999999999999" },
    }),
  ).toEqual([]);
  // A saved review keeps paths, never a session.
  expect(
    (
      await api("/api/reviews", {
        title: "No",
        targets: [
          {
            repo,
            comparison: { kind: "working", session: { agent: "claude", id: ids.mainClaude } },
          },
        ],
      })
    ).status,
  ).toBe(400);

  // The tabs: sessions in the main checkout share it; the branch's session
  // counts its branch's changes. An idle found session is a tab once opened.
  for (const id of [
    `found-claude-${ids.mainClaude}`,
    `found-codex-${ids.mainCodex}`,
    `found-claude-${ids.branch}`,
  ])
    expect((await api(`/api/threads/${id}/open`, {})).status).toBe(200);
  const latest = await list();
  await vi.waitFor(
    () => {
      const threads = latest.value!.threads;
      expect(
        threads.find((thread) => thread.id === `found-claude-${ids.mainClaude}`),
      ).toMatchObject({ shared: true });
      expect(threads.find((thread) => thread.id === `found-codex-${ids.mainCodex}`)).toMatchObject({
        shared: true,
      });
      const branch = threads.find((thread) => thread.id === `found-claude-${ids.branch}`);
      expect(branch?.shared).toBeUndefined();
      expect(branch?.changes).toEqual({ files: 2, additions: 2, deletions: 2 });
    },
    { timeout: 10_000 },
  );
  // A new file differs from HEAD too; a committed one does not.
  await writeFile(join(feature, "new.ts"), "new\n");
  const some = await api<ReviewResponse>("/api/review", {
    repo: feature,
    comparison: { kind: "working", base: "main", paths: ["a.ts", "b.ts", "new.ts"] },
  });
  expect(some.data.files.map((file) => file.path).sort()).toEqual(["a.ts", "b.ts", "new.ts"]);
  expect(some.data.uncommitted?.sort()).toEqual(["b.ts", "new.ts"]);
});

test("Keep in Med and adopt capture nothing, also for an inactive session; the row counts live Changes", async () => {
  const { api, list, feature, home } = await fixture();
  await writeFile(join(feature, "a.ts"), "feature\n");
  git(feature, ["commit", "-q", "-am", "Feature"]);
  await writeFile(join(feature, "b.ts"), "uncommitted\n");
  // An inactive session: idle, and older than the found window.
  const path = await claude(home, feature, ids.old, ["a.ts"]);
  const old = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  await utimes(path, old, old);

  const adopted = await api<{ id: string; created: boolean }>("/api/sessions/adopt", {
    session: ids.old,
  });
  expect(adopted.status).toBe(200);
  const saved = (await api<SavedReview>(`/api/reviews/${adopted.data.id}`)).data;
  expect(saved).toMatchObject({
    targets: [],
    checkout: { repo: feature, branch: "feature" },
    sessions: [{ agent: "claude", id: ids.old }],
  });
  expect(saved.iterations).toBeUndefined();
  // Before a hand-off, the row counts the branch's live Changes.
  const latest = await list();
  await vi.waitFor(
    () =>
      expect(latest.value!.threads.find((thread) => thread.id === adopted.data.id)).toMatchObject({
        checkout: feature,
        branch: "feature",
        linked: true,
        changes: { files: 2, additions: 2, deletions: 2 },
      }),
    { timeout: 10_000 },
  );

  // The agent's first hand-off is version 1; the next is version 2.
  const first = await api<SavedReview>(`/api/reviews/${adopted.data.id}/versions`, {
    targets: [{ repo: feature, comparison: { kind: "working", paths: ["b.ts"] } }],
  });
  expect(first.status).toBe(200);
  expect(first.data.iterations?.map((entry) => entry.number)).toEqual([1]);
  expect(first.data.totals).toMatchObject({ files: 1 });
  const second = await api<SavedReview>(`/api/reviews/${adopted.data.id}/versions`, {
    targets: [{ repo: feature, comparison: { kind: "range", base: "main", head: "HEAD" } }],
  });
  expect(second.data.iterations?.map((entry) => entry.number)).toEqual([1, 2]);
  // A version needs a comparison.
  expect((await api(`/api/reviews/${adopted.data.id}/versions`, { targets: [] })).status).toBe(400);
});
