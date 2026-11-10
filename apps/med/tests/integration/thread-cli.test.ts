import { execFileSync } from "node:child_process";
import { appendFile, mkdir, mkdtemp, realpath, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { runReviewCommand } from "../../src/cli/review";
import { runThreadCommand } from "../../src/cli/thread";
import { claudeProjectFolder } from "../../src/host/session-index";
import { startHost, type RunningHost } from "../../src/host/server";
import type { SessionEntry } from "../../src/shared/found-sessions";
import type { Thread, ThreadList } from "../../src/shared/threads";
import { readServerEvents } from "../../src/web/data/sse";

// `med thread` through the production host, on a scratch home with Claude
// Code and Codex transcripts of several ages: find and adopt sessions, and
// list, open, close, reopen, and delete the tabs. A thread is a session.

beforeEach(() => {
  for (const name of ["MED_PORT", "MED_STATE_DIR", "CLAUDE_CODE_SESSION_ID"]) vi.stubEnv(name, "");
});
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
const lines = (records: unknown[]) =>
  records.map((entry) => JSON.stringify(entry)).join("\n") + "\n";
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
/** Sets a file's times to `ago` milliseconds before now. */
const age = (path: string, ago: number) =>
  utimes(path, new Date(Date.now() - ago), new Date(Date.now() - ago));

async function claude(home: string, cwd: string, id: string, prompt: string, title?: string) {
  const folder = join(home, ".claude", "projects", claudeProjectFolder(cwd));
  await mkdir(folder, { recursive: true });
  const path = join(folder, `${id}.jsonl`);
  const at = new Date().toISOString();
  await writeFile(
    path,
    lines([
      {
        type: "user",
        cwd,
        sessionId: id,
        uuid: `${id}-u`,
        timestamp: at,
        message: { role: "user", content: prompt },
      },
      {
        type: "assistant",
        cwd,
        sessionId: id,
        uuid: `${id}-a`,
        timestamp: at,
        message: {
          role: "assistant",
          stop_reason: "end_turn",
          content: [{ type: "text", text: "Done." }],
        },
      },
      ...(title ? [{ type: "custom-title", customTitle: title, sessionId: id }] : []),
    ]),
  );
  return path;
}

/** A Codex rollout in the day folder of `started`, or in the archive. */
async function codex(
  home: string,
  cwd: string,
  id: string,
  prompt: string,
  started: Date | "archived",
) {
  const folder =
    started === "archived"
      ? join(home, ".codex", "archived_sessions")
      : join(
          home,
          ".codex",
          "sessions",
          String(started.getFullYear()),
          String(started.getMonth() + 1).padStart(2, "0"),
          String(started.getDate()).padStart(2, "0"),
        );
  await mkdir(folder, { recursive: true });
  const path = join(folder, `rollout-2026-08-01T09-00-00-${id}.jsonl`);
  const at = new Date().toISOString();
  await writeFile(
    path,
    lines([
      { timestamp: at, type: "session_meta", payload: { id, cwd, originator: "codex_cli_rs" } },
      {
        timestamp: at,
        type: "response_item",
        payload: { type: "message", role: "user", content: [{ type: "input_text", text: prompt }] },
      },
      { timestamp: at, type: "event_msg", payload: { type: "task_complete" } },
    ]),
  );
  return path;
}

const ids = {
  glossary: "11111111-1111-4111-8111-111111111111",
  tides: "22222222-2222-4222-8222-222222222222",
  feet: "019a0000-3333-7333-8333-333333333333",
  archived: "019a0000-4444-7444-8444-444444444444",
  elsewhere: "55555555-5555-4555-8555-555555555555",
  twinA: "abcdef01-6666-4666-8666-666666666666",
  twinB: "abcdef02-7777-4777-8777-777777777777",
};

async function fixture() {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "med thread cli ")));
  directories.push(directory);
  const repo = join(directory, "tide");
  await mkdir(repo);
  git(repo, ["init", "-q", "-b", "main"]);
  await writeFile(join(repo, "README.md"), "# tide\n");
  git(repo, ["add", "."]);
  git(repo, ["commit", "-q", "-m", "Start"]);
  const glossary = join(directory, "tide.worktrees", "glossary");
  git(repo, ["worktree", "add", "-q", "-b", "glossary", glossary]);
  const elsewhere = join(directory, "elsewhere");
  await mkdir(elsewhere);
  const home = join(directory, "home");
  vi.stubEnv("MED_HOME_DIR", home);

  // A recent Claude Code session with a title, and one of a month ago.
  const glossaryPath = await claude(
    home,
    glossary,
    ids.glossary,
    "Add a short glossary to the README.",
    "README glossary",
  );
  await age(
    await claude(home, repo, ids.tides, "Explain the tide prediction model in the README."),
    30 * DAY,
  );
  // A Codex session of 40 days ago, and an archived one of 60 days ago.
  const forty = new Date(Date.now() - 40 * DAY);
  await age(
    await codex(home, repo, ids.feet, "Readers in the US want heights in feet.", forty),
    40 * DAY,
  );
  const archivedPath = await codex(
    home,
    glossary,
    ids.archived,
    "Show the moon phase beside each tide.",
    "archived",
  );
  await age(archivedPath, 60 * DAY);
  // A session outside the registered repositories, and two whose IDs start alike.
  await claude(home, elsewhere, ids.elsewhere, "Plan the trip to the coast.");
  await claude(home, repo, ids.twinA, "Fix the first twin bug.");
  await claude(home, repo, ids.twinB, "Fix the second twin bug.");

  const stateDir = join(directory, "state");
  const host = await startHost({ repo, repos: [repo], stateDir, port: 0 });
  hosts.push(host);
  const run = async (...args: string[]) => {
    const output: string[] = [];
    await runThreadCommand([...args, "--state-dir", stateDir, "--port", String(host.port)], {
      print: (text) => output.push(text),
      openUrl: () => {},
    });
    return output.join("\n");
  };
  const api = async <T>(path: string, body?: unknown) => {
    const response = await fetch(`http://127.0.0.1:${host.port}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { authorization: `Bearer ${host.token}`, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, data: (await response.json()) as T };
  };
  /** The thread list as a window's stream sends it, latest first. */
  const threads = async () => {
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
  /** The thread ID and link that adopt prints. */
  const adopted = (output: string) => {
    const match = new RegExp(
      `^Thread ((?:claude|codex)-[A-Za-z0-9_-]+): \\[(.+)\\]\\(http://127\\.0\\.0\\.1:${host.port}/review/([A-Za-z0-9_-]+)\\)( \\(already in Med\\))?$`,
    ).exec(output);
    if (!match) throw new Error(`Not an adopted thread: ${output}`);
    expect(match![1]).toBe(match![3]);
    expect(output).not.toContain(host.token);
    return { id: match![1]!, title: match![2]!, again: !!match![4] };
  };
  /** A session's hand-off of the repository's uncommitted change, as
   * `med review create` makes it; its review's ID. */
  const handOff = async (session: string, key: string) => {
    await writeFile(join(repo, "README.md"), `# tide\n\nA change for ${key}.\n`);
    await runReviewCommand(
      [
        ...["create", "--title", "Tide notes", "--key", key, "--repo", repo, "--working"],
        ...["--no-pr", "--session", session, "--state-dir", stateDir, "--port", String(host.port)],
      ],
      { print: () => {}, openUrl: () => {}, environment: {}, home },
    );
    return (await api<{ id: string }>("/api/reviews/by-key", { key })).data.id;
  };
  /** The tab with this ID, as the thread list has it. */
  const tab = async (id: string) =>
    (await api<ThreadList>("/api/threads")).data.threads.find((thread) => thread.id === id);
  return {
    run,
    api,
    threads,
    adopted,
    handOff,
    tab,
    repo,
    glossary,
    elsewhere,
    glossaryPath,
    archivedPath,
    host,
    stateDir,
  };
}

test("find lists sessions of any age by title, first prompt, or folder, newest first", async () => {
  const { run, repo, glossary } = await fixture();
  // The title and the folder.
  const glossaryLine = await run("find", "glossary");
  expect(glossaryLine.split("\n")).toHaveLength(2);
  expect(glossaryLine.split("\n")[0]!.split("\t")).toEqual([
    `claude:${ids.glossary}`,
    expect.stringMatching(/^\d{4}-\d\d-\d\d \d\d:\d\d$/),
    glossary,
    "README glossary",
  ]);
  // The archived Codex session works in the glossary worktree too.
  expect(glossaryLine.split("\n")[1]).toMatch(new RegExp(`^codex:${ids.archived}\t`));
  // Words of the first prompt, in any order and case; old sessions too.
  expect((await run("find", "README", "PREDICTION")).split("\t")).toEqual([
    `claude:${ids.tides}`,
    expect.any(String),
    repo,
    "Explain the tide prediction model in the README",
  ]);
  const json = JSON.parse(await run("find", "feet", "--json")) as SessionEntry[];
  expect(json).toEqual([
    expect.objectContaining({
      agent: "codex",
      id: ids.feet,
      title: "Readers in the US want heights in feet",
      prompt: "Readers in the US want heights in feet.",
      cwd: repo,
      repository: "tide",
    }),
  ]);
  expect(json[0]!.thread).toBeUndefined();
  expect(await run("find", "no such words")).toBe(
    'No Claude Code or Codex session matches "no such words".',
  );
  // Without words, the newest first, up to --limit.
  const newest = (await run("find", "--limit", "3")).split("\n");
  expect(newest).toHaveLength(3);
  expect(newest.map((line) => line.split("\t")[0])).not.toContain(`codex:${ids.archived}`);
});

test("adopt keeps a Claude Code or Codex session as a thread by ID or by path, and fails clearly", async () => {
  const {
    run,
    api,
    threads,
    adopted,
    tab,
    repo,
    glossary,
    elsewhere,
    glossaryPath,
    archivedPath,
    host,
    stateDir,
  } = await fixture();

  // Claude Code by ID: a session of a month ago. Its thread is the session,
  // with no review until it hands one off, in the checkout that it works in.
  const tides = adopted(await run("adopt", ids.tides));
  expect(tides).toEqual({
    id: `claude-${ids.tides}`,
    title: "Explain the tide prediction model in the README",
    again: false,
  });
  expect(await tab(tides.id)).toMatchObject({
    kind: "session",
    session: { agent: "claude", id: ids.tides, cwd: repo },
    checkout: repo,
    reviews: [],
    open: true,
  });
  // Its session pane reads the transcript.
  expect((await api(`/api/sessions/${tides.id}/turns`)).status).toBe(200);
  // Again: the same thread, also back from the archive as a tab.
  expect((await api(`/api/threads/${tides.id}/close`, {})).status).toBe(200);
  expect(await tab(tides.id)).toBeUndefined();
  expect(adopted(await run("adopt", `claude:${ids.tides}`))).toEqual({ ...tides, again: true });
  expect(await tab(tides.id)).toBeDefined();

  // Claude Code by path: a recent session is in history while its agent does
  // not work; adopted, the same thread is a tab.
  const latest = await threads();
  await vi.waitFor(
    async () =>
      expect(
        (await api<{ threads: Thread[] }>("/api/threads/history")).data.threads.find(
          (thread) => thread.title === "README glossary",
        ),
      ).toMatchObject({ id: `claude-${ids.glossary}`, open: false }),
    { timeout: 10_000 },
  );
  const glossaryThread = adopted(await run("adopt", glossaryPath));
  expect(glossaryThread).toEqual({
    id: `claude-${ids.glossary}`,
    title: "README glossary",
    again: false,
  });
  await vi.waitFor(
    () =>
      expect(latest.value!.threads.filter((thread) => thread.title === "README glossary")).toEqual([
        expect.objectContaining({ id: glossaryThread.id, checkout: glossary }),
      ]),
    { timeout: 10_000 },
  );

  // Codex by ID, from a day folder of 40 days ago.
  const feet = adopted(await run("adopt", ids.feet, "--title", "Heights in feet"));
  expect(feet).toMatchObject({ id: `codex-${ids.feet}`, title: "Heights in feet" });
  expect((await tab(feet.id))?.session).toEqual({ agent: "codex", id: ids.feet, cwd: repo });
  expect((await api(`/api/sessions/${feet.id}/turns`)).status).toBe(200);

  // Codex by path, from its archive, with JSON.
  const archived = JSON.parse(await run("adopt", archivedPath, "--json")) as {
    id: string;
    url: string;
    created: boolean;
    session: SessionEntry;
  };
  expect(archived).toMatchObject({
    id: `codex-${ids.archived}`,
    created: true,
    url: expect.stringMatching(new RegExp(`/review/codex-${ids.archived}$`)),
    session: { agent: "codex", id: ids.archived, archived: true, cwd: glossary },
  });
  expect((await api(`/api/sessions/${archived.id}/turns`)).status).toBe(200);
  // find shows which thread holds a session now.
  expect(await run("find", "feet")).toMatch(new RegExp(`\t${feet.id}$`));

  // A session outside the registered repositories is a thread too, in no
  // repository until it works in one.
  const trip = adopted(await run("adopt", ids.elsewhere));
  const away = await tab(trip.id);
  expect(away).toMatchObject({ session: { agent: "claude", id: ids.elsewhere, cwd: elsewhere } });
  expect(away?.repository).toBeUndefined();

  // No session, and more than one.
  await expect(run("adopt", "99999999-9999-4999-8999-999999999999")).rejects.toThrow(
    `No Claude Code or Codex session matches "99999999-9999-4999-8999-999999999999". Run med thread find --port ${host.port} --state-dir '${stateDir}' <words> to list sessions.`,
  );
  await expect(run("adopt", join(repo, "README.md"))).rejects.toThrow(
    /^No Claude Code or Codex session matches/,
  );
  const twins = run("adopt", "abcdef0");
  await expect(twins).rejects.toThrow(/^"abcdef0" names more than one session/);
  await expect(twins).rejects.toThrow(`claude:${ids.twinA}`);
  await expect(twins).rejects.toThrow(`claude:${ids.twinB}`);
});

test("a session's hand-off joins its thread; med thread show says to hand off instead", async () => {
  const { run, api, adopted, handOff, tab } = await fixture();
  const tides = adopted(await run("adopt", ids.tides));
  await expect(run("show", "--working")).rejects.toThrow(
    "med thread show is gone: hand off your changes with med review create",
  );
  const review = await handOff(`claude:${ids.tides}`, "tides");
  expect((await tab(tides.id))?.reviews.map((entry) => entry.id)).toEqual([review]);
  // The review has no tab of its own.
  const tabs = (await api<ThreadList>("/api/threads")).data.threads.map((thread) => thread.id);
  expect(tabs).not.toContain(review);
  // Its link opens the session's thread.
  expect((await api<{ thread: Thread }>(`/api/threads/${review}/open`, {})).data.thread.id).toBe(
    tides.id,
  );
});

test("list, close, reopen, open, and delete tabs from the command line", async () => {
  const { run, api, adopted, handOff } = await fixture();
  const tides = adopted(await run("adopt", ids.tides));
  const feet = adopted(await run("adopt", ids.feet, "--title", "Heights in feet"));
  const ids_ = (output: string) => output.split("\n").map((line) => line.split("\t")[0]);

  // The tabs, newest first. Their sessions last worked weeks before Med
  // watched them, so neither finished since you looked: both are idle.
  const listed = await run("list");
  expect(listed.split("\n")).toEqual([
    `${tides.id}\tidle\ttide/main\tExplain the tide prediction model in the README`,
    `${feet.id}\tidle\ttide/main\tHeights in feet`,
  ]);
  const json = JSON.parse(await run("list", "--json")) as Thread[];
  expect(json.map((thread) => [thread.id, thread.open])).toEqual([
    [tides.id, true],
    [feet.id, true],
  ]);

  // close archives a tab; its agent's session stays.
  expect(await run("close", feet.id)).toBe(`Archived ${feet.id}.`);
  expect(await run("close", feet.id)).toBe(`${feet.id} was not open.`);
  expect(ids_(await run("list"))).toEqual([tides.id]);
  const archived = (await run("list", "--archived")).split("\n");
  expect(archived[0]).toBe(`${feet.id}\tclosed\ttide/main\tHeights in feet`);
  // --history, its old name, still works.
  expect(ids_(await run("list", "--history"))).not.toContain(tides.id);

  // reopen brings back the tab that closed last.
  expect(await run("reopen")).toBe(`Opened "Heights in feet" (${feet.id}).`);
  expect(ids_(await run("list"))).toEqual([tides.id, feet.id]);
  await expect(run("reopen")).rejects.toThrow("No archived thread to reopen.");

  // The key of a session's review names its thread too.
  await handOff(`claude:${ids.tides}`, "tides");
  expect(await run("close", "--key", "tides")).toBe(`Archived ${tides.id}.`);
  expect(await run("open", tides.id)).toBe(
    `Opened "Explain the tide prediction model in the README" as a tab (${tides.id}).`,
  );
  expect(ids_(await run("list"))).toContain(tides.id);

  // delete removes the thread with its reviews; the session stays a transcript.
  const review = await handOff(`codex:${ids.feet}`, "feet");
  expect(await run("delete", feet.id)).toBe(`Deleted ${feet.id}.`);
  expect((await api(`/api/reviews/${review}`)).status).toBe(404);
  expect(ids_(await run("list"))).toEqual([tides.id]);
  expect(await run("list", "--archived")).not.toContain(feet.id);
  expect(await run("find", "feet")).toContain(`codex:${ids.feet}`);

  // Mistakes say what to do.
  await expect(run("open", "nope")).rejects.toThrow('"nope" is not a thread ID');
  await expect(run("close")).rejects.toThrow("Name the thread by its ID or by --key.");
  await expect(run("open", tides.id, "--remove-worktree")).rejects.toThrow(
    "Use --remove-worktree with close.",
  );
  expect(await run()).toContain("med thread adopt <session>");
});

test("list says which tabs need you, finished since you looked, work, or are idle; wait waits for a change", async () => {
  const { run, api, adopted, handOff, glossaryPath, host, stateDir } = await fixture();
  const glossary = adopted(await run("adopt", ids.glossary));
  const tides = adopted(await run("adopt", ids.tides));
  // The glossary session handed off a review, whose key names its thread.
  await handOff(`claude:${ids.glossary}`, "glossary");
  const listed = async () =>
    new Map(
      (await api<ThreadList>("/api/threads")).data.threads.map((thread) => [thread.id, thread]),
    );
  const state = async (id: string) =>
    (await run("list"))
      .split("\n")
      .find((row) => row.startsWith(id))!
      .split("\t")[1];
  // The reader saw both threads as they are.
  for (const thread of (await listed()).values())
    await api(`/api/threads/${thread.id}/seen`, { at: thread.updatedAt });
  expect(await state(glossary.id)).toBe("idle");

  // A turn that works, and then ends while no one looks: done.
  const turn = (role: "user" | "assistant") => ({
    type: role,
    cwd: dirname(glossaryPath),
    sessionId: ids.glossary,
    uuid: `${ids.glossary}-${role}-${Date.now()}`,
    timestamp: new Date().toISOString(),
    message:
      role === "user"
        ? { role, content: "Add one more entry." }
        : { role, stop_reason: "end_turn", content: [{ type: "text", text: "Added." }] },
  });
  await appendFile(glossaryPath, lines([turn("user")]));
  await expect.poll(() => state(glossary.id), { timeout: 10_000 }).toBe("working");
  const json = JSON.parse(await run("list", "--json")) as (Thread & { attention: string })[];
  expect(json.find((thread) => thread.id === glossary.id)!.attention).toBe("working");

  // wait ends when the turn ends, and says which thread finished.
  const waiting = run("wait", glossary.id, "--timeout", "20");
  await new Promise((resolve) => setTimeout(resolve, 600));
  await appendFile(glossaryPath, lines([turn("assistant")]));
  const ended = (await waiting).split("\n");
  expect(ended[0]).toBe("A thread finished its work.");
  expect(ended[1]).toMatch(new RegExp(`^${glossary.id}\\tdone\\t`));
  expect(await state(glossary.id)).toBe("done");
  // Seen in a window, it is idle again.
  const now = (await listed()).get(glossary.id)!;
  await api(`/api/threads/${glossary.id}/seen`, { at: now.updatedAt });
  expect(await state(glossary.id)).toBe("idle");

  // With nothing at work, a wait ends at once; without names it waits on
  // every tab but the caller's own thread.
  const output: string[] = [];
  await runThreadCommand(["wait", "--json", "--state-dir", stateDir, "--port", String(host.port)], {
    print: (text) => output.push(text),
    environment: { MED_THREAD_KEY: "glossary" },
  });
  const own = JSON.parse(output.join("\n")) as {
    ended: boolean;
    reason: string;
    threads: { id: string; state: string }[];
  };
  expect(own).toMatchObject({ ended: true, reason: "nothing" });
  expect(own.threads.map((thread) => thread.id)).toEqual([tides.id]);

  // A timeout is a check-in: it says so and lists the states.
  await appendFile(glossaryPath, lines([turn("user")]));
  await expect.poll(() => state(glossary.id), { timeout: 10_000 }).toBe("working");
  const check = (await run("wait", "--key", "glossary", "--timeout", "1")).split("\n");
  expect(check[0]).toBe("Timed out after 1 s, a check-in: 1 thread works. Wait again to go on.");
  expect(check[1]).toMatch(new RegExp(`^${glossary.id}\\tworking\\t`));

  // Mistakes say what to do.
  await expect(run("wait", "--until", "soon")).rejects.toThrow(
    "--until takes needs-you, done, idle.",
  );
  await expect(run("wait", "--timeout", "soon")).rejects.toThrow("--timeout takes seconds");
  await expect(run("wait", `r_${"0".repeat(24)}`)).rejects.toThrow("is not a tab");
  await expect(run("list", "--until", "done")).rejects.toThrow(
    "Use --until and --timeout with wait.",
  );
});
