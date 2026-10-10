import { afterEach, expect, test, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentInboxState } from "../../src/shared/agent-inbox";
import type { SavedReview } from "../../src/shared/saved-review";
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

const claude = "5f0c2a8e-1111-4222-8333-944455556666";
const codex = "01a1238e-0fdb-7300-9b82-7d23108f7bb0";

async function fixture() {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "med agent inbox ")));
  directories.push(directory);
  const repo = join(directory, "repo");
  await mkdir(repo);
  const git = (...args: string[]) => execFileSync("git", args, { cwd: repo });
  git("init", "-q", "-b", "main");
  await writeFile(join(repo, "summary.ts"), "export const best = (ms: number) => `${ms} ms`;\n");
  git("add", ".");
  git("-c", "user.name=Med", "-c", "user.email=med@example.invalid", "commit", "-qm", "Start");
  await writeFile(
    join(repo, "summary.ts"),
    "export const best = (ms: number) => `${Math.round(ms / 1000)} s`;\n",
  );
  const home = join(directory, "home");
  await mkdir(home);
  vi.stubEnv("MED_HOME_DIR", home);
  const stateDir = join(directory, "state");
  const queued: [string, string][] = [];
  const host = await startHost({
    repo,
    repos: [repo],
    stateDir,
    port: 0,
    queueCodex: async (thread, text) => {
      queued.push([thread, text]);
    },
  });
  hosts.push(host);
  const api = async (path: string, body?: unknown) => {
    const response = await fetch(`http://127.0.0.1:${host.port}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { authorization: `Bearer ${host.token}`, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, data: (await response.json()) as never };
  };
  const created = await api("/api/reviews", {
    title: "Format durations",
    key: "durations",
    targets: [{ repo, comparison: { kind: "working" } }],
    sessions: [
      { agent: "claude", id: claude, cwd: repo },
      { agent: "codex", id: codex, cwd: repo },
    ],
  });
  const saved = created.data as { id: string; targets: { id: string }[] };
  const target = saved.targets[0]!.id;
  const notes = (await api(`/api/reviews/${saved.id}/targets/${target}/notes`)).data as {
    revision: number;
  };
  const comment = (
    await api(`/api/reviews/${saved.id}/targets/${target}/notes`, {
      expectedRevision: notes.revision,
      mutation: {
        type: "add",
        note: { path: "summary.ts", side: "new", line: 1, text: "Round to minutes instead." },
      },
    })
  ).data as { notes: { id: string }[] };
  const wait = (session: string) => {
    const printed: string[] = [];
    const done = runReviewCommand(
      ["wait", "--key", "durations", "--state-dir", stateDir, "--port", String(host.port)],
      {
        print: (text) => printed.push(text),
        environment: { CLAUDE_CODE_SESSION_ID: session },
        home,
      },
    ).then(() => printed.join("\n"));
    return done;
  };
  return { api, repo, saved, commentId: comment.notes[0]!.id, wait, queued };
}

test("a message reaches a waiting Claude session through med review wait", async () => {
  const { api, saved, commentId, wait } = await fixture();
  const inbox = async () => (await api(`/api/reviews/${saved.id}/agent`)).data as AgentInboxState;
  expect((await inbox()).drafts).toMatchObject([
    { id: commentId, path: "summary.ts", text: "Round to minutes instead." },
  ]);

  // The agent is not waiting yet: Med keeps the message until it does.
  const first = await api(`/api/reviews/${saved.id}/agent/messages`, {
    sessionId: claude,
    text: "Also keep the old format in the export.",
    noteIds: [],
  });
  expect(first.data).toMatchObject({ message: { delivery: "pending" } });
  expect(await wait(claude)).toContain("Also keep the old format in the export.");

  // Now the agent waits first; a message with the comment ends the wait.
  const output = wait(claude);
  await vi.waitFor(async () => expect((await inbox()).waiting).toEqual([claude]));
  const sent = await api(`/api/reviews/${saved.id}/agent/messages`, {
    sessionId: claude,
    text: "Use minutes.",
    noteIds: [commentId],
  });
  expect(sent.status).toBe(200);
  const text = await output;
  expect(text).toMatch(/^The user sent this from the Med review "Format durations"/);
  expect(text).toContain("Use minutes.");
  expect(text).toContain("File: summary.ts");
  expect(text).toContain("Round to minutes instead.");

  const state = await inbox();
  expect(state.messages.map((message) => message.delivery)).toEqual(["delivered", "delivered"]);
  // A sent comment is no longer a draft.
  expect(state.drafts).toEqual([]);
});

test("a message to a Codex session goes to its queue", async () => {
  const { api, saved, commentId, queued } = await fixture();
  const sent = await api(`/api/reviews/${saved.id}/agent/messages`, {
    sessionId: codex,
    text: "Use minutes.",
    noteIds: [commentId],
  });
  expect(sent.data).toMatchObject({ message: { agent: "codex", delivery: "queued" } });
  expect(queued).toHaveLength(1);
  expect(queued[0]![0]).toBe(codex);
  expect(queued[0]![1]).toContain("Round to minutes instead.");

  const empty = await api(`/api/reviews/${saved.id}/agent/messages`, {
    sessionId: codex,
    text: " ",
    noteIds: [],
  });
  expect(empty.status).toBe(400);
});

test("a reply pinned to the review stays with its iteration", async () => {
  const { api, repo, saved } = await fixture();
  const pin = async (mutation: unknown) =>
    (await api(`/api/reviews/${saved.id}/pins`, mutation)).data as SavedReview;
  const source = { agent: "claude", sessionId: claude, itemId: "msg_01" };
  const text = "## Why minutes\n\nThe summary rounds in [summary.ts:1](summary.ts:1).";
  await pin({ add: { text, source } });
  // Pinning the same reply again keeps one pin.
  const pinned = await pin({ add: { text, source } });
  expect(pinned.iterations?.[0]?.pins).toMatchObject([{ text, source }]);

  // The agent's next round has its own Notes; the first round keeps its pin.
  const next = (
    await api("/api/reviews", {
      title: "Format durations",
      key: "durations",
      targets: [{ repo, comparison: { kind: "working" } }],
    })
  ).data as SavedReview;
  expect(next.iterations?.map((entry) => entry.pins?.length ?? 0)).toEqual([1, 0]);
  const later = await pin({ add: { text: "Use minutes everywhere." } });
  expect(later.iterations?.map((entry) => entry.pins?.length ?? 0)).toEqual([1, 1]);

  const removed = await pin({ remove: pinned.iterations![0]!.pins![0]!.id });
  expect(removed.iterations?.[0]?.pins).toBeUndefined();
  expect((await api(`/api/reviews/${saved.id}/pins`, { add: { text: " " } })).status).toBe(400);
});

test("a comment on a passage of the Notes counts, copies, and reaches the agent with its quote", async () => {
  const { api, saved, commentId, queued } = await fixture();
  const comment = (mutation: unknown) => api(`/api/reviews/${saved.id}/brief-comments`, mutation);
  const add = {
    section: "brief",
    iteration: 1,
    quote: "rounds to whole seconds",
    prefix: "The summary ",
    text: "Round to minutes instead.",
  };
  // Only notes that the review has take comments.
  expect((await comment({ add })).status).toBe(404);
  await api(`/api/reviews/${saved.id}/brief`, {
    brief: "# Durations\n\nThe summary rounds to whole seconds.",
  });
  const commented = (await comment({ add })).data as SavedReview;
  expect(commented.briefComments).toMatchObject([add]);
  expect(commented.commentCount).toBe(2);
  const id = commented.briefComments![0]!.id;

  const inbox = (await api(`/api/reviews/${saved.id}/agent`)).data as AgentInboxState;
  expect(inbox.drafts).toMatchObject([
    { id: commentId, path: "summary.ts" },
    { id, path: "Notes", quote: add.quote, text: add.text },
  ]);
  const feedback = (await api(`/api/reviews/${saved.id}/feedback`)).data as {
    text: string;
    count: number;
  };
  expect(feedback.count).toBe(2);
  expect(feedback.text).toContain(
    `On: the review's brief (iteration 1)\nComment ID: ${id}\n\nQuote:\n> rounds to whole seconds\n\nComment:\nRound to minutes instead.`,
  );
  await api(`/api/reviews/${saved.id}/agent/messages`, {
    sessionId: codex,
    text: "",
    noteIds: [id],
  });
  expect(queued[0]![1]).toContain("> rounds to whole seconds");
  expect(queued[0]![1]).not.toContain("File: summary.ts");

  const edited = (await comment({ edit: { id, text: "Use minutes." } })).data as SavedReview;
  expect(edited.briefComments?.[0]).toMatchObject({ id, text: "Use minutes." });
  const removed = (await comment({ remove: id })).data as SavedReview;
  expect(removed.briefComments).toBeUndefined();
  expect(removed.commentCount).toBe(1);
});
