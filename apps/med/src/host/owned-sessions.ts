import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { constants, existsSync } from "node:fs";
import { access, appendFile, mkdir, readFile } from "node:fs/promises";
import { delimiter, dirname, isAbsolute, join, relative } from "node:path";
import { createInterface } from "node:readline";
import { z } from "zod";
import type { SessionEvent, SessionUpdate } from "../shared/agent-session";
import {
  AGENT_CAPABILITIES,
  AGENT_DEFAULTS,
  ownedQuestionSchema,
  ownedSettingSchema,
  type AgentChoices,
  type AgentOptions,
  type AgentPreset,
  type OwnedCommand,
  type OwnedPermission,
  type OwnedQuestion,
  type OwnedSetting,
  type OwnedState,
  type PermissionReply,
} from "../shared/owned-session";
import type { AgentSession } from "../shared/saved-review";
import { compactUpdate } from "./agent-transcripts";
import { heldLocks, lockFolders, processCwd } from "./agent-locks";
import { agyHistory, agyTitle, probeAgy, startAgy } from "./agy-runner";
import { probeCodex, startCodex, type CodexModel } from "./codex-runner";
import {
  attachHeld,
  forgetLog,
  holderEnded,
  readHolder,
  startHeld,
  type HeldAgent,
  type HeldEvents,
} from "./held-agent";
import { createJsonRpc, parseRpc, RpcError, type JsonRpc } from "./json-rpc";
import { HostError } from "./runtime/errors";
import { readRecords, writeStateFile } from "./runtime/state-file";
import { userHome } from "./service/discover";
import { createSessionProcesses, type SessionProcesses } from "./session-processes";
import { shellEnvironment } from "./shell-environment";
import type { PromptImage } from "../shared/agent-inbox";

/** An installed agent with the command that starts it. */
export interface RunnableAgent extends AgentPreset {
  command: string;
  args: string[];
}

/** A session that Med started. A holder keeps its process (holder.ts), so
 * the agent outlives a restart of the host. */
export interface OwnedRunner {
  readonly session: AgentSession;
  /** Settles when the runner has read its holder's log, after a restart. */
  readonly attached?: Promise<void>;
  state(): OwnedState;
  /** A session from before the host restarted, whose agent starts again
   * with its next prompt. */
  dormant(): boolean;
  /** The agent's process, while it runs. */
  pid(): number | undefined;
  /** Updates that Med keeps for an ACP session; Claude Code writes a transcript. */
  readonly log?: SessionLog;
  prompt(text: string, images?: PromptImage[]): Promise<void>;
  /** The main conversation's tools run now. Claude Code reads a prompt that
   * comes meanwhile when they end, in the same turn, as its terminal does
   * with a message that the user queued (queued-messages.ts). */
  runsTools?(): boolean;
  /** Send now: a message into the turn that runs, which Codex takes at its
   * next step (`turn/steer`). Between turns it is the next prompt. */
  steer?(text: string, images?: PromptImage[]): Promise<void>;
  answer(id: string, option: string, reply?: PermissionReply): void;
  interrupt(): void;
  set(id: string, value: string): Promise<void>;
  /** Starts the agent of a session whose process stopped; it resumes. */
  restart(): Promise<void>;
  /** Clears what stopped the work (`OwnedState.halt`). */
  dismiss(): void;
  stop(): void;
  /** Stops the agent's process and keeps the session, as when its tab
   * closed: a Claude Code session resumes with its next prompt. */
  release(): void;
  /** Leaves the agent running for the next host, as when the host closes. */
  detach(): void;
  subscribe(listener: () => void): () => void;
}

/** What Continue sends to an agent whose turn stopped before its end. */
export const CONTINUE_TURN = "Your last turn stopped before it ended. Continue where you stopped.";

/** Updates kept at most per session, in memory and on disk. */
const MAX_EVENTS = 5000;
/** A streaming reply sends its state at most this often. */
const STREAM_MS = 80;

/** An update as an ACP session's file keeps it: with the holder's lifetime
 * and the number of the log entry that it came from. */
export type LoggedEvent = SessionEvent & { held?: [string, number] };

/** An ACP session's updates, kept in memory and appended to a file, so the
 * thread stays readable after the agent or the host stops. */
export class SessionLog {
  readonly events: SessionEvent[] = [];
  private listeners = new Set<(events: SessionEvent[]) => void>();
  private writing: Promise<void> = Promise.resolve();
  /** The holder's lifetime, and its last log entry that the file has. */
  private generation: string | undefined;
  private through = 0;
  private last: [string, number] | undefined;
  constructor(
    private path?: string,
    earlier: LoggedEvent[] = [],
  ) {
    for (const { held, ...event } of earlier) {
      this.events.push(event);
      if (held) this.last = held;
    }
  }
  /** A holder's log starts. Its entries up to the last that the file has
   * are in the thread already. */
  begin(generation: string) {
    this.generation = generation;
    this.through = this.last?.[0] === generation ? this.last[1] : 0;
  }
  /** `entry` is the number of the log entry that the update came from. */
  push(update: SessionUpdate, entry?: number) {
    if (entry !== undefined && entry <= this.through) return;
    const event = { at: Date.now(), update: compactUpdate(update) };
    this.events.push(event);
    if (this.events.length > MAX_EVENTS) this.events.splice(0, this.events.length - MAX_EVENTS);
    const path = this.path;
    const kept: LoggedEvent =
      entry !== undefined && this.generation ? { ...event, held: [this.generation, entry] } : event;
    if (path)
      this.writing = this.writing
        .then(() => appendFile(path, `${JSON.stringify(kept)}\n`))
        .catch(() => {});
    for (const listener of this.listeners) listener([event]);
  }
  subscribe(listener: (events: SessionEvent[]) => void) {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }
  /** The updates in a session's file, with the entries they came from. */
  static async read(path: string): Promise<LoggedEvent[]> {
    let text: string;
    try {
      text = await readFile(path, "utf8");
    } catch {
      return [];
    }
    return text
      .split("\n")
      .filter(Boolean)
      .slice(-MAX_EVENTS)
      .flatMap((line) => {
        try {
          return [JSON.parse(line) as LoggedEvent];
        } catch {
          return [];
        }
      });
  }
}

// Variables that tie a process to the Claude Code session or app that started
// Med. An agent that Med starts is a session of its own. CLAUDE_CODE_SIMPLE
// is bare mode, which ignores the user's login.
const SESSION_VARIABLES = [
  "CLAUDECODE",
  "CLAUDE_CODE_ENTRYPOINT",
  "CLAUDE_CODE_SESSION_ID",
  "CLAUDE_CODE_MESSAGING_SOCKET",
  "CLAUDE_CODE_MESSAGING_TOKEN",
  "CLAUDE_CODE_SSE_PORT",
  "CLAUDE_CODE_SIMPLE",
  "CLAUDE_CODE_CHILD_SESSION",
  "CLAUDE_CODE_HOST_SESSION_ID",
  "CLAUDE_CODE_SDK_HAS_HOST_AUTH_REFRESH",
  "CLAUDE_CODE_SESSION_ATTENDED",
  "CLAUDE_CODE_EXECPATH",
  "CLAUDE_CODE_DESKTOP_APP_VERSION",
  "CLAUDE_AGENT_SDK_VERSION",
  "CLAUDE_AGENT_SDK_MCP_NO_PREFIX",
  "CLAUDE_PID",
];
/** The environment of an agent that Med starts: Med's own with the login
 * shell's variables when Med runs as the login service (shell-environment.ts),
 * without the variables of the session that started Med, and with `extra`. */
export function agentEnvironment(extra: Record<string, string> = {}) {
  const env = { ...process.env, ...shellEnvironment() };
  for (const name of SESSION_VARIABLES) delete env[name];
  return { ...env, ...extra };
}

/** Listeners and a state that changes in place, with the time of its last change. */
export function createState(initial: OwnedState) {
  let state = { ...initial, updatedAt: Date.now() };
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set(change: Partial<OwnedState>) {
      state = { ...state, ...change, updatedAt: Date.now() };
      for (const listener of listeners) listener();
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}

export const lastLines = (text: string) => text.trim().split("\n").slice(-3).join("\n").slice(-600);

/** The parts of a runner's state that a checkpoint keeps (holder.ts). */
export const kept = ({
  status,
  settings,
  commands,
  turns,
  context,
  error,
  images,
}: OwnedState) => ({
  status,
  settings,
  commands,
  turns,
  ...(context ? { context } : {}),
  ...(error ? { error } : {}),
  ...(images ? { images } : {}),
});

/** Claude Code processes in the user's home, for a runner that no
 * OwnedSessions starts (session-processes.ts). */
let defaultProcesses: SessionProcesses | undefined;
const runsElsewhere = async (sessionId: string) =>
  (await (defaultProcesses ??= createSessionProcesses()).elsewhere([sessionId])).has(sessionId);

/** A short line for a tool call's input: its command, path, or URL. */
export function inputSummary(input: Record<string, unknown> | undefined) {
  if (!input) return undefined;
  for (const key of ["command", "file_path", "path", "url", "pattern", "description"])
    if (typeof input[key] === "string") return (input[key] as string).slice(0, 500);
  return undefined;
}

const capitalized = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);
const CLAUDE_MODES = [
  { value: "default", name: "Ask", description: "Ask before edits and commands" },
  { value: "acceptEdits", name: "Accept edits", description: "Edit files without asking" },
  { value: "plan", name: "Plan", description: "Plan first; do not edit" },
  {
    value: "auto",
    name: "Auto",
    description: "A classifier allows safe actions and asks about risky ones",
  },
  {
    value: "dontAsk",
    name: "Don't ask",
    description: "Deny what the permission rules do not allow",
  },
  {
    value: "bypassPermissions",
    name: "Bypass permissions",
    description: "Run every tool without asking",
    confirm:
      "Claude Code will edit any file and run any command without asking, until you change the mode. Use it only where a mistake costs nothing, such as a throwaway clone. If Claude Code started without it, it starts again between turns.",
  },
];
const BYPASS = "bypassPermissions";
/** The modes in the order of Claude Code's ⇧Tab. Bypass is there only when
 * Claude Code started with it allowed; Don't ask is never there. */
const modeCycle = (bypass: boolean) => [
  "default",
  "acceptEdits",
  "plan",
  ...(bypass ? [BYPASS] : []),
  "auto",
];
/** The mode a new session starts in: a mode that Med knows, but never Bypass,
 * which asks first. "default" leaves it to the user's own setting. */
const startMode = (mode: string | undefined) =>
  mode && mode !== BYPASS && CLAUDE_MODES.some((entry) => entry.value === mode) ? mode : "default";
/** The modes that an approved plan can continue in, the first by default,
 * as Claude Code offers them after a plan. */
const planModes = (bypass: boolean) =>
  ["acceptEdits", "default", "auto", ...(bypass ? [BYPASS] : [])].map((value) =>
    CLAUDE_MODES.find((mode) => mode.value === value)!,
  );
const questionsSchema = z.array(ownedQuestionSchema).min(1).max(8);

const claudeInitSchema = z
  .object({
    commands: z
      .array(
        z.object({
          name: z.string(),
          description: z.string().default(""),
          argumentHint: z.string().optional(),
          builtin: z.boolean().optional(),
        }),
      )
      .default([]),
    models: z
      .array(
        z.object({
          value: z.string(),
          displayName: z.string().optional(),
          description: z.string().optional(),
          supportedEffortLevels: z.array(z.string()).optional(),
        }),
      )
      .default([]),
    current_permission_mode: z.string().optional(),
  })
  .passthrough();
type ClaudeModel = z.infer<typeof claudeInitSchema>["models"][number];

const modelOption = (entry: ClaudeModel) => ({
  value: entry.value,
  name: entry.displayName ?? entry.value,
  ...(entry.description ? { description: entry.description } : {}),
});
const effortOptions = (levels: string[]) => [
  { value: "default", name: "Default effort" },
  ...levels.map((level) => ({
    value: level,
    name: level === "xhigh" ? "Extra high" : capitalized(level),
  })),
];

/** The model and effort that Claude Code offers, from the wanted ones. */
function claudeChoices(models: ClaudeModel[], wanted: AgentChoices) {
  const model = models.find((entry) => entry.value === wanted.model);
  const levels = (model ?? models[0])?.supportedEffortLevels ?? [];
  return {
    model: model?.value ?? "default",
    effort: wanted.effort && levels.includes(wanted.effort) ? wanted.effort : "default",
  };
}

/**
 * The models that Claude Code offers. `initialize` answers without a prompt,
 * so the process writes no transcript; Med stops it after the answer.
 */
async function probeClaude(agent: RunnableAgent): Promise<ClaudeModel[]> {
  const child = spawn(
    agent.command,
    [
      ...agent.args,
      "-p",
      "--input-format",
      "stream-json",
      "--output-format",
      "stream-json",
      "--verbose",
      "--session-id",
      randomUUID(),
    ],
    { cwd: userHome(), env: agentEnvironment(), stdio: ["pipe", "pipe", "ignore"] },
  );
  try {
    return await new Promise<ClaudeModel[]>((resolve) => {
      const timer = setTimeout(() => resolve([]), 15_000);
      const done = (models: ClaudeModel[]) => {
        clearTimeout(timer);
        resolve(models);
      };
      child.on("error", () => done([]));
      child.on("exit", () => done([]));
      createInterface({ input: child.stdout, crlfDelay: Infinity }).on("line", (line) => {
        try {
          const message = JSON.parse(line);
          if (message.type !== "control_response") return;
          done(claudeInitSchema.safeParse(message.response?.response).data?.models ?? []);
        } catch {
          /* Not a message. */
        }
      });
      child.stdin.on("error", () => {});
      child.stdin.write(
        `${JSON.stringify({ type: "control_request", request_id: "med-probe", request: { subtype: "initialize" } })}\n`,
      );
    });
  } finally {
    child.kill("SIGTERM");
  }
}

/**
 * Claude Code through `stream-json`. Med starts the binary that the user
 * installed and signed in to, through a holder (holder.ts), and answers its
 * control requests: permission prompts go to the review, and Med sends
 * interrupts and model changes. The session writes its transcript as usual,
 * which the thread reads.
 *
 * The runner's state comes from the holder's log: a host that attaches to a
 * running agent reads the log from its start, without acting on it again,
 * and then follows the agent live.
 */
export function startClaude(
  agent: RunnableAgent,
  cwd: string,
  options: {
    /** The folder of the agents' holders and their logs. */
    holders: string;
    sessionId?: string;
    /** The variables to add, read when the process starts. */
    env?: () => Record<string, string>;
    /** The model and effort to start with, where `models` offers them. */
    choices?: AgentChoices;
    models?: ClaudeModel[] | Promise<ClaudeModel[]>;
    /** The session exists: it continues with `--resume` at its next prompt,
     * with the model, effort, and mode it had. */
    resume?: { model?: string; effort?: string; mode?: string };
    /** A session from before the host restarted: Med attaches to its holder,
     * or reads how its agent ended from the holder's log. */
    attach?: boolean;
    /** A new session that starts from this one's history (`--fork-session`),
     * until its first prompt makes its own transcript. */
    fork?: string;
    /** Whether another process runs a session (session-processes.ts). */
    elsewhere?: (sessionId: string) => Promise<boolean>;
    /** What stopped the work before the host restarted, such as a cut turn. */
    halt?: OwnedState["halt"];
  },
): OwnedRunner {
  const sessionId = options.sessionId ?? randomUUID();
  const session: AgentSession = { agent: "claude", id: sessionId, cwd };
  const store = createState({
    sessionId,
    preset: agent.id,
    name: agent.name,
    status: "starting",
    settings: [],
    commands: [],
    turns: 0,
    images: true,
    capabilities: AGENT_CAPABILITIES.claude,
  });
  // The holder of the agent's process, while one runs. Each holder has a
  // token; the events of one that Med left are not this runner's.
  let held: HeldAgent | undefined;
  let active: object | undefined;
  // The runner reads entries from before it attached: it writes nothing.
  let replaying = false;
  let attached: Promise<void> = Promise.resolve();
  let waking: Promise<void> | undefined;
  // Claude Code has the session's transcript: a new process resumes it. A
  // fork has its own transcript after its first prompt.
  let exists = !!options.resume && !options.fork;
  /** The main conversation's tool calls that run (runsTools), by ID. */
  const tools = new Set<string>();
  let stopping = false;
  let sequence = 0;
  const pending = new Map<string, (response: { error?: string; value?: unknown }) => void>();
  let ask:
    | {
        id: string;
        input: unknown;
        suggestions?: unknown[];
        questions?: OwnedQuestion[];
        plan?: boolean;
      }
    | undefined;
  let models = Array.isArray(options.models) ? options.models : [];
  let chosen: { model: string; effort: string; mode: string; bypass?: boolean } = options.resume
    ? {
        model: options.resume.model ?? "default",
        effort: options.resume.effort ?? "default",
        mode: options.resume.mode ?? "default",
      }
    : {
        ...claudeChoices(models, options.choices ?? {}),
        mode: startMode(options.choices?.mode),
      };
  // Whether the process that runs started with Bypass allowed: Claude Code
  // refuses to switch to it otherwise.
  let bypassable = false;
  let streamTimer: ReturnType<typeof setTimeout> | undefined;
  let streaming: OwnedState["streaming"];

  const write = (message: object) => {
    if (!replaying) held?.write(JSON.stringify(message));
  };
  const settings = (): OwnedSetting[] => {
    const model = models.find((entry) => entry.value === chosen.model) ?? models[0];
    const efforts = model?.supportedEffortLevels ?? [];
    return [
      ...(models.length
        ? [
            {
              id: "model",
              name: "Model",
              category: "model" as const,
              value: chosen.model,
              options: models.map(modelOption),
            },
          ]
        : []),
      ...(efforts.length
        ? [
            {
              id: "effort",
              name: "Effort",
              category: "effort" as const,
              value: efforts.includes(chosen.effort) ? chosen.effort : "default",
              options: effortOptions(efforts),
              idleOnly: true,
            },
          ]
        : []),
      {
        id: "mode",
        name: "Mode",
        category: "mode" as const,
        // The mode that Claude Code reports, even one that Med does not know.
        value: chosen.mode,
        options: CLAUDE_MODES.some((entry) => entry.value === chosen.mode)
          ? CLAUDE_MODES
          : [...CLAUDE_MODES, { value: chosen.mode, name: chosen.mode }],
        cycle: modeCycle(bypassable),
      },
    ];
  };
  /** Takes the mode that Claude Code reports, as after an approved plan. */
  const reported = (mode: unknown) => {
    if (typeof mode !== "string" || !mode || mode === chosen.mode) return;
    chosen.mode = mode;
    store.set({ settings: settings() });
  };
  // What each answer to Med's control requests changes, live or read again.
  const effects: Record<string, (value: unknown, request: Record<string, any>) => void> = {
    initialize(value) {
      // The reply also names the signed-in account; Med keeps none of it.
      const parsed = claudeInitSchema.safeParse(value);
      if (!parsed.success) return;
      models = parsed.data.models;
      // Claude Code reports the mode that it started in: the session's own,
      // or for a new one, the mode that Med asked for.
      if (parsed.data.current_permission_mode) chosen.mode = parsed.data.current_permission_mode;
      store.set({
        status: store.get().status === "starting" ? "idle" : store.get().status,
        settings: settings(),
        commands: parsed.data.commands
          .filter((command) => !command.builtin)
          .map((command): OwnedCommand => ({
            name: command.name,
            description: command.description,
            ...(command.argumentHint ? { hint: command.argumentHint } : {}),
          })),
      });
    },
    get_context_usage(value) {
      const { totalTokens, maxTokens } = (value ?? {}) as Record<string, unknown>;
      if (typeof totalTokens === "number" && typeof maxTokens === "number" && maxTokens > 0)
        store.set({ context: { used: totalTokens, total: maxTokens } });
    },
    set_model(_value, request) {
      chosen.model = typeof request.model === "string" ? request.model : "default";
      store.set({ settings: settings() });
    },
    set_permission_mode(_value, request) {
      if (typeof request.mode === "string") chosen.mode = request.mode;
      store.set({ settings: settings() });
    },
  };
  const expect = (
    id: string,
    request: Record<string, any>,
    done?: (response: { error?: string; value?: unknown }) => void,
  ) =>
    pending.set(id, (response) => {
      if (!response.error) effects[String(request.subtype)]?.(response.value, request);
      done?.(response);
    });
  const control = (request: { subtype: string } & Record<string, unknown>) =>
    new Promise<unknown>((resolve, reject) => {
      const id = `med-${++sequence}`;
      expect(id, request, ({ error, value }) =>
        error ? reject(new HostError("agent-error", error, 502)) : resolve(value),
      );
      write({ type: "control_request", request_id: id, request });
    });
  const flushStreaming = () => {
    streamTimer = undefined;
    store.set({ streaming });
  };
  const clearTurn = () => {
    clearTimeout(streamTimer);
    streamTimer = undefined;
    streaming = undefined;
    ask = undefined;
    tools.clear();
  };

  /** What the review shows for a tool call that waits: a question with its
   * choices, a plan to approve, or a permission to give. */
  const claudePermission = (
    id: string,
    request: Record<string, any>,
    {
      questions,
      plan,
      suggestions,
    }: { questions?: OwnedQuestion[]; plan?: string; suggestions: unknown[] },
  ): OwnedPermission => {
    if (questions)
      return {
        id,
        title: `${agent.name} asks`,
        options: [
          { id: "answer", name: "Answer", kind: "allow_once" },
          { id: "deny", name: "Skip", kind: "reject_once" },
        ],
        questions,
      };
    if (plan !== undefined) {
      const modes = planModes(bypassable);
      return {
        id,
        title: `${agent.name}'s plan`,
        options: [
          { id: "approve", name: "Approve", kind: "allow_once" },
          { id: "deny", name: "Keep planning", kind: "reject_once" },
        ],
        plan: {
          text: plan,
          modes: modes.map(({ value, name }) => ({ value, name })),
          mode: modes[0]!.value,
        },
      };
    }
    const name = String(request.display_name ?? request.tool_name ?? "A tool");
    const detail = inputSummary(request.input) ?? request.description;
    return {
      id,
      title: `${agent.name} wants to use ${name}`,
      ...(detail ? { detail: String(detail) } : {}),
      options: [
        { id: "allow", name: "Allow", kind: "allow_once" },
        ...(suggestions.length
          ? [{ id: "always", name: "Allow for this session", kind: "allow_always" as const }]
          : []),
        { id: "deny", name: "Deny", kind: "reject_once" },
      ],
    };
  };

  const onMessage = (message: Record<string, any>) => {
    switch (message.type) {
      // A main-conversation response that calls tools starts them, and
      // each result ends its call; parallel calls run until the last one
      // ends. A subagent's calls run inside the main one's.
      case "assistant":
      case "user": {
        if (message.parent_tool_use_id) return;
        const blocks = (
          Array.isArray(message.message?.content) ? message.message.content : []
        ) as ({ type?: unknown; id?: unknown; tool_use_id?: unknown } | null)[];
        const before = tools.size > 0;
        for (const block of blocks) {
          if (message.type === "assistant" && block?.type === "tool_use")
            tools.add(String(block.id));
          if (message.type === "user" && block?.type === "tool_result")
            tools.delete(String(block.tool_use_id));
        }
        if (before !== tools.size > 0) store.set({});
        return;
      }
      case "control_response": {
        const response = message.response ?? {};
        const done = pending.get(response.request_id);
        if (!done) return;
        pending.delete(response.request_id);
        done(
          response.subtype === "error"
            ? { error: String(response.error ?? "Claude Code refused the request.") }
            : { value: response.response },
        );
        return;
      }
      case "control_request": {
        const request = message.request ?? {};
        if (request.subtype !== "can_use_tool") {
          write({
            type: "control_response",
            response: {
              subtype: "error",
              request_id: message.request_id,
              error: `Med does not handle ${request.subtype}.`,
            },
          });
          return;
        }
        const suggestions = Array.isArray(request.permission_suggestions)
          ? request.permission_suggestions
          : [];
        const id = String(message.request_id);
        const input = (request.input ?? {}) as Record<string, unknown>;
        const questions =
          request.tool_name === "AskUserQuestion"
            ? questionsSchema.safeParse(input.questions).data
            : undefined;
        const plan =
          request.tool_name === "ExitPlanMode" && typeof input.plan === "string"
            ? input.plan
            : undefined;
        ask = { id, input: request.input, suggestions, questions, plan: plan !== undefined };
        store.set({ permission: claudePermission(id, request, { questions, plan, suggestions }) });
        return;
      }
      case "control_cancel_request":
        if (ask?.id === message.request_id) {
          ask = undefined;
          store.set({ permission: undefined });
        }
        return;
      case "system":
        // Claude Code reports its mode when it starts, and when it changes.
        if (message.subtype === "init" || message.subtype === "status")
          reported(message.permissionMode);
        if (message.subtype === "status" && message.status === "requesting")
          store.set({ status: "working" });
        return;
      case "stream_event": {
        const event = message.event ?? {};
        if (event.type === "message_start")
          streaming = { id: String(event.message?.id ?? randomUUID()), text: "" };
        else if (
          event.type === "content_block_delta" &&
          event.delta?.type === "text_delta" &&
          streaming &&
          !message.parent_tool_use_id
        ) {
          streaming = { ...streaming, text: streaming.text + String(event.delta.text ?? "") };
          streamTimer ??= setTimeout(flushStreaming, STREAM_MS);
        }
        return;
      }
      case "result": {
        clearTurn();
        store.set({
          status: "idle",
          streaming: undefined,
          permission: undefined,
          ...(message.is_error && message.subtype !== "error_during_execution"
            ? { error: String(message.result ?? "The turn failed.") }
            : { error: undefined }),
        });
        if (!replaying) {
          held?.checkpoint({ state: kept(store.get()), models, chosen, exists, sequence });
          void control({ subtype: "get_context_usage" }).catch(() => {});
        }
        return;
      }
    }
  };
  /** The state at a checkpoint, where a long log starts again. */
  const restore = (checkpoint: any) => {
    if (!checkpoint?.state) return;
    models = checkpoint.models ?? models;
    chosen = checkpoint.chosen ?? chosen;
    exists = !!checkpoint.exists;
    sequence = Math.max(sequence, Number(checkpoint.sequence) || 0);
    pending.clear();
    clearTurn();
    store.set({ ...checkpoint.state, permission: undefined, streaming: undefined });
  };
  /** A line that Med wrote to the agent, read again from the log. */
  const onSent = (message: Record<string, any>) => {
    if (message.type === "user") {
      exists = true;
      store.set({
        status: "working",
        turns: store.get().turns + 1,
        error: undefined,
        halt: undefined,
      });
    } else if (message.type === "control_request") {
      const id = String(message.request_id ?? "");
      const number = Number(/^med-(\d+)$/.exec(id)?.[1] ?? 0);
      sequence = Math.max(sequence, number);
      expect(id, message.request ?? {});
    } else if (message.type === "control_response" && ask?.id === message.response?.request_id) {
      ask = undefined;
      store.set({ permission: undefined });
    }
  };
  /** The events of the holder with `token`. */
  const events = (token: object, done?: () => void): HeldEvents => {
    let errors = "";
    return {
      entry(entry, replay) {
        if (active !== token) return;
        replaying = replay;
        try {
          // A holder's log starts with its agent: what stopped earlier is past.
          if (entry.kind === "h") store.set({ halt: undefined });
          else if (entry.kind === "m" && replay) restore(JSON.parse(entry.text).checkpoint);
          else if (entry.kind === "o") onMessage(JSON.parse(entry.text));
          else if (entry.kind === "i" && replay) onSent(JSON.parse(entry.text));
          else if (entry.kind === "e") errors = `${errors}${entry.text}\n`.slice(-4000);
        } catch {
          /* Not a message. */
        } finally {
          replaying = false;
        }
      },
      live: () => done?.(),
      exit(exit) {
        done?.();
        if (active !== token) return;
        active = undefined;
        held = undefined;
        void forgetLog(options.holders, sessionId);
        for (const settle of pending.values()) settle({ error: "Claude Code stopped." });
        pending.clear();
        if (stopping) return;
        const before = store.get().status;
        clearTurn();
        // Med or the user stopped it, as `med agents stop` does: it resumes
        // with the next message. A holder that ended without a word, as in a
        // reboot, cut the turn that ran.
        if (exit.requested || exit.lost) {
          store.set({
            status: "idle",
            permission: undefined,
            streaming: undefined,
            ...(exit.lost && before === "working"
              ? {
                  halt: {
                    kind: "interrupted" as const,
                    detail: "The agent's process ended during the turn",
                  },
                }
              : {}),
          });
          return;
        }
        ended(
          exit.error ??
            (exit.signal
              ? `Stopped by ${exit.signal}`
              : exit.code
                ? `Exited with code ${exit.code}`
                : undefined),
          exit.errors || errors,
          before,
        );
      },
    };
  };

  const launch = () => {
    const args = [
      "-p",
      "--input-format",
      "stream-json",
      "--output-format",
      "stream-json",
      "--include-partial-messages",
      "--verbose",
      "--permission-prompt-tool",
      "stdio",
      ...(exists
        ? ["--resume", sessionId]
        : options.fork
          ? ["--resume", options.fork, "--fork-session", "--session-id", sessionId]
          : ["--session-id", sessionId]),
      ...(chosen.model !== "default" ? ["--model", chosen.model] : []),
      ...(chosen.effort !== "default" ? ["--effort", chosen.effort] : []),
      // A session that ran keeps its mode; a new one starts in the mode that
      // Med chose (Auto, or the thread's), else in the user's default.
      ...(chosen.mode !== "default" || exists ? ["--permission-mode", chosen.mode] : []),
      // Claude Code switches to Bypass only when it started with it allowed.
      ...(chosen.bypass || chosen.mode === BYPASS ? ["--allow-dangerously-skip-permissions"] : []),
    ];
    bypassable = !!chosen.bypass || chosen.mode === BYPASS;
    const token = {};
    active = token;
    held = startHeld(
      options.holders,
      {
        sessionId,
        kind: "claude",
        name: agent.name,
        command: agent.command,
        args: [...agent.args, ...args],
        cwd,
        env: agentEnvironment(options.env?.()),
      },
      events(token),
    );
    void control({ subtype: "initialize" }).catch((error: unknown) => {
      // The process ended; the exit says why.
      if (active === token)
        store.set({ error: error instanceof Error ? error.message : String(error) });
    });
  };
  /**
   * The process ended, and Med did not stop it. The session waits without a
   * process, as after a host restart, and its next prompt or Restart resumes
   * it. A turn that it cut, or an exit with an error, says why.
   */
  const ended = (reason: string | undefined, errors: string, before: OwnedState["status"]) => {
    const lines = lastLines(errors);
    store.set({
      status: "idle",
      permission: undefined,
      streaming: undefined,
      ...(reason || before !== "idle"
        ? {
            halt: {
              kind: "stopped",
              detail: reason ?? "Exited during the turn",
              ...(lines ? { lines } : {}),
              at: Date.now(),
            },
          }
        : {}),
    });
  };
  /** Starts a restored session's process, unless another one runs it. */
  const wake = async () => {
    await attached;
    if (held || stopping) return;
    if (await (options.elsewhere ?? runsElsewhere)(sessionId))
      throw new HostError(
        "session-busy",
        `Another ${agent.name} process runs this session, such as one in a terminal. End it, then send again.`,
        409,
      );
    if (!held && !stopping) launch();
  };
  if (options.resume) {
    store.set({ status: "idle", settings: settings(), halt: options.halt });
    // The models come from a probe; until then, only the mode shows.
    void Promise.resolve(options.models).then((offered) => {
      if (models.length || !offered?.length) return;
      models = offered;
      store.set({ settings: settings() });
    });
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
  } else launch();

  return {
    session,
    attached,
    state: store.get,
    dormant: () => !held,
    pid: () => held?.pid(),
    subscribe: store.subscribe,
    runsTools: () => tools.size > 0,
    async prompt(text, images = []) {
      if (store.get().status === "exited")
        throw new HostError("session-stopped", "This session has stopped.", 409);
      if (!held)
        await (waking ??= wake().finally(() => {
          waking = undefined;
        }));
      // Images go first, as Claude Code puts pasted images before the text.
      const content = images.length
        ? [
            ...images.map((image) => ({
              type: "image",
              source: { type: "base64", media_type: image.mimeType, data: image.data },
            })),
            ...(text ? [{ type: "text", text }] : []),
          ]
        : text;
      write({ type: "user", message: { role: "user", content } });
      exists = true;
      store.set({
        status: "working",
        turns: store.get().turns + 1,
        error: undefined,
        halt: undefined,
      });
    },
    answer(id, option, reply = {}) {
      if (!ask || ask.id !== id) return;
      const said = reply.message?.trim();
      let response: Record<string, unknown>;
      if (option === "deny")
        response = {
          behavior: "deny",
          message: ask.plan
            ? `The user wants to keep planning.${said ? ` They said: ${said}` : " Ask what to change."}`
            : ask.questions
              ? `The user chose not to answer.${said ? ` They said: ${said}` : ""}`
              : `The user denied this in Med.${said ? ` They said: ${said}` : ""}`,
        };
      else if (ask.questions) {
        // Claude Code reads each answer by its question's text.
        const answers: Record<string, string> = {};
        for (const { question } of ask.questions) {
          const answer = reply.answers?.[question]?.trim();
          if (answer) answers[question] = answer;
        }
        if (!Object.keys(answers).length)
          throw new HostError("no-answer", "Choose an answer first.", 400);
        response = {
          behavior: "allow",
          updatedInput: { ...(ask.input as object), answers },
        };
      } else if (ask.plan) {
        // Approving a plan sets the mode that the work continues in.
        const modes = planModes(bypassable).map((mode) => mode.value);
        const mode = reply.mode && modes.includes(reply.mode) ? reply.mode : modes[0]!;
        response = {
          behavior: "allow",
          updatedInput: ask.input,
          updatedPermissions: [{ type: "setMode", mode, destination: "session" }],
        };
      } else
        response = {
          behavior: "allow",
          updatedInput: ask.input,
          ...(option === "always" && ask.suggestions?.length
            ? { updatedPermissions: ask.suggestions }
            : {}),
        };
      write({
        type: "control_response",
        response: { subtype: "success", request_id: id, response },
      });
      ask = undefined;
      store.set({ permission: undefined });
    },
    interrupt() {
      if (held) void control({ subtype: "interrupt" }).catch(() => {});
    },
    async set(id, value) {
      const setting = store.get().settings.find((entry) => entry.id === id);
      if (!setting || !setting.options.some((option) => option.value === value))
        throw new HostError("invalid-setting", "The agent does not offer this choice.", 400);
      // Without a process, the choice waits for the next start.
      if (!held) {
        if (id === "model" || id === "effort" || id === "mode") chosen[id] = value;
        if (value === BYPASS) chosen.bypass = true;
      } else if (id === "model") {
        await control({ subtype: "set_model", ...(value === "default" ? {} : { model: value }) });
      } else if (id === "mode" && (value !== BYPASS || bypassable)) {
        await control({ subtype: "set_permission_mode", mode: value });
      } else if (id === "mode" || id === "effort") {
        // Claude Code takes the effort, and leave to bypass permissions, when
        // it starts, so it starts again, once the holder of the process
        // before has ended.
        if (store.get().status === "working")
          throw new HostError(
            "agent-busy",
            id === "mode"
              ? "Switch to Bypass permissions when the turn ends."
              : "Change the effort when the turn ends.",
            409,
          );
        chosen[id] = value;
        if (value === BYPASS) chosen.bypass = true;
        const previous = held;
        active = undefined;
        held = undefined;
        for (const settle of pending.values()) settle({ error: "Claude Code started again." });
        pending.clear();
        previous.stop();
        await holderEnded(options.holders, sessionId);
        if (!stopping) launch();
      }
      store.set({ settings: settings() });
    },
    async restart() {
      if (store.get().status === "exited")
        throw new HostError("session-stopped", "This session has stopped.", 409);
      if (held) return;
      await (waking ??= wake().finally(() => {
        waking = undefined;
      }));
      store.set({ status: "starting", halt: undefined, error: undefined });
    },
    dismiss() {
      store.set({ halt: undefined });
    },
    stop() {
      stopping = true;
      held?.stop();
      store.set({ status: "exited", permission: undefined, streaming: undefined, halt: undefined });
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

/** A session that stopped before the host restarted, such as an ACP session:
 * its thread stays readable, and a new session continues the work. */
function stoppedRunner(session: AgentSession, preset: string, name: string): OwnedRunner {
  const state: OwnedState = {
    sessionId: session.id,
    preset,
    name,
    status: "exited",
    settings: [],
    commands: [],
    turns: 0,
  };
  const stopped = () => {
    throw new HostError("session-stopped", "This session has stopped.", 409);
  };
  return {
    session,
    state: () => state,
    dormant: () => false,
    pid: () => undefined,
    subscribe: () => () => {},
    prompt: async () => stopped(),
    answer() {},
    interrupt() {},
    set: async () => stopped(),
    restart: async () => stopped(),
    dismiss() {},
    stop() {},
    release() {},
    detach() {},
  };
}

const configOptionSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  category: z.string().optional(),
  type: z.string().optional(),
  currentValue: z.unknown(),
  options: z.array(z.record(z.string(), z.unknown())).default([]),
});
type ConfigOption = z.infer<typeof configOptionSchema>;

/** ACP select options, with groups flattened. */
function flatOptions(options: Record<string, unknown>[]): OwnedSetting["options"] {
  return options.flatMap((option) =>
    Array.isArray(option.options)
      ? flatOptions(option.options as Record<string, unknown>[])
      : typeof option.value === "string"
        ? [
            {
              value: option.value,
              name: typeof option.name === "string" ? option.name : option.value,
              ...(typeof option.description === "string"
                ? { description: option.description }
                : {}),
            },
          ]
        : [],
  );
}
const CATEGORIES: Record<string, OwnedSetting["category"]> = {
  model: "model",
  thought_level: "effort",
  mode: "mode",
};
function configSettings(options: unknown): OwnedSetting[] {
  if (!Array.isArray(options)) return [];
  return options.flatMap((raw) => {
    const parsed = configOptionSchema.safeParse(raw);
    if (!parsed.success || (parsed.data.type && parsed.data.type !== "select")) return [];
    const option: ConfigOption = parsed.data;
    return [
      {
        id: option.id,
        name: option.name ?? option.id,
        category: CATEGORIES[option.category ?? ""] ?? "other",
        value: String(option.currentValue ?? ""),
        options: flatOptions(option.options),
      },
    ];
  });
}

/** A note in the thread for a turn that ended early or without a reply. */
function stopNotice(name: string, reason: string | undefined, answered: boolean) {
  const notice = (title: string, description?: string): SessionUpdate => ({
    sessionUpdate: "notice",
    title,
    severity: "warning",
    ...(description ? { description } : {}),
  });
  if (reason === "cancelled") return notice("Interrupted");
  if (reason === "refusal") return notice(`${name} refused the request`);
  if (reason === "max_tokens" || reason === "max_turn_requests")
    return notice(`${name} stopped at its limit`);
  if (!answered)
    return notice(
      `${name} ended the turn without a reply`,
      `Check that ${name} can use the chosen model: run it once in a terminal with that model.`,
    );
  return undefined;
}

/**
 * An agent through the Agent Client Protocol, such as `opencode acp`. Med is
 * the client: it creates a session in the review's repository, sends prompts,
 * answers permission requests, and keeps the session's updates, because an
 * ACP agent keeps no transcript that Med can read.
 *
 * A holder (holder.ts) keeps the agent's process. A host that attaches to it
 * after a restart reads its log for the session's state: the requests that
 * wait for answers and the agent's questions that wait for the reader.
 */
export function startAcp(
  agent: Pick<RunnableAgent, "id" | "name" | "command" | "args">,
  cwd: string,
  {
    holders,
    logDirectory,
    env,
    choices = {},
    onOffer,
    onAgentSession,
    attach,
  }: {
    /** The folder of the agents' holders and their logs. */
    holders: string;
    logDirectory?: string;
    env?: Record<string, string>;
    /** The model and effort to set, where the agent offers them. */
    choices?: AgentChoices;
    /** The settings of the new session, before Med sets its choices. */
    onOffer?(settings: OwnedSetting[]): void;
    /** The agent's own ID for the session. codex-acp gives Codex's thread
     * ID, which also names the session's rollout in ~/.codex/sessions. */
    onAgentSession?(id: string): void;
    /** A session from before the host restarted, whose holder runs, with
     * the updates that its thread has. */
    attach?: { sessionId: string; earlier: LoggedEvent[] };
  },
): OwnedRunner {
  const sessionId = attach?.sessionId ?? randomUUID();
  const session: AgentSession = { agent: "acp", name: agent.name, id: sessionId, cwd };
  const log = new SessionLog(
    logDirectory ? join(logDirectory, `${sessionId}.jsonl`) : undefined,
    attach?.earlier,
  );
  if (logDirectory) void mkdir(logDirectory, { recursive: true }).catch(() => {});
  const store = createState({
    sessionId,
    preset: agent.id,
    name: agent.name,
    status: "starting",
    settings: [],
    commands: [],
    turns: 0,
    capabilities: AGENT_CAPABILITIES.acp,
  });
  let acpSession: string | undefined;
  // Settings that came as older `models` and `modes`, not as config options.
  const legacy = new Set<string>();
  let answer: ((option: string | null) => void) | undefined;
  let stopping = false;
  // The prompt of the turn in progress, which some agents, such as OpenCode,
  // send back as a user update; and whether the agent answered it.
  let turn: { text: string; answered: boolean } | undefined;
  let held: HeldAgent | undefined;
  let active: object | undefined;
  let replaying = false;
  // The log entry that Med reads now: the thread's updates keep its number.
  let entryNumber: number | undefined;
  // New config options replace the old ones; settings from `models` and `modes` stay.
  const withConfig = (options: unknown) => [
    ...configSettings(options),
    ...store.get().settings.filter((setting) => legacy.has(setting.id)),
  ];
  const fail = (error: unknown) =>
    store.set({ error: error instanceof Error ? error.message : String(error) });
  const push = (update: SessionUpdate) => log.push(update, entryNumber);
  const rpc: JsonRpc = createJsonRpc(
    (line) => {
      if (!replaying) held?.write(line);
    },
    {
      async request(method, params) {
        if (method !== "session/request_permission")
          throw new RpcError(`Med does not offer ${method}.`, -32601);
        const { toolCall, options } = params as {
          toolCall?: { toolCallId?: string; title?: string; rawInput?: Record<string, unknown> };
          options?: {
            optionId: string;
            name: string;
            kind: OwnedPermission["options"][number]["kind"];
          }[];
        };
        const id = toolCall?.toolCallId ?? randomUUID();
        const detail = inputSummary(toolCall?.rawInput);
        const permission: OwnedPermission = {
          id,
          title: `${agent.name} wants to ${toolCall?.title ? `run ${toolCall.title}` : "use a tool"}`,
          ...(detail ? { detail } : {}),
          options: (options ?? []).map((option) => ({
            id: option.optionId,
            name: option.name,
            kind: option.kind,
          })),
        };
        const chosen = await new Promise<string | null>((resolve) => {
          answer = resolve;
          store.set({ permission });
        });
        answer = undefined;
        store.set({ permission: undefined });
        return {
          outcome: chosen ? { outcome: "selected", optionId: chosen } : { outcome: "cancelled" },
        };
      },
      notify(method, params) {
        if (method !== "session/update") return;
        const update = (params as { update?: Record<string, unknown> })?.update;
        if (!update || typeof update.sessionUpdate !== "string") return;
        switch (update.sessionUpdate) {
          case "available_commands_update":
            store.set({
              commands: (Array.isArray(update.availableCommands) ? update.availableCommands : [])
                .filter((command) => typeof command?.name === "string")
                .map((command: Record<string, any>) => ({
                  name: command.name,
                  description: String(command.description ?? ""),
                  ...(typeof command.input?.hint === "string" ? { hint: command.input.hint } : {}),
                })),
            });
            return;
          case "config_option_update":
            store.set({ settings: withConfig(update.configOptions) });
            return;
          case "current_mode_update":
            store.set({
              settings: store
                .get()
                .settings.map((setting) =>
                  setting.id === "mode"
                    ? { ...setting, value: String(update.currentModeId) }
                    : setting,
                ),
            });
            return;
          case "usage_update":
            if (
              typeof update.used === "number" &&
              typeof update.size === "number" &&
              update.size > 0
            )
              store.set({ context: { used: update.used, total: update.size } });
            push(update as SessionUpdate);
            return;
          case "user_message_chunk": {
            const content = update.content as { type?: string; text?: string } | undefined;
            // Med logged the prompt when it sent it.
            if (
              turn &&
              content?.type === "text" &&
              content.text &&
              turn.text.includes(content.text)
            )
              return;
            push(update as SessionUpdate);
            return;
          }
          default:
            if (
              turn &&
              ["agent_message_chunk", "agent_thought_chunk", "tool_call"].includes(
                update.sessionUpdate,
              )
            )
              turn.answered = true;
            push(update as SessionUpdate);
        }
      },
    },
  );

  // What each answer to Med's requests changes, live or read again.
  const settingValue = (id: string, value: string) =>
    store.set({
      settings: store
        .get()
        .settings.map((entry) => (entry.id === id ? { ...entry, value } : entry)),
    });
  const answered = (method: string, params: any, result: any, error?: RpcError) => {
    if (method === "session/prompt") {
      const current = turn;
      turn = undefined;
      if (error) fail(error);
      else {
        // An agent can end a turn without a word, as OpenCode does when its
        // model refuses the request; the thread says so.
        const notice = stopNotice(agent.name, result?.stopReason, current?.answered ?? true);
        if (notice) push(notice);
      }
      if (store.get().status !== "exited") store.set({ status: "idle" });
      if (!replaying)
        held?.checkpoint({
          state: kept(store.get()),
          acpSession,
          legacy: [...legacy],
          lastId: rpc.last(),
        });
      return;
    }
    if (error) return;
    if (method === "initialize") {
      if (result?.agentCapabilities?.promptCapabilities?.image === true)
        store.set({ images: true });
    } else if (method === "session/new") {
      acpSession = String(result.sessionId);
      onAgentSession?.(acpSession);
      const settings = configSettings(result.configOptions);
      const has = (category: string) => settings.some((setting) => setting.category === category);
      if (!has("model") && Array.isArray(result.models?.availableModels)) {
        legacy.add("model");
        settings.push({
          id: "model",
          name: "Model",
          category: "model",
          value: String(result.models.currentModelId ?? ""),
          options: result.models.availableModels.map((model: Record<string, any>) => ({
            value: String(model.modelId),
            name: String(model.name ?? model.modelId),
          })),
        });
      }
      if (!has("mode") && Array.isArray(result.modes?.availableModes)) {
        legacy.add("mode");
        settings.push({
          id: "mode",
          name: "Mode",
          category: "mode",
          value: String(result.modes.currentModeId ?? ""),
          options: result.modes.availableModes.map((mode: Record<string, any>) => ({
            value: String(mode.id),
            name: String(mode.name ?? mode.id),
            ...(mode.description ? { description: String(mode.description) } : {}),
          })),
        });
      }
      // A live start waits for Med's choices before it is idle; a log read
      // again is idle from here.
      store.set({
        settings,
        ...(replaying && store.get().status === "starting" ? { status: "idle" } : {}),
      });
    } else if (method === "session/set_config_option") {
      if (Array.isArray(result?.configOptions))
        store.set({ settings: withConfig(result.configOptions) });
      else settingValue(String(params?.configId), String(params?.value));
    } else if (method === "session/set_model") settingValue("model", String(params?.modelId));
    else if (method === "session/set_mode") settingValue("mode", String(params?.modeId));
  };
  // The answer counts as it arrives, with its log entry's number.
  const call = <T = any>(method: string, params: Record<string, unknown>) =>
    rpc.request<T>(method, params, (result, error) => answered(method, params, result, error));

  // Read again from the log: Med's requests that wait for answers, and the
  // agent's that wait for the reader.
  const sent = new Map<number, { method: string; params: any }>();
  const asked = new Map<number | string, { method: string; params: unknown }>();
  let lastId = 0;
  /** A line that Med wrote, live or read again. */
  const onSent = (line: string, replay: boolean) => {
    const message = parseRpc(line);
    if (!message) return;
    if (message.method === "session/prompt") {
      // The prompt goes to the thread with its log entry's number.
      const prompt = Array.isArray((message.params as any)?.prompt)
        ? ((message.params as any).prompt as Record<string, any>[])
        : [];
      for (const content of prompt)
        push({ sessionUpdate: "user_message_chunk", content } as SessionUpdate);
      if (replay) {
        turn = {
          text: prompt.map((block) => (typeof block.text === "string" ? block.text : "")).join(""),
          answered: false,
        };
        store.set({ status: "working", turns: store.get().turns + 1, error: undefined });
      }
    }
    if (!replay) return;
    if (message.method !== undefined && typeof message.id === "number") {
      sent.set(message.id, { method: message.method, params: message.params });
      lastId = Math.max(lastId, message.id);
    } else if (message.method === undefined && message.id !== undefined) asked.delete(message.id);
  };
  /** A line that the agent wrote, read again. */
  const onReplayed = (line: string) => {
    const message = parseRpc(line);
    if (!message) return;
    if (message.method !== undefined && message.id !== undefined)
      asked.set(message.id, { method: message.method, params: message.params });
    else if (message.method !== undefined) rpc.receive(line);
    else if (typeof message.id === "number") {
      const request = sent.get(message.id);
      if (!request) return;
      sent.delete(message.id);
      answered(
        request.method,
        request.params,
        message.result,
        message.error
          ? new RpcError(
              message.error.message ?? "The agent returned an error.",
              message.error.code ?? 0,
            )
          : undefined,
      );
    }
  };
  /** The state at a checkpoint, where a long log starts again. */
  const restore = (checkpoint: any) => {
    if (!checkpoint?.state) return;
    acpSession = checkpoint.acpSession;
    legacy.clear();
    for (const id of checkpoint.legacy ?? []) legacy.add(id);
    lastId = Math.max(lastId, Number(checkpoint.lastId) || 0);
    sent.clear();
    asked.clear();
    turn = undefined;
    store.set({ ...checkpoint.state, permission: undefined });
  };
  let errors = "";
  let ready: Promise<void>;
  const events = (token: object, done: () => void): HeldEvents => ({
    entry(entry, replay) {
      if (active !== token) return;
      replaying = replay;
      entryNumber = entry.n;
      try {
        if (entry.kind === "h") log.begin(JSON.parse(entry.text).generation);
        else if (entry.kind === "m" && replay) restore(JSON.parse(entry.text).checkpoint);
        else if (entry.kind === "o" && replay) onReplayed(entry.text);
        else if (entry.kind === "o") rpc.receive(entry.text);
        else if (entry.kind === "i") onSent(entry.text, replay);
        else if (entry.kind === "e") errors = `${errors}${entry.text}\n`.slice(-4000);
      } catch {
        /* Not a message. */
      } finally {
        replaying = false;
        entryNumber = undefined;
      }
    },
    live() {
      if (active !== token) return done();
      // Med's requests that wait go on waiting; the agent's get answers.
      rpc.resume(
        new Map(
          [...sent].map(([id, { method, params }]) => [
            id,
            (result: unknown, error?: RpcError) => answered(method, params, result, error),
          ]),
        ),
        asked,
        lastId,
      );
      sent.clear();
      asked.clear();
      done();
    },
    exit(exit) {
      done();
      if (active !== token) return;
      active = undefined;
      held = undefined;
      void forgetLog(holders, sessionId);
      rpc.close(`${agent.name} stopped.`);
      answer?.(null);
      if (stopping) return;
      store.set({
        status: "exited",
        permission: undefined,
        ...(exit.error
          ? { error: exit.error }
          : (exit.code || exit.signal) && !exit.requested
            ? {
                error:
                  lastLines(exit.errors || errors) ||
                  `${agent.name} stopped with ${exit.signal ?? `code ${exit.code}`}.`,
              }
            : {}),
      });
    },
  });

  const token = {};
  active = token;
  if (attach) {
    ready = new Promise<void>((done) => {
      void attachHeld(holders, sessionId, events(token, done)).then(
        (found) => {
          if (!found) {
            active = undefined;
            store.set({ status: "exited" });
            done();
          } else if (active === token) held = found;
        },
        (error: unknown) => {
          active = undefined;
          fail(error);
          store.set({ status: "exited" });
          done();
        },
      );
    });
  } else {
    held = startHeld(
      holders,
      {
        sessionId,
        kind: "acp",
        name: agent.name,
        command: agent.command,
        args: agent.args,
        cwd,
        env: agentEnvironment(env),
      },
      events(token, () => {}),
    );
    ready = (async () => {
      await call("initialize", {
        protocolVersion: 1,
        clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
        clientInfo: { name: "Med", version: "0.1" },
      });
      await call("session/new", { cwd, mcpServers: [] });
      const settings = store.get().settings;
      onOffer?.(settings);
      for (const category of ["model", "effort"] as const) {
        const wanted = choices[category];
        const setting = settings.find((entry) => entry.category === category);
        if (wanted && setting && setting.value !== wanted)
          await change(setting.id, wanted).catch(() => {});
      }
      if (store.get().status === "starting") store.set({ status: "idle" });
    })();
    ready.catch((error) => {
      fail(error);
      if (!stopping) store.set({ status: "exited" });
    });
  }

  return {
    session,
    log,
    attached: ready.catch(() => {}),
    state: store.get,
    dormant: () => false,
    pid: () => held?.pid(),
    subscribe: store.subscribe,
    async prompt(text, images = []) {
      await ready;
      if (store.get().status === "exited")
        throw new HostError("session-stopped", "This session has stopped.", 409);
      if (images.length && !store.get().images)
        throw new HostError("images-unsupported", `${agent.name} does not take images.`, 400);
      const prompt = [
        ...images.map((image) => ({ type: "image" as const, ...image })),
        ...(text ? [{ type: "text" as const, text }] : []),
      ];
      store.set({ status: "working", turns: store.get().turns + 1, error: undefined });
      turn = { text, answered: false };
      call("session/prompt", { sessionId: acpSession, prompt }).catch(() => {});
    },
    answer(_id, option) {
      answer?.(option);
    },
    interrupt() {
      if (!acpSession) return;
      rpc.notify("session/cancel", { sessionId: acpSession });
      answer?.(null);
    },
    async set(id, value) {
      await ready;
      await change(id, value);
    },
    // Med starts an ACP agent's session again only through `session/load`,
    // which comes with ACP resume.
    async restart() {
      throw new HostError(
        "session-stopped",
        `${agent.name} cannot resume this session. Start a new one.`,
        409,
      );
    },
    dismiss() {
      store.set({ halt: undefined });
    },
    stop() {
      stopping = true;
      answer?.(null);
      held?.stop();
      store.set({ status: "exited", permission: undefined });
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
  async function change(id: string, value: string) {
    const setting = store.get().settings.find((entry) => entry.id === id);
    if (!setting || !setting.options.some((option) => option.value === value))
      throw new HostError("invalid-setting", "The agent does not offer this choice.", 400);
    try {
      if (legacy.has(id))
        await call(id === "model" ? "session/set_model" : "session/set_mode", {
          sessionId: acpSession,
          ...(id === "model" ? { modelId: value } : { modeId: value }),
        });
      else
        await call("session/set_config_option", {
          sessionId: acpSession,
          configId: id,
          value,
        });
    } catch (error) {
      throw new HostError(
        "agent-error",
        error instanceof Error ? error.message : String(error),
        502,
      );
    }
  }
}

async function executable(path: string) {
  try {
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}
/** The first `name` on PATH or in the usual install folders. */
async function findExecutable(name: string, folders: string[], env = process.env) {
  for (const folder of [...(env.PATH ?? "").split(delimiter), ...folders]) {
    if (!folder) continue;
    const path = join(folder, name);
    if (await executable(path)) return path;
  }
  return undefined;
}

const customAgentsSchema = z.array(
  z.object({
    id: z.string().regex(/^[a-z0-9-]{1,40}$/),
    name: z.string().min(1).max(80),
    command: z.string().min(1),
    args: z.array(z.string()).default([]),
  }),
);

/**
 * The agents Med can start: Claude Code, the ACP agents it knows, and the
 * ones in `agents.json` in Med's state directory. Med starts only installed
 * binaries and never installs one.
 */
export async function findAgents(stateDir?: string, home = userHome()): Promise<RunnableAgent[]> {
  const known = [
    {
      id: "claude",
      name: "Claude Code",
      kind: "claude" as const,
      binary: "claude",
      args: [],
      folders: [join(home, ".local", "bin"), join(home, ".claude", "local")],
    },
    {
      id: "opencode",
      name: "OpenCode",
      kind: "acp" as const,
      binary: "opencode",
      args: ["acp"],
      folders: [join(home, ".opencode", "bin")],
    },
    // Codex's own CLI runs its app-server; Codex Desktop ships one inside
    // the ChatGPT app. MED_CODEX_PATH names another.
    {
      id: "codex",
      name: "Codex",
      kind: "codex" as const,
      binary: "codex",
      args: [],
      folders: [
        ...(process.env.MED_CODEX_PATH ? [dirname(process.env.MED_CODEX_PATH)] : []),
        "/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin",
        "/opt/homebrew/bin",
      ],
    },
    {
      id: "agy",
      name: "Antigravity",
      kind: "agy" as const,
      binary: "agy",
      args: [],
      folders: [join(home, ".local", "bin")],
    },
    {
      id: "gemini",
      name: "Gemini CLI",
      kind: "acp" as const,
      binary: "gemini",
      args: ["--experimental-acp"],
      folders: ["/opt/homebrew/bin"],
    },
  ];
  const found: RunnableAgent[] = await Promise.all(
    known.map(async ({ binary, folders, ...agent }) => {
      const command = await findExecutable(binary, folders, {
        ...process.env,
        ...shellEnvironment(),
      });
      return {
        ...agent,
        command: command ?? binary,
        available: !!command,
        capabilities: AGENT_CAPABILITIES[agent.kind],
      };
    }),
  );
  if (stateDir) {
    try {
      const custom = customAgentsSchema.parse(
        JSON.parse(await readFile(join(stateDir, "agents.json"), "utf8")),
      );
      for (const agent of custom)
        found.push({
          ...agent,
          kind: "acp",
          available: await executable(agent.command),
          capabilities: AGENT_CAPABILITIES.acp,
        });
    } catch {
      /* No custom agents. */
    }
  }
  return found;
}

/** What Med keeps of a session that it started, so that the session
 * continues after the host restarts. */
const recordSchema = z.object({
  preset: z.string(),
  kind: z.enum(["claude", "acp", "codex", "agy"]),
  /** The key of a Codex thread's holder, when it is not the thread's ID. */
  holder: z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,128}$/)
    .optional(),
  name: z.string(),
  cwd: z.string(),
  /** The thread's key, for the agent's environment. */
  key: z.string().optional(),
  choices: z.object({ model: z.string(), effort: z.string(), mode: z.string() }).partial(),
  /** The user stopped it. */
  stopped: z.boolean().optional(),
  /** An agent's own ID for the session: an ACP agent's, or agy's conversation. */
  agentSessionId: z.string().max(200).optional(),
  /** A fork (Continue in Med) before its first prompt: the session it starts from. */
  forkOf: z.string().max(128).optional(),
  /** A turn that has not ended. After a restart, it is a turn that the
   * restart cut, which waits for the reader to continue it. */
  turn: z.object({ startedAt: z.number() }).optional(),
  updatedAt: z.number(),
});
type SessionRecord = z.infer<typeof recordSchema>;
/** Records kept at most; the oldest go first. */
const MAX_RECORDS = 200;
/** How long a host that starts waits for the sessions' holders' logs. */
const ATTACH_MS = 3000;
/** How long an agent outlives its closed tab, so a tab that closed by
 * mistake comes back with it. Tests set `MED_AGENT_RELEASE_MS`. */
const releaseMs = () => Number(process.env.MED_AGENT_RELEASE_MS ?? 60_000);

/** The model, effort, and mode that a session's settings show now. */
function chosenSettings(state: OwnedState): SessionRecord["choices"] {
  const chosen: SessionRecord["choices"] = {};
  for (const setting of state.settings)
    if (
      setting.category === "model" ||
      setting.category === "effort" ||
      setting.category === "mode"
    )
      chosen[setting.category] = setting.value;
  return chosen;
}

/** The sessions that this Med host started, by session ID. */
export class OwnedSessions {
  private runners = new Map<string, OwnedRunner>();
  private updated = new Map<string, number>();
  /** Claude Code's models, asked once per host. */
  private claudeModels = new Map<string, Promise<ClaudeModel[]>>();
  /** Codex's and agy's models, asked once per host. */
  private codexModels = new Map<string, Promise<CodexModel[]>>();
  private agyModels = new Map<string, Promise<{ id: string; name: string }[]>>();
  /** What each ACP agent offered in its last new session. */
  private offered: Promise<Record<string, OwnedSetting[]>> | undefined;
  private records: Record<string, SessionRecord> = {};
  private writing: Promise<void> = Promise.resolve();
  /** The host closes: the turns that it cuts stay recorded. */
  private closing = false;
  /** The sessions whose threads' tabs are closed, with when they closed. */
  private closedTabs = new Map<string, number>();
  private releaseTimer: ReturnType<typeof setTimeout> | undefined;
  /** The Claude Code processes that Med does not run (session-processes.ts). */
  private processes: SessionProcesses;
  constructor(
    private options: {
      agents: () => Promise<RunnableAgent[]>;
      /** Where the agents' holders keep their files (holder.ts). */
      holderDirectory: string;
      /** Where ACP sessions keep their updates. */
      logDirectory?: string;
      /** Where Med keeps what each ACP agent offered, for the next new session. */
      offersFile?: string;
      /** Where Med keeps the sessions it started, for after a restart. */
      recordsFile?: string;
      /** The variables of an agent in a thread with `key`, working in `cwd`. */
      environment?: (key: string | undefined, cwd: string) => Record<string, string>;
      /** The home directory whose `.claude/sessions` Claude Code writes. */
      home?: () => string;
      /** Antigravity (`agy`), which is off until the user turns it on
       * (`MED_AGY=1`, docs/AGENT_WORKSPACES.md#antigravity-is-off). */
      agy?: boolean;
    },
  ) {
    this.processes = createSessionProcesses({
      ...(options.home ? { home: options.home } : {}),
      ownPids: () => this.pids(),
    });
  }
  /** The processes of the agents that Med runs now. */
  private pids() {
    return [...this.runners.values()].flatMap((runner) => runner.pid() ?? []);
  }
  /**
   * The Claude Code sessions of `ids` that another process runs, such as
   * `claude` in a terminal, with where each is open. `maxAgeMs` accepts an
   * answer of that age.
   */
  elsewhere(ids: readonly string[], maxAgeMs = 0) {
    return this.processes.elsewhere(ids, maxAgeMs);
  }
  async runsElsewhere(sessionId: string) {
    return (await this.processes.elsewhere([sessionId])).has(sessionId);
  }
  /** Whether a process that Med does not run has a Codex thread or an agy
   * conversation open (agent-locks.ts). */
  async lockedElsewhere(agent: "codex" | "agy", id: string) {
    const folder = lockFolders(this.options.home?.())[agent];
    const own = new Set(this.pids());
    return (await heldLocks(folder)).get(id)?.some((pid) => !own.has(pid)) ?? false;
  }
  /**
   * The agent sessions that run on this computer now: Med's that work on a
   * turn, and the Claude Code, Codex, and agy sessions that other processes
   * have open (session-processes.ts, agent-locks.ts).
   */
  async running() {
    const home = this.options.home?.() ?? userHome();
    const own = new Set(this.pids());
    const folders = lockFolders(home);
    const [claude, codex, agy] = await Promise.all([
      this.processes.running(),
      heldLocks(folders.codex),
      this.agy ? heldLocks(folders.agy) : new Map<string, number[]>(),
    ]);
    const outside = (held: Map<string, number[]>) =>
      [...held].flatMap(([id, pids]) => {
        const pid = pids.find((entry) => !own.has(entry));
        return pid ? [{ id, pid }] : [];
      });
    return {
      med: [...this.runners.values()]
        .filter((runner) => runner.state().status === "working" && !runner.dormant())
        .map((runner) => ({
          session: runner.session,
          kind: this.records[runner.session.id]?.kind ?? "acp",
          name: runner.state().name,
        })),
      claude,
      codex: outside(codex),
      agy: await Promise.all(
        outside(agy).map(async ({ id, pid }) => {
          const [cwd, title] = await Promise.all([processCwd(pid), agyTitle(home, id)]);
          return { id, pid, ...(cwd && { cwd }), ...(title && { title }) };
        }),
      ),
    };
  }
  /** Whether Med offers Antigravity. */
  get agy() {
    return !!this.options.agy;
  }
  /** The agents that Med offers: agy only when it is on. */
  private async offeredAgents() {
    return (await this.options.agents()).filter((agent) => agent.kind !== "agy" || this.agy);
  }
  async agents(): Promise<AgentPreset[]> {
    return (await this.offeredAgents()).map(({ id, name, kind, available, capabilities }) => ({
      id,
      name,
      kind,
      available,
      capabilities: capabilities ?? AGENT_CAPABILITIES[kind],
    }));
  }
  private async agent(presetId: string) {
    const agent = (await this.offeredAgents()).find((entry) => entry.id === presetId);
    if (!agent?.available)
      throw new HostError("agent-unavailable", "This agent is not installed here.", 404);
    return agent;
  }
  private models(agent: RunnableAgent) {
    let models = this.claudeModels.get(agent.id);
    if (!models) this.claudeModels.set(agent.id, (models = probeClaude(agent)));
    return models;
  }
  private codexOffers(agent: RunnableAgent) {
    let models = this.codexModels.get(agent.id);
    if (!models) this.codexModels.set(agent.id, (models = probeCodex(agent)));
    return models;
  }
  private agyOffers(agent: RunnableAgent) {
    let models = this.agyModels.get(agent.id);
    if (!models) this.agyModels.set(agent.id, (models = probeAgy(agent)));
    return models;
  }
  private offers() {
    const file = this.options.offersFile;
    this.offered ??= (file ? readFile(file, "utf8") : Promise.reject(new Error("No file.")))
      .then((text) => z.record(z.string(), z.array(ownedSettingSchema)).parse(JSON.parse(text)))
      .catch(() => ({}));
    return this.offered;
  }
  private async remember(presetId: string, settings: OwnedSetting[]) {
    const offers = await this.offers();
    offers[presetId] = settings.filter(
      (setting) => setting.category === "model" || setting.category === "effort",
    );
    if (this.options.offersFile)
      await writeStateFile(this.options.offersFile, JSON.stringify(offers)).catch(() => {});
  }
  /**
   * The models and efforts that an agent offers, valued with the choices for
   * a new session. An ACP agent tells them only in a session, so Med shows
   * what it offered in the last one.
   */
  async choices(presetId: string): Promise<AgentOptions> {
    const agent = await this.agent(presetId);
    const wanted = AGENT_DEFAULTS[presetId] ?? {};
    if (agent.kind === "claude") {
      const models = await this.models(agent);
      if (!models.length) return {};
      const chosen = claudeChoices(models, wanted);
      const levels = [...new Set(models.flatMap((entry) => entry.supportedEffortLevels ?? []))];
      return {
        model: {
          id: "model",
          name: "Model",
          category: "model",
          value: chosen.model,
          options: models.map(modelOption),
        },
        ...(levels.length
          ? {
              effort: {
                id: "effort",
                name: "Effort",
                category: "effort" as const,
                value: chosen.effort,
                options: effortOptions(levels),
              },
              efforts: Object.fromEntries(
                models.map((entry) => [entry.value, entry.supportedEffortLevels ?? []]),
              ),
            }
          : {}),
      };
    }
    if (agent.kind === "codex") {
      const models = await this.codexOffers(agent);
      if (!models.length) return {};
      const model =
        models.find((entry) => entry.id === wanted.model) ??
        models.find((entry) => entry.isDefault);
      const levels = [...new Set(models.flatMap((entry) => entry.efforts))];
      return {
        model: {
          id: "model",
          name: "Model",
          category: "model",
          value: model?.id ?? models[0]!.id,
          options: models.map((entry) => ({
            value: entry.id,
            name: entry.name,
            ...(entry.description ? { description: entry.description } : {}),
          })),
        },
        ...(levels.length
          ? {
              effort: {
                id: "effort",
                name: "Effort",
                category: "effort" as const,
                value: wanted.effort && levels.includes(wanted.effort) ? wanted.effort : "default",
                options: effortOptions(levels),
              },
              efforts: Object.fromEntries(models.map((entry) => [entry.id, entry.efforts])),
            }
          : {}),
      };
    }
    if (agent.kind === "agy") {
      const models = await this.agyOffers(agent);
      if (!models.length) return {};
      return {
        model: {
          id: "model",
          name: "Model",
          category: "model",
          value: models.some((entry) => entry.id === wanted.model) ? wanted.model! : "default",
          options: [
            { value: "default", name: "agy's default" },
            ...models.map((entry) => ({ value: entry.id, name: entry.name })),
          ],
        },
      };
    }
    const settings = (await this.offers())[presetId] ?? [];
    const pick = (category: "model" | "effort") => {
      const setting = settings.find((entry) => entry.category === category);
      if (!setting) return {};
      const value = wanted[category];
      return {
        [category]: setting.options.some((option) => option.value === value)
          ? { ...setting, value: value! }
          : setting,
      };
    };
    return { ...pick("model"), ...pick("effort") };
  }
  private environment(key: string | undefined, cwd: string) {
    return this.options.environment?.(key, cwd) ?? {};
  }
  /**
   * Starts an agent in `cwd`, for the thread with `key`, and the chosen model
   * and effort, or Med's defaults, where the agent offers them.
   */
  async start(
    presetId: string,
    cwd: string,
    {
      key,
      choices,
      conversation,
    }: {
      key?: string;
      choices?: AgentChoices;
      /** An agy conversation that Med continues, with its history. */
      conversation?: string;
    } = {},
  ): Promise<OwnedRunner> {
    const agent = await this.agent(presetId);
    // A thread keeps the mode that it last chose for Claude Code.
    const kept = agent.kind === "claude" && key ? this.threadMode(key) : undefined;
    const wanted = { ...AGENT_DEFAULTS[presetId], ...(kept && { mode: kept }), ...choices };
    if (agent.kind === "codex") {
      const holder = randomUUID();
      const runner = startCodex(agent, cwd, {
        holders: this.options.holderDirectory,
        holder,
        env: () => this.environment(key, cwd),
        choices: wanted,
        models: this.codexOffers(agent),
        elsewhere: (id) => this.lockedElsewhere("codex", id),
        onHolder: (holder) => this.noteHolder(runner.session.id, holder),
      });
      // Codex names the thread: the runner has its ID once it started.
      await runner.attached;
      this.track(runner, {
        preset: presetId,
        kind: "codex",
        name: agent.name,
        cwd,
        ...(key ? { key } : {}),
        holder,
        choices: {},
        updatedAt: Date.now(),
      });
      return runner;
    }
    if (agent.kind === "agy") {
      const runner = startAgy(agent, cwd, {
        holders: this.options.holderDirectory,
        ...(this.options.logDirectory ? { logDirectory: this.options.logDirectory } : {}),
        env: () => this.environment(key, cwd),
        choices: wanted,
        models: this.agyOffers(agent),
        onConversation: (id) => this.noteAgentSession(runner.session.id, id),
        elsewhere: (id) => this.lockedElsewhere("agy", id),
        ...(this.options.home ? { home: this.options.home } : {}),
        ...(conversation && {
          conversation,
          history: await agyHistory(this.options.home?.() ?? userHome(), conversation),
        }),
      });
      this.track(runner, {
        preset: presetId,
        kind: "agy",
        name: agent.name,
        cwd,
        ...(key ? { key } : {}),
        ...(conversation ? { agentSessionId: conversation } : {}),
        choices: {},
        updatedAt: Date.now(),
      });
      return runner;
    }
    const runner =
      agent.kind === "claude"
        ? startClaude(agent, cwd, {
            holders: this.options.holderDirectory,
            env: () => this.environment(key, cwd),
            choices: wanted,
            models: await this.models(agent),
            elsewhere: (id) => this.runsElsewhere(id),
          })
        : startAcp(agent, cwd, {
            holders: this.options.holderDirectory,
            ...(this.options.logDirectory ? { logDirectory: this.options.logDirectory } : {}),
            env: this.environment(key, cwd),
            choices: wanted,
            onOffer: (settings) => void this.remember(presetId, settings),
            onAgentSession: (id) => this.noteAgentSession(runner.session.id, id),
          });
    this.track(runner, {
      preset: presetId,
      kind: agent.kind,
      name: agent.name,
      cwd,
      ...(key ? { key } : {}),
      choices: {},
      updatedAt: Date.now(),
    });
    return runner;
  }
  /** The permission mode of the thread's newest Claude Code session. */
  private threadMode(key: string) {
    let newest: SessionRecord | undefined;
    for (const record of Object.values(this.records))
      if (
        record.key === key &&
        record.kind === "claude" &&
        record.choices.mode &&
        (!newest || record.updatedAt > newest.updatedAt)
      )
        newest = record;
    return newest?.choices.mode;
  }
  /** Claude Code, as installed here, to run a session that Med did not start. */
  private async claude(cwd: string) {
    const agent = (await this.options.agents()).find(
      (entry) => entry.kind === "claude" && entry.available,
    );
    if (!agent) throw new HostError("agent-unavailable", "Claude Code is not installed here.", 409);
    if (!existsSync(cwd))
      throw new HostError(
        "session-folder-gone",
        `The session's folder ${cwd} no longer exists, so Claude Code cannot resume it.`,
        409,
      );
    return agent;
  }
  /**
   * Runs a Claude Code session that Med did not start, such as an adopted one
   * that no process runs now. It waits without a process, and its next prompt
   * starts `claude --resume`. Med keeps its record, as for the sessions that
   * it starts, so it resumes after a restart too.
   */
  async resume(session: AgentSession, { key }: { key?: string } = {}): Promise<OwnedRunner> {
    const current = this.runners.get(session.id);
    if (current) return current;
    if (session.agent === "codex") return this.resumeCodex(session, key);
    const agent = await this.claude(session.cwd);
    const runner = startClaude(agent, session.cwd, {
      holders: this.options.holderDirectory,
      sessionId: session.id,
      env: () => this.environment(key, session.cwd),
      resume: {},
      models: this.models(agent),
      elsewhere: (id) => this.runsElsewhere(id),
    });
    this.track(runner, {
      preset: agent.id,
      kind: "claude",
      name: agent.name,
      cwd: session.cwd,
      ...(key ? { key } : {}),
      choices: {},
      updatedAt: Date.now(),
    });
    return runner;
  }
  /** A Codex thread that Med did not start, such as an adopted one: its
   * next prompt starts Codex's app-server and resumes the thread. */
  private async resumeCodex(session: AgentSession, key: string | undefined) {
    const agent = (await this.options.agents()).find(
      (entry) => entry.kind === "codex" && entry.available,
    );
    if (!agent) throw new HostError("agent-unavailable", "Codex is not installed here.", 409);
    if (!existsSync(session.cwd))
      throw new HostError(
        "session-folder-gone",
        `The session's folder ${session.cwd} no longer exists, so Codex cannot resume it.`,
        409,
      );
    const runner = this.codexRunner(agent, session.cwd, session.id, key, {});
    this.track(runner, {
      preset: agent.id,
      kind: "codex",
      name: agent.name,
      cwd: session.cwd,
      ...(key ? { key } : {}),
      choices: {},
      updatedAt: Date.now(),
    });
    return runner;
  }
  private codexRunner(
    agent: RunnableAgent,
    cwd: string,
    thread: string,
    key: string | undefined,
    extra: Partial<Parameters<typeof startCodex>[2]>,
  ) {
    return startCodex(agent, cwd, {
      holders: this.options.holderDirectory,
      thread,
      env: () => this.environment(key, cwd),
      models: this.codexOffers(agent),
      elsewhere: (id) => this.lockedElsewhere("codex", id),
      onHolder: (holder) => this.noteHolder(thread, holder),
      ...extra,
    });
  }
  /** The key of a Codex thread's holder changed to the thread's own. */
  private noteHolder(sessionId: string, holder: string) {
    const record = this.records[sessionId];
    if (!record || record.holder === holder) return;
    const { holder: _old, ...rest } = record;
    this.records[sessionId] = holder === sessionId ? rest : { ...rest, holder };
    this.save();
  }
  /**
   * Continue in Med: a new Claude Code session that starts from `session`'s
   * history (`--resume <id> --fork-session --session-id <new ID>`), while
   * another process keeps the original. The fork is a session of the thread,
   * not a question's fork.
   */
  async fork(session: AgentSession, { key }: { key?: string } = {}): Promise<OwnedRunner> {
    const agent = await this.claude(session.cwd);
    const runner = startClaude(agent, session.cwd, {
      holders: this.options.holderDirectory,
      fork: session.id,
      env: () => this.environment(key, session.cwd),
      models: await this.models(agent),
      elsewhere: (id) => this.runsElsewhere(id),
    });
    this.track(runner, {
      preset: agent.id,
      kind: "claude",
      name: agent.name,
      cwd: session.cwd,
      ...(key ? { key } : {}),
      choices: {},
      forkOf: session.id,
      updatedAt: Date.now(),
    });
    return runner;
  }
  /**
   * Brings back the sessions that this host started before it restarted. A
   * session whose holder runs goes on: Med reads the holder's log and follows
   * the agent. A holder that ended left its log, which says how the agent
   * ended. Without either, a Claude Code session waits without a process and
   * resumes with its next prompt; other sessions show as stopped, with their
   * threads.
   */
  async restore() {
    const file = this.options.recordsFile;
    if (!file) return;
    // Each record on its own: one that Med cannot read costs only itself.
    const records = await readRecords(file, (id, value) =>
      /^[A-Za-z0-9_-]{1,128}$/.test(id) ? recordSchema.safeParse(value).data : undefined,
    ).catch(() => undefined);
    if (!records) return;
    this.records = records;
    const agents = await this.options.agents();
    const holders = this.options.holderDirectory;
    const runners: OwnedRunner[] = [];
    for (const [id, record] of Object.entries(this.records)) {
      if (this.runners.has(id)) continue;
      const agent = agents.find((entry) => entry.id === record.preset);
      const session: AgentSession = {
        agent: record.kind === "agy" ? "acp" : record.kind,
        ...(record.kind === "acp" || record.kind === "agy" ? { name: record.name } : {}),
        id,
        cwd: record.cwd,
      };
      let runner: OwnedRunner;
      if (record.stopped) runner = stoppedRunner(session, record.preset, record.name);
      else if (record.kind === "claude" && agent?.kind === "claude" && agent.available)
        runner = startClaude(agent, record.cwd, {
          holders,
          sessionId: id,
          env: () => this.environment(record.key, record.cwd),
          resume: record.choices,
          attach: true,
          ...(record.forkOf ? { fork: record.forkOf } : {}),
          ...(record.turn
            ? {
                halt: { kind: "interrupted" as const, detail: "Med restarted during the turn" },
              }
            : {}),
          models: this.models(agent),
          elsewhere: (session) => this.runsElsewhere(session),
        });
      else if (record.kind === "codex" && agent?.kind === "codex" && agent.available) {
        const attach = !!(await readHolder(holders, record.holder ?? id));
        runner = this.codexRunner(agent, record.cwd, id, record.key, {
          ...(record.holder ? { holder: record.holder } : {}),
          choices: record.choices,
          attach,
          ...(record.turn && !attach
            ? { halt: { kind: "interrupted" as const, detail: "Med restarted during the turn" } }
            : {}),
        });
      } else if (record.kind === "agy" && agent?.kind === "agy" && agent.available && this.agy) {
        const attach = !!(await readHolder(holders, id));
        runner = startAgy(agent, record.cwd, {
          holders,
          sessionId: id,
          ...(this.options.logDirectory ? { logDirectory: this.options.logDirectory } : {}),
          ...(record.agentSessionId ? { conversation: record.agentSessionId } : {}),
          env: () => this.environment(record.key, record.cwd),
          choices: record.choices,
          models: this.agyOffers(agent),
          onConversation: (conversation) => this.noteAgentSession(id, conversation),
          elsewhere: (conversation) => this.lockedElsewhere("agy", conversation),
          ...(attach
            ? {
                attach: {
                  earlier: this.options.logDirectory
                    ? await SessionLog.read(join(this.options.logDirectory, `${id}.jsonl`))
                    : [],
                },
              }
            : {}),
          ...(this.options.home ? { home: this.options.home } : {}),
        });
      } else if (record.kind === "acp" && (await readHolder(holders, id)))
        runner = startAcp(
          { id: record.preset, name: record.name, command: "", args: [] },
          record.cwd,
          {
            holders,
            ...(this.options.logDirectory ? { logDirectory: this.options.logDirectory } : {}),
            attach: {
              sessionId: id,
              earlier: this.options.logDirectory
                ? await SessionLog.read(join(this.options.logDirectory, `${id}.jsonl`))
                : [],
            },
            onAgentSession: (agentSessionId) => this.noteAgentSession(id, agentSessionId),
          },
        );
      else runner = stoppedRunner(session, record.preset, record.name);
      this.track(runner, record, false);
      runners.push(runner);
    }
    // The page shows each session as its log left it, not as it was first.
    await Promise.race([
      Promise.all(runners.map((runner) => runner.attached)),
      new Promise((done) => setTimeout(done, ATTACH_MS)),
    ]);
  }
  /** Keeps a runner, and its record up to date with its choices. */
  private track(runner: OwnedRunner, record: SessionRecord, save = true) {
    const id = runner.session.id;
    this.runners.set(id, runner);
    this.updated.set(id, Date.now());
    this.records[id] = record;
    if (save) this.save();
    runner.subscribe(() => {
      this.updated.set(id, Date.now());
      if (this.closedTabs.has(id)) this.releaseIdle();
      const current = this.records[id];
      if (!current || this.closing) return;
      const state = runner.state();
      const choices = { ...current.choices, ...chosenSettings(state) };
      // A fork's first prompt makes its transcript: it resumes as itself.
      const forked = !!current.forkOf && state.turns > 0;
      // A turn stays recorded until it ends, or until the reader acts on the
      // work that stopped.
      const turn =
        state.status === "working"
          ? (current.turn ?? { startedAt: Date.now() })
          : state.halt
            ? current.turn
            : undefined;
      if (
        !forked &&
        JSON.stringify(choices) === JSON.stringify(current.choices) &&
        turn === current.turn
      )
        return;
      const { forkOf, turn: _turn, ...rest } = current;
      this.records[id] = {
        ...rest,
        ...(forkOf && !forked ? { forkOf } : {}),
        ...(turn ? { turn } : {}),
        choices,
        updatedAt: Date.now(),
      };
      this.save();
    });
    runner.log?.subscribe(() => this.updated.set(id, Date.now()));
  }
  private save() {
    const file = this.options.recordsFile;
    if (!file) return;
    const kept = Object.entries(this.records)
      .sort(([, a], [, b]) => b.updatedAt - a.updatedAt)
      .slice(0, MAX_RECORDS);
    this.records = Object.fromEntries(kept);
    const text = JSON.stringify(this.records);
    this.writing = this.writing.then(() => writeStateFile(file, text)).catch(() => {});
  }
  private noteAgentSession(sessionId: string, agentSessionId: string) {
    const record = this.records[sessionId];
    if (!record || record.agentSessionId === agentSessionId) return;
    this.records[sessionId] = { ...record, agentSessionId };
    this.save();
  }
  /**
   * The ACP sessions that Med started, as the agent's own session ID and
   * Med's ID. A Codex session through codex-acp also writes a rollout with
   * the agent's ID, which the found sessions must not list again.
   */
  agentSessions(): [string, string][] {
    return Object.entries(this.records).flatMap(([id, record]) =>
      record.agentSessionId ? [[record.agentSessionId, id] as [string, string]] : [],
    );
  }
  /** What Med keeps of a session that it started: its agent, its model and
   * effort, and an ACP agent's own ID for it. */
  recorded(sessionId: string) {
    const record = this.records[sessionId];
    return (
      record && {
        preset: record.preset,
        choices: record.choices,
        ...(record.agentSessionId ? { agentSessionId: record.agentSessionId } : {}),
      }
    );
  }
  /** Stops a session for the user: it stays stopped after a restart. */
  end(runner: OwnedRunner) {
    runner.stop();
    const record = this.records[runner.session.id];
    if (!record || record.stopped) return;
    this.records[runner.session.id] = { ...record, stopped: true, updatedAt: Date.now() };
    this.save();
  }
  get(sessionId: string) {
    return this.runners.get(sessionId);
  }
  /** When the session's state or updates last changed. */
  updatedAt(sessionId: string) {
    return this.updated.get(sessionId);
  }
  /** An ACP session's updates, from its runner or from its log file. */
  async events(sessionId: string): Promise<SessionEvent[]> {
    const runner = this.runners.get(sessionId);
    if (runner?.log) return runner.log.events;
    if (!this.options.logDirectory || !/^[A-Za-z0-9_-]+$/.test(sessionId)) return [];
    return (await SessionLog.read(join(this.options.logDirectory, `${sessionId}.jsonl`))).map(
      ({ held: _held, ...event }) => event,
    );
  }
  /** Sessions that still run, or wait to resume, in a folder or below it. */
  within(folder: string) {
    return [...this.runners.values()].filter((runner) => {
      const inside = relative(folder, runner.session.cwd);
      return runner.state().status !== "exited" && !inside.startsWith("..") && !isAbsolute(inside);
    });
  }
  /**
   * An agent lives as long as its thread's tab. `closed` names the sessions
   * whose tabs are closed, with when each closed; an agent among them stops
   * once it is idle and its tab has stayed closed for a minute. A turn ends
   * first, and a question waits for its answer.
   */
  release(closed: Map<string, number>) {
    this.closedTabs = closed;
    this.releaseIdle();
  }
  private releaseIdle() {
    clearTimeout(this.releaseTimer);
    if (this.closing) return;
    const now = Date.now();
    let next = Infinity;
    for (const [id, at] of this.closedTabs) {
      const runner = this.runners.get(id);
      if (!runner || runner.pid() === undefined || runner.state().status !== "idle") continue;
      const due = at + releaseMs();
      if (due <= now) runner.release();
      else next = Math.min(next, due);
    }
    if (next < Infinity)
      this.releaseTimer = setTimeout(() => this.releaseIdle(), next - now).unref();
  }
  /** The host closes: the agents keep working in their holders, and the
   * next host attaches to them. */
  async detachAll() {
    this.closing = true;
    clearTimeout(this.releaseTimer);
    for (const runner of this.runners.values()) runner.detach();
    await this.writing;
  }
}
