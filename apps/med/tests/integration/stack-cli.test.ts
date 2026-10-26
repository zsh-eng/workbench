import { execFileSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runReviewCommand } from "../../src/cli/review";
import { startHost, type RunningHost } from "../../src/host/server";
import type { SavedReview } from "../../src/shared/saved-review";
import type { Thread } from "../../src/shared/threads";

// Stacks and sets (docs/STACKS.md) through the CLI and the production host:
// one thread of many reviews, made by `--stack`, by detection, or by hand.

beforeEach(() => {
  for (const name of [
    "CLAUDE_CODE_SESSION_ID",
    "MED_SESSION",
    "MED_THREAD_KEY",
    "MED_THREAD_REPO",
    "MED_PORT",
    "MED_STATE_DIR",
  ])
    vi.stubEnv(name, "");
});
const cleanup: (() => Promise<unknown>)[] = [];
const hosts: RunningHost[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(hosts.splice(0).map((host) => host.close()));
  for (const step of cleanup.splice(0).reverse()) await step().catch(() => {});
});

const env = {
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "test@example.invalid",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@example.invalid",
};
const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, ...env },
  }).trim();

/** A gh stand-in: `pr view <n>` prints that pull request from pulls.json. */
const FAKE_GH = `#!/usr/bin/env node
const { readFileSync, appendFileSync } = require("node:fs");
const { join } = require("node:path");
const args = process.argv.slice(2);
appendFileSync(join(__dirname, "calls.log"), JSON.stringify(args) + "\\n");
const pulls = JSON.parse(readFileSync(join(__dirname, "pulls.json"), "utf8"));
if (args[0] === "pr" && args[1] === "view") {
  const key = args[2].replace(/^.*\\/pull\\//, "");
  if (pulls[key]) { process.stdout.write(JSON.stringify(pulls[key])); process.exit(0); }
}
process.stderr.write("fake gh: no answer for " + args.join(" "));
process.exit(1);
`;

/**
 * A repository with four branches stacked on main (parse, ast, types,
 * codegen), each adding one file, and a host that has it. With `remote`, the
 * branches live only in a bare origin as pull requests 21–24, which the local
 * clone has not fetched.
 */
async function bed({ remote = false } = {}) {
  vi.stubEnv("GIT_CONFIG_GLOBAL", "/dev/null");
  vi.stubEnv("GIT_CONFIG_NOSYSTEM", "1");
  const root = await realpath(await mkdtemp(join(tmpdir(), "med-stack-")));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const author = join(root, "author");
  await mkdir(author);
  git(author, "init", "-q", "-b", "main");
  git(author, "config", "commit.gpgsign", "false");
  await writeFile(join(author, "README.md"), "# Compiler\n");
  git(author, "add", ".");
  git(author, "commit", "-qm", "Start");
  const layers = ["parse", "ast", "types", "codegen"];
  const heads: string[] = [];
  let below = "main";
  for (const name of layers) {
    git(author, "checkout", "-q", "-b", name, below);
    await writeFile(join(author, `${name}.ts`), `export const ${name} = true;\n`);
    git(author, "add", ".");
    git(author, "commit", "-qm", `Add ${name}`);
    heads.push(git(author, "rev-parse", "HEAD"));
    below = name;
  }
  git(author, "checkout", "-q", "main");
  let repo = author;
  const pulls: Record<string, unknown> = {};
  if (remote) {
    const origin = join(root, "origin.git");
    git(root, "init", "-q", "--bare", "-b", "main", origin);
    git(author, "remote", "add", "origin", origin);
    git(author, "push", "-q", "origin", "main");
    layers.forEach((name, index) =>
      git(author, "push", "-q", "origin", `${name}:refs/pull/${21 + index}/head`),
    );
    repo = join(root, "local");
    git(root, "clone", "-q", origin, repo);
    git(repo, "remote", "set-url", "origin", "https://github.com/acme/compiler.git");
    git(repo, "config", `url.${origin}.insteadOf`, "https://github.com/acme/compiler.git");
    const main = git(repo, "rev-parse", "main");
    layers.forEach((name, index) => {
      const number = 21 + index;
      pulls[String(number)] = {
        number,
        title: `Add the ${name} pass`,
        url: `https://github.com/acme/compiler/pull/${number}`,
        baseRefName: index ? layers[index - 1] : "main",
        headRefName: name,
        baseRefOid: index ? heads[index - 1] : main,
        headRefOid: heads[index],
        state: index === 0 ? "MERGED" : "OPEN",
        isDraft: index === 3,
      };
    });
    const bin = join(root, "bin");
    await mkdir(bin);
    await writeFile(join(bin, "gh"), FAKE_GH);
    await chmod(join(bin, "gh"), 0o755);
    await writeFile(join(bin, "pulls.json"), JSON.stringify(pulls));
    vi.stubEnv("PATH", `${bin}:${process.env.PATH}`);
  }
  const stateDir = join(root, "state");
  const host = await startHost({ repo, repos: [repo], stateDir, port: 0 });
  hosts.push(host);
  const args = ["--state-dir", stateDir, "--port", String(host.port)];
  const run = async (...command: string[]) => {
    const output: string[] = [];
    await runReviewCommand([...command, ...args], { print: (text) => output.push(text) });
    return output.join("\n");
  };
  const api = async (path: string, body?: unknown) => {
    const response = await fetch(`http://127.0.0.1:${host.port}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        authorization: `Bearer ${host.token}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(`${response.status} ${JSON.stringify(data)}`);
    return data;
  };
  const review = (output: string): Promise<SavedReview> =>
    api(`/api/reviews/${/\/review\/(r_[a-f0-9]+)/.exec(output)![1]}`);
  const tabs = async (): Promise<Thread[]> => (await api("/api/threads")).threads;
  /** The paths of a target's diff. */
  const files = async (saved: SavedReview, targetId: string) =>
    (
      (await api(`/api/reviews/${saved.id}/targets/${targetId}/review`)) as {
        files: { path: string }[];
      }
    ).files.map((file) => file.path);
  const layerFiles = async (saved: SavedReview) => {
    const ids = saved.iterations!.at(-1)!.targetIds;
    return Promise.all(ids.map((id) => files(saved, id)));
  };
  return { root, repo, heads, host, run, api, review, tabs, files, layerFiles };
}

describe("stacks and sets", () => {
  it("makes one thread of four stacked pull requests, each layer against the one below, with no checkout", async () => {
    const f = await bed({ remote: true });
    const branch = git(f.repo, "symbolic-ref", "--short", "HEAD");
    const output = await f.run("create", "--stack", "21", "#22", "23", "24", "--repo", f.repo);
    expect(output).toContain("4 layers, bottom first: Add the parse pass · Add the ast pass");
    const saved = await f.review(output);
    expect(saved.title).toBe("Add the parse pass · 4 layers");
    expect(saved.parts!.shape).toBe("stack");
    expect(saved.parts!.items).toMatchObject([
      { title: "Add the parse pass", state: "merged", base: "main", head: "parse" },
      { title: "Add the ast pass", state: "open", base: "parse", head: "ast" },
      { title: "Add the types pass", state: "open", base: "ast", head: "types" },
      {
        title: "Add the codegen pass",
        state: "draft",
        pullRequestUrl: "https://github.com/acme/compiler/pull/24",
      },
    ]);
    // Each layer shows only its own change.
    expect(await f.layerFiles(saved)).toEqual([
      ["parse.ts"],
      ["ast.ts"],
      ["types.ts"],
      ["codegen.ts"],
    ]);
    // The heads were fetched, not checked out.
    expect(git(f.repo, "symbolic-ref", "--short", "HEAD")).toBe(branch);
    expect(git(f.repo, "cat-file", "-t", f.heads[3]!)).toBe("commit");
    expect(git(f.repo, "status", "--porcelain")).toBe("");
    // One tab, with its parts and their counts.
    const tabs = await f.tabs();
    expect(tabs).toHaveLength(1);
    expect(tabs[0]!.parts!.items.map((part) => [part.title, part.additions, part.files])).toEqual([
      ["Add the parse pass", 1, 1],
      ["Add the ast pass", 1, 1],
      ["Add the types pass", 1, 1],
      ["Add the codegen pass", 1, 1],
    ]);
    // The whole stack is the bottom's base to the top's head.
    const layers = saved
      .iterations!.at(-1)!
      .targetIds.map((id) => saved.targets.find((target) => target.id === id)!);
    const whole = await f.api("/api/review", {
      repo: f.repo,
      comparison: { kind: "range", base: layers[0]!.base, head: layers[3]!.head },
    });
    expect(whole.files.map((file: { path: string }) => file.path).sort()).toEqual([
      "ast.ts",
      "codegen.ts",
      "parse.ts",
      "types.ts",
    ]);
  });

  it("stacks branches without GitHub, makes sets, and replaces one part by its key", async () => {
    const f = await bed();
    const stack = await f.review(
      await f.run(
        "create",
        "--stack",
        "parse",
        "ast",
        "types",
        "--repo",
        f.repo,
        "--key",
        "compiler",
      ),
    );
    expect(stack.parts!.items.map((part) => [part.key, part.base, part.head])).toEqual([
      ["parse", "main", "parse"],
      ["ast", "parse", "ast"],
      ["types", "ast", "types"],
    ]);
    expect(await f.layerFiles(stack)).toEqual([["parse.ts"], ["ast.ts"], ["types.ts"]]);
    // A set: each part since the base, here main.
    const set = await f.review(
      await f.run("create", "--set", "codegen", "types", "--repo", f.repo, "--base", "ast"),
    );
    expect(set.parts!.shape).toBe("set");
    expect(await f.layerFiles(set)).toEqual([["codegen.ts", "types.ts"], ["types.ts"]]);
    // A comment on the bottom layer, then a new commit on the middle one,
    // handed off with that part's key: only the middle layer is new.
    const before = stack.iterations!.at(-1)!.targetIds;
    await f.api(`/api/reviews/${stack.id}/targets/${before[0]}/notes`, {
      reviewId: `${stack.id}:${before[0]}`,
      expectedRevision: 0,
      mutation: { type: "add", note: { path: "parse.ts", side: "new", line: 1, text: "Name it" } },
    });
    git(f.repo, "checkout", "-q", "ast");
    await writeFile(join(f.repo, "ast.ts"), "export const ast = 2;\n");
    git(f.repo, "commit", "-qam", "Change ast");
    git(f.repo, "checkout", "-q", "main");
    const output = await f.run(
      "create",
      "--key",
      "ast",
      "--title",
      "ast",
      "--repo",
      f.repo,
      "--base",
      "parse",
      "--head",
      "ast",
    );
    expect(output).toContain("Added iteration 2");
    const next = await f.review(output);
    expect(next.id).toBe(stack.id);
    const after = next.iterations!.at(-1)!.targetIds;
    expect(after[0]).toBe(before[0]);
    expect(after[1]).not.toBe(before[1]);
    expect(after[2]).toBe(before[2]);
    expect(next.partTotals![next.parts!.items[0]!.id]!.comments).toBe(1);
  });

  it("joins a hand-off whose base is an open thread's head from the same session, and ungroups it", async () => {
    const f = await bed();
    const session = ["--session", "claude:4f9c2a7e-session"];
    const first = await f.review(
      await f.run(
        "create",
        "--title",
        "Parse",
        "--repo",
        f.repo,
        "--base",
        "main",
        "--head",
        "parse",
        "--merge-base",
        ...session,
      ),
    );
    const output = await f.run(
      "create",
      "--title",
      "AST",
      "--repo",
      f.repo,
      "--base",
      "parse",
      "--head",
      "ast",
      "--merge-base",
      ...session,
    );
    expect(output).toContain("Added layer 2 of 2 to the stack");
    const stack = await f.review(output);
    expect(stack.id).toBe(first.id);
    expect(stack.parts!.items.map((part) => part.title)).toEqual(["Parse", "AST"]);
    expect(await f.layerFiles(stack)).toEqual([["parse.ts"], ["ast.ts"]]);
    expect(await f.tabs()).toHaveLength(1);
    // Another session's chained branch is a thread of its own.
    const other = await f.review(
      await f.run(
        "create",
        "--title",
        "Types",
        "--repo",
        f.repo,
        "--base",
        "ast",
        "--head",
        "types",
        "--merge-base",
        "--session",
        "claude:other-session",
      ),
    );
    expect(other.id).not.toBe(stack.id);
    expect(other.parts).toBeUndefined();
    expect(await f.tabs()).toHaveLength(2);
    // By hand: Types goes on top of the stack, and its tab goes.
    const grouped = await f.api(`/api/threads/${other.id}/group`, { onto: stack.id });
    expect(grouped.thread).toBe(stack.id);
    const three = await f.review(`/review/${stack.id}`);
    expect(three.parts!.items.map((part) => part.title)).toEqual(["Parse", "AST", "Types"]);
    expect((await f.tabs()).map((thread) => thread.id)).toEqual([stack.id]);
    // Ungroup: each layer above the first is a thread again.
    const split = await f.api(`/api/threads/${stack.id}/ungroup`, {});
    expect(split.threads).toHaveLength(2);
    const single = await f.review(`/review/${stack.id}`);
    expect(single.parts).toBeUndefined();
    expect(single.title).toBe("Parse");
    expect(await f.layerFiles(single)).toEqual([["parse.ts"]]);
    const tabs = await f.tabs();
    expect(tabs).toHaveLength(3);
    expect(tabs.every((thread) => !thread.parts)).toBe(true);
  });
});
