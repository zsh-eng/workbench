import { execFile } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
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
  const guide = await readFile(resolve("skills/med/guide.md"), "utf8");
  const claude = join(home, ".claude", "skills", "med", "SKILL.md");
  const codex = join(home, ".agents", "skills", "med", "SKILL.md");

  const instructions = await readFile(resolve("skills/thread-instructions.md"), "utf8");

  // Only Claude Code is set up, so only it gets the skill. A first install
  // also shows the lines for the user's CLAUDE.md or AGENTS.md.
  await mkdir(join(home, ".claude"));
  const first = await med("install");
  expect(first).toMatch(
    /^Installed the Med skill for Claude Code: ~\/\.claude\/skills\/med \(SKILL\.md, guide\.md\)\n\nAdd these lines to ~\/\.claude\/CLAUDE\.md/,
  );
  expect(
    first.endsWith(
      `${instructions}\nReview practices to copy into your own skills: med skills suggest\n`,
    ),
  ).toBe(true);
  expect(await med("instructions")).toBe(instructions);
  // The setup guide shows the same lines.
  expect(await readFile(resolve("docs/USAGE.md"), "utf8")).toContain(instructions);
  // The skill points at its guide, which med docs agents prints too.
  expect(await readFile(claude, "utf8")).toBe(skill);
  expect(await readFile(join(home, ".claude", "skills", "med", "guide.md"), "utf8")).toBe(guide);
  expect(
    (await exec("bun", [cli, "docs", "agents"], { env: { ...process.env, HOME: home } })).stdout,
  ).toBe(`${guide.trimEnd()}\n`);
  await expect(readFile(codex)).rejects.toThrow("ENOENT");
  expect(await med("install")).toContain("is up to date");
  // A skill from an earlier version, without its guide, is brought up to date.
  await rm(join(home, ".claude", "skills", "med", "guide.md"));
  expect(await med("install")).toContain("Updated the Med skill for Claude Code");
  expect(await readFile(join(home, ".claude", "skills", "med", "guide.md"), "utf8")).toBe(guide);

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

it("suggests review practices to copy, and writes one only where asked", async () => {
  const home = await realpath(await mkdtemp(join(tmpdir(), "med-suggest-")));
  temporary.push(home);
  const cli = resolve("src/cli/index.ts");
  const med = async (...args: string[]) =>
    (
      await exec("bun", [cli, "skills", "suggest", ...args], {
        env: { ...process.env, HOME: home },
      })
    ).stdout;
  const proofFirst = await readFile(resolve("skills/suggestions/proof-first/SKILL.md"), "utf8");

  // The list names each practice and how to copy one; nothing is written.
  const list = await med();
  for (const name of [
    "proof-first",
    "explain-first",
    "adversarial-review",
    "round-limit",
    "risk-levels",
    "review-md",
  ]) {
    expect(list).toMatch(new RegExp(`^  ${name} +\\S`, "m"));
    const text = await readFile(resolve(`skills/suggestions/${name}/SKILL.md`), "utf8");
    expect(text).toMatch(new RegExp(`^---\\nname: ${name}\\ndescription: `));
    expect(text.split("\n").length).toBeLessThanOrEqual(40);
  }
  expect(list).toContain("git config med.checks proof,explainer,findings");
  expect(await readdir(home)).not.toContain(".claude");

  // A name prints the skill to copy; --to writes it, and keeps the user's edits.
  expect(await med("proof-first")).toBe(proofFirst);
  expect(await med("proof-first", "--to", "~/.claude/skills")).toBe(
    "Wrote the proof-first practice: ~/.claude/skills/proof-first/SKILL.md. Edit it as you like.\n",
  );
  const file = join(home, ".claude", "skills", "proof-first", "SKILL.md");
  expect(await readFile(file, "utf8")).toBe(proofFirst);
  await writeFile(file, `${proofFirst}\n- My own step\n`);
  await expect(med("proof-first", "--to", "~/.claude/skills")).rejects.toMatchObject({
    stderr: expect.stringContaining("exists and differs, perhaps with your edits"),
  });
  expect(await readFile(file, "utf8")).toContain("My own step");
  await expect(med("tidy-first")).rejects.toMatchObject({
    stderr: expect.stringContaining("There is no suggested practice named tidy-first"),
  });
});
