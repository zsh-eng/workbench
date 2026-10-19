import { afterEach, expect, test, vi } from "vitest";
import { execFileSync } from "node:child_process";
import {
  appendFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { removeGitEnvironment } from "../../scripts/git-environment.mjs";
import { claudeProjectFolder } from "../../src/host/found-sessions";
import { startHost, type RunningHost } from "../../src/host/server";
import type { SessionEntry } from "../../src/shared/found-sessions";
import type { QuestionState } from "../../src/shared/questions";
import type { SavedReview } from "../../src/shared/saved-review";
import type { Thread } from "../../src/shared/threads";
import { readServerEvents } from "../../src/web/data/sse";
import { removeFolder } from "./remove-folder";

// The scratch repositories' Git must not reach the checkout's repository.
removeGitEnvironment();

const directories: string[] = [];
const hosts: RunningHost[] = [];
const streams: AbortController[] = [];
afterEach(async () => {
  for (const stream of streams.splice(0)) stream.abort();
  await Promise.all(hosts.splice(0).map((host) => host.close()));
  await Promise.all(directories.splice(0).map((path) => removeFolder(path)));
  vi.unstubAllEnvs();
});

const agentScript = (name: string) =>
  fileURLToPath(new URL(`../fixtures/agents/${name}`, import.meta.url));
const LEAD = "11111111-1111-4111-8111-111111111111";
const SENTINEL = "33333333-3333-4333-8333-333333333333";
const CODEX = "019a0000-0000-7000-8000-00000000c0de";
const excerpt = {
  path: "summary.ts",
  side: "new" as const,
  start: 1,
  end: 1,
  lines: [{ number: 1, mark: "+" as const, text: "export const best = 1;" }],
};

/** A registered repository, a Claude Code session that worked on it, and a
 * host whose Claude Code and Codex are the fakes. */
async function fixture() {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "med questions ")));
  directories.push(directory);
  const repo = join(directory, "repo");
  await mkdir(repo);
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: repo });
  await writeFile(join(repo, "summary.ts"), "export const best = 1;\n");
  const home = join(directory, "home");
  vi.stubEnv("MED_HOME_DIR", home);
  vi.stubEnv("MED_CODEX_PATH", agentScript("fake-codex.mjs"));
  const project = join(home, ".claude", "projects", claudeProjectFolder(repo));
  await mkdir(project, { recursive: true });
  const transcript = (id: string, prompt: string) =>
    [
      { type: "user", message: { role: "user", content: prompt } },
      {
        type: "assistant",
        message: {
          id: `msg_${id.slice(0, 4)}`,
          role: "assistant",
          model: "claude-opus-test",
          stop_reason: "end_turn",
          content: [{ type: "text", text: "Done." }],
        },
      },
    ]
      .map((entry, index) =>
        JSON.stringify({
          ...entry,
          uuid: `${id}-${index}`,
          sessionId: id,
          cwd: repo,
          timestamp: new Date(Date.now() - 60_000 + index * 1000).toISOString(),
        }),
      )
      .join("\n")
      .concat("\n");
  const lead = join(project, `${LEAD}.jsonl`);
  await writeFile(lead, transcript(LEAD, "Format durations as minutes."));
  const stateDir = join(directory, "state");
  const host = await startHost({
    repo,
    repos: [repo],
    stateDir,
    port: 0,
    agents: async () => [
      {
        id: "claude",
        name: "Claude Code",
        kind: "claude",
        available: true,
        command: process.execPath,
        args: [agentScript("fake-claude.mjs")],
      },
    ],
  });
  hosts.push(host);
  const headers = { authorization: `Bearer ${host.token}`, "content-type": "application/json" };
  const api = async <T>(path: string, body?: unknown) => {
    const response = await fetch(`http://127.0.0.1:${host.port}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, data: (await response.json()) as T };
  };
  /** The question's states as they stream, and whether the stream ended. */
  const watch = async (id: string) => {
    const response = await fetch(`http://127.0.0.1:${host.port}/api/questions/${id}/events`, {
      headers,
    });
    expect(response.status).toBe(200);
    const seen = { states: [] as QuestionState[], ended: false };
    const controller = new AbortController();
    streams.push(controller);
    void readServerEvents(
      response.body!,
      (event) => seen.states.push(JSON.parse(event.data) as QuestionState),
      controller.signal,
    )
      .then(() => (seen.ended = true))
      .catch(() => {});
    return {
      seen,
      until: (check: (state: QuestionState) => boolean) =>
        vi.waitFor(
          () => {
            const state = seen.states.at(-1);
            if (!state || !check(state)) throw new Error(`Not yet: ${JSON.stringify(state)}`);
            return state;
          },
          { timeout: 8000 },
        ),
    };
  };
  const ask = (thread: string, question: string) =>
    api<QuestionState>("/api/questions", { thread, question, excerpt });
  /** The found threads, after a scan that saw a session written after this call. */
  const foundAfterScan = async () => {
    await writeFile(
      join(project, `${SENTINEL}.jsonl`),
      transcript(SENTINEL, "Check the sentinel."),
    );
    return vi.waitFor(
      async () => {
        const { data } = await api<{ threads: Thread[] }>("/api/threads/history");
        const found = data.threads.filter((thread) => thread.found);
        if (!found.some((thread) => thread.id === `found-claude-${SENTINEL}`))
          throw new Error("The scan has not run yet.");
        return found.map((thread) => thread.id);
      },
      { timeout: 10_000, interval: 300 },
    );
  };
  const claudeRun = async (id: string) =>
    JSON.parse(await readFile(join(home, "claude-print", `${id}.args.json`), "utf8")) as string[];
  return { api, ask, watch, repo, home, project, lead, stateDir, foundAfterScan, claudeRun };
}

test("a question forks the lead Claude session in plan mode; the lead, the found list, and the search never get it", async () => {
  const { api, ask, watch, project, lead, stateDir, foundAfterScan, claudeRun } = await fixture();
  const leadBytes = await readFile(lead);

  const asked = await ask(`found-claude-${LEAD}`, "Why minutes?");
  expect(asked.status).toBe(200);
  expect(asked.data).toMatchObject({ agent: "claude", context: "thread" });
  const { until } = await watch(asked.data.id);
  const answered = await until((state) => state.status === "done");
  // The fork has the thread's context, plan mode, and the model the thread used.
  expect(answered.answer).toBe(
    "Mode plan, model claude-opus-test, effort default. The thread began with: Format durations as minutes.. You asked: Why minutes?",
  );

  const forkId = (await readdir(project))
    .map((name) => name.replace(/\.jsonl$/, ""))
    .find((name) => name !== LEAD && name !== SENTINEL)!;
  const args = await claudeRun(forkId);
  expect(args).toEqual([
    "-p",
    "--resume",
    LEAD,
    "--fork-session",
    "--session-id",
    forkId,
    "--permission-mode",
    "plan",
    "--output-format",
    "stream-json",
    "--verbose",
    "--include-partial-messages",
    "--model",
    "claude-opus-test",
  ]);
  // The user's message is the question and the excerpt; Med adds nothing.
  const fork = (await readFile(join(project, `${forkId}.jsonl`), "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as { type: string; message: { content: unknown } });
  expect(fork.filter((entry) => entry.type === "user").at(-1)!.message.content).toBe(
    "Why minutes?\n\nsummary.ts, line 1 after the change:\n\n```\n1 + export const best = 1;\n```\n",
  );
  // The lead session gets nothing.
  expect((await readFile(lead)).equals(leadBytes)).toBe(true);

  // The fork is not a thread, in the list or in the search.
  const found = await foundAfterScan();
  expect(found).toContain(`found-claude-${LEAD}`);
  expect(found).not.toContain(`found-claude-${forkId}`);
  const search = await api<{ sessions: SessionEntry[] }>("/api/sessions/find", { text: "" });
  expect(search.data.sessions.map((session) => session.id)).not.toContain(forkId);
  expect(await readFile(join(stateDir, "question-forks.json"), "utf8")).toContain(forkId);

  // Close discards the question and removes the fork's transcript.
  expect((await api("/api/questions/close", { id: asked.data.id })).data).toEqual({ closed: true });
  await expect(readFile(join(project, `${forkId}.jsonl`))).rejects.toThrow(/ENOENT/);
  expect((await readFile(lead)).equals(leadBytes)).toBe(true);
  expect(await readFile(join(stateDir, "question-forks.json"), "utf8")).not.toContain(forkId);
  expect((await api(`/api/questions/stop`, { id: asked.data.id })).status).toBe(404);
});

test("Close keeps a fork's transcript, still left out, when a record names another session", async () => {
  const { api, ask, watch, project, foundAfterScan } = await fixture();
  const asked = await ask(`found-claude-${LEAD}`, "Why minutes?");
  await (await watch(asked.data.id)).until((state) => state.status === "done");
  const forkId = (await readdir(project))
    .map((name) => name.replace(/\.jsonl$/, ""))
    .find((name) => name !== LEAD)!;
  const forkPath = join(project, `${forkId}.jsonl`);
  // A record that the check cannot place: Med is not sure the file is the fork's.
  await appendFile(forkPath, `${JSON.stringify({ type: "user", sessionId: LEAD })}\n`);
  await api("/api/questions/close", { id: asked.data.id });
  expect(await readFile(forkPath, "utf8")).toContain(forkId);
  expect(await foundAfterScan()).not.toContain(`found-claude-${forkId}`);
});

test("Stop ends the fork's process and keeps the answer so far", async () => {
  const { api, ask, watch, project, home } = await fixture();
  const asked = await ask(`found-claude-${LEAD}`, "Wait, why minutes?");
  const { until } = await watch(asked.data.id);
  await until((state) => state.status === "answering" && state.answer.startsWith("Mode plan"));
  const forkId = (await readdir(project))
    .map((name) => name.replace(/\.jsonl$/, ""))
    .find((name) => name !== LEAD)!;
  const pid = Number(await readFile(join(home, "claude-print", `${forkId}.pid`), "utf8"));
  expect(() => process.kill(pid, 0)).not.toThrow();

  const stopped = await api<QuestionState>("/api/questions/stop", { id: asked.data.id });
  expect(stopped.data.status).toBe("stopped");
  expect(stopped.data.answer).toMatch(/^Mode plan/);
  expect(() => process.kill(pid, 0)).toThrow(/ESRCH/);
});

test("Codex answers from the excerpt in a read-only session when its CLI cannot fork", async () => {
  const { api, repo, home } = await fixture();
  const review = (
    await api<SavedReview>("/api/reviews", {
      title: "Format durations",
      targets: [{ repo, comparison: { kind: "working" } }],
      sessions: [{ agent: "codex", id: CODEX, cwd: repo }],
    })
  ).data;
  const asked = await api<QuestionState>("/api/questions", {
    thread: review.id,
    question: "Why minutes?",
    excerpt,
  });
  expect(asked.data).toMatchObject({ agent: "codex", context: "excerpt" });
  const runs = join(home, "codex-runs");
  const run = await vi.waitFor(async () => {
    const [name] = (await readdir(runs)).filter((entry) => entry.endsWith(".json"));
    if (!name) throw new Error("No run yet.");
    return JSON.parse(await readFile(join(runs, name), "utf8")) as {
      args: string[];
      cwd: string;
      prompt: string;
    };
  });
  expect(run.args).toEqual([
    "exec",
    "--json",
    "--ephemeral",
    "--skip-git-repo-check",
    "-c",
    'approval_policy="never"',
    "--sandbox",
    "read-only",
    "-",
  ]);
  expect(run.cwd).toBe(repo);
  expect(run.prompt).toBe(
    "Why minutes?\n\nsummary.ts, line 1 after the change:\n\n```\n1 + export const best = 1;\n```\n",
  );
});

test("Codex answers in a read-only fork of the thread when its CLI has exec fork", async () => {
  vi.stubEnv("FAKE_CODEX_FORK", "1");
  const { api, repo } = await fixture();
  const review = (
    await api<SavedReview>("/api/reviews", {
      title: "Format durations",
      targets: [{ repo, comparison: { kind: "working" } }],
      sessions: [{ agent: "codex", id: CODEX, cwd: repo }],
    })
  ).data;
  const asked = await api<QuestionState>("/api/questions", {
    thread: review.id,
    question: "Why minutes?",
    excerpt,
  });
  expect(asked.data).toMatchObject({ agent: "codex", context: "thread" });
  const response = await fetch(
    `http://127.0.0.1:${hosts[0]!.port}/api/questions/${asked.data.id}/events`,
    { headers: { authorization: `Bearer ${hosts[0]!.token}` } },
  );
  const controller = new AbortController();
  streams.push(controller);
  let last: QuestionState | undefined;
  void readServerEvents(
    response.body!,
    (event) => (last = JSON.parse(event.data) as QuestionState),
    controller.signal,
  ).catch(() => {});
  await vi.waitFor(() => expect(last?.status).toBe("done"), { timeout: 8000 });
  expect(last!.answer).toBe(`Codex, fork of ${CODEX}, sandbox read-only. You asked: Why minutes?`);
});
