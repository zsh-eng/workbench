import { afterEach, expect, test, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SavedReview } from "../../src/shared/saved-review";
import type { Thread, ThreadList } from "../../src/shared/threads";
import { startHost, type RunningHost } from "../../src/host/server";
import { claudeProjectFolder } from "../../src/host/found-sessions";
import { readServerEvents } from "../../src/web/data/sse";

// The thread list reads each thread's last turn from its transcript's tail: what
// the agent does now, what it said last, and whether it asked the user; and
// the checkout's work that the base branch does not have yet.

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
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

type Step =
  | { text: string; end?: boolean }
  | { tool: string; input: Record<string, unknown>; result?: string };

/** A Claude Code transcript: a prompt 4 minutes ago, then the agent's steps,
 * one a minute apart. A tool without a result still runs. */
async function claude(home: string, cwd: string, id: string, prompt: string, steps: Step[]) {
  const folder = join(home, ".claude", "projects", claudeProjectFolder(cwd));
  await mkdir(folder, { recursive: true });
  const base = { cwd, sessionId: id, isSidechain: false };
  const records: unknown[] = [
    { ...base, type: "user", timestamp: ago(240_000), message: { role: "user", content: prompt } },
  ];
  steps.forEach((step, index) => {
    const timestamp = ago(180_000 - index * 60_000);
    if ("text" in step) {
      records.push({
        ...base,
        type: "assistant",
        timestamp,
        message: {
          id: `msg-${index}`,
          role: "assistant",
          stop_reason: step.end ? "end_turn" : null,
          content: [{ type: "text", text: step.text }],
        },
      });
      return;
    }
    const callId = `toolu_${index}`;
    records.push({
      ...base,
      type: "assistant",
      timestamp,
      message: {
        id: `msg-${index}`,
        role: "assistant",
        stop_reason: "tool_use",
        content: [{ type: "tool_use", id: callId, name: step.tool, input: step.input }],
      },
    });
    if (step.result !== undefined)
      records.push({
        ...base,
        type: "user",
        timestamp,
        message: {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: callId, content: step.result }],
        },
      });
  });
  await writeFile(join(folder, `${id}.jsonl`), lines(records));
}

/** A Codex rollout in today's day folder whose turn ended on a list of choices. */
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
  const reply =
    "Heights can show in feet. Which unit should the table use by default?\n\n- Metres, as now\n- Feet, for readers in the US";
  await writeFile(
    join(folder, `rollout-2026-10-15T09-00-00-${id}.jsonl`),
    lines([
      {
        timestamp: ago(120_000),
        type: "session_meta",
        payload: { id, cwd, originator: "codex_cli_rs", timestamp: ago(120_000) },
      },
      {
        timestamp: ago(110_000),
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "Add feet." }],
        },
      },
      {
        timestamp: ago(100_000),
        type: "response_item",
        payload: {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: reply }],
        },
      },
      { timestamp: ago(100_000), type: "event_msg", payload: { type: "task_complete" } },
    ]),
  );
}

async function fixture() {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "med thread status ")));
  directories.push(directory);
  const repo = join(directory, "tide");
  await mkdir(repo);
  git(repo, ["init", "-q", "-b", "main"]);
  await writeFile(join(repo, "README.md"), "# tide\n");
  git(repo, ["add", "."]);
  git(repo, ["commit", "-q", "-m", "Start"]);
  const trees = Object.fromEntries(
    ["ask", "busy", "done", "pick", "feet"].map((name) => {
      const path = join(directory, "tide.worktrees", name);
      git(repo, ["worktree", "add", "-q", "-b", name, path]);
      return [name, path];
    }),
  ) as Record<"ask" | "busy" | "done" | "pick" | "feet", string>;
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
    return latest;
  };
  return { api, list, repo, trees, home };
}

test("each thread tells what its agent does now, what it said, and whether it asks you", async () => {
  const { api, list, repo, trees, home } = await fixture();
  const ids = {
    ask: "11111111-1111-4111-8111-111111111111",
    busy: "22222222-2222-4222-8222-222222222222",
    done: "33333333-3333-4333-8333-333333333333",
    pick: "44444444-4444-4444-8444-444444444444",
    feet: "55555555-5555-4555-8555-555555555555",
    landed: "66666666-6666-4666-8666-666666666666",
  };
  // A turn that ended on a question, on working changes.
  await writeFile(join(trees.ask, "format.ts"), "export const time = 1;\n");
  await claude(home, trees.ask, ids.ask, "Times in Tromsø are an hour off. Fix formatTime.", [
    { tool: "Read", input: { file_path: join(trees.ask, "README.md") }, result: "# tide" },
    {
      text: "Fixed: `formatTime` asks `Intl` for the hour.\n\nOne choice for you: should the table show **each station's own time**, or the reader's? I kept the station's own time. Should I switch it?",
      end: true,
    },
  ]);
  // A turn that runs a command now; a command keeps no `cd <dir> &&`.
  await claude(home, trees.busy, ids.busy, "Add a glossary to the README.", [
    {
      tool: "Edit",
      input: { file_path: join(trees.busy, "README.md"), old_string: "a", new_string: "b" },
      result: "ok",
    },
    {
      tool: "Bash",
      input: { command: `cd "${trees.busy}" && bun test`, description: "Run the tests" },
    },
  ]);
  // A turn that ended with a commit ahead of main; its last text does not ask,
  // though its code has a question mark.
  await writeFile(join(trees.done, "search.ts"), "export const find = (a?: string) => a;\n");
  git(trees.done, ["add", "."]);
  git(trees.done, ["commit", "-q", "-m", "Search"]);
  await claude(home, trees.done, ids.done, "Make search forgiving.", [
    {
      text: "Search ignores case now.\n\nThe branch has one commit and is ready to review: `find(a?)`",
      end: true,
    },
  ]);
  // A turn that waits on Claude Code's question tool.
  await claude(home, trees.pick, ids.pick, "Pick a colour for the chart.", [
    {
      tool: "AskUserQuestion",
      input: { questions: [{ question: "Which colour should high tides use?", options: [] }] },
    },
  ]);
  // A Codex turn that ended on a list of choices; and a session on main.
  await codex(home, trees.feet, ids.feet);
  await claude(home, repo, ids.landed, "Explain the model.", [
    { text: "The README explains the model.", end: true },
  ]);

  const head = (cwd: string) => git(cwd, ["rev-parse", "HEAD"]);
  const save = (title: string, cwd: string, id: string, comparison: unknown) =>
    api<SavedReview>("/api/reviews", {
      title,
      targets: [{ repo: cwd, comparison }],
      sessions: [{ agent: "claude", id, cwd }],
    });
  const asked = await save("Daylight saving times", trees.ask, ids.ask, { kind: "working" });
  await save("Forgiving search", trees.done, ids.done, {
    kind: "range",
    base: "main",
    head: "done",
  });
  // A commit on main: the main checkout's own uncommitted changes are not its work.
  await writeFile(join(repo, "README.md"), "# tide\n\nHow it predicts.\n");
  git(repo, ["commit", "-q", "-am", "Explain the model"]);
  await writeFile(join(repo, "scratch.txt"), "not this thread's\n");
  await save("Explain the model", repo, ids.landed, {
    kind: "range",
    base: `${head(repo)}~1`,
    head: head(repo),
  });

  const latest = await list();
  const thread = (title: string) =>
    latest.value?.threads.find((entry) => entry.title === title) as Thread | undefined;
  await vi.waitFor(
    () => {
      expect(thread("Daylight saving times")?.unlanded).toBeDefined();
      expect(thread("Forgiving search")?.unlanded).toBeDefined();
      expect(thread("Explain the model")?.unlanded).toBeDefined();
      expect(thread("Add a glossary to the README")?.turn).toBeDefined();
      expect(thread("Pick a colour for the chart")?.turn).toBeDefined();
      expect(thread("Add feet")?.turn).toBeDefined();
    },
    { timeout: 15_000 },
  );

  // The question: the last paragraph as plain text, its end time, and asks.
  expect(thread("Daylight saving times")).toMatchObject({
    state: "idle",
    turn: {
      asks: true,
      said: "One choice for you: should the table show each station's own time, or the reader's? I kept the station's own time. Should I switch it?",
      startedAt: expect.any(Number),
      endedAt: expect.any(Number),
    },
    unlanded: { base: "main", ahead: 0, uncommitted: true },
  });
  // The working turn: what runs now, and since when.
  const busy = thread("Add a glossary to the README")!;
  expect(busy).toMatchObject({ found: true, state: "working" });
  expect(busy.turn).toEqual({ startedAt: expect.any(Number), activity: "Running bun test" });
  expect(Date.now() - busy.turn!.startedAt!).toBeGreaterThan(200_000);
  // Ready: a commit ahead of main, and no question.
  const done = thread("Forgiving search")!;
  expect(done.turn).toMatchObject({
    said: "The branch has one commit and is ready to review: find(a?)",
  });
  expect(done.turn?.asks).toBeUndefined();
  expect(done.unlanded).toEqual({ base: "main", ahead: 1, uncommitted: false });
  // Landed: nothing ahead of main, and main's own changes do not count.
  expect(thread("Explain the model")?.unlanded).toEqual({
    base: "main",
    ahead: 0,
    uncommitted: false,
  });
  // A question tool that waits, and a Codex question before its choices.
  expect(thread("Pick a colour for the chart")?.turn).toMatchObject({
    asks: true,
    activity: "Asks you a question",
    said: "Which colour should high tides use?",
  });
  expect(thread("Add feet")?.turn).toMatchObject({ asks: true });

  // A reply from Med waits in the thread's agent inbox, and the list says so.
  const sent = await api(`/api/reviews/${asked.data.id}/agent/messages`, {
    sessionId: ids.ask,
    text: "Keep the station's own time.",
    noteIds: [],
  });
  expect(sent.status).toBe(200);
  await vi.waitFor(
    () =>
      expect(thread("Daylight saving times")?.replied).toMatchObject({
        text: "Keep the station's own time.",
        delivery: "pending",
      }),
    { timeout: 5000 },
  );
  expect(thread("Daylight saving times")!.replied!.at).toBeGreaterThan(
    thread("Daylight saving times")!.turn!.endedAt!,
  );

  // An agent in `med review wait` needs you; its open wait is not work.
  await claude(home, trees.done, ids.done, "Make search forgiving.", [
    { text: "Search ignores case now. I wait for your review." },
    { tool: "Bash", input: { command: "med review wait", description: "Wait for review" } },
  ]);
  const forgiving = latest.value!.threads.find((entry) => entry.title === "Forgiving search")!;
  const waited = api(`/api/reviews/${forgiving.id}/agent/wait`, { session: ids.done });
  await vi.waitFor(() => expect(thread("Forgiving search")?.state).toBe("waiting"), {
    timeout: 5000,
  });
  expect(thread("Forgiving search")!.turn).toEqual({
    startedAt: expect.any(Number),
    said: "Search ignores case now. I wait for your review.",
  });
  await api(`/api/reviews/${forgiving.id}/agent/messages`, {
    sessionId: ids.done,
    text: "Looks good.",
    noteIds: [],
  });
  expect((await waited).status).toBe(200);
});
