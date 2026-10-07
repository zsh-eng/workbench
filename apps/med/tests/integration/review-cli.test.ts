import { execFileSync } from "node:child_process";
import { createServer, type Server } from "node:http";
import { mkdtemp, mkdir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runReviewCommand } from "../../src/cli/review";
import { startHost, type RunningHost } from "../../src/host/server";
import {
  getPersistentToken,
  publishConnection,
  readConnection,
} from "../../src/host/runtime/connection";

const temporary: string[] = [];
const servers: Server[] = [];
const hosts: RunningHost[] = [];
afterEach(async () => {
  await Promise.all(hosts.splice(0).map((host) => host.close()));
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((done) => {
          server.close(() => done());
          server.closeAllConnections();
        }),
    ),
  );
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});
async function state() {
  const path = await realpath(await mkdtemp(join(tmpdir(), "med-review-cli-")));
  temporary.push(path);
  return path;
}
const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_AUTHOR_NAME: "Test",
      GIT_AUTHOR_EMAIL: "test@example.invalid",
      GIT_COMMITTER_NAME: "Test",
      GIT_COMMITTER_EMAIL: "test@example.invalid",
    },
  }).trim();
async function fixture(count = 1) {
  const root = await state();
  const repos: string[] = [];
  for (let index = 0; index < count; index++) {
    const repo = join(root, `repo-${index}`);
    await mkdir(repo);
    git(repo, "init", "-b", "main");
    git(repo, "config", "commit.gpgsign", "false");
    await writeFile(join(repo, "file.txt"), "before\n");
    git(repo, "add", ".");
    git(repo, "commit", "-m", "before");
    await writeFile(join(repo, "file.txt"), `after ${index}\n`);
    repos.push(repo);
  }
  const stateDir = join(root, "state");
  const host = await startHost({ repo: repos[0]!, repos, stateDir, port: 0 });
  hosts.push(host);
  const args = ["--state-dir", stateDir, "--port", String(host.port)];
  const run = async (...command: string[]) => {
    const output: string[] = [];
    await runReviewCommand([...command, ...args], { print: (text) => output.push(text) });
    return output.join("\n");
  };
  const api = async (path: string) => {
    const response = await fetch(`http://127.0.0.1:${host.port}${path}`, {
      headers: { authorization: `Bearer ${host.token}` },
    });
    expect(response.status).toBe(200);
    return response.json();
  };
  const saved = async (output: string) => {
    expect(output).toMatch(
      new RegExp(
        `^\\[Review changes here\\]\\(http://127\\.0\\.0\\.1:${host.port}/review/r_[a-z0-9]+\\)$`,
      ),
    );
    expect(output).not.toContain(host.token);
    const id = output.match(/\/review\/(r_[a-z0-9]+)/)![1];
    return api(`/api/reviews/${id}`);
  };
  return { root, repos, host, stateDir, run, api, saved };
}

describe("agent review CLI through the production host", () => {
  it("discovers registered repositories and creates a readable committed review from relative paths", async () => {
    const f = await fixture();
    const repo = f.repos[0]!;
    const base = git(repo, "rev-parse", "HEAD");
    git(repo, "commit", "-am", "after");
    const head = git(repo, "rev-parse", "HEAD");
    const listing = await f.run("repos");
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
    expect(bundle.targets).toMatchObject([{ repo, base, head }]);
    const review = await f.api(`/api/reviews/${bundle.id}/targets/${bundle.targets[0].id}/review`);
    expect(review.files.map((file: { path: string }) => file.path)).toEqual(["file.txt"]);
    expect(review.patch).toContain("-before\n+after 0");
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

  it("attaches a brief from a file, then replaces and removes it without a new revision", async () => {
    const f = await fixture();
    const path = join(f.root, "brief.md");
    await writeFile(path, "\n# Fix\n\nSee [file.txt:1](file.txt:1).\n\n");
    const bundle = await f.saved(
      await f.run("create", "--title", "Fix", "--repo", f.repos[0]!, "--working", "--brief", path),
    );
    expect(bundle.brief.text).toBe("# Fix\n\nSee [file.txt:1](file.txt:1).");
    const post = (brief: string | null) =>
      fetch(`http://127.0.0.1:${f.host.port}/api/reviews/${bundle.id}/brief`, {
        method: "POST",
        headers: { authorization: `Bearer ${f.host.token}`, "content-type": "application/json" },
        body: JSON.stringify({ brief }),
      });
    const replaced = await (await post("Second brief")).json();
    expect(replaced).toMatchObject({ brief: { text: "Second brief" }, revision: bundle.revision });
    expect((await post("x".repeat(100_001))).status).toBe(400);
    expect((await f.api(`/api/reviews/${bundle.id}`)).brief.text).toBe("Second brief");
    expect((await (await post(null)).json()).brief).toBeUndefined();
    expect((await f.api(`/api/reviews/${bundle.id}`)).brief).toBeUndefined();
    const empty = join(f.root, "empty.md");
    await writeFile(empty, " \n");
    await expect(
      f.run("create", "--title", "Fix", "--repo", f.repos[0]!, "--working", "--brief", empty),
    ).rejects.toThrow("Invalid brief: Supply the brief text.");
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
    expect(JSON.parse(data)).toEqual({
      type: "review",
      id: shown,
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

  it("updates one review by key: iterations keep comments and briefs, and the PR link comes later", async () => {
    const f = await fixture();
    const repo = f.repos[0]!;
    const brief = async (name: string, text: string) => {
      const path = join(f.root, name);
      await writeFile(path, text);
      return path;
    };
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
    const first = await f.saved(
      await create("Round one", "feat/x", "--brief", await brief("one.md", "First round")),
    );
    expect(first.iterations).toMatchObject([{ number: 1, brief: { text: "First round" } }]);
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
    const output = await create(
      "Round two",
      "feat/x",
      "--brief",
      await brief("two.md", "Second round"),
    );
    const [link, note] = output.split("\n");
    expect(note).toBe("Added iteration 2 to the review with this key.");
    const second = await f.saved(link!);
    expect(second).toMatchObject({
      id: first.id,
      key: "feat/x",
      title: "Round two",
      commentCount: 1,
      brief: { text: "Second round" },
      totals: { comparisons: 1 },
    });
    expect(
      second.iterations.map((entry: { number: number; brief: { text: string } }) => [
        entry.number,
        entry.brief.text,
      ]),
    ).toEqual([
      [1, "First round"],
      [2, "Second round"],
    ]);
    const current = second.iterations[1].targetIds[0];
    expect((await f.api(`/api/reviews/${first.id}/targets/${current}/review`)).patch).toContain(
      "+after again",
    );
    const earlier = await f.api(`/api/reviews/${first.id}/targets/${first.targets[0].id}/notes`);
    expect(earlier.notes.map((entry: { text: string }) => entry.text)).toEqual(["Keep this"]);

    // The pull request opens after the review; its link joins the same review.
    const updated = await f.run(
      "update",
      "--key",
      "feat/x",
      "--pr",
      "https://github.com/example/repo/pull/7",
    );
    expect(updated).toContain(`/review/${first.id}`);
    expect((await f.api(`/api/reviews/${first.id}`)).pullRequestUrl).toBe(
      "https://github.com/example/repo/pull/7",
    );
    const other = await f.saved(await create("Other", "feat/y"));
    expect(other.id).not.toBe(first.id);
    await expect(f.run("update", "--key", "missing", "--title", "Nope")).rejects.toThrow(
      "No review has this key",
    );
    await expect(create("Bad", "has space")).rejects.toThrow("Invalid key");
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
    const outside = await state();
    git(outside, "init", "-b", "main");
    await expect(
      run("create", "--title", "Outside", "--repo", outside, "--working"),
    ).rejects.toThrow("Med request failed:");
    expect(output).toEqual([]);
  });

  it("reports a stopped host and does not expose its credential", async () => {
    const f = await fixture();
    await f.host.close();
    await expect(f.run("repos")).rejects.toThrow("Start med-diff");
  });
});

// A hostile peer is outside the CLI's tested path. Keep real fetch so redirects
// and credential redaction are observed rather than asserted as request options.
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

// Focused state tests cover simultaneous creation and stale-process cleanup.
// Sequential CLI tests cannot reliably reproduce these cross-process races.
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
