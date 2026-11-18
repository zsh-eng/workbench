import { execFileSync, spawn } from "node:child_process";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runReviewCommand } from "../../src/cli/review";
import { cleanUp, clearAgentSession, fixture, git } from "./review-cli-fixture";

beforeEach(clearAgentSession);
afterEach(cleanUp);

describe("hand-off checks that say what to do next", () => {
  /** Runs a command and keeps its link output and its advice apart. */
  const checked = async (
    f: Awaited<ReturnType<typeof fixture>>,
    command: string[],
    options: { environment?: NodeJS.ProcessEnv; home?: string } = {},
  ) => {
    const out: string[] = [];
    const advice: string[] = [];
    await runReviewCommand(
      [...command, "--no-pr", "--state-dir", f.stateDir, "--port", String(f.host.port)],
      {
        print: (text) => out.push(text),
        warn: (text) => advice.push(text),
        // A scratch home: the checks read transcripts from ~/.claude.
        home: join(f.root, "home"),
        ...options,
      },
    );
    return { out: out.join("\n"), advice: advice.join("\n") };
  };
  const reviews = async (f: Awaited<ReturnType<typeof fixture>>) =>
    (await readdir(join(f.stateDir, "reviews")).catch(() => [] as string[])).filter((name) =>
      name.endsWith(".json"),
    ).length;

  it("takes a folder inside the repository as the repository", async () => {
    const f = await fixture();
    const repo = f.repos[0]!;
    await mkdir(join(repo, "src"));
    const { out } = await checked(f, [
      "create",
      "--title",
      "Inner folder",
      "--repo",
      join(repo, "src"),
      "--working",
      "--paths",
      join(repo, "file.txt"),
    ]);
    const bundle = await f.saved(out);
    expect(bundle.targets[0]).toMatchObject({
      repo,
      comparison: { kind: "working", paths: ["file.txt"] },
    });
    // update --paths takes the folder too.
    await writeFile(join(repo, "file.txt"), "again\n");
    const again = await checked(f, [
      "update",
      "--key",
      bundle.id,
      "--repo",
      join(repo, "src"),
      "--paths",
      join(repo, "file.txt"),
    ]);
    expect((await f.saved(again.out)).targets.at(-1)).toMatchObject({
      repo,
      comparison: { kind: "working", paths: ["file.txt"] },
    });
  });

  it("refuses an empty hand-off and names the comparison that holds the work", async () => {
    const f = await fixture();
    const repo = f.repos[0]!;
    const home = join(f.root, "home");
    const project = join(home, ".claude", "projects", "-work");
    await mkdir(project, { recursive: true });
    // The session started after the fixture's commit and before its own on main.
    const start = Date.now() + 60_000;
    await writeFile(
      join(project, "s-1.jsonl"),
      `{"type":"user","cwd":"${repo}","timestamp":"${new Date(start).toISOString()}"}\n`,
    );
    execFileSync("git", ["commit", "-qam", "agent work"], {
      cwd: repo,
      env: {
        ...process.env,
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_AUTHOR_NAME: "Test",
        GIT_AUTHOR_EMAIL: "test@example.invalid",
        GIT_COMMITTER_NAME: "Test",
        GIT_COMMITTER_EMAIL: "test@example.invalid",
        GIT_COMMITTER_DATE: new Date(start + 60_000).toISOString(),
      },
    });
    await expect(
      checked(
        f,
        ["create", "--title", "On main", "--repo", repo, "--base", "main", "--head", "HEAD"],
        {
          environment: { CLAUDE_CODE_SESSION_ID: "s-1" },
          home,
        },
      ),
    ).rejects.toThrow(
      "main and HEAD are the same commit, so there is nothing to review. For commits that you made on this branch, pass the commit before your work as --base. This session made 1 commit on HEAD: --base HEAD~1 --head HEAD.",
    );
    await expect(
      checked(f, ["create", "--title", "Clean tree", "--repo", repo, "--working"]),
    ).rejects.toThrow(`${repo} has no uncommitted changes, so there is nothing to review.`);
    expect(await reviews(f)).toBe(0);
  });

  it("compares a branch from its merge base when the base moved on, unless told not to", async () => {
    const f = await fixture();
    const repo = f.repos[0]!;
    git(repo, "commit", "-am", "start");
    const fork = git(repo, "rev-parse", "HEAD");
    git(repo, "switch", "-c", "feat/search");
    await writeFile(join(repo, "search.ts"), "export {};\n");
    git(repo, "add", ".");
    git(repo, "commit", "-m", "search");
    git(repo, "switch", "main");
    await writeFile(join(repo, "later.txt"), "main moved on\n");
    git(repo, "add", ".");
    git(repo, "commit", "-m", "later on main");
    const range = ["--repo", repo, "--base", "main", "--head", "feat/search"];
    const pr = await checked(f, ["create", "--title", "Search box", "--key", "one", ...range]);
    expect((await f.saved(pr.out)).targets[0].base).toBe(fork);
    expect(pr.advice).toContain(
      "Merge base: main has 1 commit that feat/search does not have, so Med compared feat/search with their merge base, as a pull request does. Add --no-merge-base to compare the two tips.",
    );
    const tips = await checked(f, [
      "create",
      "--title",
      "Search box",
      "--key",
      "two",
      ...range,
      "--no-merge-base",
    ]);
    expect((await f.saved(tips.out)).targets[0].base).toBe(git(repo, "rev-parse", "main"));
    expect(tips.advice).not.toContain("Merge base");
  });

  it("records no session for a subagent, which has its parent's session ID", async () => {
    const f = await fixture();
    const repo = f.repos[0]!;
    const home = join(f.root, "home");
    // Claude Code keeps a subagent's work beside its parent's transcript.
    const project = join(home, ".claude", "projects", "-work-app");
    const subagents = join(project, "parent", "subagents");
    await mkdir(subagents, { recursive: true });
    const at = new Date().toISOString();
    const start = `{"type":"user","cwd":"/work/app","sessionId":"parent"}\n`;
    const call = (id: string, name: string, input: object, isSidechain = false) =>
      `${JSON.stringify({ type: "assistant", isSidechain, timestamp: at, message: { content: [{ type: "tool_use", id, name, input }] } })}\n`;
    const transcripts = (parent: string, subagent: string) =>
      Promise.all([
        writeFile(join(project, "parent.jsonl"), start + parent),
        writeFile(join(subagents, "agent-a1.jsonl"), start + subagent),
      ]);
    const create = (key: string) =>
      checked(f, ["create", "--title", "Retry policy", "--key", key, "--repo", repo, "--working"], {
        environment: { CLAUDE_CODE_SESSION_ID: "parent" },
        home,
      });

    // The parent waits on its subagent, which runs the hand-off.
    await transcripts(
      call("toolu_agent", "Agent", { prompt: "Fix it, then run med review create." }),
      call("toolu_sub", "Bash", { command: "med review create --key sub --working" }, true),
    );
    const sub = await create("sub");
    expect((await f.saved(sub.out)).session).toBeUndefined();
    expect(sub.advice).toContain(
      "Session: this command runs in a subagent of Claude Code session parent.",
    );

    // The parent's own hand-off, beside a subagent at work, records the parent.
    await transcripts(
      call("toolu_own", "Bash", { command: "med review create --key own --working" }),
      call("toolu_test", "Bash", { command: "bun run test" }, true),
    );
    const own = await create("own");
    expect((await f.saved(own.out)).session).toEqual({
      agent: "claude",
      id: "parent",
      cwd: "/work/app",
    });

    // When no transcript shows the call, Med records nothing and says so.
    await transcripts("", call("toolu_test", "Bash", { command: "bun run test" }, true));
    const unknown = await create("unknown");
    expect((await f.saved(unknown.out)).session).toBeUndefined();
    expect(unknown.advice).toContain(
      "Med could not tell which agent runs this command, so Med recorded no session. If the session itself runs it, add --session claude:parent.",
    );
  });

  it("checks the title, and defaults the key to the branch", async () => {
    const f = await fixture(2);
    const repo = f.repos[0]!;
    git(repo, "switch", "-c", "feat/retry");
    const short = await checked(f, ["create", "--title", "Retry", "--repo", repo, "--working"], {
      environment: { CLAUDE_CODE_SESSION_ID: "s-2" },
    });
    const first = await f.saved(short.out);
    expect(first.key).toBe("feat/retry");
    expect(short.advice).toContain(
      `Title check: the title has 1 word. Use 2–4 words that name what the task builds, without the repository's name or words such as "review" and "changes": med review update --key feat/retry ${f.flags} --title "<2-4 words>"`,
    );
    expect(short.advice).toContain(
      "Key: feat/retry, from the branch. Hand off each later round of this task with the same key",
    );
    expect(short.advice).not.toContain("med review wait");
    // The next round on the branch is the next version of the same review.
    await writeFile(join(repo, "file.txt"), "round two\n");
    const named = await checked(f, [
      "create",
      "--title",
      "repo-0 retry fix",
      "--repo",
      repo,
      "--working",
    ]);
    const [link, note] = named.out.split("\n");
    expect(note).toBe("Added iteration 2 to the review with this key.");
    const second = await f.saved(link!);
    expect(second.id).toBe(first.id);
    expect(second.iterations).toHaveLength(2);
    expect(named.advice).toContain("Title check: the title names the repository (repo-0).");
    const good = await checked(f, ["update", "--key", first.id, "--title", "Fetch retries"]);
    expect(good.out).toContain(first.id);
    expect((await f.api(`/api/reviews/${first.id}`)).title).toBe("Fetch retries");

    // The same branch name in another repository is another task.
    const other = f.repos[1]!;
    git(other, "switch", "-c", "feat/retry");
    const elsewhere = await checked(f, [
      "create",
      "--title",
      "Retry policy",
      "--repo",
      other,
      "--working",
    ]);
    const third = await f.saved(elsewhere.out);
    expect(third.id).not.toBe(first.id);
    expect(third.key).toBe("repo-1/feat/retry");
    expect(elsewhere.advice).toContain("Key: repo-1/feat/retry, from the branch.");
  });

  it("warns when a guide update would describe code that the capture does not show", async () => {
    const f = await fixture();
    const repo = f.repos[0]!;
    const guide = join(f.root, "guide.json");
    await writeFile(guide, JSON.stringify({ segments: [{ title: "File", files: ["file.txt"] }] }));
    await checked(f, [
      "create",
      "--key",
      "fix",
      "--title",
      "Small fix",
      "--repo",
      repo,
      "--working",
    ]);
    const fresh = await checked(f, ["update", "--key", "fix", "--guide", guide]);
    expect(fresh.advice).not.toContain("Stale capture");
    await writeFile(join(repo, "file.txt"), "fixed after the comments\n");
    const stale = await checked(f, ["update", "--key", "fix", "--guide", guide]);
    expect(stale.advice).toContain(
      `Stale capture: the checkout changed after version 1 was captured, so this guide now goes with code that the review does not show. To hand off your fixes, make version 2 with the same key: med review create --key fix ${f.flags} --repo ${repo} --working --guide <file>`,
    );
  });

  it("asks for generated files last, and names files that this session did not edit", async () => {
    const f = await fixture();
    const repo = f.repos[0]!;
    await writeFile(join(repo, "mine.ts"), "export const mine = 1;\n");
    await writeFile(join(repo, "bun.lock"), "{}\n");
    const home = join(f.root, "home");
    const project = join(home, ".claude", "projects", "-work");
    await mkdir(project, { recursive: true });
    await writeFile(
      join(project, "s-3.jsonl"),
      [
        { type: "user", cwd: repo, timestamp: new Date().toISOString() },
        {
          type: "assistant",
          cwd: repo,
          message: {
            content: [
              { type: "tool_use", name: "Write", input: { file_path: join(repo, "mine.ts") } },
              { type: "tool_use", name: "Edit", input: { file_path: join(repo, "bun.lock") } },
            ],
          },
        },
      ]
        .map((line) => JSON.stringify(line))
        .join("\n") + "\n",
    );
    const guide = join(f.root, "guide.json");
    await writeFile(
      guide,
      JSON.stringify({
        segments: [
          { title: "Lockfile", files: ["bun.lock"] },
          { title: "Code", files: ["mine.ts", "file.txt"] },
        ],
      }),
    );
    const run = await checked(
      f,
      [
        "create",
        "--key",
        "mine",
        "--title",
        "Mine only",
        "--repo",
        repo,
        "--working",
        "--guide",
        guide,
      ],
      { environment: { CLAUDE_CODE_SESSION_ID: "s-3" }, home },
    );
    expect(run.out).toContain(
      'Guide check: order the segments by review priority.\n- Put lockfiles and generated files in the last segments, after the code and tests: "Lockfile" before "Code"',
    );
    expect(run.advice).toContain(
      `Shared checkout: file.txt changed, but this session did not edit it. If it is not part of your task, hand off only your files: med review update --key mine ${f.flags} --paths ${join(repo, "bun.lock")} ${join(repo, "mine.ts")}`,
    );
  });

  it("reads a manifest from standard input", async () => {
    const f = await fixture(2);
    const manifest = JSON.stringify({
      title: "Two repos",
      targets: f.repos.map((repo) => ({ repo, comparison: { kind: "working" } })),
    });
    const child = spawn(
      "bun",
      [
        resolve("src/cli/index.ts"),
        "review",
        "create",
        "--manifest",
        "-",
        "--no-pr",
        "--no-session",
        "--state-dir",
        f.stateDir,
        "--port",
        String(f.host.port),
      ],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    child.stdin.end(manifest);
    let out = "";
    child.stdout.on("data", (chunk) => (out += chunk));
    const code = await new Promise((done) => child.on("close", done));
    expect(code).toBe(0);
    const bundle = await f.saved(out.trim());
    expect(bundle.targets.map((target: { repo: string }) => target.repo)).toEqual(f.repos);
  });

  it("checks proof, an explainer, and open findings only when the repository opts in", async () => {
    const f = await fixture();
    const repo = f.repos[0]!;
    const guide = join(f.root, "guide.json");
    const withSummary = async (summary: string) => {
      await writeFile(
        guide,
        JSON.stringify({ summary, segments: [{ title: "Retry", files: ["file.txt"] }] }),
      );
      return ["--guide", guide];
    };
    const handoff = (...extra: string[]) =>
      checked(f, [
        "create",
        "--key",
        "t",
        "--title",
        "Retry policy",
        "--repo",
        repo,
        "--working",
        ...extra,
      ]);
    // Off by default: a hand-off without proof is captured as before.
    await handoff();
    const saved = await reviews(f);
    expect(saved).toBeGreaterThan(0);

    execFileSync("git", ["config", "med.checks", "proof,findings"], { cwd: repo });
    const refused = await handoff(
      ...(await withSummary("## Findings\n- Important `file.txt:1` The retry never stops.\n")),
    ).catch((error: Error) => error.message);
    expect(refused).toMatch(
      /^.+ asks for proof,findings with each hand-off \(git config med\.checks proof,findings\)\. Add a Proof section in the guide's summary: .+med skills suggest proof-first.+; and no open Important finding: fix it, or close each as Fixed, Intentional, or Won't fix with a reason \(file\.txt:1\)\. Then run med review create again\. Nothing was captured\. To turn the check off, the user runs: git config --unset-all med\.checks$/,
    );
    expect(await reviews(f)).toBe(saved);

    // With proof, and the finding closed, the version is captured.
    const { out } = await handoff(
      ...(await withSummary(
        "## Proof\n- `bun test`: 3 passed\n\n## Findings\n- Important `file.txt:1` The retry never stops. Fixed: it stops after 3 tries.\n",
      )),
    );
    expect((await f.saved(out.split("\n")[0]!)).iterations).toHaveLength(2);

    // A guide's summary is an explainer, however short.
    execFileSync("git", ["config", "med.checks", "explainer"], { cwd: repo });
    await expect(handoff()).rejects.toThrow(
      /asks for explainer with each hand-off .+ Add an explainer: why the change exists/,
    );
    await handoff(...(await withSummary("Retries stop.")));
    expect(await reviews(f)).toBe(saved);
  });
});
