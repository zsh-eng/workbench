import { afterEach, expect, test, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentInboxState, AgentMessage } from "../../src/shared/agent-inbox";
import { startHost, type RunningHost } from "../../src/host/server";
import { removeFolder } from "./remove-folder";

// A comment that changes while Med sends it to the agent. A Claude session
// that no process runs resumes in Med; the test holds the resume while the
// user edits the comment in another window.

const directories: string[] = [];
const hosts: RunningHost[] = [];
afterEach(async () => {
  await Promise.all(hosts.splice(0).map((host) => host.close()));
  await Promise.all(directories.splice(0).map((path) => removeFolder(path)));
  vi.unstubAllEnvs();
});

const session = "3b9d6a2c-7e41-4f08-9c55-1a2b3c4d5e6f";
const fakeClaude = fileURLToPath(new URL("../fixtures/agents/fake-claude.mjs", import.meta.url));

async function fixture() {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "med sent comments ")));
  directories.push(directory);
  const repo = join(directory, "repo");
  await mkdir(repo);
  const git = (...args: string[]) => execFileSync("git", args, { cwd: repo });
  git("init", "-q", "-b", "main");
  await writeFile(join(repo, "summary.ts"), "export const best = 1;\n");
  git("add", ".");
  git("-c", "user.name=Med", "-c", "user.email=med@example.invalid", "commit", "-qm", "Start");
  await writeFile(join(repo, "summary.ts"), "export const best = 2;\n");
  const home = join(directory, "home");
  await mkdir(home);
  vi.stubEnv("MED_HOME_DIR", home);
  // Med finds the installed agents when it resumes a session; a test can hold that.
  let hold: Promise<void> | undefined;
  let held = false;
  const host = await startHost({
    repo,
    repos: [repo],
    stateDir: join(directory, "state"),
    port: 0,
    agentAckMs: 300,
    agents: async () => {
      if (hold) {
        held = true;
        await hold;
      }
      return [
        {
          id: "claude",
          name: "Claude Code",
          kind: "claude",
          available: true,
          command: process.execPath,
          args: [fakeClaude],
        },
      ];
    },
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
  const saved = (
    await api<{ id: string; targets: { id: string }[] }>("/api/reviews", {
      title: "Format durations",
      key: "durations",
      targets: [{ repo, comparison: { kind: "working" } }],
      sessions: [{ agent: "claude", id: session, cwd: repo }],
    })
  ).data;
  const notesPath = `/api/reviews/${saved.id}/targets/${saved.targets[0]!.id}/notes`;
  const mutate = async (mutation: unknown) => {
    const { revision } = (await api<{ revision: number }>(notesPath)).data;
    return (
      await api<{ notes: { id: string; text: string }[] }>(notesPath, {
        expectedRevision: revision,
        mutation,
      })
    ).data;
  };
  const added = await mutate({
    type: "add",
    note: { path: "summary.ts", side: "new", line: 1, text: "Round to minutes." },
  });
  const commentId = added.notes[0]!.id;
  const inbox = async () => (await api<AgentInboxState>(`/api/reviews/${saved.id}/agent`)).data;
  /** The prompts that the resumed session got. */
  const prompts = async () => {
    const path = join(home, ".claude", "projects", "-fake-repo", `${session}.jsonl`);
    if (!existsSync(path)) return [];
    return (
      (await readFile(path, "utf8"))
        .split("\n")
        .filter(Boolean)
        .map(
          (line) =>
            JSON.parse(line) as {
              type: string;
              message: { content: unknown };
              attachment?: { type: string; prompt: string };
            },
        )
        // A prompt that came during a turn is queued for the agent's next step.
        .map((record) =>
          record.attachment?.type === "queued_command"
            ? { type: "user", message: { content: record.attachment.prompt } }
            : record,
        )
        .filter(
          (record) =>
            record.type === "user" &&
            !(
              Array.isArray(record.message.content) &&
              record.message.content.some(
                (block: { type?: string }) => block.type === "tool_result",
              )
            ),
        )
        .map((record) => {
          const content = record.message.content;
          // A prompt to the running session comes as content blocks.
          return Array.isArray(content)
            ? content.map((block: { text?: string }) => block.text ?? "").join("")
            : String(content);
        })
    );
  };
  return {
    api,
    saved,
    commentId,
    mutate,
    inbox,
    prompts,
    /** Holds the next resume until the returned function runs. */
    holdResume() {
      let release!: () => void;
      hold = new Promise<void>((resolve) => {
        release = resolve;
      });
      return {
        held: () => held,
        release() {
          hold = undefined;
          release();
        },
      };
    },
  };
}

test("an edit while Med sends a comment keeps the comment a draft, and the thread shows what the agent got", async () => {
  const { api, saved, commentId, mutate, inbox, prompts, holdResume } = await fixture();
  await expect.poll(async () => (await inbox()).resumable).toEqual([session]);
  const resume = holdResume();
  const sending = api<{ message: AgentMessage; state: AgentInboxState }>(
    `/api/reviews/${saved.id}/agent/messages`,
    { sessionId: session, text: "", noteIds: [commentId] },
  );
  // Med has read the comment and waits to resume the session. The user
  // edits the comment in another window.
  await vi.waitFor(() => expect(resume.held()).toBe(true));
  await mutate({ type: "edit", id: commentId, text: "Round to hours." });
  resume.release();
  const sent = await sending;
  expect(sent.status).toBe(200);
  await vi.waitFor(async () => expect(await prompts()).toHaveLength(1), { timeout: 5000 });
  // The agent got the text before the edit, and the thread shows that text.
  expect((await prompts())[0]).toContain("Round to minutes.");
  expect((await prompts())[0]).not.toContain("Round to hours.");
  const state = await inbox();
  expect(state.messages.at(-1)!.comments).toEqual([
    { path: "summary.ts", line: 1, text: "Round to minutes." },
  ]);
  // The edit has not reached the agent, so the comment is still a draft.
  expect(state.drafts).toMatchObject([{ id: commentId, text: "Round to hours." }]);
});

test("the agent answers a comment in its thread; the comment stays sent, and the next message shows the answer as the agent's", async () => {
  const { api, saved, commentId, mutate, inbox, prompts } = await fixture();
  await expect.poll(async () => (await inbox()).resumable).toEqual([session]);
  expect((await inbox()).owned).toEqual([]);
  const first = await api(`/api/reviews/${saved.id}/agent/messages`, {
    sessionId: session,
    text: "",
    noteIds: [commentId],
  });
  expect(first.status).toBe(200);
  await vi.waitFor(async () => expect(await prompts()).toHaveLength(1), { timeout: 5000 });
  // The message says how to answer a comment where the user reads it.
  expect((await prompts())[0]).toContain(
    `med review reply --key ${saved.id} --comment <Comment ID> --text -`,
  );
  expect((await prompts())[0]).toContain(`Comment ID: ${commentId}`);
  // Med runs the session now, so a comment can go to it from the comment.
  const before = await inbox();
  expect(before.owned).toEqual([session]);
  expect(before.drafts).toEqual([]);

  const answered = await api<{ note: { id: string; parentId: string; author: unknown } }>(
    `/api/reviews/${saved.id}/agent/reply`,
    {
      commentId,
      text: "Minutes drop the seconds. Keep them for short runs?",
      session: { agent: "claude", id: session },
    },
  );
  expect(answered.status).toBe(200);
  expect(answered.data.note).toMatchObject({
    parentId: commentId,
    author: { agent: "claude", sessionId: session },
  });
  // The answer is not the user's change: the comment stays sent, and the
  // review's revision tells open pages to read the comments again.
  const after = await inbox();
  expect(after.drafts).toEqual([]);
  expect(after.revision).toBeGreaterThan(before.revision!);
  const notes = await mutate({
    type: "add",
    note: {
      path: "summary.ts",
      side: "new",
      line: 1,
      parentId: commentId,
      text: "Yes, under a minute.",
    },
  });
  expect(notes.notes.map((note) => note.text)).toEqual([
    "Round to minutes.",
    "Minutes drop the seconds. Keep them for short runs?",
    "Yes, under a minute.",
  ]);
  // The user's reply makes the thread a draft; the agent reads its own
  // answer as its own.
  expect((await inbox()).drafts).toMatchObject([{ id: commentId, replies: 1 }]);
  await api(`/api/reviews/${saved.id}/agent/messages`, {
    sessionId: session,
    text: "",
    noteIds: [commentId],
  });
  await vi.waitFor(async () => expect(await prompts()).toHaveLength(2), { timeout: 5000 });
  const second = (await prompts())[1]!;
  expect(second).toContain("## Claude's reply to User Comment 1");
  expect(second).toContain("## User Comment 2");
  expect(second).toContain("Reply to: User Comment 1");
  expect(second).not.toContain("## User Comment 3");

  const missing = await api<{ error: { message: string } }>(
    `/api/reviews/${saved.id}/agent/reply`,
    { commentId: "no-such-comment", text: "Done." },
  );
  expect(missing.status).toBe(404);
  expect(missing.data.error.message).toBe("This review has no comment with that ID.");
});
