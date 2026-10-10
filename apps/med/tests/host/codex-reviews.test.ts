import { afterEach, expect, test, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { appendFile, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CodexReviewRun } from "../../src/shared/codex-review";
import type { SavedReview } from "../../src/shared/saved-review";
import { startHost, type RunningHost } from "../../src/host/server";

const directories: string[] = [];
const hosts: RunningHost[] = [];
afterEach(async () => {
  await Promise.all(hosts.splice(0).map((host) => host.close()));
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
  vi.unstubAllEnvs();
});

const DAY = 24 * 60 * 60 * 1000;
const line = (value: unknown) => `${JSON.stringify(value)}\n`;
const item = (at: string, value: unknown) =>
  line({ timestamp: at, type: "event_msg", payload: { type: "item_completed", item: value } });
/** A review's end, as Codex 0.160 writes it. */
const exited = (at: string, findings: { file: string; start: number; end: number }[]) =>
  item(at, {
    type: "ExitedReviewMode",
    review_output: {
      findings: findings.map(({ file, start, end }, index) => ({
        title: `[P${index + 1}] Finding ${index + 1}`,
        body: `Body ${index + 1}.`,
        confidence_score: 0.8,
        priority: index + 1,
        code_location: { absolute_file_path: file, line_range: { start, end } },
      })),
      overall_correctness: "patch is incorrect",
      overall_explanation: "The exporter reads a field that trails do not have.",
      overall_confidence_score: 0.9,
    },
  });

test("lists Codex reviews of a saved review's checkout as findings at its lines", async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "med codex reviews ")));
  directories.push(directory);
  const repo = join(directory, "trails");
  await mkdir(join(repo, "src"), { recursive: true });
  const git = (...args: string[]) =>
    execFileSync("git", ["-c", "user.name=Med", "-c", "user.email=med@example.invalid", ...args], {
      cwd: repo,
      encoding: "utf8",
    }).trim();
  git("init", "-q", "-b", "main");
  await writeFile(join(repo, "src/trails.ts"), "export const trails = [];\n");
  git("add", ".");
  git("commit", "-qm", "Start");
  const base = git("rev-parse", "HEAD");
  await writeFile(join(repo, "src/export.ts"), "export const exportTrails = () => '';\n");
  git("add", ".");
  git("commit", "-qm", "Export trails");
  const head = git("rev-parse", "HEAD");

  const home = join(directory, "home");
  vi.stubEnv("MED_HOME_DIR", home);
  /** Writes a Codex session that started at `at`, in Codex's day folder. */
  const session = async (id: string, cwd: string, commit: string, at: number, rest = "") => {
    const date = new Date(at);
    const pad = (value: number) => String(value).padStart(2, "0");
    const folder = join(
      home,
      ".codex/sessions",
      String(date.getFullYear()),
      pad(date.getMonth() + 1),
      pad(date.getDate()),
    );
    await mkdir(folder, { recursive: true });
    const path = join(folder, `rollout-2026-10-10T08-00-00-${id}.jsonl`);
    const meta = { id, timestamp: date.toISOString(), cwd, git: { commit_hash: commit } };
    await writeFile(path, line({ type: "session_meta", payload: meta }) + rest);
    return path;
  };
  const yesterday = Date.now() - DAY;
  const earlier = new Date(yesterday + 1000).toISOString();
  const file = join(repo, "src/export.ts");
  // A review of the head, from before the review was saved.
  await session(
    "codex-head",
    repo,
    head,
    yesterday,
    item(earlier, { type: "EnteredReviewMode", user_facing_hint: "changes against 'main'" }) +
      exited(earlier, [
        { file, start: 1, end: 1 },
        { file: join(directory, "elsewhere.ts"), start: 2, end: 2 },
      ]),
  );
  // An older commit's review, and a review of another folder: not this review's.
  await session("codex-old", repo, base, yesterday, exited(earlier, [{ file, start: 1, end: 1 }]));
  await session(
    "codex-other",
    directory,
    head,
    yesterday,
    exited(earlier, [{ file, start: 1, end: 1 }]),
  );
  // A session that has not finished its review yet.
  const growing = await session("codex-later", repo, base, Date.now());

  const host = await startHost({
    repo,
    repos: [repo],
    stateDir: join(directory, "state"),
    port: 0,
  });
  hosts.push(host);
  const api = async <T>(path: string, body?: unknown) => {
    const response = await fetch(`http://127.0.0.1:${host.port}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { authorization: `Bearer ${host.token}`, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return (await response.json()) as T;
  };
  const saved = await api<SavedReview>("/api/reviews", {
    title: "Export trails",
    targets: [{ repo, comparison: { kind: "range", base: "main~1", head: "main" } }],
  });
  expect(saved.targets[0]!.head).toBe(head);
  const runs = async () =>
    (await api<{ runs: CodexReviewRun[] }>(`/api/reviews/${saved.id}/codex-reviews`)).runs;

  expect(await runs()).toEqual([
    {
      id: "codex-head:0",
      threadId: "codex-head",
      repo,
      commit: head,
      createdAt: earlier,
      target: "changes against 'main'",
      verdict: "patch is incorrect",
      explanation: "The exporter reads a field that trails do not have.",
      findings: [
        {
          id: "codex-head:0:0",
          title: "Finding 1",
          body: "Body 1.",
          priority: 1,
          confidence: 0.8,
          path: "src/export.ts",
          startLine: 1,
          endLine: 1,
        },
      ],
    },
  ]);

  // The review that ends after the review was saved shows too, newest first.
  const later = new Date(Date.now() + 1000).toISOString();
  await appendFile(growing, exited(later, [{ file, start: 1, end: 1 }]));
  expect((await runs()).map((run) => [run.id, run.findings.length])).toEqual([
    ["codex-later:0", 1],
    ["codex-head:0", 1],
  ]);
});
