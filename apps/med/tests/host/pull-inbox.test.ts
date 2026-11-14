import { afterEach, expect, test, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { PullInbox } from "../../src/shared/pull-inbox";
import { startHost, type RunningHost } from "../../src/host/server";
import { removeFolder } from "./remove-folder";

// The pull requests page's list: the host keeps its last answer in the state
// folder, so a reload and a restart show it at once, and it reads GitHub
// again only when a page asks for a fresh or a new list.

const directories: string[] = [];
const hosts: RunningHost[] = [];
afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(hosts.splice(0).map((host) => host.close()));
  await Promise.all(directories.splice(0).map((path) => removeFolder(path)));
  vi.unstubAllEnvs();
});

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

/** Your open pull requests on GitHub, as the fake gh's searches find them. */
function onGitHub(...titles: string[]) {
  const node = (title: string, at: number) => ({
    url: `https://github.com/acme/trailhead/pull/${420 + at}`,
    number: 420 + at,
    title,
    isDraft: false,
    createdAt: "2026-11-01T00:00:00Z",
    updatedAt: `2026-11-0${9 - at}T00:00:00Z`,
    additions: 3,
    deletions: 1,
    headRefName: `topic-${at}`,
    baseRefName: "main",
    reviewDecision: "REVIEW_REQUIRED",
    mergeable: "MERGEABLE",
    author: { login: "you" },
    repository: { nameWithOwner: "acme/trailhead" },
    commits: { nodes: [] },
    reviewRequests: { nodes: [] },
  });
  vi.stubEnv("FAKE_GH_SEARCH", JSON.stringify({ review: [], author: titles.map(node) }));
}

async function fixture() {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "med pull list ")));
  directories.push(directory);
  const repo = join(directory, "trailhead");
  await mkdir(repo);
  git(repo, "init", "-q", "-b", "main");
  git(repo, "remote", "add", "origin", "git@github.com:acme/trailhead.git");
  const log = join(directory, "gh.log");
  await writeFile(log, "");
  vi.stubEnv("FAKE_GH_LOG", log);
  vi.stubEnv("MED_HOME_DIR", join(directory, "home"));
  const start = async () => {
    const host = await startHost({
      repo,
      stateDir: join(directory, "state"),
      port: 0,
      gh: {
        command: process.execPath,
        args: [fileURLToPath(new URL("../fixtures/gh/fake-gh.mjs", import.meta.url))],
      },
    });
    hosts.push(host);
    return host;
  };
  /** How many GitHub searches gh has run. */
  const searches = async () =>
    (await readFile(log, "utf8")).split("\n").filter((line) => line.includes('"graphql"')).length;
  return { start, searches };
}

async function read(host: RunningHost, query = "") {
  const response = await fetch(`http://127.0.0.1:${host.port}/api/pull-requests${query}`, {
    headers: { authorization: `Bearer ${host.token}` },
  });
  expect(response.status).toBe(200);
  return (await response.json()) as PullInbox;
}
const titles = (inbox: PullInbox) => inbox.yours.map((row) => row.title);

test("the page's last list shows at once after a reload and a restart, and a page that asks reads GitHub again", async () => {
  const { start, searches } = await fixture();
  onGitHub("Search chips");
  const host = await start();
  // With no list kept, the first read waits for GitHub: two searches.
  expect(titles(await read(host))).toEqual(["Search chips"]);
  expect(await searches()).toBe(2);
  // A page that opens again gets the kept list, and so does one that asks
  // for a fresh list within the minute.
  onGitHub("Search chips", "Clear chips");
  expect(titles(await read(host))).toEqual(["Search chips"]);
  expect(titles(await read(host, "?read=fresh"))).toEqual(["Search chips"]);
  expect(await searches()).toBe(2);
  // The refresh button reads GitHub again.
  expect(titles(await read(host, "?read=new"))).toEqual(["Search chips", "Clear chips"]);
  expect(await searches()).toBe(4);
  // A click while a read runs gets a read of its own, after that one ends.
  vi.stubEnv("FAKE_GH_DELAY_MS", "400");
  const running = read(host, "?read=new");
  await new Promise((done) => setTimeout(done, 100));
  onGitHub("Trail names");
  const clicked = read(host, "?read=new");
  await running;
  const last = await clicked;
  vi.stubEnv("FAKE_GH_DELAY_MS", "0");
  expect(titles(last)).toEqual(["Trail names"]);
  expect(await searches()).toBe(8);

  // A new host on the same state folder has the list before gh answers.
  await host.close();
  const again = await start();
  expect(await read(again)).toEqual(last);
  expect(await searches()).toBe(8);
  // A minute on, pages that ask for a fresh list share one read of GitHub.
  onGitHub("Clear chips");
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(Date.now() + 61_000);
  vi.stubEnv("FAKE_GH_DELAY_MS", "300");
  const [one, two] = await Promise.all([read(again, "?read=fresh"), read(again, "?read=fresh")]);
  expect(titles(one)).toEqual(["Clear chips"]);
  expect(two).toEqual(one);
  expect(await searches()).toBe(10);
});

test("a failed read keeps the last list and says why, and with no list the page says why", async () => {
  const { start, searches } = await fixture();
  onGitHub("Search chips");
  vi.stubEnv("FAKE_GH_SIGNED_OUT", "github.com");
  const host = await start();
  const signedOut = "You are not logged into any accounts on github.com";
  expect(await read(host)).toMatchObject({ yours: [], unavailable: signedOut });
  vi.stubEnv("FAKE_GH_SIGNED_OUT", "");
  const listed = await read(host, "?read=new");
  expect(titles(listed)).toEqual(["Search chips"]);
  expect(listed.unavailable).toBeUndefined();

  // gh signs out: the list stays, from its read, with the reason.
  vi.stubEnv("FAKE_GH_SIGNED_OUT", "github.com");
  const failed = await read(host, "?read=new");
  expect(failed).toEqual({ ...listed, failed: { at: expect.any(String), reason: signedOut } });
  // The failed read counts: within the minute, a fresh list asks GitHub nothing.
  const tries = await searches();
  expect(await read(host, "?read=fresh")).toEqual(failed);
  expect(await searches()).toBe(tries);
  // The next read that works says nothing of it.
  vi.stubEnv("FAKE_GH_SIGNED_OUT", "");
  const back = await read(host, "?read=new");
  expect(titles(back)).toEqual(["Search chips"]);
  expect(back.failed).toBeUndefined();
});
