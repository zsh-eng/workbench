import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, writeFile, rename, rm, symlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, it } from "vitest";
const exec = promisify(execFile),
  temporary: string[] = [];
afterEach(async () => {
  for (const p of temporary.splice(0)) await rm(p, { recursive: true, force: true });
});

it("persists registration and backlinks through the CLI; reconciles edits, additions and renames", async () => {
  const temp = await mkdtemp(join(tmpdir(), "med-vault-cli-"));
  temporary.push(temp);
  const vault = join(temp, "vault"),
    state = join(temp, "state");
  await mkdir(join(vault, "Notes"), { recursive: true });
  await mkdir(join(vault, "Assets"));
  await mkdir(join(vault, ".obsidian"));
  await writeFile(join(vault, "Notes", "Target.md"), "# Target\n");
  await writeFile(join(vault, "Assets", "pic.png"), "image placeholder");
  await writeFile(join(vault, ".obsidian", "ignored.md"), "[[Target]]");
  await writeFile(join(temp, "outside.md"), "[[Target]]");
  await symlink(join(temp, "outside.md"), join(vault, "linked.md"));
  await writeFile(
    join(vault, "Source.md"),
    [
      "---",
      "example: '[[Target]]'",
      "---",
      "[[Target#Heading|label]] ![[pic.png|200]]",
      "`[[Target]]`",
      "```md",
      "[[Target]]",
      "```",
      "\\[[Target]]",
      "<!-- [[Target]] -->",
      "[normal](Notes/Target.md#Heading)",
      "[reference][t]",
      "",
      "[t]: Notes/Target.md",
      "[[Future]]",
      "[[Clash]]",
      "",
    ].join("\n"),
  );
  const run = async (...args: string[]) =>
    JSON.parse(
      (await exec("bun", [resolve("src/cli/index.ts"), ...args, "--state-dir", state])).stdout,
    );
  const added = await run("sources", "add", "vault", vault, "--index"),
    id = added.source.id;
  expect(added.index).toMatchObject({
    files: 3,
    notes: 2,
    links: 6,
    embeds: 1,
    unresolved: 2,
    parsed: 2,
  });
  expect((await run("sources", "list")).sources).toHaveLength(1);
  const links = (await run("vault", "backlinks", id, "Notes/Target.md")).backlinks;
  expect(links).toHaveLength(3);
  expect(links[0]).toMatchObject({ source: "Source.md", line: 4, fragment: "Heading" });
  expect((await run("vault", "backlinks", id, "Assets/pic.png")).backlinks).toMatchObject([
    { embed: 1 },
  ]);
  expect(await run("vault", "index", id)).toMatchObject({ parsed: 0, changed: 0 });
  await writeFile(join(vault, "Future.md"), "# Future\n");
  await writeFile(join(vault, "Notes", "Clash.md"), "# First\n");
  await writeFile(join(vault, "Assets", "Clash.md"), "# Second\n");
  expect(await run("vault", "index", id)).toMatchObject({ parsed: 3, ambiguous: 1, unresolved: 1 });
  expect((await run("vault", "backlinks", id, "Future.md")).backlinks).toHaveLength(1);
  await rename(join(vault, "Future.md"), join(vault, "Later.md"));
  await run("vault", "index", id);
  expect((await run("vault", "backlinks", id, "Future.md")).backlinks).toHaveLength(0);
  await writeFile(join(vault, "Source.md"), "[[Later]]\n");
  expect(await run("vault", "index", id)).toMatchObject({ parsed: 1, links: 1, unresolved: 0 });
  expect((await run("vault", "backlinks", id, "Later.md")).backlinks).toHaveLength(1);
  await writeFile(join(vault, "Version.2.md"), "# Version two\n");
  await writeFile(join(vault, "Source.md"), "[[Version.2]]\n");
  await run("vault", "index", id);
  expect((await run("vault", "backlinks", id, "Version.2.md")).backlinks).toHaveLength(1);
  await run("sources", "remove", id);
  await expect(run("vault", "index", id)).rejects.toThrow("Choose a registered source ID");
});

it("separates repository and vault registrations and rejects a replaced directory", async () => {
  const temp = await mkdtemp(join(tmpdir(), "med-sources-cli-"));
  temporary.push(temp);
  const repo = join(temp, "repo");
  await mkdir(repo);
  await exec("git", ["init", repo]);
  const run = async (...args: string[]) =>
    JSON.parse(
      (
        await exec("bun", [
          resolve("src/cli/index.ts"),
          ...args,
          "--state-dir",
          join(temp, "state"),
        ])
      ).stdout,
    );
  const git = await run("sources", "add", "repo", repo),
    vault = await run("sources", "add", "vault", repo);
  expect(git.id).not.toBe(vault.id);
  expect((await run("sources", "list")).sources).toHaveLength(2);
  await rename(repo, join(temp, "moved"));
  await mkdir(repo);
  await expect(run("vault", "index", vault.id)).rejects.toThrow("registered directory changed");
});

it("prints embedded guides and launches only the saved repositories through the built CLI", async () => {
  const temp = await mkdtemp(join(tmpdir(), "med-registered-host-"));
  temporary.push(temp);
  const repo = join(temp, "repo"),
    state = join(temp, "state");
  await mkdir(repo);
  await exec("git", ["init", "-b", "main", repo]);
  await writeFile(join(repo, "file.md"), "# Example\n");
  await exec("git", ["-C", repo, "add", "."]);
  await exec("git", [
    "-C",
    repo,
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.invalid",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "-m",
    "Initial",
  ]);
  await exec("bun", ["run", "build:server"]);
  const cli = resolve("dist/cli.js");
  const run = async (...args: string[]) =>
    (await exec(process.execPath, [cli, ...args, "--state-dir", state])).stdout;
  await run("sources", "add", "repo", repo);
  expect((await exec(process.execPath, [cli, "docs", "vaults"], { cwd: temp })).stdout).toContain(
    "Registered sources and Obsidian vaults",
  );
  const host = spawn(
    process.execPath,
    [cli, "--registered", "--no-open", "--port", "0", "--state-dir", state],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  let output = "",
    errors = "";
  host.stderr.on("data", (chunk) => {
    errors += chunk;
  });
  const exited = new Promise<void>((done) => host.once("exit", () => done()));
  try {
    const port = await new Promise<string>((done, reject) => {
      const timeout = setTimeout(() => reject(new Error("Host startup timed out.")), 10000);
      host.once("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      host.once("exit", () => {
        clearTimeout(timeout);
        reject(new Error(errors));
      });
      host.stdout.on("data", (chunk) => {
        output += chunk;
        const match = /http:\/\/127\.0\.0\.1:(\d+)/.exec(output);
        if (match) {
          clearTimeout(timeout);
          done(match[1]!);
        }
      });
    });
    const listing = JSON.parse(await run("review", "repos", "--port", port));
    expect(listing.repositories).toMatchObject([{ name: "repo" }]);
  } finally {
    host.kill("SIGTERM");
    const timeout = setTimeout(() => host.kill("SIGKILL"), 5000);
    await exited;
    clearTimeout(timeout);
  }
});
