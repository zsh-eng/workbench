import { afterEach, expect, test, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SessionEvent } from "../../src/shared/agent-session";
import type { SavedReview } from "../../src/shared/saved-review";
import type { ThreadList } from "../../src/shared/threads";
import { startHost, type RunningHost } from "../../src/host/server";
import { claudeProjectFolder } from "../../src/host/found-sessions";
import { readServerEvents } from "../../src/web/data/sse";

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
      GIT_AUTHOR_NAME: "Med",
      GIT_AUTHOR_EMAIL: "med@example.invalid",
      GIT_COMMITTER_NAME: "Med",
      GIT_COMMITTER_EMAIL: "med@example.invalid",
    },
  }).trim();

const lines = (records: unknown[]) =>
  records.map((entry) => JSON.stringify(entry)).join("\n") + "\n";
const time = (ago: number) => new Date(Date.now() - ago).toISOString();

/** A Claude Code transcript: an optional title, a prompt, and either a reply
 * that ends the turn or a tool call that still runs. */
async function claude(
  home: string,
  cwd: string,
  id: string,
  { prompt, title, working = false }: { prompt: string; title?: string; working?: boolean },
) {
  const folder = join(home, ".claude", "projects", claudeProjectFolder(cwd));
  await mkdir(folder, { recursive: true });
  const path = join(folder, `${id}.jsonl`);
  const base = { cwd, sessionId: id, gitBranch: "main", isSidechain: false };
  await writeFile(
    path,
    lines([
      ...(title ? [{ type: "custom-title", customTitle: title, sessionId: id }] : []),
      {
        ...base,
        type: "user",
        uuid: `${id}-u`,
        timestamp: time(60_000),
        message: { role: "user", content: prompt },
      },
      working
        ? {
            ...base,
            type: "assistant",
            uuid: `${id}-a`,
            timestamp: time(30_000),
            message: {
              role: "assistant",
              stop_reason: "tool_use",
              content: [{ type: "tool_use", id: "t1", name: "Read", input: { file_path: "a" } }],
            },
          }
        : {
            ...base,
            type: "assistant",
            uuid: `${id}-a`,
            timestamp: time(30_000),
            message: {
              role: "assistant",
              stop_reason: "end_turn",
              content: [{ type: "text", text: "Done." }],
            },
          },
    ]),
  );
  return path;
}

/** A Codex rollout in today's day folder, with its turn complete. */
async function codex(home: string, cwd: string, id: string, prompt: string) {
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
  await writeFile(
    join(folder, `rollout-2026-10-15T09-00-00-${id}.jsonl`),
    lines([
      {
        timestamp: time(120_000),
        type: "session_meta",
        payload: { id, cwd, originator: "codex_cli_rs", timestamp: time(120_000) },
      },
      {
        timestamp: time(110_000),
        type: "response_item",
        payload: { type: "message", role: "user", content: [{ type: "input_text", text: prompt }] },
      },
      {
        timestamp: time(100_000),
        type: "response_item",
        payload: {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "Added." }],
        },
      },
      { timestamp: time(100_000), type: "event_msg", payload: { type: "task_complete" } },
    ]),
  );
}

async function fixture() {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "med found ")));
  directories.push(directory);
  const repo = join(directory, "tide");
  await mkdir(repo);
  git(repo, ["init", "-q", "-b", "main"]);
  await writeFile(join(repo, "README.md"), "# tide\n");
  git(repo, ["add", "."]);
  git(repo, ["commit", "-q", "-m", "Start"]);
  const glossary = join(directory, "tide.worktrees", "glossary");
  git(repo, ["worktree", "add", "-q", "-b", "glossary", glossary]);
  const home = join(directory, "home");
  await mkdir(home);
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
  /** The thread list as a window's stream sends it, latest first. */
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
  return { api, list, host, repo, glossary, home, directory };
}

const foundIn = (list: ThreadList | null) =>
  (list?.threads ?? []).filter((thread) => thread.found).map((thread) => thread.title);

test("the thread list finds Claude Code and Codex sessions in the registered checkouts", async () => {
  const { api, list, host, repo, glossary, home, directory } = await fixture();
  const glossaryId = "11111111-1111-4111-8111-111111111111";
  const transcript = await claude(home, glossary, glossaryId, {
    prompt: "Add a short glossary to the README.",
    title: "README glossary",
    working: true,
  });
  // A session in a folder inside the main checkout is the checkout's.
  await mkdir(join(repo, "docs"));
  await claude(home, join(repo, "docs"), "22222222-2222-4222-8222-222222222222", {
    prompt: "Explain the prediction model in the README, briefly, with a warning about it.",
  });
  await codex(
    home,
    glossary,
    "33333333-3333-4333-8333-333333333333",
    "Readers in the US want heights in feet.",
  );
  // A session in a worktree that Med does not know yet, inside the main
  // checkout, is not the main checkout's: it waits for its own.
  const side = join(repo, ".claude", "worktrees", "side");
  git(repo, ["worktree", "add", "-q", "-b", "side", side]);
  await claude(home, side, "abababab-abab-4bab-8bab-abababababab", {
    prompt: "Work in a new worktree.",
  });
  // Not listed: a folder outside the repositories, a session older than a
  // week, a session without a prompt, and one that a saved review names.
  await mkdir(join(directory, "elsewhere"));
  await claude(home, join(directory, "elsewhere"), "44444444-4444-4444-8444-444444444444", {
    prompt: "Not in a registered repository.",
  });
  const old = await claude(home, repo, "55555555-5555-4555-8555-555555555555", {
    prompt: "An old task.",
  });
  const week = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
  await utimes(old, week, week);
  const empty = join(home, ".claude", "projects", claudeProjectFolder(repo));
  await writeFile(
    join(empty, "66666666-6666-4666-8666-666666666666.jsonl"),
    lines([{ type: "file-history-snapshot", messageId: "m", snapshot: {} }]),
  );
  const kept = "77777777-7777-4777-8777-777777777777";
  await claude(home, glossary, kept, { prompt: "Handed off with med review create." });
  await api("/api/reviews", {
    title: "Handed off",
    targets: [{ repo: glossary, comparison: { kind: "working" } }],
    sessions: [{ agent: "claude", id: kept, cwd: glossary }],
  });

  const latest = await list();
  await vi.waitFor(
    () =>
      expect(foundIn(latest.value)).toEqual(
        expect.arrayContaining([
          "README glossary",
          "Explain the prediction model in the README",
          "Readers in the US want heights in feet",
        ]),
      ),
    { timeout: 10_000 },
  );
  const threads = latest.value!.threads;
  const byTitle = (title: string) => threads.find((thread) => thread.title === title);
  // Titles: Claude's custom title, else the first prompt as a thread name.
  expect(byTitle("README glossary")).toMatchObject({
    id: `found-claude-${glossaryId}`,
    found: true,
    agent: "claude",
    state: "working",
    checkout: glossary,
    branch: "glossary",
    linked: true,
    repository: { name: "tide", path: repo },
    sessions: [{ agent: "claude", id: glossaryId, cwd: glossary }],
  });
  expect(byTitle("Explain the prediction model in the README")).toMatchObject({
    agent: "claude",
    state: "idle",
    checkout: repo,
    branch: "main",
    sessions: [{ cwd: join(repo, "docs") }],
  });
  expect(byTitle("Readers in the US want heights in feet")).toMatchObject({
    id: "found-codex-33333333-3333-4333-8333-333333333333",
    agent: "codex",
    state: "idle",
    checkout: glossary,
  });
  // Until the registry reads the new worktree, its session is not listed.
  expect(byTitle("Work in a new worktree")?.checkout ?? side).toBe(side);
  // The saved review keeps its session; it is not listed twice.
  expect(threads.filter((thread) => thread.title === "Handed off")).toHaveLength(1);
  expect(latest.value!.found).toEqual({ shown: true });

  // The checkout's working changes count, and follow the agent's edits,
  // which change its transcript too.
  await writeFile(join(glossary, "README.md"), "# tide\n\n## Glossary\n\nRange.\n");
  await writeFile(join(glossary, "terms.md"), "a\nb\n");
  const edited = new Date();
  await utimes(transcript, edited, edited);
  await vi.waitFor(
    () =>
      expect(
        latest.value!.threads.find((thread) => thread.title === "README glossary")?.changes,
      ).toEqual({ files: 2, additions: 6, deletions: 0 }),
    { timeout: 10_000 },
  );

  // The session pane reads a found thread's session as a saved review's.
  const response = await fetch(
    `http://127.0.0.1:${host.port}/api/reviews/found-claude-${glossaryId}/sessions/${glossaryId}/events`,
    { headers: { authorization: `Bearer ${host.token}` } },
  );
  expect(response.status).toBe(200);
  const reset = await new Promise<{ events: SessionEvent[] }>((resolve) => {
    const controller = new AbortController();
    streams.push(controller);
    void readServerEvents(
      response.body!,
      (event) => {
        if (event.event === "reset") resolve(JSON.parse(event.data));
      },
      controller.signal,
    ).catch(() => {});
  });
  expect(
    reset.events.some(
      (event) =>
        event.update.sessionUpdate === "user_message_chunk" &&
        event.update.content.type === "text" &&
        event.update.content.text === "Add a short glossary to the README.",
    ),
  ).toBe(true);
  // A session outside the registered repositories has no route.
  expect(
    (
      await api(
        "/api/reviews/found-claude-44444444-4444-4444-8444-444444444444/sessions/44444444-4444-4444-8444-444444444444/turns",
      )
    ).status,
  ).toBe(404);
});

test("found sessions hide one by one or all at once, and Keep in Med saves one as a thread", async () => {
  const { api, list, glossary, home, directory } = await fixture();
  const id = "88888888-8888-4888-8888-888888888888";
  await claude(home, glossary, id, { prompt: "Add a glossary.", title: "README glossary" });
  await codex(home, glossary, "99999999-9999-4999-8999-999999999999", "Add feet.");
  const latest = await list();
  await vi.waitFor(
    () => expect(foundIn(latest.value).sort()).toEqual(["Add feet", "README glossary"]),
    {
      timeout: 10_000,
    },
  );

  // Hide keeps the choice in the state directory, across a restart.
  expect(
    (await api("/api/found", { hide: { id: `found-claude-${id}`, hidden: true } })).status,
  ).toBe(200);
  await vi.waitFor(() => expect(foundIn(latest.value)).toEqual(["Add feet"]), { timeout: 5000 });
  await api("/api/found", { hide: { id: `found-claude-${id}`, hidden: false } });
  await vi.waitFor(() => expect(foundIn(latest.value)).toHaveLength(2), { timeout: 5000 });
  await api("/api/found", { shown: false });
  await vi.waitFor(() => expect(latest.value!.found).toEqual({ shown: false }), { timeout: 5000 });
  expect(foundIn(latest.value)).toEqual([]);
  await hosts.splice(0)[0]!.close();
  const again = await startHost({
    repo: join(directory, "tide"),
    repos: [join(directory, "tide")],
    stateDir: join(directory, "state"),
    port: 0,
  });
  hosts.push(again);
  const call = async <T>(path: string, body?: unknown) => {
    const response = await fetch(`http://127.0.0.1:${again.port}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { authorization: `Bearer ${again.token}`, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, data: (await response.json()) as T };
  };
  const events = await fetch(`http://127.0.0.1:${again.port}/api/threads/events`, {
    headers: { authorization: `Bearer ${again.token}` },
  });
  const restarted: { value: ThreadList | null } = { value: null };
  const controller = new AbortController();
  streams.push(controller);
  void readServerEvents(
    events.body!,
    (event) => (restarted.value = JSON.parse(event.data) as ThreadList),
    controller.signal,
  ).catch(() => {});
  await vi.waitFor(() => expect(restarted.value?.found).toEqual({ shown: false }));
  await call("/api/found", { shown: true });
  await vi.waitFor(() => expect(foundIn(restarted.value)).toHaveLength(2), { timeout: 10_000 });

  // Keep in Med: a saved thread on the checkout's working changes, with the
  // session linked, takes the found thread's place.
  const saved = await call<SavedReview>("/api/reviews", {
    title: "README glossary",
    targets: [{ repo: glossary, comparison: { kind: "working" } }],
    sessions: [{ agent: "claude", id, cwd: glossary }],
  });
  expect(saved.status).toBe(200);
  await vi.waitFor(() => expect(foundIn(restarted.value)).toEqual(["Add feet"]), { timeout: 5000 });
  expect(restarted.value!.threads.find((thread) => thread.id === saved.data.id)).toMatchObject({
    title: "README glossary",
    sessions: [{ agent: "claude", id }],
  });
});
