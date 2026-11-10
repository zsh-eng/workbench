import { afterEach, expect, test, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SavedReview } from "../../src/shared/saved-review";
import type { Thread, ThreadList } from "../../src/shared/threads";
import { startHost, type RunningHost } from "../../src/host/server";
import { claudeProjectFolder } from "../../src/host/session-index";
import { readServerEvents } from "../../src/web/data/sse";

// Tabs and the archive through the production host: the move from an older
// Med's tabs, names, pins and seen marks across restarts, pruning of
// archived threads, and the subagents that a tab lists.

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
  const save = async (title: string, session?: SavedReview["session"]) =>
    (
      await api<SavedReview>("/api/reviews", {
        title,
        targets: [{ repo, comparison: { kind: "working" } }],
        ...(session && { session }),
      })
    ).data;
  const tabs = async () =>
    (await api<ThreadList>("/api/threads")).data.threads.map((thread) => thread.title);
  const history = async () =>
    (await api<{ threads: Thread[] }>("/api/threads/history")).data.threads;
  const stop = async () => void (await hosts.splice(hosts.indexOf(host), 1)[0]!.close());
  const restart = async () => {
    await stop();
    await start();
  };
  const record = (id: string) => join(stateDir, "reviews", `${id}.json`);
  return { api, save, tabs, history, start, stop, restart, record, repo, home, stateDir };
}

test("the first start moves an older Med's tabs: a review goes to its session's thread, with its name, pin, and seen mark", async () => {
  const { api, save, tabs, history, stop, start, repo, stateDir } = await fixture();
  const session = {
    agent: "claude" as const,
    id: "56565656-5656-4565-8565-565656565656",
    cwd: repo,
  };
  const found = "78787878-7878-4787-8787-787878787878";
  const handedOff = await save("Tide chart", session);
  const alone = await save("Harbour webcams");
  const archived = await save("Offline tides");
  await stop();
  // As the Med before sessions were threads left it: each review a tab, a
  // found session a `found-…` tab, and no thread store.
  await rm(join(stateDir, "threads.json"));
  await writeFile(
    join(stateDir, "tabs.json"),
    JSON.stringify({
      version: 1,
      order: [handedOff.id, `found-claude-${found}`, alone.id],
      entries: {
        [handedOff.id]: { name: "Tide chart v2" },
        [`found-claude-${found}`]: {
          stub: { title: "Found work", sessions: [{ agent: "claude", id: found, cwd: repo }] },
        },
        [alone.id]: {},
        [archived.id]: { closedAt: Date.parse("2026-10-01T08:00:00.000Z") },
      },
      pins: [handedOff.id],
      seen: { [handedOff.id]: 42 },
    }),
  );
  await start();

  const listed = (await api<ThreadList>("/api/threads")).data.threads;
  const byId = new Map(listed.map((thread) => [thread.id, thread]));
  expect(listed.map((thread) => thread.id).toSorted()).toEqual(
    [`claude-${session.id}`, `claude-${found}`, alone.id].toSorted(),
  );
  expect(byId.get(`claude-${session.id}`)).toMatchObject({
    kind: "session",
    title: "Tide chart v2",
    pinned: 1,
    seen: 42,
    session: { agent: "claude", id: session.id },
    reviews: [{ id: handedOff.id, title: "Tide chart" }],
  });
  expect(byId.get(`claude-${found}`)).toMatchObject({ kind: "session", reviews: [] });
  expect(byId.get(alone.id)).toMatchObject({ kind: "review", reviews: [{ id: alone.id }] });
  expect(await history()).toMatchObject([
    { id: archived.id, open: false, closedAt: Date.parse("2026-10-01T08:00:00.000Z") },
  ]);
  // The old file stays beside the new one, and a restart does not move it again.
  expect(existsSync(join(stateDir, "tabs.json.before-sessions"))).toBe(true);
  expect(existsSync(join(stateDir, "tabs.json"))).toBe(false);
  await stop();
  await start();
  expect((await tabs()).toSorted()).toEqual(["Found work", "Harbour webcams", "Tide chart v2"]);
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
  // Med keeps the name in its thread store, not in the review.
  const saved = JSON.parse(await readFile(join(stateDir, "threads.json"), "utf8")) as {
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

test("a pinned thread stays pinned across a restart and in history, and a deleted one leaves the pins", async () => {
  const { api, save, history, restart, stateDir } = await fixture();
  const first = await save("Forgiving station search");
  const second = await save("Offline tides");
  const pinned = async () =>
    (await api<ThreadList>("/api/threads")).data.threads
      .filter((thread) => thread.pinned)
      .toSorted((a, b) => a.pinned! - b.pinned!)
      .map((thread) => thread.title);

  expect((await api(`/api/threads/${second.id}/pin`, { pinned: true })).status).toBe(200);
  expect((await api(`/api/threads/${first.id}/pin`, { pinned: true })).status).toBe(200);
  expect(await pinned()).toEqual(["Offline tides", "Forgiving station search"]);
  // Med keeps the pins in its thread store, in the order they were pinned.
  const saved = JSON.parse(await readFile(join(stateDir, "threads.json"), "utf8")) as {
    pins?: string[];
  };
  expect(saved.pins).toEqual([second.id, first.id]);
  await restart();
  expect(await pinned()).toEqual(["Offline tides", "Forgiving station search"]);

  // A pin takes a place among the others, as a drag in the sidebar drops it,
  // and a pinned thread moves to another place.
  const third = await save("Harbour webcams");
  expect((await api(`/api/threads/${third.id}/pin`, { pinned: true, at: 0 })).status).toBe(200);
  const order = async () =>
    (await api<ThreadList>("/api/threads")).data.threads
      .filter((thread) => thread.pinned)
      .toSorted((a, b) => a.pinned! - b.pinned!)
      .map((thread) => thread.title);
  expect(await order()).toEqual(["Harbour webcams", "Offline tides", "Forgiving station search"]);
  expect((await api(`/api/threads/${third.id}/pin`, { pinned: true, at: 2 })).status).toBe(200);
  expect(await order()).toEqual(["Offline tides", "Forgiving station search", "Harbour webcams"]);
  // A place past the end is the end.
  expect((await api(`/api/threads/${second.id}/pin`, { pinned: true, at: 9 })).status).toBe(200);
  expect(await order()).toEqual(["Forgiving station search", "Harbour webcams", "Offline tides"]);
  expect((await api(`/api/threads/${third.id}/pin`, { pinned: true, at: -1 })).status).toBe(400);
  expect((await api(`/api/threads/${third.id}/pin`, { pinned: false })).status).toBe(200);
  expect((await api(`/api/threads/${second.id}/pin`, { pinned: true, at: 0 })).status).toBe(200);
  expect(await order()).toEqual(["Offline tides", "Forgiving station search"]);

  // A closed thread keeps its pin; unpinning takes it off.
  expect((await api(`/api/threads/${second.id}/close`, {})).status).toBe(200);
  expect((await history()).map((thread) => [thread.title, thread.pinned])).toEqual([
    ["Offline tides", 1],
  ]);
  expect((await api(`/api/threads/${first.id}/pin`, { pinned: false })).status).toBe(200);
  expect(await pinned()).toEqual([]);

  // Deleting a thread removes its pin, and Med cannot pin what it does not know.
  expect((await api(`/api/threads/${second.id}/delete`, {})).status).toBe(200);
  const after = JSON.parse(await readFile(join(stateDir, "threads.json"), "utf8")) as {
    pins?: string[];
  };
  expect(after.pins).toEqual([]);
  expect((await api(`/api/threads/r_${"0".repeat(24)}/pin`, { pinned: true })).status).toBe(404);
  expect((await api(`/api/threads/${first.id}/pin`, { pinned: "yes" })).status).toBe(400);
});

test("a review that a session hands off joins the session's thread, which keeps its pin", async () => {
  const { api, save, repo, home } = await fixture();
  const session = "34343434-3434-4434-8434-343434343434";
  const folder = join(home, ".claude", "projects", claudeProjectFolder(repo));
  await mkdir(folder, { recursive: true });
  await writeFile(
    join(folder, `${session}.jsonl`),
    transcript(repo, session, "Draw the tide chart.", "runs"),
  );
  const thread = `claude-${session}`;
  const rows = async () =>
    (await api<ThreadList>("/api/threads")).data.threads.map((each) => [
      each.id,
      each.pinned,
      each.reviews.map((review) => review.title),
    ]);
  // A session that Med sees work opens as a tab, and the reader pins it.
  await expect.poll(rows).toEqual([[thread, undefined, []]]);
  expect((await api(`/api/threads/${thread}/pin`, { pinned: true })).status).toBe(200);
  expect(await rows()).toEqual([[thread, 1, []]]);

  // Its agent hands off a review, then another: the thread stays one row.
  await save("Tide chart", { agent: "claude", id: session, cwd: repo });
  await save("Tide chart labels", { agent: "claude", id: session, cwd: repo });
  expect(await rows()).toEqual([[thread, 1, ["Tide chart labels", "Tide chart"]]]);
});

test("a thread store with an entry that Med cannot read keeps the other tabs and their names, and a copy of the file", async () => {
  const { api, save, tabs, start, stop, stateDir } = await fixture();
  const first = await save("Forgiving station search");
  const second = await save("Tide tables offline");
  await api(`/api/threads/${first.id}/name`, { name: "Station search v2" });
  await api(`/api/threads/${second.id}/name`, { name: "Offline tides" });
  expect((await tabs()).toSorted()).toEqual(["Offline tides", "Station search v2"]);
  await stop();
  const file = join(stateDir, "threads.json");
  const saved = JSON.parse(await readFile(file, "utf8"));
  saved.entries[second.id].name = 42;
  await writeFile(file, JSON.stringify(saved));

  await start();
  expect((await tabs()).toSorted()).toEqual(["Station search v2", "Tide tables offline"]);
  const kept = (await readdir(stateDir)).filter((name) =>
    name.startsWith("threads.json.unreadable-"),
  );
  expect(kept).toHaveLength(1);
  expect(JSON.parse(await readFile(join(stateDir, kept[0]!), "utf8")).entries[second.id].name).toBe(
    42,
  );
});

test("an archived thread is forgotten after 180 days, with its reviews", async () => {
  const { api, save, tabs, history, restart, record, repo, home, stateDir } = await fixture();
  const session = "12121212-1212-4212-8212-121212121212";
  const folder = join(home, ".claude", "projects", claudeProjectFolder(repo));
  await mkdir(folder, { recursive: true });
  await writeFile(
    join(folder, `${session}.jsonl`),
    transcript(repo, session, "Explain the tide model.", "ends"),
  );
  const adopted = (
    await api<{ id: string }>("/api/sessions/adopt", { session, title: "Kept half a year ago" })
  ).data.id;
  const year = await save("Closed half a year ago");
  const week = await save("Closed last week");
  for (const id of [adopted, year.id, week.id])
    expect((await api(`/api/threads/${id}/close`, {})).status).toBe(200);

  // Med prunes when it starts, and once a day.
  const file = join(stateDir, "threads.json");
  const state = JSON.parse(await readFile(file, "utf8")) as {
    entries: Record<string, { closedAt?: number }>;
  };
  state.entries[adopted]!.closedAt = Date.now() - 181 * DAY;
  state.entries[year.id]!.closedAt = Date.now() - 181 * DAY;
  state.entries[week.id]!.closedAt = Date.now() - 7 * DAY;
  await writeFile(file, JSON.stringify(state));
  await restart();

  expect(existsSync(record(week.id))).toBe(true);
  expect(existsSync(record(year.id))).toBe(false);
  expect((await api(`/api/reviews/${year.id}`)).status).toBe(404);
  // The session stays in Claude Code; Med no longer keeps it.
  expect((await history()).map((thread) => thread.title)).toEqual(["Closed last week"]);
  const after = JSON.parse(await readFile(file, "utf8")) as { entries: Record<string, unknown> };
  expect(Object.keys(after.entries)).not.toContain(adopted);

  // No limit of saved reviews: more save.
  for (let index = 0; index < 3; index++) await save(`Another ${index}`);
  expect((await tabs()).length).toBeGreaterThanOrEqual(3);
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
  await save("Durations in minutes", { agent: "claude", id: session, cwd: repo });
  const thread = `claude-${session}`;

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
      expect(latest.value?.threads.find((each) => each.id === thread)?.subagents).toHaveLength(2),
    { timeout: 10_000 },
  );
  const subagents = latest.value!.threads.find((each) => each.id === thread)!.subagents!;
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

test("the host keeps what the reader saw of each tab: one mark for every window and the CLI, across a restart", async () => {
  const { api, save, restart, stateDir } = await fixture();
  const first = await save("Forgiving station search");
  const second = await save("Offline tides");
  const listed = async () =>
    new Map(
      (await api<ThreadList>("/api/threads")).data.threads.map((thread) => [thread.id, thread]),
    );
  // Med keeps marks from when the host started: a thread made after that,
  // such as the first one, is new until the reader sees it.
  const before = await listed();
  const since = before.get(first.id)!.seen!;
  expect(since).toBeLessThan(before.get(first.id)!.updatedAt);
  expect(before.get(second.id)!.seen).toBe(since);

  // A window marks a thread seen up to a change, and a lower mark makes the
  // later changes new again, as Mark as unread does.
  const at = before.get(first.id)!.updatedAt;
  expect((await api(`/api/threads/${first.id}/seen`, { at: at - 1 })).status).toBe(200);
  expect((await listed()).get(first.id)!.seen).toBe(at - 1);
  expect((await api(`/api/threads/${first.id}/seen`, { at })).status).toBe(200);
  await restart();
  expect((await listed()).get(first.id)!.seen).toBe(at);

  // A browser's marks from before go to the host once: they fill marks that
  // the host lacks, move older ones forward, and leave newer ones.
  const old = { [first.id]: at - 10, [second.id]: at - 20, [`r_${"0".repeat(24)}`]: 5 };
  expect((await api("/api/threads/seen", { marks: old })).status).toBe(200);
  const merged = await listed();
  expect(merged.get(first.id)!.seen).toBe(at);
  expect(merged.get(second.id)!.seen).toBe(at - 20);
  const file = JSON.parse(await readFile(join(stateDir, "threads.json"), "utf8")) as {
    seen?: Record<string, number>;
  };
  expect(Object.keys(file.seen ?? {}).toSorted()).toEqual([first.id, second.id].toSorted());

  // A deleted thread leaves the marks, and Med marks only threads it knows.
  expect((await api(`/api/threads/${second.id}/delete`, {})).status).toBe(200);
  const after = JSON.parse(await readFile(join(stateDir, "threads.json"), "utf8")) as {
    seen?: Record<string, number>;
  };
  expect(Object.keys(after.seen ?? {})).toEqual([first.id]);
  expect((await api(`/api/threads/r_${"0".repeat(24)}/seen`, { at: 1 })).status).toBe(404);
  expect((await api(`/api/threads/${first.id}/seen`, { at: -1 })).status).toBe(400);
});

test("a long poll sends the tabs at once, then when they differ from the caller's, or after its wait", async () => {
  const { api, save } = await fixture();
  await save("Forgiving station search");
  type Next = { version: string; list: ThreadList };
  const first = await api<Next>("/api/threads/next", {});
  expect(first.status).toBe(200);
  expect(first.data.list.threads.map((thread) => thread.title)).toEqual([
    "Forgiving station search",
  ]);
  // The same list: the host waits, then sends it as it is. The first lists
  // can still change, as Git's work for the tab comes in.
  let version = first.data.version;
  let waited = 0;
  for (let attempt = 0; attempt < 10 && waited < 350; attempt++) {
    const started = Date.now();
    const next = await api<Next>("/api/threads/next", { version, waitMs: 400 });
    waited = Date.now() - started;
    version = next.data.version;
  }
  expect(waited).toBeGreaterThanOrEqual(350);
  // A change ends the wait early.
  const waiting = api<Next>("/api/threads/next", { version, waitMs: 20_000 });
  await new Promise((resolve) => setTimeout(resolve, 200));
  const at = Date.now();
  await save("Offline tides");
  const changed = await waiting;
  expect(Date.now() - at).toBeLessThan(5_000);
  expect(changed.data.version).not.toBe(version);
  expect(changed.data.list.threads.map((thread) => thread.title)).toContain("Offline tides");
  expect((await api("/api/threads/next", { waitMs: 60_000 })).status).toBe(400);
});
