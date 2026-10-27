import { existsSync } from "node:fs";
import { lstat, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { version } from "../../package.json";
import skill from "../../skills/med/SKILL.md" with { type: "text" };
import guide from "../../skills/med/guide.md" with { type: "text" };
import instructions from "../../skills/thread-instructions.md" with { type: "text" };
import adversarialReview from "../../skills/suggestions/adversarial-review/SKILL.md" with { type: "text" };
import explainFirst from "../../skills/suggestions/explain-first/SKILL.md" with { type: "text" };
import proofFirst from "../../skills/suggestions/proof-first/SKILL.md" with { type: "text" };
import reviewMd from "../../skills/suggestions/review-md/SKILL.md" with { type: "text" };
import riskLevels from "../../skills/suggestions/risk-levels/SKILL.md" with { type: "text" };
import roundLimit from "../../skills/suggestions/round-limit/SKILL.md" with { type: "text" };

/** The files of the Med skill: the checklist, and the guide it points to. */
const SKILL_FILES: Readonly<Record<string, string>> = { "SKILL.md": skill, "guide.md": guide };

/**
 * Review practices to copy into the user's own skills (docs/PRACTICES.md).
 * Med suggests them; it never installs one unless asked.
 */
const SUGGESTIONS: Readonly<Record<string, string>> = {
  "proof-first": proofFirst,
  "explain-first": explainFirst,
  "adversarial-review": adversarialReview,
  "round-limit": roundLimit,
  "risk-levels": riskLevels,
  "review-md": reviewMd,
};
const describe = (text: string) => /^description: (.+)$/m.exec(text)?.[1] ?? "";

export const skillsHelp = `Usage: med skills install [--claude] [--codex] [--force]
       med skills update
       med skills uninstall [--claude] [--codex] [--force]
       med skills show
       med skills instructions
       med skills suggest [<name> [--to <skills folder>] [--force]]

install writes the Med skill, which tells an agent when and how to hand off
changes in Med, for Claude Code (~/.claude/skills/med) and Codex
(~/.agents/skills/med): SKILL.md, and guide.md, which med docs agents prints. Without --claude or --codex, it writes the skill for
each agent that has a configuration directory (~/.claude or ~/.codex). --force
replaces another skill or link with the same name.
update refreshes the Med skill where it is installed, after you update Med,
and installs it nowhere new. med status and med web say when it is out of date.
uninstall removes the Med skill from those places. show prints the skill.
instructions prints the lines to add to CLAUDE.md or AGENTS.md, so that an agent
that Med starts in a thread hands off its work there. Edit them as you like.
suggest lists review practices written as small skills, such as proof-first;
suggest <name> prints one to copy into your own skills, and --to writes it to
<skills folder>/<name>/SKILL.md, such as --to ~/.claude/skills. Med installs
none of them by itself.`;

/** Where to put the thread instructions, with the instructions. */
const instructionsNote = `Add these lines to ~/.claude/CLAUDE.md, ~/.codex/AGENTS.md, or a repository's
AGENTS.md, so that agents that Med starts in a thread hand off their work there.
Edit them as you like; med skills instructions prints them again.

${instructions}`;

/** A skill that this command wrote, from this or an earlier version. */
const isMedSkill = (text: string) =>
  /^---\nname: med\n/.test(text) && text.includes("med review create");

/** Where each agent reads skills, and the folder that says it is set up. */
const AGENTS = [
  { id: "claude", name: "Claude Code", config: ".claude", skills: [".claude", "skills"] },
  { id: "codex", name: "Codex", config: ".codex", skills: [".agents", "skills"] },
] as const;
const shownPath = (path: string, home: string) =>
  path.startsWith(home) ? `~${path.slice(home.length)}` : path;

/**
 * The agents that have the Med skill installed: a skill that this command
 * wrote, in a folder of its own (not a link to a working copy). `stale`: its
 * files differ from this version's. Comparing the files means that an update
 * that leaves the skill as it was does not ask for a refresh.
 */
async function installedSkills(home: string) {
  const found: { id: (typeof AGENTS)[number]["id"]; directory: string; stale: boolean }[] = [];
  for (const agent of AGENTS) {
    const directory = join(home, ...agent.skills, "med");
    if (!(await lstat(directory).catch(() => undefined))?.isDirectory()) continue;
    const files = await Promise.all(
      Object.keys(SKILL_FILES).map((name) =>
        readFile(join(directory, name), "utf8").catch(() => undefined),
      ),
    );
    if (!files[0] || !isMedSkill(files[0])) continue;
    const stale = Object.values(SKILL_FILES).some((text, index) => files[index] !== text);
    found.push({ id: agent.id, directory, stale });
  }
  return found;
}

/** One line that suggests a refresh, when an installed Med skill is out of date. */
export async function skillNotice(home = homedir()) {
  const stale = (await installedSkills(home))
    .filter((entry) => entry.stale)
    .map((entry) => shownPath(entry.directory, home));
  if (!stale.length) return undefined;
  return `The Med skill in ${stale.join(" and ")} differs from the one that Med ${version} installs. Refresh it: med skills update`;
}

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
      to: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });
  const action = positionals[0];
  if (values.help || !action) return print(skillsHelp);
  if (action === "suggest") return suggest(positionals.slice(1), values, print);
  if (
    positionals.length !== 1 ||
    !["install", "update", "uninstall", "show", "instructions"].includes(action)
  )
    throw new Error(skillsHelp);
  if (action === "update" && (values.claude || values.codex || values.force))
    throw new Error("Use med skills update without options; it refreshes each installed skill.");
  if (action === "show") return print(skill);
  if (action === "instructions") return print(instructions.trimEnd());

  const home = homedir();
  // update: only where a Med skill is installed, so it installs nothing new.
  const present = action === "update" ? await installedSkills(home) : [];
  const chosen = AGENTS.filter((agent) =>
    action === "update"
      ? present.some((entry) => entry.id === agent.id)
      : values.claude || values.codex
        ? values[agent.id]
        : action === "uninstall" || existsSync(join(home, agent.config)),
  );
  if (action === "update" && !chosen.length)
    return print("The Med skill is not installed. med skills install installs it.");
  if (!chosen.length)
    throw new Error(
      "Found no ~/.claude or ~/.codex directory. Use --claude or --codex to choose an agent.",
    );
  const shown = (path: string) => shownPath(path, home);
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
    const written = await Promise.all(
      Object.keys(SKILL_FILES).map((name) =>
        entry?.isDirectory()
          ? readFile(join(directory, name), "utf8").catch(() => undefined)
          : undefined,
      ),
    );
    const names = Object.keys(SKILL_FILES);
    if (names.every((name, index) => written[index] === SKILL_FILES[name])) {
      print(`The Med skill for ${agent.name} is up to date: ${shown(directory)}`);
      continue;
    }
    if (entry && !entry.isDirectory()) await rm(directory, { force: true });
    else if (!ours) await rm(directory, { recursive: true, force: true });
    await mkdir(directory, { recursive: true });
    for (const name of names) await writeFile(join(directory, name), SKILL_FILES[name]!);
    print(
      `${current ? "Updated" : "Installed"} the Med skill for ${agent.name}: ${shown(directory)} (${names.join(", ")})`,
    );
    if (!current) installed++;
  }
  if (action === "uninstall" && !removed) print("The Med skill is not installed.");
  // A first install also shows the lines for the user's agent instructions,
  // and where the suggested practices are.
  if (installed)
    print(
      `\n${instructionsNote.trimEnd()}\n\nReview practices to copy into your own skills: med skills suggest`,
    );
}

async function suggest(
  names: string[],
  values: { to?: string; force?: boolean },
  print: (text: string) => void,
) {
  const [name] = names;
  if (!name) {
    if (values.to)
      throw new Error(
        "Name the practice to write, such as med skills suggest proof-first --to ~/.claude/skills.",
      );
    const width = Math.max(...Object.keys(SUGGESTIONS).map((id) => id.length));
    print(
      [
        "Review practices, written as small skills. Med suggests them and installs none by itself.",
        "",
        ...Object.entries(SUGGESTIONS).map(
          ([id, text]) => `  ${id.padEnd(width)}  ${describe(text)}`,
        ),
        "",
        "Print one to copy: med skills suggest <name>",
        "Write one to your skills: med skills suggest <name> --to ~/.claude/skills",
        "Make proof, an explainer, or no open Important finding a check for a repository: git config med.checks proof,explainer,findings",
      ].join("\n"),
    );
    return;
  }
  const text = SUGGESTIONS[name];
  if (!text || names.length > 1)
    throw new Error(
      `There is no suggested practice named ${names.join(" ")}. These are: ${Object.keys(SUGGESTIONS).join(", ")}.`,
    );
  if (!values.to) return print(text.trimEnd());
  const home = homedir();
  const folder = resolve(values.to.replace(/^~(?=$|\/)/, home), name);
  const file = join(folder, "SKILL.md");
  const shown = folder.startsWith(home) ? `~${folder.slice(home.length)}` : folder;
  const current = await readFile(file, "utf8").catch(() => undefined);
  if (current === text) return print(`${shown}/SKILL.md is up to date.`);
  if (current !== undefined && !values.force)
    throw new Error(
      `${shown}/SKILL.md exists and differs, perhaps with your edits. Add --force to replace it.`,
    );
  await mkdir(folder, { recursive: true });
  await writeFile(file, text);
  print(`Wrote the ${name} practice: ${shown}/SKILL.md. Edit it as you like.`);
}
