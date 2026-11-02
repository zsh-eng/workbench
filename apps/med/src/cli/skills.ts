import { existsSync } from "node:fs";
import { lstat, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { version } from "../../package.json";
import { UsageError } from "./exit-status";
import skill from "../../skills/med/SKILL.md" with { type: "text" };
import instructions from "../../skills/thread-instructions.md" with { type: "text" };
import adversarialReview from "../../skills/suggestions/adversarial-review/SKILL.md" with { type: "text" };
import explainFirst from "../../skills/suggestions/explain-first/SKILL.md" with { type: "text" };
import proofFirst from "../../skills/suggestions/proof-first/SKILL.md" with { type: "text" };
import reviewMd from "../../skills/suggestions/review-md/SKILL.md" with { type: "text" };
import riskLevels from "../../skills/suggestions/risk-levels/SKILL.md" with { type: "text" };
import roundLimit from "../../skills/suggestions/round-limit/SKILL.md" with { type: "text" };

const describe = (text: string) => /^description: (.+)$/m.exec(text)?.[1] ?? "";

/**
 * The skill that install writes: a stub that runs `med skills show`, so an
 * agent reads the checklist of the Med that runs, not of the Med that
 * installed the skill. Change STUB_VERSION when the stub's text changes.
 */
const STUB_VERSION = "1";
const STUB = `---
name: med
description: ${describe(skill)}
metadata:
  med-stub: "${STUB_VERSION}"
---
<!-- med skills install wrote this file. med skills uninstall removes it. -->

Run \`med skills show\` and do what it prints. The installed Med prints it, so
it always agrees with your \`med\` commands. \`med docs agents\` prints the
full guide.

If the shell cannot find \`med\`, tell the user: you cannot hand off a review
here.
`;
/** Files that earlier versions installed beside SKILL.md; update removes them. */
const OLD_FILES = ["guide.md"];

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

export const skillsHelp = `Usage: med skills install [--claude] [--codex] [--force]
       med skills status
       med skills update
       med skills uninstall [--claude] [--codex] [--force]
       med skills show
       med skills instructions
       med skills suggest [<name> [--to <skills folder>] [--force]]

install writes the Med skill, which tells an agent when and how to hand off
changes in Med, for Claude Code (~/.claude/skills/med) and Codex
(~/.agents/skills/med). The skill is a short SKILL.md that tells the agent
to run med skills show, so the agent reads the checklist of the Med that you
have now. Without --claude or --codex, it writes the skill for each agent that
has a configuration directory (~/.claude or ~/.codex). --force replaces
another skill or link with the same name.
status tells, for each agent, if the Med skill is installed and up to date.
update refreshes the Med skill where it is installed, and installs it nowhere
new. It replaces a full copy from an earlier Med with the short skill.
med status and med web say when it is out of date.
uninstall removes the Med skill from those places. show prints the checklist
that the skill runs; med docs agents prints the full guide.
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

/** A skill that this command wrote, from this or an earlier version: a stub or a full copy. */
const isMedSkill = (text: string) =>
  /^---\nname: med\n/.test(text) &&
  (/^ {2}med-stub: /m.test(text) || text.includes("med review create"));

/** Where each agent reads skills, and the folder that says it is set up. */
const AGENTS = [
  { id: "claude", name: "Claude Code", config: ".claude", skills: [".claude", "skills"] },
  { id: "codex", name: "Codex", config: ".codex", skills: [".agents", "skills"] },
] as const;
const shownPath = (path: string, home: string) =>
  path.startsWith(home) ? `~${path.slice(home.length)}` : path;

/** What is in an agent's med skill folder. */
type Found =
  | { state: "missing" }
  | { state: "other"; link: boolean }
  | { state: "med"; stale: boolean };

/**
 * The skill in a folder. `stale`: it differs from the stub of this version,
 * or it is a full copy from an earlier Med. Comparing the text means that an
 * update that leaves the stub as it was does not ask for a refresh.
 */
async function skillIn(directory: string): Promise<Found> {
  const entry = await lstat(directory).catch(() => undefined);
  if (!entry) return { state: "missing" };
  if (!entry.isDirectory()) return { state: "other", link: entry.isSymbolicLink() };
  const text = await readFile(join(directory, "SKILL.md"), "utf8").catch(() => undefined);
  if (text === undefined) return { state: "missing" };
  if (!isMedSkill(text)) return { state: "other", link: false };
  const old = OLD_FILES.some((name) => existsSync(join(directory, name)));
  return { state: "med", stale: text !== STUB || old };
}

/**
 * The agents that have the Med skill installed: a skill that this command
 * wrote, in a folder of its own (not a link to a working copy).
 */
async function installedSkills(home: string) {
  const found: { id: (typeof AGENTS)[number]["id"]; directory: string; stale: boolean }[] = [];
  for (const agent of AGENTS) {
    const directory = join(home, ...agent.skills, "med");
    const skill = await skillIn(directory);
    if (skill.state === "med") found.push({ id: agent.id, directory, stale: skill.stale });
  }
  return found;
}

/** One line for each agent: the state of its Med skill, and what to run next. */
async function status(home: string) {
  const rows = await Promise.all(
    AGENTS.map(async (agent) => {
      const directory = join(home, ...agent.skills, "med");
      return { agent, directory, found: await skillIn(directory) };
    }),
  );
  const said = rows.map(({ found }) =>
    found.state === "missing"
      ? "not installed"
      : found.state === "other"
        ? `${found.link ? "a link" : "another skill"}, which Med leaves`
        : found.stale
          ? "out of date"
          : "up to date",
  );
  const width = Math.max(...said.map((text) => text.length));
  const lines = rows.map(
    ({ agent, directory }, index) =>
      `${agent.name.padEnd(12)} ${said[index]!.padEnd(width)}  ${shownPath(directory, home)}`,
  );
  if (rows.some(({ found }) => found.state === "med" && found.stale))
    lines.push("", "Refresh them: med skills update");
  else if (!rows.some(({ found }) => found.state === "med"))
    lines.push("", "Install it: med skills install");
  return lines.join("\n");
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
    !["install", "status", "update", "uninstall", "show", "instructions"].includes(action)
  )
    throw new UsageError(skillsHelp);
  if (
    (action === "update" || action === "status") &&
    (values.claude || values.codex || values.force)
  )
    throw new UsageError(`Use med skills ${action} without options; it reads each agent's skill.`);
  if (action === "show") return print(skill);
  if (action === "instructions") return print(instructions.trimEnd());

  const home = homedir();
  if (action === "status") return print(await status(home));
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
    const found = await skillIn(directory);
    if (found.state === "med" && !found.stale) {
      print(`The Med skill for ${agent.name} is up to date: ${shown(directory)}`);
      continue;
    }
    if (entry && !entry.isDirectory()) await rm(directory, { force: true });
    else if (!ours) await rm(directory, { recursive: true, force: true });
    await mkdir(directory, { recursive: true });
    await writeFile(file, STUB);
    // A full copy from an earlier Med also had the guide; med docs agents prints it now.
    if (ours) for (const name of OLD_FILES) await rm(join(directory, name), { force: true });
    print(
      `${current ? "Updated" : "Installed"} the Med skill for ${agent.name}: ${shown(directory)}`,
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
