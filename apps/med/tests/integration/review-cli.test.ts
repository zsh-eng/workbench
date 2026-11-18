import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseReviewCommand, runReviewCommand } from "../../src/cli/review";
import {
  DEFAULT_PORT,
  getPersistentToken,
  publishConnection,
  readConnection,
} from "../../src/host/runtime/connection";
import { cleanUp, clearAgentSession, fixture, git, servers, state } from "./review-cli-fixture";

beforeEach(clearAgentSession);
afterEach(cleanUp);

describe("agent review CLI through the production host", () => {
  it("discovers registered repositories and creates a readable committed review from relative paths", async () => {
    const f = await fixture();
    const repo = f.repos[0]!;
    const base = git(repo, "rev-parse", "HEAD");
    git(repo, "commit", "-am", "after");
    const head = git(repo, "rev-parse", "HEAD");
    // One line per repository; --repo checks one checkout; --json has it all.
    expect(await f.run("repos")).toBe(`repo-0\t${repo}\tmain\t0 worktrees`);
    expect(await f.run("repos", "--repo", repo)).toBe(`${repo} is registered as repo-0, on main.`);
    await expect(f.run("repos", "--repo", f.root)).rejects.toThrow(
      `${f.root} is not registered in Med. Ask the user before you add it; with their OK, run: med add ${f.flags} ${f.root}`,
    );
    const listing = await f.run("repos", "--json");
    expect(JSON.parse(listing).repositories.map((entry: { path: string }) => entry.path)).toEqual([
      repo,
    ]);
    expect(listing).not.toContain(f.host.token);
    const bundle = await f.saved(
      await f.run(
        "create",
        "--title",
        "Fix",
        "--repo",
        relative(process.cwd(), repo),
        "--base",
        base,
        "--head",
        head,
      ),
    );
    // Object IDs at the tip of main are main's newest commit.
    expect(bundle.targets).toMatchObject([
      { repo, base, head, names: { head: "main", on: { branch: "main", commits: 1 } } },
    ]);
    const review = await f.api(`/api/reviews/${bundle.id}/targets/${bundle.targets[0].id}/review`);
    expect(review.files.map((file: { path: string }) => file.path)).toEqual(["file.txt"]);
    expect(review.patch).toContain("-before\n+after 0");
  });

  it("saves the names of a range's endpoints with the commits they name", async () => {
    const f = await fixture();
    const repo = f.repos[0]!;
    git(repo, "switch", "-c", "week-view");
    git(repo, "commit", "-am", "after");
    const named = await f.saved(
      await f.run("create", "--title", "Week", "--repo", repo, "--base", "main", "--head", "HEAD"),
    );
    expect(named.targets[0]).toMatchObject({
      base: git(repo, "rev-parse", "main"),
      head: git(repo, "rev-parse", "HEAD"),
      names: { base: "main", head: "week-view" },
    });
    expect(named.targets[0].names.on).toBeUndefined();
  });

  it("captures working changes from a multi-repository manifest and keeps the capture when files change", async () => {
    const f = await fixture(2);
    const path = join(f.root, "review.json");
    await writeFile(
      path,
      JSON.stringify({
        title: "Several repos",
        targets: f.repos.map((repo) => ({
          repo: relative(process.cwd(), repo),
          comparison: { kind: "working" },
        })),
      }),
    );
    const bundle = await f.saved(await f.run("create", "--manifest", path));
    expect(bundle.targets.map((target: { repo: string }) => target.repo)).toEqual(f.repos);
    for (const [index, target] of bundle.targets.entries()) {
      await writeFile(join(f.repos[index]!, "file.txt"), "later\n");
      const review = await f.api(`/api/reviews/${bundle.id}/targets/${target.id}/review`);
      expect(review.patch).toContain(`+after ${index}`);
      expect(review.patch).not.toContain("later");
    }
  });

  it("answers a comment in its thread as the session, by the start of its ID", async () => {
    const f = await fixture();
    const claude = "5c1f0e2a-9b7d-4e3a-8f6c-2d4b6a8c0e1f";
    const bundle = await f.saved(
      await f.run(
        "create",
        "--key",
        "fix-copy",
        "--title",
        "Fix",
        "--repo",
        f.repos[0]!,
        "--working",
        "--no-session",
        "--session",
        `claude:${claude}`,
      ),
    );
    const notesPath = `/api/reviews/${bundle.id}/targets/${bundle.targets[0].id}/notes`;
    const added = await (
      await fetch(`http://127.0.0.1:${f.host.port}${notesPath}`, {
        method: "POST",
        headers: { authorization: `Bearer ${f.host.token}`, "content-type": "application/json" },
        body: JSON.stringify({
          expectedRevision: (await f.api(notesPath)).revision,
          mutation: {
            type: "add",
            note: { path: "file.txt", side: "new", line: 1, text: "Why after?" },
          },
        }),
      })
    ).json();
    const comment = added.notes[0].id;
    // The start of the ID finds the comment and its review; the words after it
    // are the answer.
    expect(await f.run("reply", comment.slice(0, 6), "It", "reads", "later.")).toBe(
      "Your reply is in the comment's thread.",
    );
    await f.run("reply", comment, "--key", bundle.id, "--text", "  Or after.  ");
    const notes = (await f.api(notesPath)).notes;
    expect(notes.slice(1)).toMatchObject([
      {
        parentId: comment,
        text: "It reads later.",
        author: { agent: "claude", sessionId: claude },
      },
      { parentId: comment, text: "Or after.", author: { agent: "claude", sessionId: claude } },
    ]);
    await expect(f.run("reply", "--key", "fix-copy", "--text", "Done.")).rejects.toThrow(
      "Use reply with the comment's ID, as the user's message gives it",
    );
    await expect(f.run("reply", "gone", "Done.")).rejects.toThrow('"gone" is not a comment ID.');
    await expect(f.run("reply", "abcdef12", "Done.")).rejects.toThrow(
      "Med request failed: No thread in Med has a comment with ID abcdef12.",
    );
    await expect(f.run("reply", "abcdef12", "--key", "fix-copy", "Done.")).rejects.toThrow(
      "Med request failed: This review has no comment with that ID.",
    );
  });

  it("attaches a guide to a committed range with its commits, then replaces and removes it", async () => {
    const f = await fixture();
    const repo = f.repos[0]!;
    const base = git(repo, "rev-parse", "HEAD");
    git(repo, "commit", "-am", "Change the file");
    await writeFile(join(repo, "notes.md"), "# Notes\n");
    git(repo, "add", ".");
    git(repo, "commit", "-m", "Add notes");
    const head = git(repo, "rev-parse", "HEAD");
    const guide = async (name: string, value: unknown) => {
      const path = join(f.root, name);
      await writeFile(path, JSON.stringify(value));
      return path;
    };
    const first = {
      summary: "Changes the file and adds notes.",
      segments: [
        {
          title: "The file",
          area: "core",
          critical: true,
          summary: "One line changes.",
          files: ["file.txt"],
          comments: [
            { file: "file.txt", line: 1, kind: "risk", body: "Check the old callers." },
            { file: "file.txt", body: "The whole file is one value." },
          ],
        },
        { title: "Notes", summary: "New notes.", files: ["*.md"] },
      ],
    };
    const bundle = await f.saved(
      await f.run(
        "create",
        "--title",
        "Guided",
        "--key",
        "guided",
        "--repo",
        repo,
        "--base",
        base,
        "--head",
        head,
        "--guide",
        await guide("guide.json", first),
      ),
    );
    expect(bundle.guide).toMatchObject({
      summary: first.summary,
      segments: [
        {
          title: "The file",
          area: "core",
          critical: true,
          comments: [
            { file: "file.txt", line: 1, side: "new", kind: "risk" },
            { file: "file.txt", side: "new", kind: "note" },
          ],
        },
        { title: "Notes", files: ["*.md"] },
      ],
    });
    expect(bundle.iterations[0].guide.summary).toBe(first.summary);
    expect(bundle.targets[0].commits.map((commit: { subject: string }) => commit.subject)).toEqual([
      "Change the file",
      "Add notes",
    ]);
    expect(bundle.targets[0].moreCommits).toBeUndefined();

    // A guide that leaves a file out, names one twice, and names a missing one.
    const partial = {
      segments: [
        { title: "File", files: ["file.txt", "gone.ts"] },
        {
          title: "Again",
          files: ["file.txt"],
          comments: [{ file: "notes.md", line: 1, body: "x" }],
        },
      ],
    };
    const checked = await f.run(
      "update",
      "--key",
      "guided",
      "--guide",
      await guide("partial.json", partial),
    );
    expect(checked.split("\n").slice(1)).toEqual([
      "Guide check: put every changed file in exactly one segment.",
      '- In no segment (Med shows them under "Other changes"): notes.md',
      "- In more than one segment: file.txt",
      "- Match no changed file: segments[0].files: gone.ts",
      "- Comments on a file that is not a changed file of their segment: segments[1].comments[0]: notes.md",
      `Fix the guide, then run: med review update --key "guided" ${f.flags} --guide <file>`,
    ]);

    const second = { summary: "Second guide.", segments: [{ title: "All", files: ["**"] }] };
    const clean = await f.run(
      "update",
      "--key",
      "guided",
      "--guide",
      await guide("second.json", second),
    );
    expect(clean).not.toContain("Guide check");
    const updated = await f.api(`/api/reviews/${bundle.id}`);
    expect(updated.guide.summary).toBe("Second guide.");
    expect(updated.revision).toBe(bundle.revision);

    await expect(
      f.run("update", "--key", "guided", "--guide", await guide("bad.json", { segments: [] })),
    ).rejects.toThrow("Invalid guide at segments");
    const removed = await fetch(`http://127.0.0.1:${f.host.port}/api/reviews/${bundle.id}/guide`, {
      method: "POST",
      headers: { authorization: `Bearer ${f.host.token}`, "content-type": "application/json" },
      body: JSON.stringify({ guide: null }),
    });
    expect(removed.status).toBe(200);
    expect((await f.api(`/api/reviews/${bundle.id}`)).guide).toBeUndefined();
  });

  it("announces a review to open windows and opens its link when no window is open", async () => {
    const f = await fixture();
    const origin = `http://127.0.0.1:${f.host.port}`;
    const headers = { authorization: `Bearer ${f.host.token}` };
    const opened: string[] = [];
    const create = async (title: string) => {
      const output: string[] = [];
      await runReviewCommand(
        [
          ...["create", "--title", title, "--repo", f.repos[0]!, "--working", "--open"],
          ...["--state-dir", f.stateDir, "--port", String(f.host.port)],
        ],
        { print: (text) => output.push(text), openUrl: (url) => opened.push(url) },
      );
      return output.join("\n").match(/\/review\/(r_[a-z0-9]+)/)![1]!;
    };

    // An open window hears of the review; no browser opens.
    const window = new AbortController();
    const channel = await fetch(`${origin}/api/windows`, { headers, signal: window.signal });
    const reader = channel.body!.pipeThrough(new TextDecoderStream()).getReader();
    const shown = await create("Shown");
    let text = "";
    while (!/event: review\ndata: .*\n\n/.test(text)) text += (await reader.read()).value ?? "";
    const data = /event: review\ndata: (.*)\n/.exec(text)![1]!;
    // A review that no session handed off is a thread of its own.
    expect(JSON.parse(data)).toEqual({
      type: "review",
      id: shown,
      thread: shown,
      title: "Shown",
      open: true,
      updated: false,
    });
    expect(opened).toEqual([]);

    // With the window closed, the CLI opens the review link instead.
    window.abort();
    const listening = async () => {
      const response = await fetch(`${origin}/api/windows/review`, {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({ id: shown }),
      });
      return ((await response.json()) as { windows: number }).windows;
    };
    await expect.poll(listening).toBe(0);
    const linked = await create("Linked");
    expect(opened).toEqual([`${origin}/review/${linked}#token=${f.host.token}`]);
  });

  it("updates one review by key: versions keep comments, and the PR link and title come later", async () => {
    const f = await fixture();
    const repo = f.repos[0]!;
    const create = (title: string, key: string, ...more: string[]) =>
      f.run(
        "create",
        "--title",
        title,
        "--key",
        key,
        "--repo",
        repo,
        "--working",
        "--no-pr",
        ...more,
      );
    const first = await f.saved(await create("Round one", "feat/x"));
    expect(first.iterations).toMatchObject([{ number: 1 }]);
    const post = (path: string, body: unknown) =>
      fetch(`http://127.0.0.1:${f.host.port}${path}`, {
        method: "POST",
        headers: { authorization: `Bearer ${f.host.token}`, "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    const noted = await post(`/api/reviews/${first.id}/targets/${first.targets[0].id}/notes`, {
      expectedRevision: 0,
      mutation: {
        type: "add",
        note: { path: "file.txt", side: "new", line: 1, text: "Keep this" },
      },
    });
    expect(noted.status).toBe(200);

    await writeFile(join(repo, "file.txt"), "after again\n");
    const output = await create("Round two", "feat/x");
    const [link, note] = output.split("\n");
    expect(note).toBe("Added iteration 2 to the review with this key.");
    const second = await f.saved(link!);
    expect(second).toMatchObject({
      id: first.id,
      key: "feat/x",
      title: "Round two",
      commentCount: 1,
      totals: { comparisons: 1 },
    });
    expect(second.iterations.map((entry: { number: number }) => entry.number)).toEqual([1, 2]);
    const current = second.iterations[1].targetIds[0];
    expect((await f.api(`/api/reviews/${first.id}/targets/${current}/review`)).patch).toContain(
      "+after again",
    );
    const earlier = await f.api(`/api/reviews/${first.id}/targets/${first.targets[0].id}/notes`);
    expect(earlier.notes.map((entry: { text: string }) => entry.text)).toEqual(["Keep this"]);

    // The pull request opens after the review; its link and its title, read
    // with gh, join the same review. The short title stays for the workspace.
    const bin = join(f.root, "bin");
    await mkdir(bin);
    await writeFile(
      join(bin, "gh"),
      `#!/bin/sh
if [ "$*" = "pr view https://github.com/example/repo/pull/7 --json title" ]; then
  echo '{"title":"feat(x): explain the second round in the review header"}'
  exit 0
fi
exit 1
`,
      { mode: 0o755 },
    );
    vi.stubEnv("PATH", `${bin}:${process.env.PATH}`);
    const updated = await f.run(
      "update",
      "--key",
      "feat/x",
      "--pr",
      "https://github.com/example/repo/pull/7",
    );
    expect(updated).toContain(`/review/${first.id}`);
    const linked = {
      title: "Round two",
      pullRequestUrl: "https://github.com/example/repo/pull/7",
      pullRequestTitle: "feat(x): explain the second round in the review header",
    };
    expect(await f.api(`/api/reviews/${first.id}`)).toMatchObject(linked);
    // A later round without a PR lookup keeps the PR and its title.
    await writeFile(join(repo, "file.txt"), "after a third time\n");
    expect(await f.saved((await create("Round three", "feat/x")).split("\n")[0]!)).toMatchObject({
      ...linked,
      title: "Round three",
    });
    const other = await f.saved(await create("Other", "feat/y"));
    expect(other.id).not.toBe(first.id);
    await expect(f.run("update", "--key", "missing", "--title", "Nope")).rejects.toThrow(
      "No review has this key",
    );
    await expect(create("Bad", "has space")).rejects.toThrow("Invalid key");
  });

  it("links the agent session that hands off a review, with the directory it started in", async () => {
    const f = await fixture();
    const home = join(f.root, "home");
    const claude = join(home, ".claude", "projects", "-work-app");
    await mkdir(claude, { recursive: true });
    await writeFile(
      join(claude, "claude-1.jsonl"),
      `{"type":"user","cwd":"/work/app","sessionId":"claude-1"}\n`,
    );
    const codex = join(home, ".codex", "sessions", "2026", "10", "07");
    await mkdir(codex, { recursive: true });
    await writeFile(
      join(codex, "rollout-2026-10-07T10-00-00-codex-9.jsonl"),
      `{"type":"session_meta","payload":{"id":"codex-9","cwd":"/work/codex"}}\n`,
    );
    const connection = ["--state-dir", f.stateDir, "--port", String(f.host.port)];
    const run = async (environment: NodeJS.ProcessEnv, ...command: string[]) => {
      const output: string[] = [];
      await runReviewCommand([...command, ...connection], {
        print: (text) => output.push(text),
        environment,
        home,
      });
      return output[0]!;
    };
    const create = ["create", "--title", "Agents", "--key", "feat/agents"];
    const target = ["--repo", f.repos[0]!, "--working", "--no-pr"];
    // The Claude Code session that runs the command is found on its own.
    const bundle = await f.saved(
      await run({ CLAUDE_CODE_SESSION_ID: "claude-1" }, ...create, ...target),
    );
    expect(bundle.session).toEqual({ agent: "claude", id: "claude-1", cwd: "/work/app" });
    // --session names another; the review moves to that session's thread.
    await run(
      { CLAUDE_CODE_SESSION_ID: "claude-1" },
      "update",
      "--key",
      "feat/agents",
      "--session",
      "codex:codex-9",
    );
    expect((await f.api(`/api/reviews/${bundle.id}`)).session).toEqual({
      agent: "codex",
      id: "codex-9",
      cwd: "/work/codex",
    });
    const quiet = await f.saved(
      await run(
        { CLAUDE_CODE_SESSION_ID: "claude-1" },
        "create",
        "--title",
        "None",
        ...target,
        "--no-session",
      ),
    );
    expect(quiet.session).toBeUndefined();
    await expect(run({}, ...create, ...target, "--session", "gpt:1")).rejects.toThrow(
      "Use --session claude:<session-id>",
    );
  });

  it("reports invalid commands and missing repositories without printing a review link", async () => {
    const f = await fixture();
    const output: string[] = [];
    const run = (...command: string[]) =>
      runReviewCommand([...command, "--state-dir", f.stateDir, "--port", String(f.host.port)], {
        print: (text) => output.push(text),
      });
    await expect(run("create", "--title", "Fix", "--repo", f.repos[0]!)).rejects.toThrow(
      "both --base and --head",
    );
    await expect(
      run("create", "--title", "Fix", "--repo", f.repos[0]!, "--working", "--merge-base"),
    ).rejects.toThrow("Use --working without");
    const path = join(f.root, "invalid.json");
    await writeFile(
      path,
      JSON.stringify({
        title: "Bad",
        targets: [{ repo: f.repos[0], comparison: { kind: "patch", path: "a.patch" } }],
      }),
    );
    await expect(run("create", "--manifest", path)).rejects.toThrow("Invalid review manifest");
    await expect(run("create", "--manifest", path, "--repo", f.repos[0]!)).rejects.toThrow(
      "Use --manifest without",
    );
    // An unregistered repository: ask the user before med add.
    const outside = await state();
    git(outside, "init", "-b", "main");
    await writeFile(join(outside, "a.txt"), "a\n");
    await expect(
      run("create", "--title", "Outside", "--repo", outside, "--working"),
    ).rejects.toThrow(
      `${outside} is not registered in Med. Ask the user before you add it; with their OK, run: med add ${f.flags} ${outside}`,
    );
    expect(output).toEqual([]);
  });

  it("shows only the files that --paths names, on create and as a new version on update", async () => {
    const f = await fixture();
    const repo = f.repos[0]!;
    // file.txt changed before the agent started; the agent adds its own files.
    await writeFile(join(repo, "mine.ts"), "export const mine = 1;\n");
    await mkdir(join(repo, "docs"));
    await writeFile(join(repo, "docs", "notes.md"), "# Notes\n");
    const files = async (review: { id: string; iterations?: { targetIds: string[] }[] }) => {
      const target = review.iterations!.at(-1)!.targetIds[0]!;
      const shown = (await f.api(`/api/reviews/${review.id}/targets/${target}/review`)) as {
        files: { path: string }[];
        comparison: unknown;
      };
      return { comparison: shown.comparison, paths: shown.files.map((file) => file.path) };
    };
    const created = await f.saved(
      await f.run(
        "create",
        "--title",
        "Mine",
        "--repo",
        repo,
        "--working",
        "--key",
        "mine",
        "--no-pr",
        "--paths",
        join(repo, "mine.ts"),
        join(repo, "docs"),
      ),
    );
    expect(await files(created)).toEqual({
      comparison: { kind: "working", paths: ["mine.ts", "docs"] },
      paths: ["docs/notes.md", "mine.ts"],
    });
    // update --paths adds a version; the first one stays.
    expect(await f.run("update", "--key", "mine", "--paths", join(repo, "file.txt"))).toMatch(
      /^\[Review changes here\]/,
    );
    const updated = (await f.api(`/api/reviews/${created.id}`)) as typeof created;
    expect(updated.iterations).toHaveLength(2);
    expect(await files(updated)).toEqual({
      comparison: { kind: "working", paths: ["file.txt"] },
      paths: ["file.txt"],
    });
    // Mistakes say what to do.
    await expect(f.run("update", "--key", "mine", "--paths")).rejects.toThrow(
      "Name one or more files or folders after --paths.",
    );
    await expect(
      f.run("update", "--key", "mine", "--paths", join(f.root, "elsewhere.ts")),
    ).rejects.toThrow(`is not a file or folder in ${repo}.`);
    await expect(f.run("repos", "--paths", "mine.ts")).rejects.toThrow(
      "Use --paths with create or update.",
    );
  });

  it("reports a stopped host and does not expose its credential", async () => {
    const f = await fixture();
    await f.host.close();
    await expect(f.run("repos")).rejects.toThrow(
      `Start that Med with med web --state-dir ${f.stateDir}`,
    );
  });
});

it("does not follow redirects or print credentials from peer errors", async () => {
  const stateDir = await state();
  const token = await getPersistentToken(stateDir);
  let followed = false;
  let redirect = true;
  const peer = createServer((request, response) => {
    if (request.url === "/leak") followed = true;
    if (redirect) response.writeHead(302, { location: "/leak" }).end();
    else
      response
        .writeHead(401, { "content-type": "application/json" })
        .end(JSON.stringify({ error: { message: `Expired ${token}` } }));
  });
  servers.push(peer);
  await new Promise<void>((done) => peer.listen(0, "127.0.0.1", done));
  const address = peer.address();
  if (!address || typeof address === "string") throw new Error("Missing address");
  await publishConnection(stateDir, {
    version: 1,
    origin: `http://127.0.0.1:${address.port}`,
    pid: process.pid,
    token,
  });
  const args = ["repos", "--state-dir", stateDir, "--port", String(address.port)];
  await expect(runReviewCommand(args)).rejects.toThrow("Could not connect to med");
  expect(followed).toBe(false);
  redirect = false;
  await expect(runReviewCommand(args)).rejects.toThrow("Expired [credential]");
});

describe("local connection state", () => {
  it("preserves the credential and restricts saved state permissions", async () => {
    const directory = await state();
    const tokens = await Promise.all(
      Array.from({ length: 8 }, () => getPersistentToken(directory)),
    );
    expect(new Set(tokens).size).toBe(1);
    const first = tokens[0]!;
    expect(await getPersistentToken(directory)).toBe(first);
    expect((await stat(directory)).mode & 0o777).toBe(0o700);
    expect((await stat(join(directory, "credential"))).mode & 0o777).toBe(0o600);
    await publishConnection(directory, {
      version: 1,
      origin: "http://127.0.0.1:4173",
      token: first,
      pid: process.pid,
    });
    expect((await stat(join(directory, "connections", "4173.json"))).mode & 0o777).toBe(0o600);
  });

  it("keeps ports separate and does not remove a replacement descriptor", async () => {
    const directory = await state();
    const token = await getPersistentToken(directory);
    const one = { version: 1 as const, origin: "http://127.0.0.1:4173", token, pid: process.pid };
    const cleanup = await publishConnection(directory, one);
    await publishConnection(directory, { ...one, origin: "http://127.0.0.1:4174" });
    await publishConnection(directory, one);
    await cleanup();
    expect((await readConnection(directory, 4173)).pid).toBe(process.pid);
    expect((await readConnection(directory, 4174)).origin).toBe("http://127.0.0.1:4174");
  });

  it("without --port, finds the one host that runs on another port", async () => {
    const directory = await state();
    const token = await getPersistentToken(directory);
    const host = (port: number, pid = process.pid) => ({
      version: 1 as const,
      origin: `http://127.0.0.1:${port}`,
      token,
      pid,
    });
    const port = async () => (await parseReviewCommand(["repos", "--state-dir", directory])).port;
    expect(await port()).toBe(DEFAULT_PORT);
    // A service that kept the old default, beside a stale record for the new one.
    await publishConnection(directory, host(4173));
    await publishConnection(directory, host(DEFAULT_PORT, spawnSync("true").pid));
    expect(await port()).toBe(4173);
    await publishConnection(directory, host(DEFAULT_PORT));
    expect(await port()).toBe(DEFAULT_PORT);
    expect(
      (await parseReviewCommand(["repos", "--state-dir", directory, "--port", "4173"])).port,
    ).toBe(4173);
  });

  it("rejects a descriptor that could send the credential to another origin", async () => {
    const directory = await state();
    const token = await getPersistentToken(directory);
    await publishConnection(directory, {
      version: 1,
      origin: "http://127.0.0.1:4173",
      token,
      pid: process.pid,
    });
    const path = join(directory, "connections", "4173.json");
    const data = JSON.parse(await readFile(path, "utf8"));
    await writeFile(path, JSON.stringify({ ...data, origin: "https://example.com" }));
    await expect(readConnection(directory)).rejects.toThrow("No valid med connection");
  });
});
