import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, open } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { SessionUpdate, ToolKind } from "../shared/agent-session";
import {
  AGENT_CAPABILITIES,
  type AgentChoices,
  OwnedSetting,
  OwnedState,
} from "../shared/owned-session";
import type { AgentSession } from "../shared/saved-review";
import {
  attachHeld,
  forgetLog,
  holderEnded,
  startHeld,
  type HeldAgent,
  type HeldEvents,
} from "./held-agent";
import {
  agentEnvironment,
  createState,
  kept,
  lastLines,
  SessionLog,
  type LoggedEvent,
  type OwnedRunner,
  type RunnableAgent,
} from "./owned-sessions";
import { HostError } from "./runtime/errors";
import { userHome } from "./service/discover";
import { HEAD_BYTES, readEdge } from "./found-sessions";

// Antigravity's CLI, `agy`, in headless stream-json mode: one process keeps
// a conversation open and runs a turn for each line on its input
// (`{"event":"user","message":{...}}`). It writes `init`, `step_update`, and
// one `result` per turn. Med logs the updates as for an ACP agent: agy's
// transcript has no turn boundaries or results. A conversation that Med
// continues shows the transcript's history first (`agyHistory`).
//
// Headless agy cannot ask: a tool that needs approval is refused, and the
// turn's result lists it in `denied_actions`. Its mode (`--mode`,
// `--dangerously-skip-permissions`) and the allow rules in its settings
// decide instead, so Med offers the mode and says what agy refused.
// Messages written during a turn wait in agy until the turn ends; Med keeps
// them itself until then (queued-messages.ts). Stop ends the process; the
// next prompt resumes the conversation with `--conversation`.
//
// Event shapes are agy 1.4.10's, from a recorded session
// (tests/fixtures/agents/agy-stream.jsonl); Google publishes no schema.

const STREAM_MS = 80;
/** A subagent's transcript is read this often while its parent works. */
const CHILD_MS = 1000;
/** The end of a transcript that a continued conversation shows. */
const MAX_HISTORY_BYTES = 4 * 1024 * 1024;

type Json = Record<string, any>;
const record = (value: unknown): Json | undefined =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : undefined;

/** The models that agy offers: `agy models` prints `id<TAB>name` lines. */
export async function probeAgy(agent: Pick<RunnableAgent, "command" | "args">) {
  const child = spawn(agent.command, [...agent.args, "models"], {
    cwd: userHome(),
    env: agentEnvironment(),
    stdio: ["ignore", "pipe", "ignore"],
  });
  let text = "";
  child.stdout.on("data", (chunk) => (text += String(chunk)));
  const timer = setTimeout(() => child.kill("SIGTERM"), 20_000);
  await new Promise((done) => child.once("close", done).once("error", done));
  clearTimeout(timer);
  return text.split("\n").flatMap((line) => {
    const [id, name] = line.split("\t");
    return id && name && /^[\w.-]+$/.test(id) ? [{ id, name: name.trim() }] : [];
  });
}

const AGY_MODES = [
  {
    value: "default",
    name: "Ask",
    description: "agy's own mode; headless, it refuses what would ask",
  },
  { value: "accept-edits", name: "Accept edits", description: "Edit files without asking" },
  { value: "auto", name: "Auto", description: "A reviewer allows safe actions" },
  { value: "plan", name: "Plan", description: "Plan first; do not edit" },
  {
    value: "bypass",
    name: "Bypass permissions",
    description: "Run every tool without asking",
    confirm:
      "Antigravity will edit any file and run any command without asking, until you change the mode. Use it only where a mistake costs nothing, such as a throwaway clone.",
  },
];

const KINDS: Record<string, ToolKind> = {
  run_command: "execute",
  view_file: "read",
  list_dir: "read",
  grep_search: "search",
  find_by_name: "search",
  search_web: "fetch",
  read_url_content: "fetch",
  write_to_file: "edit",
  replace_file_content: "edit",
  multi_replace_file_content: "edit",
  sed_file: "edit",
};

/** A tool call's title and input, from agy's `tool_info`. */
function toolOf(info: Json | undefined, name: string) {
  const parameters = record(info?.parameters) ?? {};
  const unquote = (value: unknown) =>
    typeof value === "string" ? value.replace(/^"([\s\S]*)"$/, "$1") : undefined;
  const command = unquote(parameters.CommandLine);
  const path =
    unquote(parameters.AbsolutePath) ??
    unquote(parameters.TargetFile) ??
    unquote(parameters.DirectoryPath) ??
    unquote(parameters.SearchPath);
  const summary = unquote(parameters.toolSummary);
  const title =
    command ??
    (name === "invoke_subagent"
      ? (unquote(parameters.Role) ?? "Subagent")
      : `${summary ?? name.replaceAll("_", " ")}${path ? ` ${path}` : ""}`);
  return {
    title: title.split("\n")[0]!.slice(0, 300),
    kind: KINDS[name] ?? ("other" as ToolKind),
    ...(command ? { rawInput: { command } } : {}),
  };
}

/** What agy writes for a person in its transcript: the request, without its wrapper. */
const requestText = (content: string) =>
  /<USER_REQUEST>\n?([\s\S]*?)\n?<\/USER_REQUEST>/.exec(content)?.[1] ?? content;

/** Where agy keeps a conversation's transcript. */
export const agyTranscript = (home: string, id: string) =>
  join(
    home,
    ".gemini",
    "antigravity-cli",
    "brain",
    id,
    ".system_generated",
    "logs",
    "transcript.jsonl",
  );

/**
 * Reads an agy transcript (`brain/<id>/.system_generated/logs/transcript.jsonl`):
 * a subagent's, into the call that started it, or a conversation's that Med
 * did not start. It holds the task or the requests, the replies, and the
 * tool calls; their results follow as their own steps.
 */
function createTranscriptReader(prefix: string, parentToolCallId?: string) {
  const meta = parentToolCallId ? { _meta: { med: { parentToolCallId } } } : {};
  const open: string[] = [];
  return (line: string): SessionUpdate[] => {
    let step: Json | undefined;
    try {
      step = record(JSON.parse(line));
    } catch {
      return [];
    }
    if (!step) return [];
    const id = `${prefix}-${step.step_index}`;
    const content = typeof step.content === "string" ? step.content : "";
    if (step.type === "SYSTEM_MESSAGE" && parentToolCallId && !open.length) {
      const task = /content=([\s\S]*?)\n<\/SYSTEM_MESSAGE>/.exec(content)?.[1];
      return task
        ? [{ sessionUpdate: "user_message_chunk", content: { type: "text", text: task }, ...meta }]
        : [];
    }
    if (step.type === "USER_INPUT")
      return [
        {
          sessionUpdate: "user_message_chunk",
          content: { type: "text", text: requestText(content) },
          ...meta,
        },
      ];
    if (step.type === "PLANNER_RESPONSE") {
      const updates: SessionUpdate[] = [];
      if (content.trim())
        updates.push({
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: content },
          messageId: id,
          ...meta,
        });
      for (const [index, call] of (Array.isArray(step.tool_calls)
        ? step.tool_calls
        : []
      ).entries()) {
        const name = String(record(call)?.name ?? "tool");
        const callId = `${id}-${index}`;
        open.push(callId);
        updates.push({
          sessionUpdate: "tool_call",
          toolCallId: callId,
          status: "in_progress",
          ...toolOf({ parameters: record(call)?.args }, name),
          _meta: { med: { ...(parentToolCallId && { parentToolCallId }), tool: name } },
        });
      }
      return updates;
    }
    // Any other step is the result of the oldest call that waits.
    const callId = open.shift();
    if (!callId) return [];
    return [
      {
        sessionUpdate: "tool_call_update",
        toolCallId: callId,
        status: step.status === "ERROR" ? "failed" : "completed",
        ...(content || step.error
          ? {
              content: [
                {
                  type: "content" as const,
                  content: {
                    type: "text" as const,
                    text: String(step.error ?? content).slice(0, 4000),
                  },
                },
              ],
            }
          : {}),
        ...meta,
      },
    ];
  };
}

export interface AgyOptions {
  holders: string;
  logDirectory?: string;
  /** Med's ID for a session from before the host restarted. */
  sessionId?: string;
  /** agy's conversation, to resume with `--conversation`. */
  conversation?: string;
  /** What the conversation said before Med ran it. */
  history?: SessionUpdate[];
  onConversation?(id: string): void;
  env?: () => Record<string, string>;
  choices?: AgentChoices;
  models?: { id: string; name: string }[] | Promise<{ id: string; name: string }[]>;
  /** Attach to a holder that runs, with the updates that the thread has. */
  attach?: { earlier: LoggedEvent[] };
  /** Whether another agy process has the conversation open. */
  elsewhere?(conversation: string): Promise<boolean>;
  home?: () => string;
}

/** An Antigravity conversation that Med runs through `agy`. */
export function startAgy(agent: RunnableAgent, cwd: string, options: AgyOptions): OwnedRunner {
  const sessionId = options.sessionId ?? randomUUID();
  const session: AgentSession = { agent: "acp", name: agent.name, id: sessionId, cwd };
  const log = new SessionLog(
    options.logDirectory ? join(options.logDirectory, `${sessionId}.jsonl`) : undefined,
    options.attach?.earlier,
  );
  if (options.logDirectory) void mkdir(options.logDirectory, { recursive: true }).catch(() => {});
  const store = createState({
    sessionId,
    preset: agent.id,
    name: agent.name,
    status: "idle",
    settings: [],
    commands: [],
    turns: 0,
    capabilities: AGENT_CAPABILITIES.agy,
  });
  let conversation = options.conversation;
  let models = Array.isArray(options.models) ? options.models : [];
  let chosen = {
    model: options.choices?.model ?? "default",
    mode: options.choices?.mode ?? "default",
  };
  let held: HeldAgent | undefined;
  let active: object | undefined;
  let stopping = false;
  let interrupted = false;
  let entryNumber: number | undefined;
  let replaying = false;
  let streaming: OwnedState["streaming"];
  let streamTimer: ReturnType<typeof setTimeout> | undefined;
  /** The actions that agy refused in this process, each said once. */
  const denied = new Set<string>();
  /** Subagents' transcripts that Med follows, by conversation. */
  const children = new Map<
    string,
    { path: string; offset: number; read(line: string): SessionUpdate[] }
  >();
  let childTimer: ReturnType<typeof setInterval> | undefined;

  const push = (update: SessionUpdate) => log.push(update, entryNumber);
  const settings = (): OwnedSetting[] => [
    ...(models.length
      ? [
          {
            id: "model",
            name: "Model",
            category: "model" as const,
            value: models.some((entry) => entry.id === chosen.model) ? chosen.model : "default",
            options: [
              { value: "default", name: "agy's default" },
              ...models.map((entry) => ({ value: entry.id, name: entry.name })),
            ],
            idleOnly: true,
          },
        ]
      : []),
    {
      id: "mode",
      name: "Mode",
      category: "mode" as const,
      value: AGY_MODES.some((entry) => entry.value === chosen.mode) ? chosen.mode : "default",
      options: AGY_MODES,
      idleOnly: true,
      cycle: ["default", "accept-edits", "plan", "auto"],
    },
  ];
  store.set({ settings: settings() });
  void Promise.resolve(options.models).then((offered) => {
    if (models.length || !offered?.length) return;
    models = offered;
    store.set({ settings: settings() });
  });

  const flushStreaming = () => {
    streamTimer = undefined;
    store.set({ streaming });
  };
  const readChildren = async () => {
    for (const child of children.values()) {
      const handle = await open(child.path, "r").catch(() => undefined);
      if (!handle) continue;
      try {
        const { size } = await handle.stat();
        if (size <= child.offset) continue;
        const buffer = Buffer.alloc(size - child.offset);
        await handle.read(buffer, 0, buffer.length, child.offset);
        const end = buffer.lastIndexOf(10);
        if (end < 0) continue;
        child.offset += end + 1;
        for (const line of buffer.toString("utf8", 0, end).split("\n"))
          for (const update of child.read(line)) push(update);
      } finally {
        await handle.close();
      }
    }
  };
  const follow = (raw: Json, callId: string) => {
    const id = typeof raw.conversation_id === "string" ? raw.conversation_id : undefined;
    const uri = typeof raw.log_uri === "string" ? raw.log_uri : undefined;
    if (!id || children.has(id) || replaying) return;
    let path: string | undefined;
    try {
      path = uri?.startsWith("file://") ? fileURLToPath(uri) : undefined;
    } catch {
      path = undefined;
    }
    path ??= agyTranscript((options.home ?? userHome)(), id);
    children.set(id, { path, offset: 0, read: createTranscriptReader(callId, callId) });
    childTimer ??= setInterval(() => void readChildren().catch(() => {}), CHILD_MS);
  };
  const endTurn = () => {
    clearTimeout(streamTimer);
    streamTimer = undefined;
    streaming = undefined;
    if (childTimer) {
      clearInterval(childTimer);
      childTimer = undefined;
      void readChildren().catch(() => {});
    }
  };

  const onEvent = (message: Json) => {
    if (message.event === "init") {
      const id = typeof message.conversation_id === "string" ? message.conversation_id : undefined;
      if (id && id !== conversation) {
        conversation = id;
        options.onConversation?.(id);
      }
      return;
    }
    if (message.event === "step_update") {
      const step = record(message.step_update) ?? {};
      const id = `${step.conversation_id ?? conversation}-${step.step_index}`;
      if (step.step_type === "agent_response") {
        const delta = typeof step.text_delta === "string" ? step.text_delta : "";
        if (!streaming || streaming.id !== id) streaming = { id, text: "" };
        streaming = { ...streaming, text: streaming.text + delta };
        if (step.state === "DONE") {
          if (streaming.text.trim())
            push({
              sessionUpdate: "agent_message_chunk",
              content: { type: "text", text: streaming.text.trimEnd() },
              messageId: id,
            });
          streaming = undefined;
          clearTimeout(streamTimer);
          streamTimer = undefined;
          store.set({ streaming: undefined });
        } else if (!replaying) streamTimer ??= setTimeout(flushStreaming, STREAM_MS);
        return;
      }
      if (step.step_type === "tool" || step.step_type === "subagent") {
        const info = record(step.tool_info);
        const name = String(step.tool_name ?? info?.name ?? "tool");
        if (step.state === "ACTIVE")
          push({
            sessionUpdate: "tool_call",
            toolCallId: id,
            status: "in_progress",
            ...toolOf(info, name),
            _meta: { med: { tool: name } },
          });
        else {
          const error = record(info?.error);
          const output = typeof info?.output === "string" ? info.output : undefined;
          const text = error ? String(error.message ?? "The tool failed.") : output;
          push({
            sessionUpdate: "tool_call_update",
            toolCallId: id,
            status: step.state === "ERROR" ? "failed" : "completed",
            ...(text
              ? {
                  content: [
                    { type: "content", content: { type: "text", text: text.slice(0, 64_000) } },
                  ],
                }
              : {}),
          });
          for (const child of Array.isArray(record(step.subagent_info)?.subagents)
            ? step.subagent_info.subagents
            : [])
            if (record(child)) follow(child, id);
        }
      }
      return;
    }
    if (message.event === "result") {
      const result = record(message.result) ?? {};
      endTurn();
      const refused = (Array.isArray(result.denied_actions) ? result.denied_actions : [])
        .map((entry: unknown) => String(record(entry)?.display_name ?? record(entry)?.action ?? ""))
        .filter((name: string) => name && !denied.has(name));
      for (const name of refused) denied.add(name);
      if (refused.length)
        push({
          sessionUpdate: "notice",
          severity: "warning",
          title: `${agent.name} refused ${refused.join(", ")}: it cannot ask in Med`,
          description:
            "Headless agy refuses an action that would ask. Choose Accept edits, Auto, or Bypass permissions, or allow the action with /permissions in agy, then send again.",
        });
      // Stop ends agy's input, which ends the turn with an error result.
      if (result.status === "ERROR" && interrupted)
        push({ sessionUpdate: "notice", severity: "warning", title: "Interrupted" });
      else if (result.status === "ERROR" && typeof result.error === "string")
        push({ sessionUpdate: "notice", severity: "error", title: result.error });
      store.set({ status: "idle", streaming: undefined });
      if (!replaying) held?.checkpoint({ state: kept(store.get()), chosen, conversation });
    }
  };

  let errors = "";
  const events = (token: object, done: () => void): HeldEvents => ({
    entry(entry, replay) {
      if (active !== token) return;
      replaying = replay;
      entryNumber = entry.n;
      try {
        if (entry.kind === "h") log.begin(JSON.parse(entry.text).generation);
        else if (entry.kind === "m" && replay) {
          const checkpoint = JSON.parse(entry.text).checkpoint;
          if (checkpoint?.state) {
            chosen = checkpoint.chosen ?? chosen;
            conversation = checkpoint.conversation ?? conversation;
            store.set({ ...checkpoint.state, settings: settings(), streaming: undefined });
          }
        } else if (entry.kind === "o") onEvent(JSON.parse(entry.text));
        else if (entry.kind === "i") {
          const sent = JSON.parse(entry.text);
          const text = sent?.message?.content;
          if (typeof text === "string") {
            push({ sessionUpdate: "user_message_chunk", content: { type: "text", text } });
            if (replay) store.set({ status: "working", turns: store.get().turns + 1 });
          }
        } else if (entry.kind === "e") errors = `${errors}${entry.text}\n`.slice(-4000);
      } catch {
        /* Not a message. */
      } finally {
        replaying = false;
        entryNumber = undefined;
      }
    },
    live: () => done(),
    exit(exit) {
      done();
      if (active !== token) return;
      active = undefined;
      held = undefined;
      void forgetLog(options.holders, sessionId);
      denied.clear();
      const before = store.get().status;
      endTurn();
      if (stopping) return;
      if (before === "working")
        push({ sessionUpdate: "notice", severity: "warning", title: "Interrupted" });
      const lines = lastLines(exit.errors || errors);
      // The conversation stays: the next prompt resumes it.
      store.set({
        status: conversation ? "idle" : "exited",
        streaming: undefined,
        ...(!exit.requested && !interrupted && (exit.code || exit.signal || exit.error)
          ? {
              halt: {
                kind: "stopped" as const,
                detail: exit.error ?? `Exited with ${exit.signal ?? `code ${exit.code}`}`,
                ...(lines ? { lines } : {}),
                at: Date.now(),
              },
            }
          : {}),
      });
      interrupted = false;
    },
  });

  const launch = () => {
    const token = {};
    active = token;
    const args = [
      "--input-format",
      "stream-json",
      "--output-format",
      "stream-json",
      ...(chosen.model !== "default" ? ["--model", chosen.model] : []),
      ...(chosen.mode === "bypass"
        ? ["--dangerously-skip-permissions"]
        : chosen.mode !== "default"
          ? ["--mode", chosen.mode]
          : []),
      ...(conversation ? ["--conversation", conversation] : []),
      // An empty print prompt: the turns come on the input.
      "-p=",
    ];
    held = startHeld(
      options.holders,
      {
        sessionId,
        kind: "agy",
        name: agent.name,
        command: agent.command,
        args: [...agent.args, ...args],
        cwd,
        env: agentEnvironment(options.env?.()),
      },
      events(token, () => {}),
    );
  };

  for (const update of options.attach ? [] : (options.history ?? [])) push(update);
  let attached: Promise<void> = Promise.resolve();
  if (options.attach) {
    const token = {};
    active = token;
    attached = new Promise<void>((done) => {
      void attachHeld(options.holders, sessionId, events(token, done)).then(
        (found) => {
          if (!found) {
            active = undefined;
            done();
          } else if (active === token) held = found;
        },
        () => {
          active = undefined;
          done();
        },
      );
    });
  }

  const wake = async () => {
    await attached;
    if (held || stopping) return;
    if (conversation && (await options.elsewhere?.(conversation)))
      throw new HostError(
        "session-busy",
        `Another agy process has this conversation open, such as agy in a terminal. Close it there, then send again.`,
        409,
      );
    launch();
  };

  return {
    session,
    log,
    attached,
    state: store.get,
    dormant: () => !held,
    pid: () => held?.pid(),
    subscribe: store.subscribe,
    async prompt(text) {
      if (store.get().status === "exited")
        throw new HostError("session-stopped", "This session has stopped.", 409);
      await wake();
      // The thread gets the prompt from the holder's log (kind "i").
      store.set({
        status: "working",
        turns: store.get().turns + 1,
        error: undefined,
        halt: undefined,
      });
      held?.write(JSON.stringify({ event: "user", message: { role: "user", content: text } }));
    },
    answer() {},
    interrupt() {
      // agy takes no stop on its input: the process ends, and the next
      // prompt resumes the conversation.
      if (!held || store.get().status !== "working") return;
      interrupted = true;
      held.stop();
    },
    async set(id, value) {
      const setting = store.get().settings.find((entry) => entry.id === id);
      if (!setting || !setting.options.some((option) => option.value === value))
        throw new HostError("invalid-setting", "The agent does not offer this choice.", 400);
      if (store.get().status === "working")
        throw new HostError("agent-busy", "Change this when the turn ends.", 409);
      if (id === "model") chosen.model = value;
      if (id === "mode") chosen.mode = value;
      store.set({ settings: settings() });
      // agy takes its model and mode when it starts: the next prompt starts it again.
      if (held) {
        const previous = held;
        active = undefined;
        held = undefined;
        previous.stop();
        await holderEnded(options.holders, sessionId);
      }
    },
    async restart() {
      await wake();
      store.set({ halt: undefined, error: undefined });
    },
    dismiss() {
      store.set({ halt: undefined });
    },
    stop() {
      stopping = true;
      endTurn();
      held?.stop();
      store.set({ status: "exited", streaming: undefined, halt: undefined });
    },
    release() {
      held?.stop();
    },
    detach() {
      active = undefined;
      held?.detach();
      held = undefined;
    },
  };
}

/** The first request of an agy conversation, as its title. */
export async function agyTitle(home: string, id: string) {
  const { lines } = await readEdge(agyTranscript(home, id), "head", HEAD_BYTES).catch(() => ({
    lines: [] as string[],
  }));
  for (const line of lines) {
    try {
      const step = record(JSON.parse(line));
      if (step?.type === "USER_INPUT" && typeof step.content === "string")
        return requestText(step.content).trim().split("\n")[0]!.slice(0, 200);
    } catch {
      /* Not a step. */
    }
  }
  return undefined;
}

/** A conversation's history from agy's transcript, for a session that Med
 * continues: it shows before Med's own turns. */
export async function agyHistory(home: string, id: string): Promise<SessionUpdate[]> {
  const path = agyTranscript(home, id);
  const { lines } = await readEdge(path, "tail", MAX_HISTORY_BYTES).catch(() => ({
    lines: [] as string[],
  }));
  const read = createTranscriptReader(id);
  return lines.flatMap((line) => read(line));
}
