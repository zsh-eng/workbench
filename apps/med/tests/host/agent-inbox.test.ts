import { afterEach, expect, test, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentInboxState } from "../../src/shared/agent-inbox";
import type { FileComment } from "../../src/shared/saved-review";
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
  // Each session hands off a review of its own.
  const created = await api("/api/reviews", {
    title: "Format durations",
    key: "durations",
    targets: [{ repo, comparison: { kind: "working" } }],
    session: { agent: "claude", id: claude, cwd: repo },
  });
  await api("/api/reviews", {
    title: "Durations in the export",
    key: "export",
    targets: [{ repo, comparison: { kind: "working" } }],
    session: { agent: "codex", id: codex, cwd: repo },
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

/** The threads of the two sessions. */
const threads = { claude: `claude-${claude}`, codex: `codex-${codex}` };
const inboxOf = (api: Awaited<ReturnType<typeof fixture>>["api"], thread: string) => async () =>
  (await api(`/api/sessions/${thread}/agent`)).data as AgentInboxState;

test("Med sends nothing to a session that another app has open: the comments stay drafts to copy", async () => {
  const { api, saved, commentId } = await fixture();
  const inbox = inboxOf(api, threads.claude);
  expect((await inbox()).elsewhere).toEqual({ [claude]: "terminal" });
  const sent = await api(`/api/sessions/${threads.claude}/agent/messages`, {
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
  // Each session's thread has its own comments.
  expect((await inboxOf(api, threads.codex)()).drafts).toEqual([]);
});

test("a message to a Codex session needs Codex: Med resumes the session with it", async () => {
  const { api } = await fixture();
  const sent = await api(`/api/sessions/${threads.codex}/agent/messages`, {
    text: "Use minutes.",
    noteIds: [],
  });
  // This host has no Codex to resume it with.
  expect(sent.status).toBe(409);
  expect(sent.data).toMatchObject({ error: { code: "codex-not-found" } });
});

test("a comment on a file belongs to the thread: it goes to the agent with its lines, and the agent's reply can resolve it", async () => {
  const { api, repo, saved, commentId } = await fixture();
  type Comments = { comments: FileComment[] };
  const comment = async (mutation: unknown) =>
    api(`/api/threads/${threads.claude}/file-comments`, mutation);
  const add = {
    source: { kind: "worktree", repo },
    path: "src/queue.ts",
    line: 3,
    endLine: 4,
    quote: "if (item.attempts > MAX) {\n  return null;",
    text: "Park it in the dead-letter list instead.",
  };
  const commented = (await comment({ add })).data as Comments;
  expect(commented.comments).toMatchObject([{ ...add, replies: [] }]);
  const id = commented.comments[0]!.id;
  // More lines than a comment takes.
  expect((await comment({ add: { ...add, line: 1, endLine: 401 } })).status).toBe(400);

  // Unsent, it waits in the message box with the review's comments.
  const inbox = inboxOf(api, threads.claude);
  expect((await inbox()).drafts).toMatchObject([
    { id: commentId, path: "summary.ts" },
    { id, path: "src/queue.ts", line: 3, endLine: 4, text: add.text, replies: 0 },
  ]);
  // Copy comments takes it too, as a message would.
  const copied = async () =>
    ((await api(`/api/reviews/${saved.id}/feedback`)).data as { text: string }).text;
  const short = id.slice(0, 6);
  expect(await copied()).toContain(
    `## ${short} · src/queue.ts:3-4 (a file, not a review's change; in the working tree of repo)\n\`\`\`\n3 | if (item.attempts > MAX) {\n4 |   return null;\n\`\`\`\n\nPark it in the dead-letter list instead.`,
  );
  expect(await copied()).toContain(`med reply ${short} --resolve`);

  // `med reply` finds the comment by its first characters, and only a
  // comment on a file resolves.
  const reply = (target: string, text: string) =>
    api(`/api/comments/${target}/reply`, { text, resolve: true });
  expect((await reply(commentId, "Done.")).status).toBe(409);
  expect((await reply(short, "Moved it to the dead-letter list.")).status).toBe(200);
  const answered = (await api(`/api/threads/${threads.claude}/file-comments`)).data as Comments;
  expect(answered.comments[0]).toMatchObject({
    replies: [{ text: "Moved it to the dead-letter list.", author: { agent: "claude" } }],
    resolved: { by: { agent: "claude" } },
  });
  // Resolved, it leaves the message box and the copied comments.
  expect((await inbox()).drafts.map((draft) => draft.id)).toEqual([commentId]);
  expect(await copied()).not.toContain(short);

  // The user opens it again, and a reply of theirs makes it a draft to send.
  await comment({ reopen: id });
  const reopened = (await comment({ reply: { id, text: "Also log it once." } })).data as Comments;
  expect(reopened.comments[0]!.resolved).toBeUndefined();
  expect(reopened.comments[0]!.replies.map((each) => each.text)).toEqual([
    "Moved it to the dead-letter list.",
    "Also log it once.",
  ]);
  expect((await inbox()).drafts.map((draft) => draft.id)).toEqual([commentId, id]);
  const removed = (await comment({ remove: id })).data as Comments;
  expect(removed.comments).toEqual([]);
});

test("the message box deletes the comments that wait in it: from the review and the files, with their replies", async () => {
  const { api, repo, saved, commentId } = await fixture();
  const notesPath = `/api/reviews/${saved.id}/targets/${saved.targets[0]!.id}/notes`;
  type Notes = { revision: number; notes: { id: string; parentId?: string }[] };
  const read = async () => (await api(notesPath)).data as Notes;
  // The user answers their own comment; the reply goes with it.
  await api(notesPath, {
    expectedRevision: (await read()).revision,
    mutation: {
      type: "add",
      note: {
        path: "summary.ts",
        side: "new",
        line: 1,
        text: "Or seconds.",
        parentId: commentId,
      },
    },
  });
  expect((await read()).notes).toHaveLength(2);
  const kept = (
    (await api(notesPath, {
      expectedRevision: (await read()).revision,
      mutation: {
        type: "add",
        note: { path: "summary.ts", side: "new", line: 1, text: "Name it formatDuration." },
      },
    })) as { data: Notes }
  ).data.notes.at(-1)!.id;
  const file = (
    (await api(`/api/threads/${threads.claude}/file-comments`, {
      add: {
        source: { kind: "worktree", repo },
        path: "src/queue.ts",
        line: 3,
        quote: "return null;",
        text: "Park it in the dead-letter list.",
      },
    })) as { data: { comments: FileComment[] } }
  ).data.comments[0]!.id;
  const inbox = inboxOf(api, threads.claude);
  expect((await inbox()).drafts.map((draft) => draft.id)).toEqual([commentId, kept, file]);

  const removed = await api(`/api/sessions/${threads.claude}/agent/delete-comments`, {
    ids: [commentId, file, "not-a-comment"],
  });
  expect(removed.status).toBe(200);
  expect(
    (removed.data as { state: AgentInboxState }).state.drafts.map((draft) => draft.id),
  ).toEqual([kept]);
  // Gone from the review, with the reply, and from the thread's file comments.
  expect((await read()).notes.map((note) => note.id)).toEqual([kept]);
  expect(
    ((await api(`/api/threads/${threads.claude}/file-comments`)).data as { comments: [] }).comments,
  ).toEqual([]);
  // The other session's review is not this thread's to clear.
  expect(
    (await api(`/api/sessions/${threads.codex}/agent/delete-comments`, { ids: [kept] })).status,
  ).toBe(200);
  expect((await read()).notes.map((note) => note.id)).toEqual([kept]);
  // An empty list is a mistake.
  expect(
    (await api(`/api/sessions/${threads.claude}/agent/delete-comments`, { ids: [] })).status,
  ).toBe(400);
});
