import { afterEach, expect, test, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startHost } from "../../src/host/server";
import { createReviewController } from "../../src/web/data/controller";
import { REVIEW_UPDATED } from "../../src/web/data/workspaces";
import type { SavedReview } from "../../src/shared/saved-review";

const cleanup: (() => Promise<unknown> | void)[] = [];
afterEach(async () => {
  for (const dispose of cleanup.splice(0).reverse()) await dispose();
  vi.unstubAllGlobals();
});
function gate() {
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { waiting, release };
}
const note = (text: string) => ({
  type: "add" as const,
  note: { path: "file.ts", side: "new" as const, line: 1, text },
});

// The controller, HTTP routes, Git capture, parser and store are real. Delay only
// transport delivery to reproduce races without replacing the mechanism tested.
async function fixture({
  removeWorktreeDuringOpen = false,
  staleCatalogue = false,
  events = false,
  // The review starts as a new thread's does: a working capture with no changes.
  empty = false,
} = {}) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "med-comment-transport-")));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const repo = join(directory, "repo");
  await mkdir(repo);
  const git = (...args: string[]) =>
    execFileSync("git", args, {
      cwd: repo,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_AUTHOR_NAME: "Test",
        GIT_AUTHOR_EMAIL: "test@example.invalid",
        GIT_COMMITTER_NAME: "Test",
        GIT_COMMITTER_EMAIL: "test@example.invalid",
      },
    });
  git("init", "-b", "main");
  git("config", "commit.gpgsign", "false");
  await writeFile(join(repo, "file.ts"), "export const before = 1;\n");
  git("add", "file.ts");
  git("commit", "-m", "baseline");
  if (!empty) await writeFile(join(repo, "file.ts"), "export const after = 2;\n");
  const linked = join(directory, "linked");
  if (removeWorktreeDuringOpen || staleCatalogue) {
    git("worktree", "add", "-b", "linked", linked);
    await writeFile(join(linked, "file.ts"), "export const after = 2;\n");
  }
  const host = await startHost({ repo, stateDir: join(directory, "state"), port: 0 });
  cleanup.push(() => host.close());
  const origin = `http://127.0.0.1:${host.port}`;
  const api = (path: string, body?: unknown) =>
    fetch(`${origin}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { authorization: `Bearer ${host.token}`, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const saved: SavedReview = await (
    await api("/api/reviews", {
      title: "Comment races",
      ...(empty ? { key: "thread" } : {}),
      targets: [
        {
          repo: removeWorktreeDuringOpen || staleCatalogue ? linked : repo,
          comparison: { kind: "working" },
        },
        { repo, comparison: { kind: "commit", commit: "HEAD" } },
      ],
    })
  ).json();
  const transport: {
    before?: (url: URL, init?: RequestInit) => Promise<void>;
    after?: (url: URL, response: Response) => Promise<Response>;
  } = {
    before: async (url) => {
      if (
        removeWorktreeDuringOpen &&
        url.pathname === "/api/session" &&
        url.searchParams.get("repo") === linked
      ) {
        git("worktree", "remove", "--force", linked);
        removeWorktreeDuringOpen = false;
      }
    },
    // A repository list read before the worktree existed, as a page reads it
    // before a new thread makes its worktree.
    after: async (url, response) => {
      if (!staleCatalogue || url.pathname !== "/api/repositories") return response;
      staleCatalogue = false;
      const body = (await response.json()) as {
        repositories: { worktrees: { path: string }[] }[];
      };
      for (const repository of body.repositories)
        repository.worktrees = repository.worktrees.filter((tree) => tree.path !== linked);
      return Response.json(body);
    },
  };
  const windowEvents = new EventTarget();
  vi.stubGlobal("window", windowEvents);
  vi.stubGlobal("document", new EventTarget());
  let clipboard = "";
  vi.stubGlobal("navigator", {
    clipboard: {
      writeText: async (text: string) => {
        clipboard = text;
      },
    },
  });
  let driftChecks = 0;
  const controller = createReviewController({
    token: host.token,
    savedReviewId: saved.id,
    events,
    fetch: async (input, init) => {
      const url = new URL(String(input), origin);
      await transport.before?.(url, init);
      const response = await fetch(url, init);
      if (url.pathname.endsWith("/drift")) driftChecks++;
      return transport.after ? transport.after(url, response) : response;
    },
  });
  cleanup.push(() => controller.dispose());
  await controller.initialize();
  expect(controller.getSnapshot().status).toBe("ready");
  await vi.waitFor(() => expect(controller.getSnapshot().notes).not.toBeNull());
  const feedback = async () => (await api(`/api/reviews/${saved.id}/feedback`)).json();
  return {
    controller,
    saved,
    transport,
    windowEvents,
    feedback,
    repo,
    linked,
    api,
    host,
    clipboard: () => clipboard,
    driftChecks: () => driftChecks,
  };
}

test("a review in a worktree that is newer than the repository list opens in that worktree", async () => {
  const { controller, linked } = await fixture({ staleCatalogue: true });
  expect(controller.getSnapshot().session?.repository.path).toBe(linked);
});

test("a review whose worktree changes after the capture offers a refresh", async () => {
  const { controller, saved, repo, driftChecks } = await fixture({ events: true });
  const working = saved.targets.find((target) => target.captured)!;
  await vi.waitFor(() => expect(controller.getSnapshot().connection).toBe("connected"));
  // The review as it opened matches its worktree.
  await vi.waitFor(() => expect(driftChecks()).toBe(1));
  expect(controller.getSnapshot().savedDrift).toBeNull();
  // An agent that does not hand off its work edits the file again.
  await writeFile(join(repo, "file.ts"), "export const after = 3;\n");
  await vi.waitFor(() => expect(controller.getSnapshot().savedDrift).toBe(working.id), {
    timeout: 10_000,
  });
  // A refresh captures the worktree again, as a new iteration that matches it.
  const iteration = await controller.startNotes();
  await controller.selectSavedTarget(iteration!.targetIds[0]!);
  await vi.waitFor(() => expect(controller.getSnapshot().savedDrift).toBeNull());
});

test("an empty capture shows the live changes until the agent hands off its work", async () => {
  const { controller, saved, repo, api, windowEvents } = await fixture({
    events: true,
    empty: true,
  });
  const first = saved.targets.find((target) => target.captured)!;
  await vi.waitFor(() => expect(controller.getSnapshot().connection).toBe("connected"));
  expect(controller.getSnapshot().review?.files).toEqual([]);

  // The agent edits a file: the review follows the worktree, with no drift bar.
  await writeFile(join(repo, "file.ts"), "export const after = 2;\n");
  await vi.waitFor(
    () => {
      const snapshot = controller.getSnapshot();
      expect(snapshot.savedView).toBe(false);
      expect(snapshot.comparison).toEqual({ kind: "working" });
      expect(snapshot.review?.files.map((file) => file.path)).toEqual(["file.ts"]);
    },
    { timeout: 10_000 },
  );
  expect(controller.getSnapshot().savedDrift).toBeNull();

  // The agent hands off: the review shows the new capture.
  const handoff: SavedReview = await (
    await api("/api/reviews", {
      title: "Comment races",
      key: "thread",
      targets: [{ repo, comparison: { kind: "working" } }],
    })
  ).json();
  windowEvents.dispatchEvent(new CustomEvent(REVIEW_UPDATED, { detail: { id: saved.id } }));
  const latest = handoff.iterations!.at(-1)!.targetIds[0]!;
  await vi.waitFor(() =>
    expect(controller.getSnapshot()).toMatchObject({ savedView: true, savedTargetId: latest }),
  );
  expect(latest).not.toBe(first.id);
});

test("a reader who returns to an empty capture keeps it, with the drift bar", async () => {
  const { controller, saved, repo } = await fixture({ events: true, empty: true });
  const first = saved.targets.find((target) => target.captured)!;
  await vi.waitFor(() => expect(controller.getSnapshot().connection).toBe("connected"));
  await writeFile(join(repo, "file.ts"), "export const after = 2;\n");
  await vi.waitFor(() => expect(controller.getSnapshot().savedView).toBe(false), {
    timeout: 10_000,
  });
  await controller.returnToSavedReview();
  await vi.waitFor(() =>
    expect(controller.getSnapshot()).toMatchObject({ savedView: true, savedDrift: first.id }),
  );
});

test("clearing while switching targets removes the newly visible comments too", async () => {
  const { controller, saved, transport, feedback } = await fixture();
  await controller.mutateNote(note("First target"));
  await controller.selectSavedTarget(saved.targets[1].id);
  await vi.waitFor(() => expect(controller.getSnapshot().notes?.notes).toEqual([]));
  await controller.mutateNote(note("Second target"));
  await controller.selectSavedTarget(saved.targets[0].id);
  const pending = gate();
  let started = false;
  transport.before = async (url) => {
    if (url.pathname.endsWith("/clear")) {
      started = true;
      await pending.waiting;
    }
  };
  const clearing = controller.clearSavedComments(2);
  await vi.waitFor(() => expect(started).toBe(true));
  await controller.selectSavedTarget(saved.targets[1].id);
  await vi.waitFor(() =>
    expect(controller.getSnapshot().notes?.notes[0]?.text).toBe("Second target"),
  );
  pending.release();
  await clearing;
  expect(controller.getSnapshot().notes?.notes).toEqual([]);
  expect(controller.getSnapshot().savedReview?.commentCount).toBe(0);
  expect((await feedback()).count).toBe(0);
});

test("a saved comment remains successful when a later metadata request fails", async () => {
  const { controller, saved, transport, feedback } = await fixture();
  transport.after = async (url, response) =>
    url.pathname === `/api/reviews/${saved.id}`
      ? Response.json({ error: { message: "Temporary metadata failure" } }, { status: 503 })
      : response;
  await controller.mutateNote(note("Keep the accepted comment"));
  expect(controller.getSnapshot().notesError).toBeNull();
  expect(controller.getSnapshot().notes?.notes[0]?.text).toBe("Keep the accepted comment");
  expect((await feedback()).text).toContain("Keep the accepted comment");
});

test("pending comments remain visible across targets and copy waits for both writes", async () => {
  const { controller, saved, transport, clipboard } = await fixture();
  const pending = gate();
  let started = false;
  transport.before = async (url, init) => {
    if (url.pathname.includes(saved.targets[0].id) && init?.method === "POST") {
      started = true;
      await pending.waiting;
    }
  };
  const first = controller.mutateNote(note("First pending comment"));
  await vi.waitFor(() => expect(started).toBe(true));
  expect(controller.getSnapshot().notes?.notes[0]?.text).toBe("First pending comment");
  await controller.selectSavedTarget(saved.targets[1].id);
  await vi.waitFor(() => expect(controller.getSnapshot().notes?.notes).toEqual([]));
  const second = controller.mutateNote(note("Second pending comment"));
  expect(controller.getSnapshot().savedReview?.commentCount).toBe(2);
  const copying = controller.copyFeedback();
  pending.release();
  await Promise.all([first, second, copying]);
  expect(controller.getSnapshot().notes?.notes.map((entry) => entry.text)).toEqual([
    "Second pending comment",
  ]);
  expect(controller.getSnapshot().savedReview?.commentCount).toBe(2);
  expect(clipboard()).toContain("First pending comment");
  expect(clipboard()).toContain("Second pending comment");
});

test("late metadata cannot hide a newer optimistic comment", async () => {
  const { controller, saved, transport, windowEvents, feedback } = await fixture();
  const metadata = gate();
  const writing = gate();
  let heldMetadata = false;
  transport.after = async (url, response) => {
    if (url.pathname === `/api/reviews/${saved.id}` && !heldMetadata) {
      heldMetadata = true;
      await metadata.waiting;
    }
    return response;
  };
  transport.before = async (url, init) => {
    if (url.pathname.endsWith("/notes") && init?.method === "POST") await writing.waiting;
  };
  windowEvents.dispatchEvent(new Event("focus"));
  await vi.waitFor(() => expect(heldMetadata).toBe(true));
  const adding = controller.mutateNote(note("Pending comment"));
  metadata.release();
  // Wait for delivery of the already-captured metadata before releasing the write.
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(controller.getSnapshot().savedReview?.commentCount).toBe(1);
  expect(controller.getSnapshot().notes?.notes[0]?.text).toBe("Pending comment");
  writing.release();
  await adding;
  expect((await feedback()).text).toContain("Pending comment");
});

test("a late copy response cannot remove a comment added during copying", async () => {
  const { controller, transport, clipboard, feedback } = await fixture();
  await controller.mutateNote(note("Already saved"));
  const copying = gate();
  const writing = gate();
  let copyStarted = false;
  transport.after = async (url, response) => {
    if (url.pathname.endsWith("/feedback")) {
      copyStarted = true;
      await copying.waiting;
    }
    return response;
  };
  transport.before = async (url, init) => {
    if (url.pathname.endsWith("/notes") && init?.method === "POST") await writing.waiting;
  };
  const copied = controller.copyFeedback();
  await vi.waitFor(() => expect(copyStarted).toBe(true));
  const added = controller.mutateNote(note("Added while copying"));
  copying.release();
  await copied;
  expect(clipboard()).toContain("Already saved");
  expect(clipboard()).not.toContain("Added while copying");
  expect(controller.getSnapshot().savedReview?.commentCount).toBe(2);
  expect(controller.getSnapshot().notes?.notes.map((entry) => entry.text)).toContain(
    "Added while copying",
  );
  writing.release();
  await added;
  expect((await feedback()).text).toContain("Added while copying");
});

test("a worktree removed after discovery opens the frozen review through its surviving checkout", async () => {
  const { controller, repo } = await fixture({ removeWorktreeDuringOpen: true });
  expect(controller.getSnapshot().session?.repository.path).toBe(repo);
  expect(controller.getSnapshot().savedView).toBe(true);
  expect((await controller.loadSources("file.ts")).new).toBe("export const after = 2;\n");
});

test("registering the missing repository restores the saved comparison", async () => {
  const { controller, saved, repo, host } = await fixture();
  await fetch(
    `http://127.0.0.1:${host.port}/api/repositories?id=${saved.targets[0].repositoryId}`,
    {
      method: "DELETE",
      headers: { authorization: `Bearer ${host.token}` },
    },
  );
  await controller.initialize();
  expect(controller.getSnapshot().error).toContain("Repository unavailable");
  await controller.addRepository(repo);
  expect(controller.getSnapshot().status).toBe("ready");
  expect(controller.getSnapshot().savedView).toBe(true);
  expect((await controller.loadSources("file.ts")).new).toBe("export const after = 2;\n");
});
