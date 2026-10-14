import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, expect, it } from "vitest";

const exec = promisify(execFile);
const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

it("installs the Med skill for each agent present, keeps other skills, and removes its own", async () => {
  const home = await realpath(await mkdtemp(join(tmpdir(), "med-skills-")));
  temporary.push(home);
  const cli = resolve("src/cli/index.ts");
  const med = async (...args: string[]) =>
    (await exec("bun", [cli, "skills", ...args], { env: { ...process.env, HOME: home } })).stdout;
  const skill = await readFile(resolve("skills/med/SKILL.md"), "utf8");
  const claude = join(home, ".claude", "skills", "med", "SKILL.md");
  const codex = join(home, ".agents", "skills", "med", "SKILL.md");

  const instructions = await readFile(resolve("skills/thread-instructions.md"), "utf8");

  // Only Claude Code is set up, so only it gets the skill. A first install
  // also shows the lines for the user's CLAUDE.md or AGENTS.md.
  await mkdir(join(home, ".claude"));
  const first = await med("install");
  expect(first).toMatch(
    /^Installed the Med skill for Claude Code: ~\/\.claude\/skills\/med\/SKILL\.md\n\nAdd these lines to ~\/\.claude\/CLAUDE\.md/,
  );
  expect(first.endsWith(instructions)).toBe(true);
  expect(await med("instructions")).toBe(instructions);
  // The setup guide shows the same lines.
  expect(await readFile(resolve("docs/AGENT_INTEGRATION.md"), "utf8")).toContain(instructions);
  expect(await readFile(claude, "utf8")).toBe(skill);
  await expect(readFile(codex)).rejects.toThrow("ENOENT");
  expect(await med("install")).toContain("is up to date");

  // Codex reads ~/.agents/skills. A different skill named med stays unless forced.
  await mkdir(join(home, ".codex"));
  await mkdir(join(home, ".agents", "skills", "med"), { recursive: true });
  await writeFile(codex, "---\nname: med\ndescription: Someone else's skill\n---\n");
  await expect(med("install")).rejects.toMatchObject({
    stderr: expect.stringContaining("~/.agents/skills/med holds another skill or a link"),
  });
  expect(await readFile(codex, "utf8")).toContain("Someone else's skill");
  expect(await med("install", "--codex", "--force")).toContain("Updated the Med skill for Codex");
  expect(await readFile(codex, "utf8")).toBe(skill);

  // A link to a working copy is replaced only on request, and its target stays.
  const copy = join(home, "copy");
  await mkdir(copy);
  await writeFile(join(copy, "SKILL.md"), skill);
  await rm(join(home, ".claude", "skills", "med"), { recursive: true });
  await symlink(copy, join(home, ".claude", "skills", "med"));
  await expect(med("install", "--claude")).rejects.toMatchObject({
    stderr: expect.stringContaining("holds another skill or a link"),
  });
  expect(await med("uninstall", "--codex")).toBe(
    "Removed the Med skill for Codex: ~/.agents/skills/med\n",
  );
  await expect(readFile(codex)).rejects.toThrow("ENOENT");
  expect(await readFile(join(copy, "SKILL.md"), "utf8")).toBe(skill);
  expect(await med("show")).toBe(`${skill}\n`);
});
