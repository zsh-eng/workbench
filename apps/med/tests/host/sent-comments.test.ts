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
    return (await readFile(path, "utf8"))
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { type: string; message: { content: unknown } })
      .filter((record) => record.type === "user")
      .map((record) => String(record.message.content));
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
