import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { runThreadCommand } from "../../src/cli/thread";
import { claudeProjectFolder } from "../../src/host/found-sessions";
import { startHost, type RunningHost } from "../../src/host/server";
import type { SessionEntry } from "../../src/shared/found-sessions";
import type { SavedReview } from "../../src/shared/saved-review";
import type { Thread, ThreadList } from "../../src/shared/threads";
import { readServerEvents } from "../../src/web/data/sse";

// `med thread` through the production host, on a scratch home with Claude
// Code and Codex transcripts of several ages: find and adopt sessions, and
// list, open, close, reopen, and delete the tabs.

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
      `^Thread (r_[a-f0-9]{24}): \\[(.+)\\]\\(http://127\\.0\\.0\\.1:${host.port}/review/(r_[a-f0-9]{24})\\)( \\(already in Med\\))?$`,
    ).exec(output);
    if (!match) throw new Error(`Not an adopted thread: ${output}`);
    expect(match![1]).toBe(match![3]);
    expect(output).not.toContain(host.token);
    return { id: match![1]!, title: match![2]!, again: !!match![4] };
  };
  /** `med thread show` from a directory, with the session's environment. */
  const show = async (args: string[], environment: NodeJS.ProcessEnv = {}, cwd = glossary) => {
    const output: string[] = [];
    await runThreadCommand(
      ["show", ...args, "--state-dir", stateDir, "--port", String(host.port)],
      { print: (text) => output.push(text), openUrl: () => {}, environment, cwd },
    );
    return output.join("\n");
  };
  return {
    run,
    show,
    api,
    threads,
    adopted,
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

test("adopt makes a Claude Code or Codex session a thread by ID or by path, and fails clearly", async () => {
  const {
    run,
    api,
    threads,
    adopted,
    repo,
    glossary,
    elsewhere,
    glossaryPath,
    archivedPath,
    host,
    stateDir,
  } = await fixture();

  // Claude Code by ID: a session of a month ago. The thread captures
  // nothing: it names its checkout, whose Changes stay live.
  await writeFile(join(repo, "README.md"), "# tide\n\nSomeone else's change.\n");
  const tides = adopted(await run("adopt", ids.tides));
  expect(tides.title).toBe("Explain the tide prediction model in the README");
  const saved = (await api<SavedReview>(`/api/reviews/${tides.id}`)).data;
  expect(saved.sessions).toEqual([{ agent: "claude", id: ids.tides, cwd: repo }]);
  expect(saved.targets).toEqual([]);
  expect(saved.iterations).toBeUndefined();
  expect(saved.checkout).toEqual({ repositoryId: expect.any(String), repo, branch: "main" });
  // Its session pane reads the transcript.
  expect((await api(`/api/reviews/${tides.id}/sessions/${ids.tides}/turns`)).status).toBe(200);
  // A new thread opens as a tab.
  const tabIds = async () =>
    (await api<ThreadList>("/api/threads")).data.threads.map((thread) => thread.id);
  expect(await tabIds()).toContain(tides.id);
  // Again: the same thread, also back from history as a tab.
  expect((await api(`/api/threads/${tides.id}/close`, {})).status).toBe(200);
  expect(await tabIds()).not.toContain(tides.id);
  expect(adopted(await run("adopt", `claude:${ids.tides}`))).toEqual({ ...tides, again: true });
  expect(await tabIds()).toContain(tides.id);

  // Claude Code by path: the found thread, in history as its agent does not
  // work, gives way to the saved one.
  const latest = await threads();
  await vi.waitFor(
    async () =>
      expect(
        (await api<{ threads: Thread[] }>("/api/threads/history")).data.threads.find(
          (thread) => thread.title === "README glossary",
        ),
      ).toMatchObject({ id: `found-claude-${ids.glossary}`, open: false }),
    { timeout: 10_000 },
  );
  const glossaryThread = adopted(await run("adopt", glossaryPath));
  expect(glossaryThread).toMatchObject({ title: "README glossary", again: false });
  await vi.waitFor(
    () =>
      expect(latest.value!.threads.filter((thread) => thread.title === "README glossary")).toEqual([
        expect.objectContaining({ id: glossaryThread.id, checkout: glossary }),
      ]),
    { timeout: 10_000 },
  );

  // Codex by ID, from a day folder of 40 days ago.
  const feet = adopted(await run("adopt", ids.feet, "--title", "Heights in feet"));
  expect(feet.title).toBe("Heights in feet");
  expect((await api<SavedReview>(`/api/reviews/${feet.id}`)).data.sessions).toEqual([
    { agent: "codex", id: ids.feet, cwd: repo },
  ]);
  expect((await api(`/api/reviews/${feet.id}/sessions/${ids.feet}/turns`)).status).toBe(200);

  // Codex by path, from its archive, with JSON.
  const archived = JSON.parse(await run("adopt", archivedPath, "--json")) as {
    id: string;
    url: string;
    created: boolean;
    session: SessionEntry;
  };
  expect(archived).toMatchObject({
    created: true,
    url: expect.stringMatching(/\/review\/r_[a-f0-9]{24}$/),
    session: { agent: "codex", id: ids.archived, archived: true, cwd: glossary },
  });
  expect((await api(`/api/reviews/${archived.id}/sessions/${ids.archived}/turns`)).status).toBe(
    200,
  );
  // find shows which thread holds a session now.
  expect(await run("find", "feet")).toMatch(new RegExp(`\t${feet.id}$`));

  // No session, more than one, and a folder that is not a registered repository.
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
  await expect(run("adopt", ids.elsewhere)).rejects.toThrow(
    `The session's folder ${elsewhere} is not in a registered repository. Run med add --port ${host.port} --state-dir '${stateDir}' <repository>, or choose a checkout with --repo <path>.`,
  );
  // --repo chooses the checkout.
  const trip = adopted(await run("adopt", ids.elsewhere, "--repo", repo));
  expect((await api<SavedReview>(`/api/reviews/${trip.id}`)).data).toMatchObject({
    sessions: [{ agent: "claude", id: ids.elsewhere, cwd: elsewhere }],
    targets: [],
    checkout: { repo },
  });
});

test("show adds a Review version to the session's thread: files, the branch, a commit, or a manifest", async () => {
  const { run, show, api, adopted, glossary, glossaryPath, host, stateDir } = await fixture();
  // The glossary branch has a commit, and the worktree has uncommitted changes.
  await writeFile(join(glossary, "terms.md"), "Range: high water less low water.\n");
  git(glossary, ["add", "terms.md"]);
  git(glossary, ["commit", "-q", "-m", "Add terms"]);
  await writeFile(join(glossary, "README.md"), "# tide\n\n## Glossary\n");
  await writeFile(join(glossary, "scratch.txt"), "not for review\n");

  // Not adopted yet: show says how.
  await expect(
    show(["--paths", "README.md"], { CLAUDE_CODE_SESSION_ID: ids.glossary }),
  ).rejects.toThrow(
    `No Med thread holds session ${ids.glossary}. Run med thread adopt --port ${host.port} --state-dir '${stateDir}' ${ids.glossary} first`,
  );
  const thread = adopted(await run("adopt", ids.glossary));
  const versions = async () => {
    const saved = (await api<SavedReview>(`/api/reviews/${thread.id}`)).data;
    const current = saved.iterations?.at(-1);
    const target = saved.targets.find((entry) => entry.id === current?.targetIds[0])!;
    const shown = (
      await api<{ files: { path: string }[] }>(
        `/api/reviews/${thread.id}/targets/${target.id}/review`,
      )
    ).data;
    return {
      count: saved.iterations?.length ?? 0,
      comparison: target.comparison,
      paths: shown.files.map((file) => file.path).sort(),
    };
  };
  expect((await api<SavedReview>(`/api/reviews/${thread.id}`)).data.targets).toEqual([]);

  // The Claude Code session that runs the command finds its thread.
  expect(await show(["--paths", "README.md"], { CLAUDE_CODE_SESSION_ID: ids.glossary })).toMatch(
    new RegExp(
      `^Version 1 of \\[README glossary\\]\\(http://127\\.0\\.0\\.1:\\d+/review/${thread.id}\\)$`,
    ),
  );
  expect(await versions()).toEqual({
    count: 1,
    comparison: { kind: "working", paths: ["README.md"] },
    paths: ["README.md"],
  });
  // A subagent has its parent's session ID, so show does not guess its thread.
  const subagents = join(dirname(glossaryPath), ids.glossary, "subagents");
  await mkdir(subagents, { recursive: true });
  await writeFile(
    join(subagents, "agent-a1.jsonl"),
    lines([
      {
        type: "assistant",
        isSidechain: true,
        timestamp: new Date().toISOString(),
        message: {
          content: [
            {
              type: "tool_use",
              id: "t1",
              name: "Bash",
              input: { command: "med thread show --working" },
            },
          ],
        },
      },
    ]),
  );
  await expect(show(["--working"], { CLAUDE_CODE_SESSION_ID: ids.glossary })).rejects.toThrow(
    `This command runs in a subagent of Claude Code session ${ids.glossary}`,
  );
  await rm(subagents, { recursive: true });
  // --base: the branch's commit and its uncommitted changes.
  await show(["--base", "main"], { CLAUDE_CODE_SESSION_ID: ids.glossary });
  expect(await versions()).toEqual({
    count: 2,
    comparison: { kind: "working", base: "main" },
    paths: ["README.md", "scratch.txt", "terms.md"],
  });
  // --key names the thread (as MED_THREAD_KEY does in a Med thread).
  const key = (await api<SavedReview>(`/api/reviews/${thread.id}`)).data.key!;
  await show(["--commit", "HEAD"], { MED_THREAD_KEY: key });
  expect(await versions()).toMatchObject({ count: 3, paths: ["terms.md"] });
  await show(["--base", "main", "--head", "HEAD", "--key", key]);
  expect(await versions()).toMatchObject({ count: 4, paths: ["terms.md"] });
  // Mistakes say what to do.
  await expect(show(["--key", key])).rejects.toThrow(
    "Say what to show: --paths, --base, --commit, --working, or --manifest.",
  );
  await expect(show(["--commit", "HEAD", "--working", "--key", key])).rejects.toThrow(
    /^Use one of --paths/,
  );
  await expect(show(["--paths", "README.md"])).rejects.toThrow(/^Med does not know this session/);
});

test("list, close, reopen, open, and delete tabs from the command line", async () => {
  const { run, api, adopted } = await fixture();
  const tides = adopted(await run("adopt", ids.tides));
  const feet = adopted(await run("adopt", ids.feet, "--title", "Heights in feet"));
  const ids_ = (output: string) => output.split("\n").map((line) => line.split("\t")[0]);

  // The tabs in the sidebar's order: a new one at the top of its repository.
  const listed = await run("list");
  expect(listed.split("\n")).toEqual([
    `${feet.id}\tidle\ttide/main\tHeights in feet`,
    `${tides.id}\tidle\ttide/main\tExplain the tide prediction model in the README`,
  ]);
  const json = JSON.parse(await run("list", "--json")) as Thread[];
  expect(json.map((thread) => [thread.id, thread.open])).toEqual([
    [feet.id, true],
    [tides.id, true],
  ]);

  // close sends a tab to history; its agent's session stays.
  expect(await run("close", feet.id)).toBe(`Closed ${feet.id}; it is in history.`);
  expect(await run("close", feet.id)).toBe(`${feet.id} was not open.`);
  expect(ids_(await run("list"))).toEqual([tides.id]);
  const history = (await run("list", "--history")).split("\n");
  expect(history[0]).toBe(`${feet.id}\tclosed\ttide/main\tHeights in feet`);
  expect(ids_(await run("list", "--history"))).not.toContain(tides.id);

  // reopen brings back the tab that closed last, at its place.
  expect(await run("reopen")).toBe(`Opened "Heights in feet" (${feet.id}).`);
  expect(ids_(await run("list"))).toEqual([feet.id, tides.id]);
  await expect(run("reopen")).rejects.toThrow("History has no thread to reopen.");

  // A key names a thread too; open puts a thread from history at the top.
  const key = (await api<SavedReview>(`/api/reviews/${tides.id}`)).data.key!;
  expect(await run("close", "--key", key)).toBe(`Closed ${tides.id}; it is in history.`);
  expect(await run("open", tides.id)).toBe(
    `Opened "Explain the tide prediction model in the README" as a tab (${tides.id}).`,
  );
  expect(ids_(await run("list"))).toEqual([tides.id, feet.id]);

  // delete removes the thread with its captures; the session stays a transcript.
  expect(await run("delete", feet.id)).toBe(`Deleted ${feet.id}.`);
  expect((await api(`/api/reviews/${feet.id}`)).status).toBe(404);
  expect(ids_(await run("list"))).toEqual([tides.id]);
  expect(await run("list", "--history")).not.toContain(feet.id);
  expect(await run("find", "feet")).toContain(`codex:${ids.feet}`);

  // Mistakes say what to do.
  await expect(run("open", "nope")).rejects.toThrow('"nope" is not a thread ID');
  await expect(run("close")).rejects.toThrow("Name the thread by its ID or by --key.");
  await expect(run("open", tides.id, "--remove-worktree")).rejects.toThrow(
    "Use --remove-worktree with close.",
  );
  expect(await run()).toContain("med thread adopt <session>");
});
