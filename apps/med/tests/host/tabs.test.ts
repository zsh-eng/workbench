import { afterEach, expect, test, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, realpath, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SavedReview } from "../../src/shared/saved-review";
import type { Thread, ThreadList } from "../../src/shared/threads";
import { startHost, type RunningHost } from "../../src/host/server";
import { claudeProjectFolder } from "../../src/host/found-sessions";
import { readServerEvents } from "../../src/web/data/sse";

// Open tabs and cold history through the production host: the first start
// with tabs, the order across restarts, pruning of closed threads, and the
// subagents that a tab lists.

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

const DAY = 24 * 60 * 60 * 1000;
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
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

/** A Claude Code transcript: a prompt, then a tool call that runs or a reply
 * that ends the turn. */
function transcript(cwd: string, id: string, prompt: string, step: "runs" | "ends") {
  const base = { cwd, sessionId: id };
  return lines([
    { ...base, type: "user", timestamp: ago(60_000), message: { role: "user", content: prompt } },
    step === "runs"
      ? {
          ...base,
          type: "assistant",
          timestamp: ago(30_000),
          message: {
            id: `${id}-1`,
            role: "assistant",
            stop_reason: "tool_use",
            content: [
              {
                type: "tool_use",
                id: `${id}-call`,
                name: "Bash",
                input: { command: "bun test", description: "Run the tests" },
              },
            ],
          },
        }
      : {
          ...base,
          type: "assistant",
          timestamp: ago(30_000),
          message: {
            id: `${id}-1`,
            role: "assistant",
            stop_reason: "end_turn",
            content: [{ type: "text", text: "Done." }],
          },
        },
  ]);
}

async function fixture() {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "med tabs ")));
  directories.push(directory);
  const repo = join(directory, "tide");
  await mkdir(repo);
  git(repo, ["init", "-q", "-b", "main"]);
  await writeFile(join(repo, "README.md"), "# tide\n");
  git(repo, ["add", "."]);
  git(repo, ["commit", "-q", "-m", "Start"]);
  const home = join(directory, "home");
  await mkdir(home);
  vi.stubEnv("MED_HOME_DIR", home);
  const stateDir = join(directory, "state");
  let host: RunningHost;
  const start = async () => {
    host = await startHost({ repo, repos: [repo], stateDir, port: 0 });
    hosts.push(host);
  };
  await start();
  const api = async <T>(path: string, body?: unknown) => {
    const response = await fetch(`http://127.0.0.1:${host.port}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { authorization: `Bearer ${host.token}`, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, data: (await response.json()) as T };
  };
  const save = async (title: string, sessions: SavedReview["sessions"] = []) =>
    (
      await api<SavedReview>("/api/reviews", {
        title,
        targets: [{ repo, comparison: { kind: "working" } }],
        ...(sessions?.length ? { sessions } : {}),
      })
    ).data;
  const tabs = async () =>
    (await api<ThreadList>("/api/threads")).data.threads.map((thread) => thread.title);
  const history = async () =>
    (await api<{ threads: Thread[] }>("/api/threads/history")).data.threads;
  const restart = async () => {
    await hosts.splice(hosts.indexOf(host), 1)[0]!.close();
    await start();
  };
  const record = (id: string) => join(stateDir, "reviews", `${id}.json`);
  return { api, save, tabs, history, restart, record, repo, home, stateDir };
}

test("the first start with tabs opens the recent threads, closes the rest, and keeps the order", async () => {
  const { api, save, tabs, history, restart, record, stateDir } = await fixture();
  const recent = await save("Recent work");
  const older = await save("Quiet for twenty days");
  const quiet = await save("Quiet for ten days");
  const archived = await save("Archived before tabs");
  expect(await tabs()).toEqual([
    "Archived before tabs",
    "Quiet for ten days",
    "Quiet for twenty days",
    "Recent work",
  ]);

  // As Med before tabs left them: no tabs file, an archived record, and one
  // that has not changed for ten days.
  await rm(join(stateDir, "tabs.json"));
  const file = JSON.parse(await readFile(record(archived.id), "utf8")) as {
    saved: { archivedAt?: string };
  };
  file.saved.archivedAt = "2026-10-01T08:00:00.000Z";
  await writeFile(record(archived.id), JSON.stringify(file));
  const tenDays = new Date(Date.now() - 10 * DAY);
  await utimes(record(quiet.id), tenDays, tenDays);
  const twentyDays = new Date(Date.now() - 20 * DAY);
  await utimes(record(older.id), twentyDays, twentyDays);
  await restart();

  // A recent thread opens; an archived one closes when it was archived, and
  // the others close now, newest change first.
  expect(await tabs()).toEqual(["Recent work"]);
  const closed = await history();
  expect(closed.map((thread) => [thread.title, thread.open])).toEqual([
    ["Quiet for ten days", false],
    ["Quiet for twenty days", false],
    ["Archived before tabs", false],
  ]);
  expect(closed[0]!.closedAt).toBeGreaterThan(Date.now() - 60_000);
  expect(closed[2]!.closedAt).toBe(Date.parse("2026-10-01T08:00:00.000Z"));

  // A new thread opens at the top of its repository; the reader's order stays
  // across a restart, which does not make the tabs again.
  const next = await save("Next task");
  expect(await tabs()).toEqual(["Next task", "Recent work"]);
  expect((await api("/api/threads/order", { order: [recent.id, next.id] })).status).toBe(200);
  expect(await tabs()).toEqual(["Recent work", "Next task"]);
  await restart();
  expect(await tabs()).toEqual(["Recent work", "Next task"]);
  expect((await history()).map((thread) => thread.title)).toEqual([
    "Quiet for ten days",
    "Quiet for twenty days",
    "Archived before tabs",
  ]);
});

test("the first start with tabs opens at most the 8 newest threads of the last 7 days", async () => {
  const { save, tabs, history, restart, record, stateDir } = await fixture();
  const titles = Array.from({ length: 10 }, (_, index) => `Thread ${index + 1}`);
  const recent = [];
  for (const title of titles) recent.push(await save(title));
  const old = await save("Nine days old");
  // As Med before tabs left them: ten threads in the last 7 days, 15 hours
  // apart, newest first, and one of nine days ago.
  await rm(join(stateDir, "tabs.json"));
  for (const [index, review] of recent.entries()) {
    const at = new Date(Date.now() - 60_000 - index * 15 * 60 * 60 * 1000);
    await utimes(record(review.id), at, at);
  }
  const nineDays = new Date(Date.now() - 9 * DAY);
  await utimes(record(old.id), nineDays, nineDays);
  await restart();

  expect(await tabs()).toEqual(titles.slice(0, 8));
  expect((await history()).map((thread) => thread.title)).toEqual([
    ...titles.slice(8),
    "Nine days old",
  ]);
});

test("a thread keeps the name that the reader gives it across a restart, a hand-off, and history, and an empty name restores the agent's title", async () => {
  const { api, save, tabs, history, restart, stateDir } = await fixture();
  const review = await save("Forgiving station search");
  const listed = async () =>
    (await api<ThreadList>("/api/threads")).data.threads.map(({ title, agentTitle }) => ({
      title,
      agentTitle,
    }));

  expect(
    (await api(`/api/threads/${review.id}/name`, { name: "  Station search v2  " })).status,
  ).toBe(200);
  expect(await listed()).toEqual([
    { title: "Station search v2", agentTitle: "Forgiving station search" },
  ]);
  // Med keeps the name in its tabs file, not in the review.
  const saved = JSON.parse(await readFile(join(stateDir, "tabs.json"), "utf8")) as {
    entries: Record<string, { name?: string }>;
  };
  expect(saved.entries[review.id]?.name).toBe("Station search v2");
  await restart();
  expect(await tabs()).toEqual(["Station search v2"]);

  // A hand-off that gives the review a new title does not change the name.
  expect(
    (await api(`/api/reviews/${review.id}/details`, { title: "Station search with regions" }))
      .status,
  ).toBe(200);
  expect(await listed()).toEqual([
    { title: "Station search v2", agentTitle: "Station search with regions" },
  ]);

  // History lists the name; an empty name gives the agent's title back.
  expect((await api(`/api/threads/${review.id}/close`, {})).status).toBe(200);
  expect((await history()).map((thread) => thread.title)).toEqual(["Station search v2"]);
  expect((await api(`/api/threads/${review.id}/name`, { name: "" })).status).toBe(200);
  const [closed] = await history();
  expect([closed!.title, closed!.agentTitle]).toEqual(["Station search with regions", undefined]);

  // A thread that Med does not know cannot be named.
  expect((await api(`/api/threads/r_${"0".repeat(24)}/name`, { name: "Nothing" })).status).toBe(
    404,
  );
});

test("a closed thread keeps its captures for 30 days, then a stub that opens its session, and after 180 days nothing", async () => {
  const { api, save, tabs, history, restart, record, repo, home, stateDir } = await fixture();
  const session = "12121212-1212-4212-8212-121212121212";
  const folder = join(home, ".claude", "projects", claudeProjectFolder(repo));
  await mkdir(folder, { recursive: true });
  await writeFile(
    join(folder, `${session}.jsonl`),
    transcript(repo, session, "Explain the tide model.", "ends"),
  );
  // An adopted session captures nothing: it names its checkout, which its stub keeps.
  const month = (
    await api<{ id: string }>("/api/sessions/adopt", { session, title: "Closed a month ago" })
  ).data;
  const year = await save("Closed half a year ago");
  const kept = await save("Closed last week");
  for (const thread of [month, year, kept])
    expect((await api(`/api/threads/${thread.id}/close`, {})).status).toBe(200);

  // Med prunes when it starts, and once a day.
  const file = join(stateDir, "tabs.json");
  const state = JSON.parse(await readFile(file, "utf8")) as {
    entries: Record<string, { closedAt?: number }>;
  };
  state.entries[month.id]!.closedAt = Date.now() - 31 * DAY;
  state.entries[year.id]!.closedAt = Date.now() - 181 * DAY;
  state.entries[kept.id]!.closedAt = Date.now() - 7 * DAY;
  await writeFile(file, JSON.stringify(state));
  await restart();

  // Last week's thread keeps its record; a month's keeps a stub in history;
  // half a year's is gone.
  expect(existsSync(record(kept.id))).toBe(true);
  expect(existsSync(record(month.id))).toBe(false);
  expect(existsSync(record(year.id))).toBe(false);
  expect((await api(`/api/reviews/${month.id}`)).status).toBe(404);
  const closed = await history();
  expect(closed.map((thread) => thread.title)).toEqual(["Closed last week", "Closed a month ago"]);
  expect(closed[1]).toMatchObject({
    id: month.id,
    stub: true,
    open: false,
    checkout: repo,
    sessions: [{ agent: "claude", id: session }],
  });

  // A stub opens as its session, which Med finds again.
  const opened = await api<{ thread: Thread }>(`/api/threads/${month.id}/open`, {});
  expect(opened.status).toBe(200);
  expect(opened.data.thread).toMatchObject({ id: `found-claude-${session}`, found: true });
  const tabIds = async () =>
    (await api<ThreadList>("/api/threads")).data.threads.map((thread) => thread.id);
  expect(await tabIds()).toContain(`found-claude-${session}`);
  expect((await history()).map((thread) => thread.title)).toEqual(["Closed last week"]);

  // No longer a limit of 128 saved reviews: more save.
  for (let index = 0; index < 3; index++) await save(`Another ${index}`);
  expect((await tabs()).length).toBeGreaterThanOrEqual(4);
});

test("a tab lists its Claude subagents: what each does now, and those that finished", async () => {
  const { repo, home, save } = await fixture();
  const session = "34343434-3434-4434-8434-343434343434";
  const folder = join(home, ".claude", "projects", claudeProjectFolder(repo));
  const agents = join(folder, session, "subagents");
  await mkdir(agents, { recursive: true });
  await writeFile(
    join(folder, `${session}.jsonl`),
    transcript(repo, session, "Make durations read as minutes.", "runs"),
  );
  await writeFile(
    join(agents, "agent-a1.jsonl"),
    transcript(repo, session, "Check the edge cases.", "runs"),
  );
  await writeFile(
    join(agents, "agent-a1.meta.json"),
    JSON.stringify({
      agentType: "general-purpose",
      description: "Check the edge cases",
      toolUseId: "toolu_edge",
    }),
  );
  await writeFile(
    join(agents, "agent-a2.jsonl"),
    transcript(repo, session, "Read the docs.", "ends"),
  );
  await writeFile(
    join(agents, "agent-a2.meta.json"),
    JSON.stringify({ description: "Read the docs", toolUseId: "toolu_docs" }),
  );
  const saved = await save("Durations in minutes", [{ agent: "claude", id: session, cwd: repo }]);

  // A window's stream sends the subagents with the tab.
  const latest: { value: ThreadList | null } = { value: null };
  const controller = new AbortController();
  streams.push(controller);
  const stream = await fetch(`http://127.0.0.1:${hosts.at(-1)!.port}/api/threads/events`, {
    headers: { authorization: `Bearer ${hosts.at(-1)!.token}` },
  });
  void readServerEvents(
    stream.body!,
    (event) => (latest.value = JSON.parse(event.data) as ThreadList),
    controller.signal,
  ).catch(() => {});
  await vi.waitFor(
    () =>
      expect(
        latest.value?.threads.find((thread) => thread.id === saved.id)?.subagents,
      ).toHaveLength(2),
    { timeout: 10_000 },
  );
  const subagents = latest.value!.threads.find((thread) => thread.id === saved.id)!.subagents!;
  expect(subagents).toEqual(
    expect.arrayContaining([
      {
        id: "toolu_edge",
        description: "Check the edge cases",
        state: "working",
        activity: expect.stringContaining("bun test"),
        updatedAt: expect.any(Number),
      },
      {
        id: "toolu_docs",
        description: "Read the docs",
        state: "idle",
        updatedAt: expect.any(Number),
      },
    ]),
  );
});
