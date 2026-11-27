import { afterEach, expect, test, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startHost, type RunningHost } from "../../src/host/server";
import { removeFolder } from "./remove-folder";

const directories: string[] = [];
const hosts: RunningHost[] = [];

afterEach(async () => {
  await Promise.all(hosts.splice(0).map((host) => host.close()));
  await Promise.all(directories.splice(0).map((path) => removeFolder(path)));
  vi.unstubAllEnvs();
});

test("host returns authenticated diff and file comment replies at /api/notifications/comments and marks reviews read", async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "med-notif-")));
  directories.push(dir);
  const repo = join(dir, "repo");
  const webRoot = join(dir, "web");
  const home = join(dir, "home");
  await mkdir(repo);
  await mkdir(webRoot);
  await mkdir(home);
  await writeFile(join(webRoot, "index.html"), "<!doctype html><div id='root'>med</div>");
  vi.stubEnv("MED_HOME_DIR", home);

  const git = (...args: string[]) => execFileSync("git", args, { cwd: repo });
  git("init", "-q", "-b", "main");
  await writeFile(join(repo, "alpha.ts"), "export const value = 1;\n");
  git("add", ".");
  git("-c", "user.name=Med", "-c", "user.email=med@example.invalid", "commit", "-qm", "Init");
  await writeFile(join(repo, "alpha.ts"), "export const value = 2;\n");

  const host = await startHost({
    repo,
    repos: [repo],
    stateDir: join(dir, "state"),
    webRoot,
    port: 0,
  });
  hosts.push(host);

  const origin = new URL(host.url).origin;
  const auth = {
    Authorization: `Bearer ${host.token}`,
    "Content-Type": "application/json",
  };

  const created = await fetch(`${origin}/api/reviews`, {
    method: "POST",
    headers: auth,
    body: JSON.stringify({
      title: "Notification test thread",
      targets: [{ repo, comparison: { kind: "working" } }],
    }),
  });
  expect(created.status).toBe(200);
  const review = (await created.json()) as { id: string; targets: { id: string }[] };
  const targetId = review.targets[0]!.id;

  // 1. Add and reply to a file comment
  const added = await fetch(
    `${origin}/api/threads/${encodeURIComponent(review.id)}/file-comments`,
    {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        add: {
          source: { kind: "worktree", repo },
          path: "alpha.ts",
          line: 1,
          quote: "export const value = 2;",
          text: "Should value stay immutable?",
        },
      }),
    },
  );
  expect(added.status).toBe(200);
  const { comments } = (await added.json()) as { comments: { id: string }[] };
  const fileCommentId = comments[0]!.id;

  const fileReplied = await fetch(
    `${origin}/api/comments/${encodeURIComponent(fileCommentId)}/reply`,
    {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        text: "Yes, keeping it const avoids accidental mutation.",
        session: { agent: "claude", id: "sess-1" },
      }),
    },
  );
  expect(fileReplied.status).toBe(200);

  // 2. Add and reply to a diff comment on the saved review
  const notesGet = await fetch(
    `${origin}/api/reviews/${encodeURIComponent(review.id)}/targets/${encodeURIComponent(targetId)}/notes`,
    { headers: { Authorization: auth.Authorization } },
  );
  expect(notesGet.status).toBe(200);
  const { revision } = (await notesGet.json()) as { revision: number };

  const diffAdded = await fetch(
    `${origin}/api/reviews/${encodeURIComponent(review.id)}/targets/${encodeURIComponent(targetId)}/notes`,
    {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        expectedRevision: revision,
        mutation: {
          type: "add",
          note: {
            path: "alpha.ts",
            side: "new",
            line: 1,
            text: "Should we export a named type too?",
          },
        },
      }),
    },
  );
  expect(diffAdded.status).toBe(200);
  const diffState = (await diffAdded.json()) as { notes: { id: string }[] };
  const diffCommentId = diffState.notes[0]!.id;

  const diffReplied = await fetch(
    `${origin}/api/comments/${encodeURIComponent(diffCommentId)}/reply`,
    {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        text: "Added a shared type alias alongside the constant.",
        session: { agent: "codex", id: "sess-2" },
      }),
    },
  );
  expect(diffReplied.status).toBe(200);

  const unauth = await fetch(`${origin}/api/notifications/comments`);
  expect(unauth.status).toBe(401);

  const listed = await fetch(`${origin}/api/notifications/comments`, {
    headers: { Authorization: auth.Authorization },
  });
  expect(listed.status).toBe(200);
  const body = (await listed.json()) as {
    replies: {
      threadId: string;
      commentId: string;
      kind: "diff" | "file";
      path: string;
      answer: string;
      answeredBy: string;
    }[];
  };
  expect(body.replies).toHaveLength(2);
  expect(body.replies).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        threadId: review.id,
        commentId: fileCommentId,
        kind: "file",
        path: "alpha.ts",
        answer: "Yes, keeping it const avoids accidental mutation.",
        answeredBy: "Claude",
      }),
      expect.objectContaining({
        threadId: review.id,
        commentId: diffCommentId,
        kind: "diff",
        path: "alpha.ts",
        answer: "Added a shared type alias alongside the constant.",
        answeredBy: "Codex",
      }),
    ]),
  );

  // 3. Marking a saved review read without an explicit version marks its latest version read
  const marked = await fetch(`${origin}/api/reviews/${encodeURIComponent(review.id)}/read`, {
    method: "POST",
    headers: auth,
    body: "{}",
  });
  expect(marked.status).toBe(200);
  const savedAfter = (await marked.json()) as { readVersions?: number[] };
  expect(savedAfter.readVersions).toContain(1);
});
