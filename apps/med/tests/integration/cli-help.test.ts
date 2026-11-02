import { execFile } from "node:child_process";
import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";

// The real CLI, as a person types it: help, typos, and exit statuses. None of
// these commands needs a server.

let root: string;
beforeAll(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "med-cli-help-")));
});
afterAll(() => rm(root, { recursive: true, force: true }));

function med(...args: string[]) {
  const env = {
    ...process.env,
    HOME: root,
    MED_HOME_DIR: root,
    MED_STATE_DIR: join(root, "state"),
  };
  return new Promise<{ code: number; stdout: string; stderr: string }>((done) => {
    execFile(
      "bun",
      [resolve("src/cli/index.ts"), ...args],
      { env, cwd: root, timeout: 30_000 },
      (error, stdout, stderr) => done({ code: error ? Number(error.code) : 0, stdout, stderr }),
    );
  });
}

it("refuses a word that is neither a command nor a folder, and names the command it is near", async () => {
  const typo = await med("revew");
  expect(typo).toMatchObject({ code: 2, stdout: "" });
  expect(typo.stderr).toBe(
    'med: "revew" is not a command or a folder. Did you mean "review"?\nRun med --help to see the commands.\n',
  );
  const far = await med("xyzzy");
  expect(far.code).toBe(2);
  expect(far.stderr).not.toContain("Did you mean");
  // A later word of the foreground mode must be a folder too.
  expect(await med(".", "missing")).toMatchObject({
    code: 2,
    stderr: 'med: "missing" is not a folder.\n',
  });
  expect((await med("--frobnicate")).code).toBe(2);
});

it("prints help with med help, and a command's own help with med help <command>", async () => {
  const help = await med("help");
  expect(help.code).toBe(0);
  expect(help.stdout).toBe((await med("--help")).stdout);
  // The commands by task, in lines that fit a terminal.
  expect(help.stdout).toMatch(/^Start:\n {2}web {7}Start the server/m);
  expect(help.stdout).toMatch(/^Hand off work:\n {2}review {4}/m);
  for (const line of help.stdout.split("\n")) expect(line.length).toBeLessThanOrEqual(80);
  // Each command it lists has its own help, which names it.
  const commands = [...help.stdout.matchAll(/^ {2}([a-z]+) {2,}/gm)].map((match) => match[1]!);
  expect(commands).toEqual(
    "web add status stop review pr thread open list remove index skills service agents docs".split(
      " ",
    ),
  );
  for (const command of [...commands, "serve", "sources"]) {
    const own = await med("help", command);
    expect(own.code).toBe(0);
    expect(own.stdout).toMatch(new RegExp(`^Usage: med ${command}\\b`));
    expect(own.stdout).not.toContain("med-diff");
  }
  expect((await med("help", "review")).stdout).toContain("Examples:\n");
  const docs = await med("help", "docs");
  expect(docs).toMatchObject({ code: 0, stdout: (await med("docs", "--help")).stdout });
  expect(await med("help", "revew")).toMatchObject({
    code: 2,
    stderr:
      'med: "revew" is not a command. Did you mean "review"?\nRun med --help to see the commands.\n',
  });
});

it("prints the user guide's index and then each of its pages, in the index's order", async () => {
  const index = await readFile(resolve("docs/USAGE.md"), "utf8");
  const pages = [...index.matchAll(/^- \[[^\]]+\]\((usage\/[a-z-]+\.md)\)/gm)].map((m) => m[1]!);
  expect(pages.length).toBe(12);
  const texts = await Promise.all(pages.map((page) => readFile(resolve("docs", page), "utf8")));
  const usage = await med("docs", "usage");
  expect(usage.stdout).toBe(`${[index, ...texts].map((text) => text.trimEnd()).join("\n\n")}\n`);
});

it("says that no server runs: status exits 0, and a command that needs the server exits 4", async () => {
  const status = await med("status");
  expect(status).toMatchObject({
    code: 0,
    stdout: expect.stringMatching(/^Med is not running\. Start it: med web/),
  });
  expect(await med("status", "--json")).toMatchObject({ code: 0, stdout: '{"running":false}\n' });
  const repos = await med("review", "repos");
  expect(repos.code).toBe(4);
  expect(repos.stderr).toContain("No valid med connection was found");
});
