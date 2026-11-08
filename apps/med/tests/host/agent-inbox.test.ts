import { afterEach, expect, test, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentInboxState } from "../../src/shared/agent-inbox";
import type { SavedReview } from "../../src/shared/saved-review";
import { startHost, type RunningHost } from "../../src/host/server";
import { openSession } from "../fixtures/terminal-claude";
import { removeFolder } from "./remove-folder";

const directories: string[] = [];
const hosts: RunningHost[] = [];
const ends: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(ends.splice(0).map((end) => end()));
  await Promise.all(hosts.splice(0).map((host) => host.close()));
  await Promise.all(directories.splice(0).map((path) => removeFolder(path)));
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
  // The Claude session runs in a terminal.
  ends.push((await openSession(home, claude)).end);
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
        args: [fileURLToPath(new URL("../fixtures/agents/fake-claude.mjs", import.meta.url))],
      },
    ],
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
  return { api, repo, saved, commentId: comment.notes[0]!.id };
}

test("Med sends nothing to a session that another app has open: the comments stay drafts to copy", async () => {
  const { api, saved, commentId } = await fixture();
  const inbox = async () => (await api(`/api/reviews/${saved.id}/agent`)).data as AgentInboxState;
  expect((await inbox()).elsewhere).toEqual({ [claude]: "terminal" });
  const sent = await api(`/api/reviews/${saved.id}/agent/messages`, {
    sessionId: claude,
    text: "Use minutes.",
    noteIds: [commentId],
  });
  expect(sent.status).toBe(409);
  expect(sent.data).toMatchObject({
    error: { code: "session-elsewhere", message: expect.stringContaining("copy the comments") },
  });
  const state = await inbox();
  expect(state.messages).toEqual([]);
  expect(state.drafts).toMatchObject([{ id: commentId, text: "Round to minutes instead." }]);
  // Copy comments gives the same text that a message would.
  const feedback = (await api(`/api/reviews/${saved.id}/feedback`)).data as { text: string };
  expect(feedback.text).toContain("Round to minutes instead.");
});

test("a message to a Codex session needs Codex: Med resumes the session with it", async () => {
  const { api, saved, commentId } = await fixture();
  const sent = await api(`/api/reviews/${saved.id}/agent/messages`, {
    sessionId: codex,
    text: "Use minutes.",
    noteIds: [commentId],
  });
  // This host has no Codex to resume it with.
  expect(sent.status).toBe(409);
  expect(sent.data).toMatchObject({ error: { code: "codex-not-found" } });
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

test("a comment on a passage of the Notes counts, and copies with its quote", async () => {
  const { api, saved, commentId } = await fixture();
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
  // A comment on a passage takes no reply, so it has no ID.
  expect(feedback.text).toContain(
    "## On the review's brief (iteration 1)\n> rounds to whole seconds\n\nRound to minutes instead.",
  );

  const edited = (await comment({ edit: { id, text: "Use minutes." } })).data as SavedReview;
  expect(edited.briefComments?.[0]).toMatchObject({ id, text: "Use minutes." });
  const removed = (await comment({ remove: id })).data as SavedReview;
  expect(removed.briefComments).toBeUndefined();
  expect(removed.commentCount).toBe(1);
});

test("a comment on a file goes to the agent with its lines, and the agent's reply can resolve it", async () => {
  const { api, repo, saved, commentId } = await fixture();
  const comment = (mutation: unknown) => api(`/api/reviews/${saved.id}/file-comments`, mutation);
  const add = {
    source: { kind: "worktree", repo },
    path: "src/queue.ts",
    line: 3,
    endLine: 4,
    quote: "if (item.attempts > MAX) {\n  return null;",
    text: "Park it in the dead-letter list instead.",
  };
  const commented = (await comment({ add })).data as SavedReview;
  expect(commented.fileComments).toMatchObject([{ ...add, replies: [] }]);
  expect(commented.commentCount).toBe(2);
  const id = commented.fileComments![0]!.id;
  // More lines than a comment takes.
  expect((await comment({ add: { ...add, line: 1, endLine: 401 } })).status).toBe(400);

  // Unsent, it waits in the message box with the review's comments.
  const inbox = async () => (await api(`/api/reviews/${saved.id}/agent`)).data as AgentInboxState;
  expect((await inbox()).drafts).toMatchObject([
    { id: commentId, path: "summary.ts" },
    { id, path: "src/queue.ts", line: 3, endLine: 4, text: add.text, replies: 0 },
  ]);
  const feedback = (await api(`/api/reviews/${saved.id}/feedback`)).data as {
    text: string;
    count: number;
  };
  expect(feedback.count).toBe(2);
  const short = id.slice(0, 6);
  expect(feedback.text).toContain(
    `## ${short} · src/queue.ts:3-4 (a file, not the review's change; in the working tree of repo)\n\`\`\`\n3 | if (item.attempts > MAX) {\n4 |   return null;\n\`\`\`\n\nPark it in the dead-letter list instead.`,
  );
  expect(feedback.text).toContain(`med reply ${short} --resolve`);

  // `med reply` finds the review by the comment's first characters.
  const found = (await api(`/api/comments/${short}`)).data as { reviews: { id: string }[] };
  expect(found.reviews.map((review) => review.id)).toEqual([saved.id]);
  // Only a comment on a file resolves.
  expect(
    (
      await api(`/api/reviews/${saved.id}/agent/reply`, {
        commentId,
        text: "Done.",
        resolve: true,
      })
    ).status,
  ).toBe(409);
  const replied = await api(`/api/reviews/${saved.id}/agent/reply`, {
    commentId: short,
    text: "Moved it to the dead-letter list.",
    resolve: true,
  });
  expect(replied.status).toBe(200);
  const answered = (await api(`/api/reviews/${saved.id}`)).data as SavedReview;
  expect(answered.fileComments![0]).toMatchObject({
    replies: [{ text: "Moved it to the dead-letter list.", author: { agent: "codex" } }],
    resolved: { by: { agent: "codex" } },
  });
  expect(answered.commentCount).toBe(3);
  // Resolved, it leaves the message box and the copied comments.
  expect((await inbox()).drafts.map((draft) => draft.id)).toEqual([commentId]);
  expect(
    ((await api(`/api/reviews/${saved.id}/feedback`)).data as { text: string }).text,
  ).not.toContain(short);

  // The user opens it again, and a reply of theirs makes it a draft to send.
  await comment({ reopen: id });
  const reopened = (await comment({ reply: { id, text: "Also log it once." } }))
    .data as SavedReview;
  expect(reopened.fileComments![0]!.resolved).toBeUndefined();
  expect(reopened.fileComments![0]!.replies.map((reply) => reply.text)).toEqual([
    "Moved it to the dead-letter list.",
    "Also log it once.",
  ]);
  expect((await inbox()).drafts.map((draft) => draft.id)).toEqual([commentId, id]);
  const removed = (await comment({ remove: id })).data as SavedReview;
  expect(removed.fileComments).toBeUndefined();
  expect(removed.commentCount).toBe(1);
});
