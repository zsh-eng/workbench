import { existsSync } from "node:fs";
import { lstat, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import skill from "../../skills/med/SKILL.md" with { type: "text" };
import instructions from "../../skills/thread-instructions.md" with { type: "text" };

export const skillsHelp = `Usage: med skills install [--claude] [--codex] [--force]
       med skills uninstall [--claude] [--codex] [--force]
       med skills show
       med skills instructions

install writes the Med skill, which tells an agent when and how to hand off
changes in Med, for Claude Code (~/.claude/skills/med) and Codex
(~/.agents/skills/med). Without --claude or --codex, it writes the skill for
each agent that has a configuration directory (~/.claude or ~/.codex). Run it
again after an update to refresh the skill. --force replaces another skill or
link with the same name.
uninstall removes the Med skill from those places. show prints the skill.
instructions prints the lines to add to CLAUDE.md or AGENTS.md, so that an agent
that Med starts in a thread hands off its work there. Edit them as you like.`;

/** Where to put the thread instructions, with the instructions. */
const instructionsNote = `Add these lines to ~/.claude/CLAUDE.md, ~/.codex/AGENTS.md, or a repository's
AGENTS.md, so that agents that Med starts in a thread hand off their work there.
Edit them as you like; med skills instructions prints them again.

${instructions}`;

/** A skill that this command wrote, from this or an earlier version. */
const isMedSkill = (text: string) =>
  /^---\nname: med\n/.test(text) && text.includes("med review create");

export async function runSkillsCommand(
  args: string[],
  print: (text: string) => void = console.log,
) {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      claude: { type: "boolean" },
      codex: { type: "boolean" },
      force: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });
  const action = positionals[0];
  if (values.help || !action) return print(skillsHelp);
  if (
    positionals.length !== 1 ||
    !["install", "uninstall", "show", "instructions"].includes(action)
  )
    throw new Error(skillsHelp);
  if (action === "show") return print(skill);
  if (action === "instructions") return print(instructions.trimEnd());

  const home = homedir();
  const agents = [
    { id: "claude", name: "Claude Code", config: ".claude", skills: [".claude", "skills"] },
    { id: "codex", name: "Codex", config: ".codex", skills: [".agents", "skills"] },
  ] as const;
  const chosen = agents.filter((agent) =>
    values.claude || values.codex
      ? values[agent.id]
      : action === "uninstall" || existsSync(join(home, agent.config)),
  );
  if (!chosen.length)
    throw new Error(
      "Found no ~/.claude or ~/.codex directory. Use --claude or --codex to choose an agent.",
    );
  const shown = (path: string) => (path.startsWith(home) ? `~${path.slice(home.length)}` : path);
  let removed = 0;
  let installed = 0;
  for (const agent of chosen) {
    const directory = join(home, ...agent.skills, "med");
    const file = join(directory, "SKILL.md");
    const entry = await lstat(directory).catch(() => undefined);
    const current = entry?.isDirectory()
      ? await readFile(file, "utf8").catch(() => undefined)
      : undefined;
    // Another skill or a link to a working copy is the user's; replace it only on request.
    const ours = !entry || (entry.isDirectory() && (current === undefined || isMedSkill(current)));
    if (!ours && !values.force)
      throw new Error(
        `${shown(directory)} holds another skill or a link. Remove it, or add --force to replace it.`,
      );
    if (action === "uninstall") {
      if (!entry) continue;
      await rm(directory, { recursive: true, force: true });
      print(`Removed the Med skill for ${agent.name}: ${shown(directory)}`);
      removed++;
      continue;
    }
    if (current === skill) {
      print(`The Med skill for ${agent.name} is up to date: ${shown(file)}`);
      continue;
    }
    if (entry && !entry.isDirectory()) await rm(directory, { force: true });
    else if (!ours) await rm(directory, { recursive: true, force: true });
    await mkdir(directory, { recursive: true });
    await writeFile(file, skill);
    print(`${current ? "Updated" : "Installed"} the Med skill for ${agent.name}: ${shown(file)}`);
    if (!current) installed++;
  }
  if (action === "uninstall" && !removed) print("The Med skill is not installed.");
  // A first install also shows the lines for the user's agent instructions.
  if (installed) print(`\n${instructionsNote.trimEnd()}`);
}
