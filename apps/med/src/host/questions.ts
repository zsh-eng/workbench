import { execFile, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  readFile,
  realpath,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { z } from "zod";
import type { FoundAgent } from "../shared/found-sessions";
import {
  questionPrompt,
  questionRoutes,
  type QuestionAsk,
  type QuestionState,
} from "../shared/questions";
import type { AgentSession } from "../shared/saved-review";
import { findTranscript } from "./agent-transcripts";
import { claudeProjectFolder, readEdge } from "./found-sessions";
import { agentEnvironment, type RunnableAgent } from "./owned-sessions";
import { route, type Route } from "./routes";
import { HostError } from "./runtime/errors";
import { userHome } from "./service/discover";

// Ask about these lines. A reviewer's question goes to a one-shot run of the
// thread's agent, and the answer streams to the reader only. Claude Code
// answers in a fork of the lead session (`--resume <id> --fork-session`) in
// plan mode: the fork reads the thread's context and writes its own
// transcript, and the lead's transcript does not change. Codex answers in a
// fork (`codex exec fork`) when its CLI has one, else in a new read-only
// session that gets the question and the excerpt only. Med adds no system
// prompt and no other text.
//
// A fork's transcript is not a thread: the found sessions and the session
// search leave out every fork that `excludes` names. Med chooses a Claude
// fork's session ID before it starts the process, and keeps the IDs in the
// state directory until it removes the transcript. Close removes a Claude
// fork's transcript only at its exact path, and only when each record in it
// carries the fork's ID; otherwise the transcript stays, and stays left out.

/** Runs of agents at once, for the whole host. */
const MAX_RUNNING = 4;
/** The answer's text that Med keeps, at most. */
const MAX_ANSWER = 256 * 1024;
/** A streaming answer sends its state at most this often. */
const STREAM_MS = 80;
/** A question without a window closes this long after its answer ends. */
const IDLE_MS = 15 * 60_000;
/** Forks that Med leaves out, at most; the newest stay. */
const MAX_FORKS = 1000;
/** Med removes a fork's transcript up to this size; a larger one stays. */
const MAX_FORK_BYTES = 64 * 1024 * 1024;
/** A fork from before a restart is removed only when it has not changed for this long. */
const SETTLED_MS = 2 * 60_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const forkSchema = z.object({
  agent: z.enum(["claude", "codex"]),
  id: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
  cwd: z.string().min(1),
  at: z.number(),
});
type Fork = z.infer<typeof forkSchema>;

export interface QuestionHost {
  /** Claude Code, when it is installed. */
  claude(): Promise<RunnableAgent | undefined>;
  /** Codex's CLI, when it is installed. */
  codex(): Promise<string | undefined>;
  /** The lead session of a saved thread or a found thread. */
  lead(thread: string): Promise<AgentSession | undefined>;
  /** What Med keeps of a session that it runs: its agent, its choices, and
   * an ACP agent's own ID for the session. */
  recorded(
    sessionId: string,
  ):
    | { preset: string; choices: { model?: string; effort?: string }; agentSessionId?: string }
    | undefined;
  /** Where Med keeps the forks' IDs. */
  forksFile?: string;
  home?: () => string;
}

interface Run {
  state: QuestionState;
  child?: ChildProcessWithoutNullStreams;
  exited?: Promise<void>;
  /** The run's own transcripts, which Close checks. */
  forks: Fork[];
  listeners: Set<() => void>;
  idle?: ReturnType<typeof setTimeout>;
}

const lastLines = (text: string) => text.trim().split("\n").slice(-3).join("\n").slice(-600);
const usable = (value: string | undefined) => (value && value !== "default" ? value : undefined);

/** The model that a session used last: Claude Code names it on each reply,
 * and Codex in each turn's context. */
async function lastModel(agent: FoundAgent, path: string) {
  const { lines } = await readEdge(path, "tail", 256 * 1024).catch(() => ({ lines: [] }));
  for (let index = lines.length - 1; index >= 0; index--) {
    const line = lines[index]!;
    if (!line.includes(agent === "claude" ? '"assistant"' : '"turn_context"')) continue;
    try {
      const entry = JSON.parse(line) as Record<string, any>;
      const model =
        agent === "claude"
          ? entry.type === "assistant"
            ? entry.message?.model
            : undefined
          : entry.type === "turn_context"
            ? entry.payload?.model
            : undefined;
      if (typeof model === "string" && model && model !== "<synthetic>") return model;
    } catch {
      /* A line that a write cut. */
    }
  }
  return undefined;
}

/** A tool call as one short line: its name and its path, pattern, or command. */
function toolActivity(name: unknown, input: Record<string, unknown> | undefined) {
  const detail = ["file_path", "path", "pattern", "command", "url", "description"]
    .map((key) => input?.[key])
    .find((value): value is string => typeof value === "string" && !!value.trim());
  const line = `${String(name ?? "A tool")}${detail ? ` ${detail.split("\n")[0]}` : ""}`;
  return line.length > 160 ? `${line.slice(0, 159)}…` : line;
}

/**
 * Removes a Claude fork's transcript after the strict check: the exact path
 * `<projects>/<encoded cwd>/<fork ID>.jsonl`, a plain file in a plain folder,
 * whose records each carry the fork's ID when they name a session. Returns
 * "removed", "absent" when no transcript is there, or "kept".
 */
async function removeClaudeFork(home: string, fork: Fork, settledMs = 0) {
  if (fork.agent !== "claude" || !UUID.test(fork.id)) return "kept" as const;
  const projects = join(home, ".claude", "projects");
  // Claude Code names the folder after its working directory, which can be
  // the real path of the thread's folder.
  const cwds = [fork.cwd, await realpath(fork.cwd).catch(() => fork.cwd)];
  let kept = false;
  for (const cwd of new Set(cwds)) {
    const folder = join(projects, claudeProjectFolder(cwd));
    const path = join(folder, `${fork.id}.jsonl`);
    const info = await lstat(path).catch(() => undefined);
    if (!info) continue;
    const parent = await lstat(folder).catch(() => undefined);
    if (
      !info.isFile() ||
      !parent?.isDirectory() ||
      info.size > MAX_FORK_BYTES ||
      Date.now() - info.mtimeMs < settledMs
    ) {
      kept = true;
      continue;
    }
    const text = await readFile(path, "utf8").catch(() => undefined);
    let carried = 0;
    let sure = text !== undefined;
    for (const line of (text ?? "").split("\n")) {
      if (!sure) break;
      if (!line.trim()) continue;
      try {
        const record = JSON.parse(line) as unknown;
        if (!record || typeof record !== "object" || Array.isArray(record)) sure = false;
        else if ("sessionId" in record) {
          if ((record as { sessionId: unknown }).sessionId === fork.id) carried++;
          else sure = false;
        }
      } catch {
        sure = false;
      }
    }
    // The file must be the one that was read.
    const after = await lstat(path).catch(() => undefined);
    if (
      !sure ||
      !carried ||
      !after ||
      after.ino !== info.ino ||
      after.size !== info.size ||
      after.mtimeMs !== info.mtimeMs
    ) {
      kept = true;
      continue;
    }
    await unlink(path);
  }
  if (kept) return "kept" as const;
  return "removed" as const;
}

/**
 * The questions that readers ask in this host, and the forks that they made.
 * A question lives in host memory until the reader closes it, or until no
 * window has read it for `IDLE_MS` after its answer ended.
 */
export class Questions {
  private runs = new Map<string, Run>();
  private forks = new Map<string, Fork>();
  private writing: Promise<void> = Promise.resolve();
  private codexForks = new Map<string, Promise<boolean>>();
  private home: () => string;

  constructor(private host: QuestionHost) {
    this.home = host.home ?? userHome;
  }

  /** Whether a transcript is a fork that a question made. */
  excludes(agent: FoundAgent, id: string) {
    return this.forks.has(`${agent}:${id}`);
  }

  /** Reads the forks of earlier runs. Their questions are gone, so their
   * transcripts go too, after the strict check. */
  async restore() {
    const file = this.host.forksFile;
    if (!file) return;
    try {
      const forks = z
        .object({ forks: z.array(forkSchema) })
        .parse(JSON.parse(await readFile(file, "utf8"))).forks;
      for (const fork of forks) this.forks.set(`${fork.agent}:${fork.id}`, fork);
    } catch {
      return;
    }
    const earlier = [...this.forks.values()];
    void (async () => {
      for (const fork of earlier) await this.removeFork(fork, SETTLED_MS);
    })();
  }

  private save() {
    const file = this.host.forksFile;
    if (!file) return this.writing;
    const forks = [...this.forks.values()].sort((a, b) => b.at - a.at).slice(0, MAX_FORKS);
    if (forks.length < this.forks.size)
      this.forks = new Map(forks.map((fork) => [`${fork.agent}:${fork.id}`, fork]));
    const text = `${JSON.stringify({ forks }, null, 2)}\n`;
    this.writing = this.writing
      .then(async () => {
        await mkdir(dirname(file), { recursive: true });
        const temporary = `${file}.${randomUUID()}.tmp`;
        await writeFile(temporary, text, { mode: 0o600 });
        await rename(temporary, file);
      })
      .catch(() => {});
    return this.writing;
  }

  /** Leaves a fork out of the found sessions, before its transcript can exist. */
  private remember(run: Run, fork: Fork) {
    run.forks.push(fork);
    const key = `${fork.agent}:${fork.id}`;
    if (this.forks.has(key)) return this.writing;
    this.forks.set(key, fork);
    return this.save();
  }

  private async removeFork(fork: Fork, settledMs = 0) {
    // Codex forks run with --ephemeral and write no rollout; one that a Codex
    // wrote anyway stays, left out.
    if (fork.agent !== "claude") return;
    const result = await removeClaudeFork(this.home(), fork, settledMs).catch(() => "kept");
    if (result === "kept") return;
    this.forks.delete(`${fork.agent}:${fork.id}`);
    await this.save();
  }

  private update(run: Run, change: Partial<QuestionState>) {
    run.state = { ...run.state, ...change };
    for (const listener of run.listeners) listener();
  }

  private settle(id: string, run: Run) {
    clearTimeout(run.idle);
    if (run.listeners.size || run.child) return;
    run.idle = setTimeout(() => void this.close(id), IDLE_MS);
    run.idle.unref?.();
  }

  get(id: string) {
    const run = this.runs.get(id);
    if (!run) throw new HostError("question-not-found", "This question is closed.", 404);
    return run;
  }

  state(id: string) {
    return this.get(id).state;
  }

  /** Calls `listener` on each change of the question; the answer streams. */
  subscribe(id: string, listener: () => void) {
    const run = this.get(id);
    run.listeners.add(listener);
    clearTimeout(run.idle);
    return () => {
      run.listeners.delete(listener);
      this.settle(id, run);
    };
  }

  async ask(input: QuestionAsk): Promise<QuestionState> {
    const running = [...this.runs.values()].filter((run) => run.child).length;
    if (running >= MAX_RUNNING)
      throw new HostError(
        "too-many-questions",
        "Other questions are being answered. Stop one, or wait for its answer.",
        429,
      );
    const lead = await this.host.lead(input.thread);
    if (!lead) throw new HostError("no-agent", "This thread has no agent session to ask.", 409);
    if (!(await stat(lead.cwd).catch(() => undefined))?.isDirectory())
      throw new HostError(
        "folder-gone",
        "The thread's folder is gone, so its agent cannot answer.",
        409,
      );
    const prompt = questionPrompt(input.question, input.excerpt);
    const recorded = this.host.recorded(lead.id);
    if (lead.agent === "claude") return this.askClaude(lead, recorded?.choices ?? {}, prompt);
    const codexThread =
      lead.agent === "codex"
        ? lead.id
        : recorded?.preset === "codex"
          ? recorded.agentSessionId
          : undefined;
    if (lead.agent === "codex" || recorded?.preset === "codex")
      return this.askCodex(lead, codexThread, recorded?.choices ?? {}, prompt);
    throw new HostError("agent-unsupported", "Ask works in Claude Code and Codex threads.", 409);
  }

  /** Starts a run and reads its output lines. The forks that Med names are
   * left out, and kept on disk, before the process starts. */
  private async start(
    state: Omit<QuestionState, "id" | "status" | "answer">,
    command: string,
    args: string[],
    cwd: string,
    prompt: string,
    read: (run: Run, message: Record<string, any>, answer: Answer) => void,
    forks: Fork[] = [],
  ) {
    const id = randomUUID();
    const run: Run = {
      state: { id, status: "starting", answer: "", ...state },
      forks: [],
      listeners: new Set(),
    };
    this.runs.set(id, run);
    for (const fork of forks) await this.remember(run, fork);
    const child = spawn(command, args, {
      cwd,
      env: agentEnvironment(),
      stdio: ["pipe", "pipe", "pipe"],
    });
    run.child = child;
    const answer = new Answer((text) => this.update(run, { answer: text }));
    let errors = "";
    child.stderr.on("data", (data: Buffer) => {
      errors = (errors + data.toString()).slice(-4000);
    });
    child.stdin.on("error", () => {});
    child.stdin.end(prompt);
    run.exited = new Promise<void>((resolve) => {
      const finish = (error?: string) => {
        if (run.child !== child) return;
        run.child = undefined;
        answer.flush();
        if (
          run.state.status !== "done" &&
          run.state.status !== "stopped" &&
          run.state.status !== "failed"
        )
          this.update(
            run,
            error
              ? { status: "failed", activity: undefined, error }
              : { status: "done", activity: undefined },
          );
        else this.update(run, { activity: undefined });
        this.settle(id, run);
        resolve();
      };
      child.on("error", (error) => finish(error.message));
      child.on("exit", (code) =>
        finish(
          code && run.state.status !== "done"
            ? lastLines(errors) ||
                `${state.agent === "claude" ? "Claude Code" : "Codex"} stopped with code ${code}.`
            : undefined,
        ),
      );
    });
    createInterface({ input: child.stdout, crlfDelay: Infinity }).on("line", (line) => {
      if (run.child !== child || run.state.status === "stopped") return;
      let message: unknown;
      try {
        message = JSON.parse(line);
      } catch {
        return;
      }
      if (message && typeof message === "object") read(run, message as Record<string, any>, answer);
    });
    return run.state;
  }

  private async askClaude(
    lead: AgentSession,
    choices: { model?: string; effort?: string },
    prompt: string,
  ) {
    const agent = await this.host.claude();
    if (!agent) throw new HostError("agent-unavailable", "Claude Code is not installed here.", 409);
    const transcript = await findTranscript(lead, this.home());
    if (!transcript)
      throw new HostError(
        "transcript-not-found",
        "The thread has no transcript yet. Ask after its agent's first reply.",
        409,
      );
    // The fork uses the thread's model and effort, so it reads the cached context.
    const model = usable(choices.model) ?? (await lastModel("claude", transcript));
    const effort = usable(choices.effort);
    // Med names the fork, so it leaves the fork out before the fork writes.
    const forkId = randomUUID();
    const args = [
      ...agent.args,
      "-p",
      "--resume",
      lead.id,
      "--fork-session",
      "--session-id",
      forkId,
      "--permission-mode",
      "plan",
      "--output-format",
      "stream-json",
      "--verbose",
      "--include-partial-messages",
      ...(model ? ["--model", model] : []),
      ...(effort ? ["--effort", effort] : []),
    ];
    let current = "";
    return this.start(
      { agent: "claude", context: "thread" },
      agent.command,
      args,
      lead.cwd,
      prompt,
      (run, message, answer) => {
        // A subagent's messages are not the answer.
        if (message.parent_tool_use_id) return;
        switch (message.type) {
          case "system":
            if (message.subtype !== "init") return;
            if (typeof message.session_id === "string" && message.session_id !== forkId)
              void this.remember(run, {
                agent: "claude",
                id: message.session_id,
                cwd: lead.cwd,
                at: Date.now(),
              });
            this.update(run, { status: "answering" });
            return;
          case "stream_event": {
            const event = message.event ?? {};
            if (event.type === "message_start") current = String(event.message?.id ?? randomUUID());
            else if (
              event.type === "content_block_start" &&
              event.content_block?.type === "tool_use"
            )
              this.update(run, { activity: toolActivity(event.content_block.name, undefined) });
            else if (event.type === "content_block_delta" && event.delta?.type === "text_delta") {
              if (run.state.activity) this.update(run, { activity: undefined });
              answer.append(current, String(event.delta.text ?? ""));
            }
            return;
          }
          case "assistant": {
            const content: Record<string, any>[] = Array.isArray(message.message?.content)
              ? message.message.content
              : [];
            const text = content
              .filter((block) => block?.type === "text" && typeof block.text === "string")
              .map((block) => block.text as string)
              .join("");
            if (text) answer.set(String(message.message?.id ?? current), text);
            const tool = content.findLast((block) => block?.type === "tool_use");
            if (tool) this.update(run, { activity: toolActivity(tool.name, tool.input) });
            return;
          }
          case "result": {
            answer.flush();
            const failed = message.is_error === true || message.subtype !== "success";
            if (!answer.text() && !failed && typeof message.result === "string")
              answer.set("result", message.result);
            answer.flush();
            const reason = Array.isArray(message.errors) ? message.errors.join("\n") : undefined;
            this.update(
              run,
              failed
                ? {
                    status: "failed",
                    activity: undefined,
                    error:
                      reason ||
                      (typeof message.result === "string" && message.result) ||
                      "Claude Code could not answer.",
                  }
                : { status: "done", activity: undefined },
            );
            return;
          }
        }
      },
      [{ agent: "claude", id: forkId, cwd: lead.cwd, at: Date.now() }],
    );
  }

  /** Whether this Codex CLI has `codex exec fork`. An older one reads
   * `fork` as a prompt and prints the help of `codex exec`. */
  private canFork(codex: string) {
    let known = this.codexForks.get(codex);
    if (!known) {
      known = new Promise<boolean>((resolve) =>
        execFile(
          codex,
          ["exec", "fork", "--help"],
          { timeout: 15_000, maxBuffer: 1024 * 1024, env: agentEnvironment() },
          (error, stdout) => resolve(!error && /codex exec fork/.test(String(stdout))),
        ),
      );
      this.codexForks.set(codex, known);
    }
    return known;
  }

  private async askCodex(
    lead: AgentSession,
    codexThread: string | undefined,
    choices: { model?: string },
    prompt: string,
  ) {
    const codex = await this.host.codex();
    if (!codex)
      throw new HostError(
        "codex-not-found",
        "Med could not find the codex command. Install Codex, or set MED_CODEX_PATH.",
        409,
      );
    const fork = !!codexThread && (await this.canFork(codex));
    const rollout = lead.agent === "codex" ? await findTranscript(lead, this.home()) : undefined;
    const model =
      usable(choices.model) ?? (rollout ? await lastModel("codex", rollout) : undefined);
    // Read-only, without approvals, and without a rollout on disk.
    const shared = [
      "--json",
      "--ephemeral",
      "--skip-git-repo-check",
      "-c",
      'approval_policy="never"',
      ...(model ? ["-m", model] : []),
    ];
    const args = fork
      ? ["exec", "fork", ...shared, "-c", 'sandbox_mode="read-only"', codexThread!, "-"]
      : ["exec", ...shared, "--sandbox", "read-only", "-"];
    return this.start(
      { agent: "codex", context: fork ? "thread" : "excerpt" },
      codex,
      args,
      lead.cwd,
      prompt,
      (run, message, answer) => {
        switch (message.type) {
          case "thread.started":
            if (
              typeof message.thread_id === "string" &&
              /^[A-Za-z0-9_-]{1,128}$/.test(message.thread_id)
            )
              void this.remember(run, {
                agent: "codex",
                id: message.thread_id,
                cwd: lead.cwd,
                at: Date.now(),
              });
            this.update(run, { status: "answering" });
            return;
          case "turn.started":
            this.update(run, { status: "answering" });
            return;
          case "item.started":
          case "item.updated":
          case "item.completed": {
            const item = message.item ?? {};
            if (item.type === "agent_message" && typeof item.text === "string") {
              answer.set(String(item.id ?? "message"), item.text);
              if (run.state.activity) this.update(run, { activity: undefined });
            } else if (item.type === "command_execution" && message.type === "item.started")
              this.update(run, { activity: toolActivity("Run", { command: item.command }) });
            else if (item.type === "reasoning" && message.type === "item.started")
              this.update(run, { activity: "Thinking" });
            return;
          }
          case "turn.completed":
            answer.flush();
            this.update(run, { status: "done", activity: undefined, error: undefined });
            return;
          case "turn.failed":
          case "error": {
            const error =
              (message.type === "error" ? message.message : message.error?.message) ??
              "Codex could not answer.";
            answer.flush();
            this.update(run, { status: "failed", activity: undefined, error: String(error) });
            return;
          }
        }
      },
    );
  }

  /** Ends a question's process; the answer so far stays. */
  async stop(id: string) {
    const run = this.get(id);
    const child = run.child;
    if (child) {
      this.update(run, { status: "stopped", activity: undefined });
      child.kill("SIGTERM");
      const forced = setTimeout(() => child.kill("SIGKILL"), 3000);
      forced.unref?.();
      await run.exited;
      clearTimeout(forced);
    }
    return run.state;
  }

  /** Discards a question: its process ends, Med forgets it, and its fork's
   * transcript goes after the strict check. */
  async close(id: string) {
    const run = this.runs.get(id);
    if (!run) return false;
    clearTimeout(run.idle);
    if (run.child) await this.stop(id).catch(() => {});
    this.runs.delete(id);
    for (const listener of run.listeners) listener();
    run.listeners.clear();
    for (const fork of run.forks) await this.removeFork(fork);
    return true;
  }

  /** Ends every run as the host closes; their forks go at the next start. */
  async stopAll() {
    await Promise.all(
      [...this.runs.entries()].map(async ([id, run]) => {
        clearTimeout(run.idle);
        if (run.child) await this.stop(id).catch(() => {});
      }),
    );
    await this.writing;
  }

  routes(): Route[] {
    return [
      route(questionRoutes.ask, (input) => this.ask(input)),
      route(questionRoutes.stop, (input) => this.stop(input.id)),
      route(questionRoutes.close, async (input) => ({ closed: await this.close(input.id) })),
    ];
  }
}

/** An answer in parts, one for each message of the agent, in order. */
class Answer {
  private parts = new Map<string, string>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private size = 0;
  constructor(private publish: (text: string) => void) {}
  text() {
    return [...this.parts.values()]
      .map((part) => part.trim())
      .filter(Boolean)
      .join("\n\n");
  }
  append(id: string, text: string) {
    if (!text || this.size > MAX_ANSWER) return;
    this.parts.set(id, (this.parts.get(id) ?? "") + text);
    this.size += text.length;
    this.timer ??= setTimeout(() => this.flush(), STREAM_MS);
  }
  set(id: string, text: string) {
    this.parts.set(id, text.slice(0, MAX_ANSWER));
    this.size = [...this.parts.values()].reduce((sum, part) => sum + part.length, 0);
    this.timer ??= setTimeout(() => this.flush(), STREAM_MS);
  }
  flush() {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.publish(this.text());
  }
}
