import { afterEach, expect, test, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { appendFile, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AttemptCompare, AttemptKept, AttemptUndo } from "../../src/shared/attempts";
import type { OwnedState } from "../../src/shared/owned-session";
import type { SavedReview } from "../../src/shared/saved-review";
import type { ThreadList } from "../../src/shared/threads";
import { startHost, type RunningHost } from "../../src/host/server";
import { runReviewCommand } from "../../src/cli/review";

const directories: string[] = [];
const hosts: RunningHost[] = [];
afterEach(async () => {
  await Promise.all(hosts.splice(0).map((host) => host.close()));
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
  vi.unstubAllEnvs();
});

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" },
  }).trim();

/** A repository on main, a host with a fake Claude Code, and its API. */
async function fixture() {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "med attempts ")));
  directories.push(directory);
  const repo = join(directory, "tide");
  await mkdir(repo);
  git(repo, "init", "-q", "-b", "main");
  // Keep saves an attempt's work with the repository's identity.
  git(repo, "config", "user.name", "Test");
  git(repo, "config", "user.email", "test@example.com");
  git(repo, "config", "commit.gpgsign", "false");
  await writeFile(join(repo, "cli.ts"), "export const days = 1;\n");
  await writeFile(join(repo, "format.ts"), "export const unit = 'm';\n");
  git(repo, "add", ".");
  git(repo, "commit", "-q", "-m", "Start");
  const start = git(repo, "rev-parse", "HEAD");
  const home = join(directory, "home");
  await mkdir(home);
  vi.stubEnv("MED_HOME_DIR", home);
  const host = await startHost({
    repo,
    repos: [repo],
    stateDir: join(directory, "state"),
    port: 0,
    agents: async () => [
      {
        id: "claude",
        name: "Claude Code",
        kind: "claude",
        available: true,
        command: process.execPath,
        args: [fileURLToPath(new URL("../fixtures/agents/fake-claude.mjs", import.meta.url))],
      },
    ],
    cli: [process.execPath, "-e", ""],
  });
  hosts.push(host);
  const api = async <T>(path: string, body?: unknown) => {
    const response = await fetch(`http://127.0.0.1:${host.port}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { authorization: `Bearer ${host.token}`, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return {
      status: response.status,
      data: (await response.json()) as T & { error?: { code: string; message: string } },
    };
  };
  /** The thread list as a window's stream first sends it. */
  const threads = async () => {
    const response = await fetch(`http://127.0.0.1:${host.port}/api/threads/events`, {
      headers: { authorization: `Bearer ${host.token}` },
    });
    const reader = response.body!.getReader();
    let text = "";
    while (!text.includes("\n\n")) text += new TextDecoder().decode((await reader.read()).value);
    await reader.cancel();
    return JSON.parse(/^data: (.*)$/m.exec(text)![1]!) as ThreadList;
  };
  const repositoryId = (await api<{ repositories: { id: string }[] }>("/api/repositories")).data
    .repositories[0]!.id;
  return {
    api,
    threads,
    repo,
    start,
    home,
    repositoryId,
    stateDir: join(directory, "state"),
    port: host.port,
  };
}

test("two attempts start in their own worktrees, compare side by side with their checks, and Keep and Undo change them as one", async () => {
  const { api, threads, repo, start, home, repositoryId } = await fixture();
  const prompt = "Show a week of tides in the CLI.";
  const begin = (attempt: number, model: string) =>
    api<{ review: SavedReview }>("/api/threads", {
      repositoryId,
      prompt,
      preset: "claude",
      choices: { model },
      group: { id: "week-view", attempt, label: `Claude Code · ${model}` },
    });

  // Each attempt is a thread with the group, on a branch that ends in its letter.
  const a = (await begin(1, "opus")).data.review;
  const b = (await begin(2, "haiku")).data.review;
  expect(a.group).toEqual({ id: "week-view", attempt: 1, label: "Claude Code · opus" });
  const [treeA, treeB] = [a.targets[0]!.repo, b.targets[0]!.repo];
  expect(git(treeA, "branch", "--show-current")).toBe("show-week-tides-cli-a");
  expect(git(treeB, "branch", "--show-current")).toBe("show-week-tides-cli-b");
  expect(
    (await threads()).threads.map((thread) => [thread.title, thread.group?.attempt]).sort(),
  ).toEqual([
    ["Show a week of tides in the CLI", 1],
    ["Show a week of tides in the CLI", 2],
  ]);
  // An attempt needs its own worktree.
  const refused = await api("/api/threads", {
    repositoryId,
    prompt,
    preset: "claude",
    worktree: false,
    group: { id: "week-view", attempt: 3 },
  });
  expect(refused.status).toBe(400);
  for (const review of [a, b])
    await vi.waitFor(
      async () =>
        expect(
          (await api<OwnedState>(`/api/reviews/${review.id}/owned/${review.sessions![0]!.id}`))
            .data,
        ).toMatchObject({ status: "idle", turns: 1 }),
      { timeout: 5000 },
    );

  // A changes the shared file and adds a module; B changes the same file,
  // commits that, and adds a test.
  await writeFile(join(treeA, "cli.ts"), "export const days = 7;\nexport const week = true;\n");
  await writeFile(join(treeA, "week.ts"), "export function week() {\n  return 7;\n}\n");
  await writeFile(join(treeB, "cli.ts"), "export const days = 7;\n");
  git(treeB, "commit", "-qam", "Seven days");
  await writeFile(join(treeB, "week.test.ts"), "// seven days\n");
  // A's agent ran the tests, and one failed, as its transcript records.
  const transcript = join(home, ".claude", "projects", "-fake-repo", `${a.sessions![0]!.id}.jsonl`);
  const line = (record: object) =>
    JSON.stringify({
      ...record,
      uuid: crypto.randomUUID(),
      sessionId: a.sessions![0]!.id,
      cwd: treeA,
      timestamp: new Date().toISOString(),
    });
  await appendFile(
    transcript,
    [
      line({
        type: "assistant",
        message: {
          id: "msg_test",
          role: "assistant",
          model: "claude-opus-5-5",
          content: [
            { type: "tool_use", id: "toolu_test", name: "Bash", input: { command: "bun test" } },
          ],
        },
      }),
      line({
        type: "user",
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "toolu_test",
              is_error: true,
              content: "Exit code 1\n✗ formats a height\n\n 3 pass\n 1 fail",
            },
          ],
        },
      }),
      line({
        type: "assistant",
        message: {
          id: "msg_done",
          role: "assistant",
          model: "claude-opus-5-5",
          stop_reason: "end_turn",
          content: [{ type: "text", text: "The week view works. One format test fails." }],
        },
      }),
    ].join("\n") + "\n",
  );

  const compare = (await api<AttemptCompare>("/api/attempts?group=week-view")).data;
  expect(compare).toMatchObject({
    group: "week-view",
    title: "Show a week of tides in the CLI",
    base: { sha: start, branch: "main" },
  });
  expect(
    compare.attempts.map((attempt) => ({
      attempt: attempt.attempt,
      agent: attempt.agent,
      model: attempt.model,
      branch: attempt.branch,
      changes: attempt.changes,
      checks: attempt.checks.map(({ command, status, summary }) => ({ command, status, summary })),
      lastMessage: attempt.lastMessage,
    })),
  ).toEqual([
    {
      attempt: 1,
      agent: "Claude",
      model: "Opus 5.5",
      branch: "show-week-tides-cli-a",
      changes: { files: 2, additions: 5, deletions: 1 },
      checks: [{ command: "bun test", status: "failed", summary: "3 pass · 1 fail" }],
      lastMessage: "The week view works. One format test fails.",
    },
    {
      attempt: 2,
      agent: "Claude",
      // Med runs this session: the model is its choice.
      model: "Haiku",
      branch: "show-week-tides-cli-b",
      changes: { files: 2, additions: 2, deletions: 1 },
      checks: [],
      lastMessage: "Model haiku, effort default, mode default: Show a week of tides in the CLI.",
    },
  ]);
  // The shared file first, with each attempt's diff against the shared base:
  // B's commit counts as much as A's uncommitted change. Then each one's own files.
  expect(
    compare.files.map((file) => [
      file.path,
      file.changes.map((change) => change && `${change.status} +${change.additions}`),
    ]),
  ).toEqual([
    ["cli.ts", ["modified +2", "modified +1"]],
    ["week.ts", ["added +3", null]],
    ["week.test.ts", [null, "added +1"]],
  ]);
  expect(compare.files[0]!.changes[0]!.patch).toContain("+export const week = true;");
  expect(compare.files[0]!.changes[1]!.patch).toContain("+export const days = 7;");

  // Keep B: A is archived, and its worktree goes after its work is a commit on its branch.
  const kept = await api<AttemptKept>("/api/attempts/keep", {
    group: "week-view",
    threadId: b.id,
  });
  expect(kept.data).toMatchObject({
    threadId: b.id,
    attempt: 2,
    title: "Show a week of tides in the CLI",
    archived: [{ threadId: a.id, attempt: 1, removed: true, stopped: false }],
    notes: [],
  });
  expect(existsSync(treeA)).toBe(false);
  expect(git(repo, "log", "-1", "--format=%s", "show-week-tides-cli-a")).toBe(
    'Attempt A of "Show a week of tides in the CLI", not kept',
  );
  expect(git(repo, "show", "show-week-tides-cli-a:week.ts")).toContain("return 7;");
  expect((await threads()).threads.map((thread) => thread.id)).toEqual([b.id]);
  const after = (await api<AttemptCompare>("/api/attempts?group=week-view")).data;
  expect(after.attempts.map((attempt) => attempt.threadId)).toEqual([b.id]);
  expect(after.kept).toEqual({ threadId: b.id, attempt: 2 });

  // Undo: A, its worktree, and its changes, uncommitted again.
  const undone = await api<AttemptUndo>("/api/attempts/undo", { group: "week-view" });
  expect(undone.data.restored).toEqual(["A with its worktree"]);
  expect(git(treeA, "diff", "--name-only")).toBe("cli.ts");
  expect(git(treeA, "ls-files", "--others", "--exclude-standard")).toBe("week.ts");
  expect(git(treeA, "rev-parse", "HEAD")).toBe(start);
  expect((await threads()).threads.map((thread) => thread.id).sort()).toEqual([a.id, b.id].sort());
  expect((await api("/api/attempts/undo", { group: "week-view" })).status).toBe(409);
});

test("agents hand off attempts with --group and --attempt; Codex checks come from its rollout, and Keep leaves a worktree that another thread uses", async () => {
  const { api, threads, repo, home, stateDir, port } = await fixture();
  const treeA = join(repo, "..", "trees", "week-a");
  const treeB = join(repo, "..", "trees", "week-b");
  git(repo, "worktree", "add", "-q", "-b", "week-a", treeA, "main");
  git(repo, "worktree", "add", "-q", "-b", "week-b", treeB, "main");
  await writeFile(join(treeA, "cli.ts"), "export const days = 7;\n");
  await writeFile(join(treeB, "cli.ts"), "export const days = 7; // a week\n");

  // B's Codex rollout: its model, and a test run that passed.
  const id = "019a0000-0000-7000-8000-00000000000b";
  const now = new Date();
  const folder = join(
    home,
    ".codex",
    "sessions",
    String(now.getFullYear()),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  );
  await mkdir(folder, { recursive: true });
  const at = (offset: number) => new Date(now.getTime() - 60_000 + offset).toISOString();
  const rollout = [
    { type: "session_meta", payload: { id, cwd: treeB, originator: "codex_cli_rs" } },
    { type: "turn_context", payload: { cwd: treeB, model: "gpt-6-astra" } },
    {
      type: "event_msg",
      payload: { type: "user_message", message: "Show a week of tides.", kind: "plain" },
    },
    {
      type: "response_item",
      payload: {
        type: "function_call",
        name: "shell",
        arguments: JSON.stringify({ command: ["bash", "-lc", "bun test"], workdir: treeB }),
        call_id: "call_test",
      },
    },
    {
      type: "response_item",
      payload: {
        type: "function_call_output",
        call_id: "call_test",
        output: JSON.stringify({
          output: "tests/week.test.ts:\n✓ prints seven days\n\n 5 pass\n 0 fail\n",
          metadata: { exit_code: 0, duration_seconds: 0.4 },
        }),
      },
    },
    {
      type: "response_item",
      payload: {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "Added a week view with tests." }],
      },
    },
  ].map((line, index) => JSON.stringify({ timestamp: at(index * 1000), ...line }));
  await writeFile(
    join(folder, `rollout-${at(0).slice(0, 19).replace(/:/g, "-")}-${id}.jsonl`),
    rollout.join("\n") + "\n",
  );

  const print = () => {};
  const environment = { MED_PORT: String(port), MED_STATE_DIR: stateDir };
  const create = (args: string[]) =>
    runReviewCommand(
      ["create", "--title", "Week view", "--working", "--no-pr", "--group", "week", ...args],
      { environment, home, print },
    );
  await create(["--repo", treeA, "--attempt", "1", "--no-session"]);
  await create(["--repo", treeB, "--attempt", "2", "--session", `codex:${id}`]);
  await expect(create(["--repo", treeA])).rejects.toThrow("Use --group and --attempt together");
  // Another thread works in A's worktree.
  await api("/api/reviews", {
    title: "Tide notes",
    targets: [{ repo: treeA, comparison: { kind: "working" } }],
  });

  const compare = (await api<AttemptCompare>("/api/attempts?group=week")).data;
  expect(compare.attempts.map((attempt) => [attempt.agent, attempt.model, attempt.checks])).toEqual(
    [
      [undefined, undefined, []],
      [
        "Codex",
        "gpt-6-astra",
        [{ command: "bun test", status: "passed", summary: "5 pass", at: expect.any(Number) }],
      ],
    ],
  );
  expect(compare.attempts[1]).toMatchObject({
    lastMessage: "Added a week view with tests.",
    state: "idle",
  });
  expect(compare.files.map((file) => file.path)).toEqual(["cli.ts"]);

  const b = compare.attempts[1]!.threadId;
  const kept = (await api<AttemptKept>("/api/attempts/keep", { group: "week", threadId: b })).data;
  expect(kept.archived).toEqual([
    { threadId: compare.attempts[0]!.threadId, attempt: 1, removed: false, stopped: false },
  ]);
  expect(kept.notes).toEqual([`Med kept A's worktree: "Tide notes" works in it.`]);
  expect(existsSync(join(treeA, "cli.ts"))).toBe(true);
  expect(git(repo, "log", "-1", "--format=%s", "week-a")).toBe("Start");
  expect((await threads()).threads.map((thread) => thread.title).sort()).toEqual([
    "Tide notes",
    "Week view",
  ]);
});
