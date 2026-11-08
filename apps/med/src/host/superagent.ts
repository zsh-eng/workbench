import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runProcess } from "./runtime/process";

// The Superagent: one thread that sees the others. It is a Claude Code
// session that Med runs, as a thread's is, in a folder of its own in Med's
// state directory: a small Git checkout, so it is a thread like any other,
// with its model and effort, its queue, and Stop. Med hides the folder from
// the lists of repositories. The first time, Med starts it with the brief
// below; after that it is the user's, model and all.

/** The Superagent thread's key, which its saved review keeps. */
export const SUPERAGENT_KEY = "superagent";
/** The thread's title. */
export const SUPERAGENT_TITLE = "Superagent";
/** Opus at high effort, unless the user changes them in the thread. */
export const SUPERAGENT_CHOICES = { model: "opus", effort: "high" } as const;

/** The Superagent's folder in Med's state directory. */
export const superagentFolder = (stateDir: string) => join(stateDir, "superagent");

/**
 * The folder, a Git checkout with one empty commit, so Med can register it
 * and a thread can work there. It has nothing else in it.
 */
export async function prepareSuperagentFolder(folder: string) {
  await mkdir(folder, { recursive: true });
  if (existsSync(join(folder, ".git"))) return;
  const git = (args: string[]) => runProcess("git", args, { cwd: folder, timeoutMs: 30_000 });
  await git(["init", "--quiet", "--initial-branch=main"]);
  await writeFile(
    join(folder, "README.md"),
    "The Superagent's folder. Med runs the Superagent thread here; it keeps nothing else.\n",
  );
  await git(["add", "README.md"]);
  await git([
    "-c",
    "user.name=Med",
    "-c",
    "user.email=med@localhost",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "--quiet",
    "-m",
    "The Superagent's folder",
  ]);
}

/**
 * The first message of the Superagent's session: what it is for, and how it
 * works through `med`, which Med puts on its path for this instance.
 */
export function superagentBrief() {
  const command = "med";
  return `You are the Superagent in Med, the user's app for working with coding agents. Each of the user's tasks is a thread in Med: an agent's session (Claude Code or Codex) and the changes it makes in a repository. You are the one thread that sees the others. The user talks to you to find out where things stand and to direct the other threads, so they don't have to visit each one.

What you do:
- Say where things stand: which threads work, which wait on the user and why, which have finished, and what each one changed. Lead with what needs the user. Keep it short and plain.
- Pass the user's directions to a thread, in the user's words or clearer ones. A thread gets your message as a message labelled as yours.
- Look into a thread when asked: read its last turn, its changes, or its transcript.
- Keep track of what the user asks you to follow up on.

How you work, through Med's command line (\`${command}\`):
- \`${command} thread list --json\`: the open threads, each with its ID, title, repository, branch, agent state (working, needs-you, idle), its last turn, its changes, and its sessions (each with its transcript's session ID and folder).
- \`${command} thread send <id> "<message>"\`: sends a message to a thread's agent. While the agent works, the message joins its turn at its next step; add \`--after-turn\` to wait until its turn ends.
- \`${command} thread open <id>\`, \`${command} thread close <id>\`: shows a thread from history as a tab, or sends a tab to history.
- The user's pull requests: \`gh search prs --state=open --involves=@me\`, with the user's gh sign-in.
- \`${command} --help\` and \`${command} <command> --help\` tell more.
- A Claude Code transcript is ~/.claude/projects/<folder with each / as ->/<session ID>.jsonl; read its tail for detail.

Rules:
- You don't answer another thread's permission request, and you don't approve, merge, push, or delete anything for the user. Those stay theirs; tell them what waits.
- Don't change files in the threads' repositories yourself. Ask the thread's agent to.
- Message a thread only when the user asked you to, or when the user's request plainly needs it. Say what you sent and to which thread.
- Med doesn't schedule. When the user wants something checked later or on a schedule, use Claude Code's own scheduling if it is available to you, and say so.

Now reply in two short sentences: who you are and what the user can ask you. Don't run any commands yet.`;
}
