import { afterEach, expect, test, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { SavedReview } from "../../src/shared/saved-review";
import { startHost, type RunningHost } from "../../src/host/server";
import { runPullRequestCommand } from "../../src/cli/pr";
import { createPrDrafts } from "../../src/host/pr-drafts";
import { removeFolder } from "./remove-folder";

const directories: string[] = [];
const hosts: RunningHost[] = [];
afterEach(async () => {
  await Promise.all(hosts.splice(0).map((host) => host.close()));
  await Promise.all(directories.splice(0).map((path) => removeFolder(path)));
  vi.unstubAllEnvs();
});

/** One pixel, as a PNG. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

test("an agent drafts a pull request from the template with an image; the reader comments, and Create runs gh pr create once GitHub has the branch's commits", async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "med pr drafts ")));
  directories.push(directory);
  const repo = join(directory, "repo");
  const remote = join(directory, "remote.git");
  await mkdir(join(repo, ".github"), { recursive: true });
  const git = (...args: string[]) => execFileSync("git", args, { cwd: repo }).toString().trim();
  git("init", "-q", "-b", "main");
  await writeFile(join(repo, ".github", "pull_request_template.md"), "## Why\n\n## Testing\n");
  await writeFile(join(repo, "retry.ts"), "export const retry = 1;\n");
  git("add", ".");
  git("-c", "user.name=Med", "-c", "user.email=med@example.invalid", "commit", "-qm", "Start");
  git("checkout", "-qb", "feat/retry");
  const log = join(directory, "gh.log");
  const sentBody = join(directory, "body.md");
  vi.stubEnv("FAKE_GH_LOG", log);
  vi.stubEnv("FAKE_GH_BODY_OUT", sentBody);
  vi.stubEnv("FAKE_GH_CREATED", "https://github.com/example/repo/pull/7");
  const stateDir = join(directory, "state");
  const gh = {
    command: process.execPath,
    args: [fileURLToPath(new URL("../fixtures/gh/fake-gh.mjs", import.meta.url))],
  };
  const host = await startHost({ repo, repos: [repo], stateDir, port: 0, gh });
  hosts.push(host);
  const api = async (path: string, body?: unknown) => {
    const response = await fetch(`http://127.0.0.1:${host.port}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { authorization: `Bearer ${host.token}`, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, response };
  };
  const { response: created } = await api("/api/reviews", {
    title: "Fetch retries",
    key: "feat/retry",
    targets: [{ repo, comparison: { kind: "working" } }],
  });
  const { id } = (await created.json()) as { id: string };
  const printed: string[] = [];
  const pr = (...args: string[]) =>
    runPullRequestCommand(args, {
      cwd: repo,
      print: (text) => printed.push(text),
      warn: (text) => printed.push(`warn: ${text}`),
      environment: {},
    });

  // The agent reads the template, then writes the draft with a screenshot.
  await pr("template");
  expect(printed.splice(0)).toEqual(
    [".github/pull_request_template.md"].map((path) => `## ${path}\n\n## Why\n\n## Testing\n`),
  );
  const drafts = join(directory, "drafts");
  await mkdir(drafts);
  await writeFile(join(drafts, "chart.png"), PNG);
  await writeFile(
    join(drafts, "pr.md"),
    "# Retry failed fetches\n\n## Why\n\nCalls failed once and gave up.\n\n![The retry chart](chart.png)\n\n## Testing\n\n- `bun test`\n",
  );
  const draft = ["draft", "--key", "feat/retry", "--file", join(drafts, "pr.md")];
  const instance = ["--state-dir", stateDir, "--port", String(host.port)];
  await pr(...draft, ...instance);
  expect(printed.join("\n")).toMatch(/Pull request draft\]\(.*\), revision 1, with 1 image\./);

  const review = async () =>
    (await (await api(`/api/reviews/${id}`)).response.json()) as SavedReview;
  const saved = (await review()).prDraft!;
  expect(saved).toMatchObject({
    title: "Retry failed fetches",
    repo,
    revision: 1,
    images: [{ href: "chart.png" }],
  });
  expect(saved.body).not.toContain("# Retry failed fetches");
  // Med keeps the image, so the Notes show it after the file is gone.
  const image = await api(`/api/reviews/${id}/pr-draft?image=${saved.images[0]!.file}`);
  expect(image.response.headers.get("content-type")).toBe("image/png");
  expect(Buffer.from(await image.response.arrayBuffer())).toEqual(PNG);

  // A comment on the draft reaches the agent as one on the draft.
  await api(`/api/reviews/${id}/brief-comments`, {
    add: { section: "pr", quote: "Calls failed once", text: "Say how many times it retries." },
  });
  const feedback = (await (await api(`/api/reviews/${id}/feedback`)).response.json()) as {
    text: string;
  };
  expect(feedback.text).toContain("On: the pull request draft (revision 1;");
  expect(feedback.text).toContain("> Calls failed once");
  // The next draft is the next revision.
  await pr(...draft, "--title", "Retry failed fetches three times", ...instance);
  expect((await review()).prDraft).toMatchObject({
    title: "Retry failed fetches three times",
    revision: 2,
  });

  // Med does not push: Create waits for the branch on GitHub.
  const create = () => api(`/api/reviews/${id}/pr-draft-create`, { draft: true });
  const unpushed = await create();
  expect(unpushed.status).toBe(409);
  expect(await unpushed.response.text()).toContain("Push feat/retry to GitHub first");
  execFileSync("git", ["init", "-q", "--bare", remote]);
  git("remote", "add", "origin", remote);
  git("push", "-q", "-u", "origin", "feat/retry");
  // A commit that GitHub does not have yet waits for the next push.
  await writeFile(join(repo, "retry.ts"), "export const retry = 3;\n");
  git("-c", "user.name=Med", "-c", "user.email=med@example.invalid", "commit", "-qam", "Three");
  const behind = await create();
  expect(behind.status).toBe(409);
  expect(await behind.response.text()).toContain("GitHub does not have its last commit");
  git("push", "-q");
  const opened = await create();
  expect(opened.status).toBe(200);
  expect(await opened.response.json()).toMatchObject({
    url: "https://github.com/example/repo/pull/7",
    left: ["The retry chart"],
  });
  const calls = (await readFile(log, "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  expect(calls).toEqual([
    [
      "pr",
      "create",
      "--title",
      "Retry failed fetches three times",
      "--body-file",
      expect.any(String),
      "--head",
      "feat/retry",
      "--draft",
    ],
  ]);
  // GitHub gets no local image: the line names it, for the reader to add there.
  expect(await readFile(sentBody, "utf8")).toContain("_Image: The retry chart (added on GitHub)_");
  expect(await review()).toMatchObject({
    pullRequestUrl: "https://github.com/example/repo/pull/7",
    prDraft: { pullRequestUrl: "https://github.com/example/repo/pull/7" },
  });
  // Once open, Create does not run again.
  expect((await create()).status).toBe(409);

  // A pull request that gh finds open already, as when the window closed
  // while gh ran, is the one that the draft opened.
  vi.stubEnv("FAKE_GH_EXISTS", "https://github.com/example/repo/pull/8");
  const again = await createPrDrafts({ directory: join(directory, "again"), gh }).create(
    (await review()).prDraft!,
    repo,
    false,
  );
  expect(again.url).toBe("https://github.com/example/repo/pull/8");
});
