import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { access, appendFile, mkdir, readFile } from "node:fs/promises";
import { delimiter, join } from "node:path";
import { createInterface } from "node:readline";
import { z } from "zod";
import type { SessionEvent, SessionUpdate } from "../shared/agent-session";
import type {
  AgentPreset,
  OwnedCommand,
  OwnedPermission,
  OwnedSetting,
  OwnedState,
} from "../shared/owned-session";
import type { AgentSession } from "../shared/saved-review";
import { compactUpdate } from "./agent-transcripts";
import { createJsonRpc, RpcError, type JsonRpc } from "./json-rpc";
import { HostError } from "./runtime/errors";
import { userHome } from "./service/discover";

/** An installed agent with the command that starts it. */
export interface RunnableAgent extends AgentPreset {
  command: string;
  args: string[];
}

/** A session that Med started. Its process belongs to the Med host. */
export interface OwnedRunner {
  readonly session: AgentSession;
  state(): OwnedState;
  /** Updates that Med keeps for an ACP session; Claude Code writes a transcript. */
  readonly log?: SessionLog;
  prompt(text: string): Promise<void>;
  answer(id: string, option: string): void;
  interrupt(): void;
  set(id: string, value: string): Promise<void>;
  stop(): void;
  subscribe(listener: () => void): () => void;
}

/** Updates kept at most per session, in memory and on disk. */
const MAX_EVENTS = 5000;
/** A streaming reply sends its state at most this often. */
const STREAM_MS = 80;

/** An ACP session's updates, kept in memory and appended to a file, so the
 * thread stays readable after the agent or the host stops. */
export class SessionLog {
  readonly events: SessionEvent[] = [];
  private listeners = new Set<(events: SessionEvent[]) => void>();
  private writing: Promise<void> = Promise.resolve();
  constructor(private path?: string) {}
  push(update: SessionUpdate) {
    const event = { at: Date.now(), update: compactUpdate(update) };
    this.events.push(event);
    if (this.events.length > MAX_EVENTS) this.events.splice(0, this.events.length - MAX_EVENTS);
    const path = this.path;
    if (path)
      this.writing = this.writing
        .then(() => appendFile(path, `${JSON.stringify(event)}\n`))
        .catch(() => {});
    for (const listener of this.listeners) listener([event]);
  }
  subscribe(listener: (events: SessionEvent[]) => void) {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }
  /** The updates of a session whose agent no longer runs. */
  static async read(path: string): Promise<SessionEvent[]> {
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
          return [JSON.parse(line) as SessionEvent];
        } catch {
          return [];
        }
      });
  }
}

// Variables that tie a process to the Claude Code session that started Med.
const SESSION_VARIABLES = [
  "CLAUDECODE",
  "CLAUDE_CODE_ENTRYPOINT",
  "CLAUDE_CODE_SESSION_ID",
  "CLAUDE_CODE_MESSAGING_SOCKET",
  "CLAUDE_CODE_SSE_PORT",
];
function agentEnvironment() {
  const env = { ...process.env };
  for (const name of SESSION_VARIABLES) delete env[name];
  return env;
}

/** Listeners and a state that changes in place. */
function createState(initial: OwnedState) {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set(change: Partial<OwnedState>) {
      state = { ...state, ...change };
      for (const listener of listeners) listener();
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}

const lastLines = (text: string) => text.trim().split("\n").slice(-3).join("\n").slice(-600);

/** A short line for a tool call's input: its command, path, or URL. */
function inputSummary(input: Record<string, unknown> | undefined) {
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
];

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

/**
 * Claude Code through `stream-json`. Med starts the binary that the user
 * installed and signed in to, and answers its control requests: permission
 * prompts go to the review, and Med sends interrupts and model changes. The
 * session writes its transcript as usual, which the thread reads.
 */
export function startClaude(
  agent: RunnableAgent,
  cwd: string,
  options: { sessionId?: string } = {},
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
  });
  let child: ChildProcessWithoutNullStreams;
  let stopping = false;
  let sequence = 0;
  const pending = new Map<string, (response: { error?: string; value?: unknown }) => void>();
  let ask: { id: string; input: unknown; suggestions?: unknown[] } | undefined;
  let models: z.infer<typeof claudeInitSchema>["models"] = [];
  let chosen = { model: "default", effort: "default", mode: "default" };
  let streamTimer: ReturnType<typeof setTimeout> | undefined;
  let streaming: OwnedState["streaming"];

  const write = (message: object) => {
    if (child.stdin.writable) child.stdin.write(`${JSON.stringify(message)}\n`);
  };
  const control = (request: object) =>
    new Promise<unknown>((resolve, reject) => {
      const id = `med-${++sequence}`;
      pending.set(id, ({ error, value }) =>
        error ? reject(new HostError("agent-error", error, 502)) : resolve(value),
      );
      write({ type: "control_request", request_id: id, request });
    });
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
              options: models.map((entry) => ({
                value: entry.value,
                name: entry.displayName ?? entry.value,
                ...(entry.description ? { description: entry.description } : {}),
              })),
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
              options: [
                { value: "default", name: "Default effort" },
                ...efforts.map((level) => ({ value: level, name: capitalized(level) })),
              ],
              idleOnly: true,
            },
          ]
        : []),
      {
        id: "mode",
        name: "Mode",
        category: "mode" as const,
        value: CLAUDE_MODES.some((entry) => entry.value === chosen.mode) ? chosen.mode : "default",
        options: CLAUDE_MODES,
      },
    ];
  };
  const flushStreaming = () => {
    streamTimer = undefined;
    store.set({ streaming });
  };

  const onMessage = (message: Record<string, any>) => {
    switch (message.type) {
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
        ask = { id: message.request_id, input: request.input, suggestions };
        const name = String(request.display_name ?? request.tool_name ?? "A tool");
        const detail = inputSummary(request.input) ?? request.description;
        const permission: OwnedPermission = {
          id: message.request_id,
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
        store.set({ permission });
        return;
      }
      case "control_cancel_request":
        if (ask?.id === message.request_id) {
          ask = undefined;
          store.set({ permission: undefined });
        }
        return;
      case "system":
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
        clearTimeout(streamTimer);
        streamTimer = undefined;
        streaming = undefined;
        store.set({
          status: "idle",
          streaming: undefined,
          permission: undefined,
          ...(message.is_error && message.subtype !== "error_during_execution"
            ? { error: String(message.result ?? "The turn failed.") }
            : { error: undefined }),
        });
        ask = undefined;
        void control({ subtype: "get_context_usage" })
          .then((value) => {
            const { totalTokens, maxTokens } = (value ?? {}) as Record<string, unknown>;
            if (typeof totalTokens === "number" && typeof maxTokens === "number" && maxTokens > 0)
              store.set({ context: { used: totalTokens, total: maxTokens } });
          })
          .catch(() => {});
        return;
      }
    }
  };

  const launch = (resume: boolean) => {
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
      ...(resume ? ["--resume", sessionId] : ["--session-id", sessionId]),
      ...(chosen.model !== "default" ? ["--model", chosen.model] : []),
      ...(chosen.effort !== "default" ? ["--effort", chosen.effort] : []),
      ...(chosen.mode !== "default" ? ["--permission-mode", chosen.mode] : []),
    ];
    const current = spawn(agent.command, [...agent.args, ...args], {
      cwd,
      env: agentEnvironment(),
      stdio: ["pipe", "pipe", "pipe"],
    });
    child = current;
    let errors = "";
    current.stderr.on("data", (data: Buffer) => {
      errors = (errors + data.toString()).slice(-4000);
    });
    // A process that a restart replaced has nothing more to say.
    current.on("error", (error) => {
      if (current === child) store.set({ status: "exited", error: error.message });
    });
    current.on("exit", (code) => {
      if (current !== child) return;
      for (const done of pending.values()) done({ error: "Claude Code stopped." });
      pending.clear();
      if (stopping) return;
      store.set({
        status: "exited",
        permission: undefined,
        streaming: undefined,
        ...(code ? { error: lastLines(errors) || `Claude Code stopped with code ${code}.` } : {}),
      });
    });
    createInterface({ input: current.stdout, crlfDelay: Infinity }).on("line", (line) => {
      if (current !== child) return;
      try {
        onMessage(JSON.parse(line));
      } catch {
        /* Not a message. */
      }
    });
    void control({ subtype: "initialize" })
      .then((value) => {
        // The reply also names the signed-in account; Med keeps none of it.
        const parsed = claudeInitSchema.safeParse(value);
        if (!parsed.success) return;
        models = parsed.data.models;
        if (parsed.data.current_permission_mode && !resume)
          chosen.mode = parsed.data.current_permission_mode;
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
      })
      .catch((error: unknown) =>
        store.set({ error: error instanceof Error ? error.message : String(error) }),
      );
  };
  launch(false);

  return {
    session,
    state: store.get,
    subscribe: store.subscribe,
    async prompt(text) {
      if (store.get().status === "exited")
        throw new HostError("session-stopped", "This session has stopped.", 409);
      write({ type: "user", message: { role: "user", content: text } });
      store.set({ status: "working", turns: store.get().turns + 1, error: undefined });
    },
    answer(id, option) {
      if (!ask || ask.id !== id) return;
      const response =
        option === "deny"
          ? { behavior: "deny", message: "The user denied this in Med." }
          : {
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
      void control({ subtype: "interrupt" }).catch(() => {});
    },
    async set(id, value) {
      const setting = store.get().settings.find((entry) => entry.id === id);
      if (!setting || !setting.options.some((option) => option.value === value))
        throw new HostError("invalid-setting", "The agent does not offer this choice.", 400);
      if (id === "model") {
        await control({ subtype: "set_model", ...(value === "default" ? {} : { model: value }) });
        chosen.model = value;
      } else if (id === "mode") {
        await control({ subtype: "set_permission_mode", mode: value });
        chosen.mode = value;
      } else if (id === "effort") {
        // Claude Code takes the effort when it starts, so it starts again.
        if (store.get().status === "working")
          throw new HostError("agent-busy", "Change the effort when the turn ends.", 409);
        chosen.effort = value;
        const previous = child;
        for (const done of pending.values()) done({ error: "Claude Code started again." });
        pending.clear();
        launch(store.get().turns > 0);
        previous.kill("SIGTERM");
      }
      store.set({ settings: settings() });
    },
    stop() {
      stopping = true;
      child.kill("SIGTERM");
      store.set({ status: "exited", permission: undefined, streaming: undefined });
    },
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

/**
 * An agent through the Agent Client Protocol, such as `opencode acp`. Med is
 * the client: it creates a session in the review's repository, sends prompts,
 * answers permission requests, and keeps the session's updates, because an
 * ACP agent keeps no transcript that Med can read.
 */
export function startAcp(agent: RunnableAgent, cwd: string, logDirectory?: string): OwnedRunner {
  const sessionId = randomUUID();
  const session: AgentSession = { agent: "acp", name: agent.name, id: sessionId, cwd };
  const log = new SessionLog(logDirectory ? join(logDirectory, `${sessionId}.jsonl`) : undefined);
  if (logDirectory) void mkdir(logDirectory, { recursive: true }).catch(() => {});
  const store = createState({
    sessionId,
    preset: agent.id,
    name: agent.name,
    status: "starting",
    settings: [],
    commands: [],
    turns: 0,
  });
  let acpSession: string | undefined;
  // Settings that came as older `models` and `modes`, not as config options.
  const legacy = new Set<string>();
  let answer: ((option: string | null) => void) | undefined;
  let stopping = false;
  // New config options replace the old ones; settings from `models` and `modes` stay.
  const withConfig = (options: unknown) => [
    ...configSettings(options),
    ...store.get().settings.filter((setting) => legacy.has(setting.id)),
  ];
  const child = spawn(agent.command, agent.args, {
    cwd,
    env: agentEnvironment(),
    stdio: ["pipe", "pipe", "pipe"],
  });
  let errors = "";
  child.stderr.on("data", (data: Buffer) => {
    errors = (errors + data.toString()).slice(-4000);
  });
  const fail = (error: unknown) =>
    store.set({ error: error instanceof Error ? error.message : String(error) });
  const rpc: JsonRpc = createJsonRpc(child.stdin, child.stdout, {
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
          if (typeof update.used === "number" && typeof update.size === "number" && update.size > 0)
            store.set({ context: { used: update.used, total: update.size } });
          log.push(update as SessionUpdate);
          return;
        default:
          log.push(update as SessionUpdate);
      }
    },
  });
  child.on("error", (error) => store.set({ status: "exited", error: error.message }));
  child.on("exit", (code) => {
    rpc.close(`${agent.name} stopped.`);
    answer?.(null);
    if (stopping) return;
    store.set({
      status: "exited",
      permission: undefined,
      ...(code ? { error: lastLines(errors) || `${agent.name} stopped with code ${code}.` } : {}),
    });
  });

  const ready = (async () => {
    await rpc.request("initialize", {
      protocolVersion: 1,
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
      clientInfo: { name: "Med", version: "0.1" },
    });
    const created = await rpc.request<Record<string, any>>("session/new", { cwd, mcpServers: [] });
    acpSession = String(created.sessionId);
    const settings = configSettings(created.configOptions);
    const has = (category: string) => settings.some((setting) => setting.category === category);
    if (!has("model") && Array.isArray(created.models?.availableModels)) {
      legacy.add("model");
      settings.push({
        id: "model",
        name: "Model",
        category: "model",
        value: String(created.models.currentModelId ?? ""),
        options: created.models.availableModels.map((model: Record<string, any>) => ({
          value: String(model.modelId),
          name: String(model.name ?? model.modelId),
        })),
      });
    }
    if (!has("mode") && Array.isArray(created.modes?.availableModes)) {
      legacy.add("mode");
      settings.push({
        id: "mode",
        name: "Mode",
        category: "mode",
        value: String(created.modes.currentModeId ?? ""),
        options: created.modes.availableModes.map((mode: Record<string, any>) => ({
          value: String(mode.id),
          name: String(mode.name ?? mode.id),
          ...(mode.description ? { description: String(mode.description) } : {}),
        })),
      });
    }
    store.set({ status: "idle", settings });
  })();
  ready.catch((error) => {
    fail(error);
    if (!stopping) store.set({ status: "exited" });
  });

  return {
    session,
    log,
    state: store.get,
    subscribe: store.subscribe,
    async prompt(text) {
      await ready;
      if (store.get().status === "exited")
        throw new HostError("session-stopped", "This session has stopped.", 409);
      log.push({ sessionUpdate: "user_message_chunk", content: { type: "text", text } });
      store.set({ status: "working", turns: store.get().turns + 1, error: undefined });
      rpc
        .request<{ stopReason?: string }>("session/prompt", {
          sessionId: acpSession,
          prompt: [{ type: "text", text }],
        })
        .then(
          () => store.set({ status: "idle" }),
          (error: unknown) => {
            fail(error);
            if (store.get().status !== "exited") store.set({ status: "idle" });
          },
        );
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
      const setting = store.get().settings.find((entry) => entry.id === id);
      if (!setting || !setting.options.some((option) => option.value === value))
        throw new HostError("invalid-setting", "The agent does not offer this choice.", 400);
      try {
        if (legacy.has(id))
          await rpc.request(id === "model" ? "session/set_model" : "session/set_mode", {
            sessionId: acpSession,
            ...(id === "model" ? { modelId: value } : { modeId: value }),
          });
        else {
          const result = await rpc.request<Record<string, unknown>>("session/set_config_option", {
            sessionId: acpSession,
            configId: id,
            value,
          });
          if (Array.isArray(result?.configOptions)) {
            store.set({ settings: withConfig(result.configOptions) });
            return;
          }
        }
      } catch (error) {
        throw new HostError(
          "agent-error",
          error instanceof Error ? error.message : String(error),
          502,
        );
      }
      store.set({
        settings: store
          .get()
          .settings.map((entry) => (entry.id === id ? { ...entry, value } : entry)),
      });
    },
    stop() {
      stopping = true;
      answer?.(null);
      child.kill("SIGTERM");
      store.set({ status: "exited", permission: undefined });
    },
  };
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
    {
      id: "codex",
      name: "Codex",
      kind: "acp" as const,
      binary: "codex-acp",
      args: [],
      folders: [],
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
      const command = await findExecutable(binary, folders);
      return { ...agent, command: command ?? binary, available: !!command };
    }),
  );
  if (stateDir) {
    try {
      const custom = customAgentsSchema.parse(
        JSON.parse(await readFile(join(stateDir, "agents.json"), "utf8")),
      );
      for (const agent of custom)
        found.push({ ...agent, kind: "acp", available: await executable(agent.command) });
    } catch {
      /* No custom agents. */
    }
  }
  return found;
}

/** The sessions that this Med host started, by session ID. */
export class OwnedSessions {
  private runners = new Map<string, OwnedRunner>();
  private updated = new Map<string, number>();
  constructor(
    private options: {
      agents: () => Promise<RunnableAgent[]>;
      /** Where ACP sessions keep their updates. */
      logDirectory?: string;
    },
  ) {}
  async agents(): Promise<AgentPreset[]> {
    return (await this.options.agents()).map(({ id, name, kind, available }) => ({
      id,
      name,
      kind,
      available,
    }));
  }
  async start(presetId: string, cwd: string): Promise<OwnedRunner> {
    const agent = (await this.options.agents()).find((entry) => entry.id === presetId);
    if (!agent?.available)
      throw new HostError("agent-unavailable", "This agent is not installed here.", 404);
    const runner =
      agent.kind === "claude"
        ? startClaude(agent, cwd)
        : startAcp(agent, cwd, this.options.logDirectory);
    const id = runner.session.id;
    this.runners.set(id, runner);
    this.updated.set(id, Date.now());
    runner.subscribe(() => this.updated.set(id, Date.now()));
    runner.log?.subscribe(() => this.updated.set(id, Date.now()));
    return runner;
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
    return SessionLog.read(join(this.options.logDirectory, `${sessionId}.jsonl`));
  }
  stopAll() {
    for (const runner of this.runners.values())
      if (runner.state().status !== "exited") runner.stop();
  }
}
