import { afterEach, expect, test, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, realpath, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { SessionEvent } from "../../src/shared/agent-session";
import type { SavedReview } from "../../src/shared/saved-review";
import type { Thread, ThreadList } from "../../src/shared/threads";
import { startHost, type RunningHost } from "../../src/host/server";
import { claudeProjectFolder } from "../../src/host/found-sessions";
import { readServerEvents } from "../../src/web/data/sse";
import { removeFolder } from "./remove-folder";

const directories: string[] = [];
const hosts: RunningHost[] = [];
const streams: AbortController[] = [];
afterEach(async () => {
  for (const stream of streams.splice(0)) stream.abort();
  await Promise.all(hosts.splice(0).map((host) => host.close()));
  await Promise.all(directories.splice(0).map((path) => removeFolder(path)));
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

/** A Codex rollout in the day folder of `day` (today by default), with its
 * turn complete. */
async function codex(home: string, cwd: string, id: string, prompt: string, day = new Date()) {
  const folder = join(
    home,
    ".codex",
    "sessions",
    String(day.getFullYear()),
    String(day.getMonth() + 1).padStart(2, "0"),
    String(day.getDate()).padStart(2, "0"),
  );
  await mkdir(folder, { recursive: true });
  const path = join(folder, `rollout-2026-10-15T09-00-00-${id}.jsonl`);
  await writeFile(
    path,
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
  return path;
}

/** Sets a file's modification time to `ago` milliseconds before now. */
const age = (path: string, ago: number) =>
  utimes(path, new Date(Date.now() - ago), new Date(Date.now() - ago));
const DAY = 24 * 60 * 60 * 1000;

async function fixture(agents?: Parameters<typeof startHost>[0]["agents"]) {
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
    ...(agents && { agents }),
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
  const list = async () => {
    const latest = follow(host);
    await vi.waitFor(() => expect(latest.value).not.toBeNull());
    return latest;
  };
  return { api, list, host, repo, glossary, home, directory };
}

/**
 * Every thread that Med finds: the tabs as a window's stream sends them, and
 * history, which a window reads when it searches. A found session that does
 * not work is history until the reader opens it.
 */
function follow(host: RunningHost) {
  const headers = { authorization: `Bearer ${host.token}` };
  const controller = new AbortController();
  streams.push(controller);
  let tabs: ThreadList | null = null;
  let history: Thread[] = [];
  void (async () => {
    const response = await fetch(`http://127.0.0.1:${host.port}/api/threads/events`, {
      headers,
      signal: controller.signal,
    });
    await readServerEvents(
      response.body!,
      (event) => (tabs = JSON.parse(event.data) as ThreadList),
      controller.signal,
    );
  })().catch(() => {});
  void (async () => {
    while (!controller.signal.aborted) {
      const response = await fetch(`http://127.0.0.1:${host.port}/api/threads/history`, {
        headers,
        signal: controller.signal,
      });
      if (response.ok) history = ((await response.json()) as { threads: Thread[] }).threads;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  })().catch(() => {});
  return {
    get value(): ThreadList | null {
      if (!tabs) return null;
      const open = new Set(tabs.threads.map((thread) => thread.id));
      return {
        ...tabs,
        threads: [...tabs.threads, ...history.filter((thread) => !open.has(thread.id))],
      };
    },
    /** The tabs alone. */
    get tabs() {
      return tabs;
    },
  };
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
  // A session that works opens as a tab, once; the others are history.
  await vi.waitFor(
    () =>
      expect(
        latest.tabs!.threads.filter((thread) => thread.found).map((thread) => thread.title),
      ).toEqual(["README glossary"]),
    { timeout: 5000 },
  );
  expect(byTitle("Explain the prediction model in the README")?.open).toBe(false);

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

  // A found tab that the reader closes stays in history while its agent works.
  const id = `found-claude-${glossaryId}`;
  expect(await api(`/api/threads/${id}/close`, {})).toEqual({
    status: 200,
    data: { closed: true },
  });
  await utimes(transcript, new Date(), new Date());
  await new Promise((resolve) => setTimeout(resolve, 3500));
  expect(latest.tabs!.threads.some((thread) => thread.id === id)).toBe(false);
  expect(latest.value!.threads.find((thread) => thread.id === id)).toMatchObject({
    state: "working",
    open: false,
    closedAt: expect.any(Number),
  });
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
  const restarted = follow(again);
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
  // The tabs come as a stream and the history from a poll, in either order.
  await vi.waitFor(
    () => {
      expect(foundIn(restarted.value)).toEqual(["Add feet"]);
      expect(restarted.value!.threads.find((thread) => thread.id === saved.data.id)).toMatchObject({
        title: "README glossary",
        sessions: [{ agent: "claude", id }],
      });
    },
    { timeout: 5000 },
  );
});

test("one window of 7 days lists Claude Code and Codex sessions by the time their transcripts changed", async () => {
  const { list, repo, home } = await fixture();
  const claudeIn = (id: string, prompt: string) => claude(home, repo, id, { prompt });
  const codexIn = (id: string, prompt: string, started: number) =>
    codex(home, repo, id, prompt, new Date(Date.now() - started));
  await age(
    await claudeIn("a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1", "A Claude task of six days ago."),
    6 * DAY,
  );
  await age(
    await claudeIn("a2a2a2a2-a2a2-4a2a-8a2a-a2a2a2a2a2a2", "A Claude task of eight days ago."),
    8 * DAY,
  );
  // Codex files a rollout under the day that its session started. A session
  // that started 20 days ago and runs again shows; one that stopped does not.
  await codexIn(
    "b1b1b1b1-b1b1-4b1b-8b1b-b1b1b1b1b1b1",
    "An old Codex task that runs again.",
    20 * DAY,
  );
  await age(
    await codexIn(
      "b2b2b2b2-b2b2-4b2b-8b2b-b2b2b2b2b2b2",
      "An old Codex task that stopped.",
      20 * DAY,
    ),
    8 * DAY,
  );
  await age(
    await codexIn("b3b3b3b3-b3b3-4b3b-8b3b-b3b3b3b3b3b3", "A Codex task of six days ago.", 6 * DAY),
    6 * DAY,
  );
  await age(
    await codexIn(
      "b4b4b4b4-b4b4-4b4b-8b4b-b4b4b4b4b4b4",
      "A Codex task of eight days ago.",
      8 * DAY,
    ),
    8 * DAY,
  );

  const latest = await list();
  await vi.waitFor(
    () =>
      expect(foundIn(latest.value).sort()).toEqual([
        "A Claude task of six days ago",
        "A Codex task of six days ago",
        "An old Codex task that runs again",
      ]),
    { timeout: 10_000 },
  );
  // Later scans read the old day folder too, between full listings.
  await claudeIn("a3a3a3a3-a3a3-4a3a-8a3a-a3a3a3a3a3a3", "A new Claude task in the checkout.");
  await vi.waitFor(
    () => expect(foundIn(latest.value)).toContain("A new Claude task in the checkout"),
    { timeout: 10_000 },
  );
  expect(foundIn(latest.value)).toContain("An old Codex task that runs again");
});

test("a Codex session that Med runs through ACP shows once, as its thread, also after a restart", async () => {
  const agents = async () => [
    {
      id: "codex",
      name: "Codex",
      kind: "acp" as const,
      available: true,
      command: process.execPath,
      args: [fileURLToPath(new URL("../fixtures/agents/fake-codex-acp.mjs", import.meta.url))],
    },
  ];
  const { api, list, repo, home, directory } = await fixture(agents);
  const repositories = await api<{ repositories: { id: string; path: string }[] }>(
    "/api/repositories",
  );
  const started = await api<{ review: SavedReview }>("/api/threads", {
    repositoryId: repositories.data.repositories.find((entry) => entry.path === repo)!.id,
    prompt: "Add a unit option to formatHeight.",
    preset: "codex",
    worktree: false,
  });
  expect(started.status).toBe(200);
  const review = started.data.review;
  const owned = review.sessions![0]!;
  expect(owned.agent).toBe("acp");
  await vi.waitFor(
    async () =>
      expect(
        (await api<{ status: string }>(`/api/reviews/${review.id}/owned/${owned.id}`)).data.status,
      ).toBe("idle"),
    { timeout: 10_000 },
  );
  // Codex wrote the session's rollout with its own ID, and the prompt.
  const day = new Date();
  const folder = join(
    home,
    ".codex",
    "sessions",
    String(day.getFullYear()),
    String(day.getMonth() + 1).padStart(2, "0"),
    String(day.getDate()).padStart(2, "0"),
  );
  const [rollout] = await readdir(folder);
  const codexId = /([0-9a-f-]{36})\.jsonl$/.exec(rollout!)![1]!;
  expect(codexId).not.toBe(owned.id);
  expect(await readFile(join(folder, rollout!), "utf8")).toContain("Add a unit option");

  // A terminal session in the same checkout, written after it, shows: the
  // scan has read the rollout too.
  await codex(home, repo, "c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1", "A terminal task in Codex.");
  const once = async (latest: { value: ThreadList | null }) => {
    await vi.waitFor(() => expect(foundIn(latest.value)).toEqual(["A terminal task in Codex"]), {
      timeout: 10_000,
    });
    const threads = latest.value!.threads;
    expect(threads.some((thread) => thread.id === `found-codex-${codexId}`)).toBe(false);
    expect(threads.filter((thread) => thread.id === review.id)).toHaveLength(1);
  };
  await once(await list());

  // Med keeps the agent's ID with the session, so a restart keeps it apart.
  await hosts.splice(0)[0]!.close();
  const again = await startHost({
    repo,
    repos: [repo],
    stateDir: join(directory, "state"),
    port: 0,
    agents,
  });
  hosts.push(again);
  const restarted = follow(again);
  await once(restarted);
});
