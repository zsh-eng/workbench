import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, expect, it } from "vitest";

const exec = promisify(execFile);
const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const step of cleanup.splice(0).reverse()) await step().catch(() => {});
});

const env = {
  ...process.env,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "test@example.invalid",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@example.invalid",
};
const git = async (cwd: string, ...args: string[]) =>
  (await exec("git", args, { cwd, env })).stdout.trim();
async function freePort() {
  const server = createServer();
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const { port } = server.address() as { port: number };
  await new Promise((done) => server.close(done));
  return port;
}

it("checks out a pull request with gh and opens its merge-base review in the background server", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "med-pr-cli-")));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const origin = join(root, "origin.git");
  const author = join(root, "author");
  const local = join(root, "local");
  await git(root, "init", "--bare", "-b", "main", origin);
  await git(root, "clone", "-q", origin, author);
  await git(author, "config", "commit.gpgsign", "false");
  await writeFile(join(author, "greeting.ts"), 'export const greeting = "hello";\n');
  await writeFile(join(author, "notes.md"), "# Notes\n");
  await git(author, "add", ".");
  await git(author, "commit", "-qm", "Initial");
  await git(author, "push", "-q", "origin", "main");
  await git(root, "clone", "-q", origin, local);
  // GitHub URLs resolve to the local bare repository.
  await git(local, "remote", "set-url", "origin", "https://github.com/acme/demo.git");
  await git(local, "config", `url.${origin}.insteadOf`, "https://github.com/acme/demo.git");

  // The pull request branches from main; main then moves on. The local clone
  // has not seen the new base, so the command must fetch it.
  await git(author, "checkout", "-qb", "feature");
  await writeFile(join(author, "greeting.ts"), 'export const greeting = "hello, reviewer";\n');
  await git(author, "commit", "-qam", "Greet the reviewer");
  await git(author, "push", "-q", "origin", "feature:refs/pull/7/head");
  const head = await git(author, "rev-parse", "HEAD");
  await git(author, "checkout", "-q", "main");
  await writeFile(join(author, "notes.md"), "# Notes\n\nMain moved on.\n");
  await git(author, "commit", "-qam", "Move main");
  await git(author, "push", "-q", "origin", "main");
  const base = await git(author, "rev-parse", "HEAD");

  // A stand-in for gh with the two commands Med runs.
  const bin = join(root, "bin");
  await mkdir(bin);
  await writeFile(
    join(bin, "pr.json"),
    JSON.stringify({
      number: 7,
      title: "Greet the reviewer",
      url: "https://github.com/acme/demo/pull/7",
      baseRefName: "main",
      baseRefOid: base,
      headRefOid: head,
    }),
  );
  await writeFile(
    join(bin, "gh"),
    `#!/bin/sh
set -e
if [ "$1 $2" = "pr checkout" ]; then
  git fetch -q origin "refs/pull/$3/head"
  git checkout -q -B "pr-$3" FETCH_HEAD
  echo "Switched to branch 'pr-$3'"
  exit 0
fi
if [ "$1 $2 $3" = "pr view 7" ]; then cat "$(dirname "$0")/pr.json"; exit 0; fi
echo "unexpected: gh $*" >&2
exit 1
`,
  );
  await chmod(join(bin, "gh"), 0o755);

  const state = join(root, "state");
  const port = String(await freePort());
  const cli = resolve("src/cli/index.ts");
  const run = (...args: string[]) =>
    exec("bun", [cli, ...args, "--state-dir", state, "--port", port], {
      cwd: local,
      env: { ...env, PATH: `${bin}:${process.env.PATH}` },
    });
  cleanup.push(() => run("stop"));
  const { stdout } = await run("pr", "checkout", "7", "--no-open");

  expect(await git(local, "rev-parse", "--abbrev-ref", "HEAD")).toBe("pr-7");
  const launch = new URL(stdout.trim().split("\n").at(-1)!);
  expect(launch.origin).toBe(`http://127.0.0.1:${port}`);
  const id = /^\/review\/([A-Za-z0-9_-]+)$/.exec(launch.pathname)![1];
  const headers = {
    authorization: `Bearer ${new URLSearchParams(launch.hash.slice(1)).get("token")}`,
  };
  const api = async (path: string) => {
    const response = await fetch(`${launch.origin}${path}`, { headers });
    expect(response.status).toBe(200);
    return response.json();
  };
  const bundle = await api(`/api/reviews/${id}`);
  expect(bundle).toMatchObject({
    title: "#7 Greet the reviewer",
    pullRequestUrl: "https://github.com/acme/demo/pull/7",
    targets: [{ repo: await realpath(local), head }],
  });
  // Only the pull request's change: main's later commit is not part of it.
  const review = await api(`/api/reviews/${id}/targets/${bundle.targets[0].id}/review`);
  expect(review.files.map((file: { path: string }) => file.path)).toEqual(["greeting.ts"]);
  expect(review.patch).toContain('+export const greeting = "hello, reviewer";');

  // A second run reuses the server and the registration.
  const again = await run("pr", "checkout", "7", "--no-open");
  expect(new URL(again.stdout.trim().split("\n").at(-1)!).origin).toBe(launch.origin);
  const repositories = await api("/api/repositories");
  expect(repositories.repositories).toHaveLength(1);
}, 60000);

it("explains how to use the command and rejects a missing pull request", async () => {
  const cli = resolve("src/cli/index.ts");
  const help = await exec("bun", [cli, "pr", "--help"]);
  expect(help.stdout).toContain("med pr checkout <number|url|branch>");
  await expect(exec("bun", [cli, "pr", "checkout"])).rejects.toMatchObject({
    stderr: expect.stringContaining("Choose a pull request"),
  });
});
