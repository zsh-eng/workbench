// Pi, the coding agent (`pi`), as an Agent Client Protocol agent: the bridge
// that `med __pi` runs (pi-acp.ts). Med runs its agents over ACP; Pi speaks an RPC of its own
// (`pi --mode rpc`, docs/rpc.md in Pi's package), so this bridge starts Pi in
// the session's folder and translates between the two:
//
// - ACP's sessions are Pi's sessions, by Pi's session ID. `session/resume`
//   starts Pi again on the session's file, which Pi writes once its model
//   answers, so a session goes on after Med or the Mac restarts.
// - Pi's models and thinking levels are the session's config options.
// - Pi's streamed text, thinking and tool calls are session updates, and
//   `session/cancel` is Pi's abort.
// - Each request's tokens are a `token_usage` update, Med's own, for the
//   thread's spend; the context comes after each turn. `/compact` is Pi's
//   compaction, which Med also sends past its autocompact setting.
// - Pi runs its tools without asking. An extension's dialog that asks yes or
//   no, or to pick one of a few, is a permission card in Med.
//
// Pi's RPC is JSON Lines split on \n alone: a JSON string may hold U+2028,
// which a line reader such as Node's readline would split on.

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { readdirSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, relative } from "node:path";
import { createJsonRpc, RpcError } from "./json-rpc.ts";

interface PiModel {
  id: string;
  name?: string;
  provider: string;
  reasoning?: boolean;
  input?: string[];
  contextWindow?: number;
  /** Newer Pi: each level's setting for this model; null for one it lacks. */
  thinkingLevelMap?: Record<string, unknown>;
}
interface PiState {
  model?: PiModel | null;
  thinkingLevel?: string;
  sessionId?: string;
  sessionFile?: string;
  isStreaming?: boolean;
}
type Json = Record<string, any>;

/** Pi's thinking levels; a model that does not reason has only "off". */
export const LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
export const LEVEL_NAMES: Record<string, string> = {
  off: "Off",
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra high",
  max: "Max",
};
/**
 * The levels a model takes. A newer Pi maps them per model, and lists Extra
 * high and Max only where the model has them; Pi 0.67 has no map, and gives
 * Extra high to the GPT-5.2 to 5.4 models and Opus 4.6 and 4.7 alone.
 */
export function piLevels(model: PiModel | null | undefined) {
  if (!model?.reasoning) return ["off"];
  const map = model.thinkingLevelMap;
  if (map && typeof map === "object")
    return LEVELS.filter((level) =>
      level === "xhigh" || level === "max" ? map[level] != null : map[level] !== null,
    );
  const xhigh = /gpt-5\.[234]|opus-4[.-][67]/.test(model.id);
  return LEVELS.filter((level) => level !== "max" && (xhigh || level !== "xhigh"));
}

/** Providers by the names their makers use; others read from their IDs. */
const PROVIDERS: Record<string, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  "openai-codex": "ChatGPT",
  "azure-openai-responses": "Azure OpenAI",
  google: "Google",
  "google-gemini-cli": "Gemini CLI",
  "google-antigravity": "Antigravity",
  "google-vertex": "Vertex AI",
  "amazon-bedrock": "Amazon Bedrock",
  "github-copilot": "GitHub Copilot",
  openrouter: "OpenRouter",
  "vercel-ai-gateway": "Vercel AI Gateway",
  xai: "xAI",
  groq: "Groq",
  cerebras: "Cerebras",
  mistral: "Mistral",
  zai: "Z.ai",
  minimax: "MiniMax",
  huggingface: "Hugging Face",
};
export const providerName = (id: string) =>
  PROVIDERS[id] ??
  id
    .split(/[-_]/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");

/** A model's value in Med: Pi's `provider/id`, as `--model` takes it. */
export const modelValue = (model: PiModel) => `${model.provider}/${model.id}`;

/** Pi's models and thinking levels as ACP config options, grouped by provider. */
export function configOptions(models: PiModel[], state: PiState) {
  const providers = [...new Set(models.map((model) => model.provider))];
  const current = state.model ? modelValue(state.model) : "";
  return [
    {
      id: "model",
      name: "Model",
      category: "model",
      type: "select",
      currentValue: current,
      options: providers.map((provider) => ({
        group: provider,
        name: providerName(provider),
        options: models
          .filter((model) => model.provider === provider)
          .map((model) => ({ value: modelValue(model), name: model.name ?? model.id })),
      })),
    },
    {
      id: "thought_level",
      name: "Thinking",
      category: "thought_level",
      type: "select",
      currentValue: state.thinkingLevel ?? "off",
      options: piLevels(state.model).map((level) => ({ value: level, name: LEVEL_NAMES[level] })),
    },
  ];
}

/** Where Pi keeps its sessions: ~/.pi/agent/sessions, or under PI_CODING_AGENT_DIR. */
const sessionsRoot = (env: NodeJS.ProcessEnv) =>
  join(env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent"), "sessions");
/** Pi's folder for a working directory's sessions, as Pi names it. */
const sessionFolder = (env: NodeJS.ProcessEnv, cwd: string) =>
  join(sessionsRoot(env), `--${cwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`);

/**
 * The file of a session, by its ID: Pi names each `<time>_<id>.jsonl`. A
 * session whose model has not answered has no file; Pi then starts a new
 * session at the same name, so the next restart finds it.
 */
export function sessionFile(env: NodeJS.ProcessEnv, cwd: string, id: string) {
  const suffix = `_${id}.jsonl`;
  const folders = [sessionFolder(env, cwd)];
  try {
    for (const entry of readdirSync(sessionsRoot(env), { withFileTypes: true }))
      if (entry.isDirectory()) folders.push(join(sessionsRoot(env), entry.name));
  } catch {
    /* No sessions yet. */
  }
  for (const folder of folders) {
    try {
      const name = readdirSync(folder).find((file) => file.endsWith(suffix));
      if (name) return join(folder, name);
    } catch {
      /* Not a folder. */
    }
  }
  return join(
    sessionFolder(env, cwd),
    `${new Date().toISOString().replace(/[:.]/g, "-")}${suffix}`,
  );
}

/**
 * An assistant message's tokens, as Med's `token_usage` update: one request,
 * for the thread's spend. Pi's input leaves out cache reads and writes. Pi
 * counts cache writes only for Anthropic's models, in the 5-minute cache
 * unless PI_CACHE_RETENTION is "long"; for OpenAI's it counts them as input.
 * None for a request without tokens, such as one that failed.
 */
export function requestTokens(message: Json, env: NodeJS.ProcessEnv = process.env) {
  const usage = message.usage as Json | undefined;
  const count = (value: unknown) => (typeof value === "number" && value > 0 ? value : 0);
  const tokens = {
    input: count(usage?.input),
    output: count(usage?.output),
    cacheRead: count(usage?.cacheRead),
    cacheWrite: count(usage?.cacheWrite),
  };
  if (!tokens.input && !tokens.output && !tokens.cacheRead && !tokens.cacheWrite) return undefined;
  const cost = count(usage?.cost?.total);
  return {
    sessionUpdate: "token_usage",
    ...(typeof message.model === "string" ? { model: message.model } : {}),
    ...tokens,
    ...(tokens.cacheWrite && message.provider === "anthropic" && env.PI_CACHE_RETENTION === "long"
      ? { cacheWriteHour: true }
      : {}),
    ...(cost ? { cost } : {}),
  };
}

/** A tool call's title and kind, as Med shows ACP tool calls. */
export function toolCall(name: string, args: Json, cwd: string) {
  const path = typeof args.path === "string" ? args.path : undefined;
  const shown = path && isAbsolute(path) ? relative(cwd, path) || "." : path;
  const absolute = path ? (isAbsolute(path) ? path : join(cwd, path)) : undefined;
  const locations = absolute ? [{ path: absolute }] : [];
  switch (name) {
    case "bash":
      return { title: String(args.command ?? "bash"), kind: "execute", locations };
    case "read":
      return { title: `Read ${shown ?? ""}`.trim(), kind: "read", locations };
    case "edit":
      return { title: `Edit ${shown ?? ""}`.trim(), kind: "edit", locations };
    case "write":
      return { title: `Write ${shown ?? ""}`.trim(), kind: "edit", locations };
    case "grep":
      return { title: `Search ${String(args.pattern ?? "")}`.trim(), kind: "search", locations };
    case "find":
      return { title: `Find ${String(args.pattern ?? "")}`.trim(), kind: "search", locations };
    case "ls":
      return { title: `List ${shown ?? "."}`, kind: "read", locations };
    default:
      return { title: name, kind: "other", locations };
  }
}

/** The diff that an edit or a write makes, from its arguments. */
function diffOf(name: string, args: Json, cwd: string) {
  const path = typeof args.path === "string" ? args.path : undefined;
  if (!path) return [];
  const absolute = isAbsolute(path) ? path : join(cwd, path);
  if (name === "edit" && typeof args.newText === "string")
    return [
      {
        type: "diff",
        path: absolute,
        oldText: typeof args.oldText === "string" ? args.oldText : null,
        newText: args.newText,
      },
    ];
  if (name === "write" && typeof args.content === "string")
    return [{ type: "diff", path: absolute, oldText: null, newText: args.content }];
  return [];
}

/** The text of a tool's result. */
const resultText = (result: Json | undefined) =>
  (Array.isArray(result?.content) ? result.content : [])
    .map((part: Json) => (part?.type === "text" && typeof part.text === "string" ? part.text : ""))
    .filter(Boolean)
    .join("\n");

/** One Pi process: its commands, answered by ID, and its events. */
class Pi {
  private readonly child: ChildProcessWithoutNullStreams;
  private next = 0;
  private readonly waiting = new Map<
    string,
    { command: string; resolve(data: any): void; reject(error: Error): void }
  >();
  private errors = "";
  readonly exited: Promise<string>;

  constructor(
    command: string[],
    cwd: string,
    onEvent: (event: Json) => void,
    env: NodeJS.ProcessEnv = process.env,
  ) {
    // Its own process group, so that a stop ends the commands it runs too.
    this.child = spawn(command[0]!, command.slice(1), {
      cwd,
      env,
      stdio: ["pipe", "pipe", "pipe"],
      detached: true,
    });
    this.child.stderr.on("data", (chunk) => {
      this.errors = `${this.errors}${chunk}`.slice(-2000);
    });
    let buffer = "";
    this.child.stdout.setEncoding("utf8");
    this.child.stdout.on("data", (chunk: string) => {
      buffer += chunk;
      let end: number;
      while ((end = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, end).replace(/\r$/, "");
        buffer = buffer.slice(end + 1);
        if (!line.trim()) continue;
        let message: Json;
        try {
          message = JSON.parse(line);
        } catch {
          continue;
        }
        if (message.type === "response") {
          // A response may come without its ID, as a prompt's can: it
          // answers the oldest command of its name.
          const id =
            typeof message.id === "string" && this.waiting.has(message.id)
              ? message.id
              : [...this.waiting].find(([, entry]) => entry.command === message.command)?.[0];
          if (id === undefined) continue;
          const entry = this.waiting.get(id);
          this.waiting.delete(id);
          if (message.success) entry?.resolve(message.data);
          else entry?.reject(new Error(String(message.error ?? `Pi refused ${message.command}.`)));
        } else onEvent(message);
      }
    });
    this.exited = new Promise((done) => {
      const end = () => {
        const reason = this.errors.trim().split("\n").at(-1) || "Pi ended.";
        for (const entry of this.waiting.values()) entry.reject(new Error(reason));
        this.waiting.clear();
        done(reason);
      };
      this.child.on("exit", end);
      this.child.on("error", (error) => {
        this.errors += error.message;
        end();
      });
    });
  }

  command<T = any>(type: string, fields: Json = {}): Promise<T> {
    const id = `med-${++this.next}`;
    return new Promise<T>((resolve, reject) => {
      this.waiting.set(id, { command: type, resolve, reject });
      this.child.stdin.write(`${JSON.stringify({ id, type, ...fields })}\n`);
    });
  }

  /** An answer to an extension's dialog, which has no command ID of its own. */
  answer(fields: Json) {
    this.child.stdin.write(`${JSON.stringify({ type: "extension_ui_response", ...fields })}\n`);
  }

  /** Pi cleans up on SIGTERM, not when its input ends; a second later, the
   * group is killed. */
  stop() {
    const group = (signal: NodeJS.Signals) => {
      try {
        process.kill(-this.child.pid!, signal);
      } catch {
        /* Ended. */
      }
    };
    group("SIGTERM");
    setTimeout(() => group("SIGKILL"), 1000).unref();
  }
}

/**
 * Pi's models, and the model and level it starts with, from a Pi that opens
 * no session and stays offline: nothing reaches a model, and a sign-in that
 * Pi would refresh at startup is not cut off when it stops.
 */
export async function probePi(pi: string[], env: NodeJS.ProcessEnv, cwd: string) {
  const probe = new Pi([...pi, "--mode", "rpc", "--no-session", "--offline"], cwd, () => {}, env);
  try {
    const [listed, state] = await Promise.race([
      Promise.all([
        probe.command<{ models?: PiModel[] }>("get_available_models"),
        probe.command<PiState>("get_state"),
      ]),
      probe.exited.then((reason) => Promise.reject(new Error(reason))),
      new Promise<never>((_, fail) =>
        setTimeout(() => fail(new Error("Pi did not answer.")), 15_000).unref(),
      ),
    ]);
    return { models: listed.models ?? [], state };
  } finally {
    probe.stop();
  }
}
export type PiOffer = Awaited<ReturnType<typeof probePi>>;

/**
 * The bridge, between ACP lines from Med (`input`) and to Med (`write`), and
 * Pi started as `pi` with Pi's own arguments.
 */
export function piBridge({
  pi,
  write,
  env = process.env,
}: {
  pi: string[];
  write(line: string): void;
  env?: NodeJS.ProcessEnv;
}) {
  let process_: Pi | undefined;
  let cwd = env.HOME ?? "/";
  let models: PiModel[] = [];
  let state: PiState = {};
  let session = "";
  /** The turn in progress: its end, and whether Med stopped it. */
  let turn: { done(result: Json): void; fail(error: Error): void; stopped: boolean } | undefined;
  let lastAssistant: Json | undefined;
  let compactions = 0;
  const calls = new Map<string, Json>();

  // JSON.stringify leaves U+2028 and U+2029 raw; Med's reader may split on them.
  const send = (line: string) =>
    write(line.replaceAll("\u2028", "\\u2028").replaceAll("\u2029", "\\u2029"));
  const update = (value: Json) =>
    rpc.notify("session/update", { sessionId: session, update: value });

  const options = () => configOptions(models, state);
  const refresh = async (pi: Pi) => {
    state = await pi.command<PiState>("get_state");
    return options();
  };

  const onEvent = (event: Json) => {
    switch (event.type) {
      case "message_update": {
        const delta = event.assistantMessageEvent;
        if (delta?.type === "text_delta" && delta.delta)
          update({
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: delta.delta },
          });
        else if (delta?.type === "thinking_delta" && delta.delta)
          update({
            sessionUpdate: "agent_thought_chunk",
            content: { type: "text", text: delta.delta },
          });
        return;
      }
      case "message_end": {
        if (event.message?.role !== "assistant") return;
        lastAssistant = event.message;
        // Each assistant message is one request: its tokens, for the thread's spend.
        const tokens = requestTokens(event.message, env);
        if (tokens) update(tokens);
        return;
      }
      case "compaction_end": {
        // Pi's own compaction, at its threshold or on an overflow, and /compact.
        const summary = event.result?.summary;
        update({
          sessionUpdate: "compaction_update",
          compactionId: `pi-compaction-${++compactions}`,
          status: event.aborted || !event.result ? "failed" : "completed",
          summary:
            typeof summary === "string" && summary ? [{ type: "text", text: summary }] : null,
        });
        return;
      }
      case "tool_execution_start": {
        const args = (event.args ?? {}) as Json;
        calls.set(event.toolCallId, { name: event.toolName, args });
        update({
          sessionUpdate: "tool_call",
          toolCallId: event.toolCallId,
          ...toolCall(event.toolName, args, cwd),
          status: "in_progress",
          rawInput: args,
          content: diffOf(event.toolName, args, cwd),
          ...(event.toolName === "write" ? { _meta: { med: { tool: "Write" } } } : {}),
        });
        return;
      }
      case "tool_execution_end": {
        const call = calls.get(event.toolCallId);
        calls.delete(event.toolCallId);
        const text = resultText(event.result);
        const diffs = call ? diffOf(call.name, call.args, cwd) : [];
        update({
          sessionUpdate: "tool_call_update",
          toolCallId: event.toolCallId,
          status: event.isError ? "failed" : "completed",
          content: [
            ...diffs,
            // An edit's diff says what it did; its result only repeats it.
            ...(text && (!diffs.length || event.isError)
              ? [{ type: "content", content: { type: "text", text } }]
              : []),
          ],
          ...(text ? { rawOutput: text } : {}),
        });
        return;
      }
      case "extension_ui_request":
        void ask(event);
        return;
      case "agent_settled":
        void finish();
        return;
      case "agent_end":
        // Pi 0.67 ends a run here; a newer Pi may still retry or compact,
        // and says agent_settled when it is done.
        void settle();
        return;
    }
  };

  /** After agent_end: the turn ends once Pi neither streams nor compacts. */
  const settle = async () => {
    const pi = process_;
    for (let tries = 0; pi && turn && tries < 100; tries++) {
      const now = await pi
        .command<PiState & { isCompacting?: boolean }>("get_state")
        .catch(() => undefined);
      if (!now || (!now.isStreaming && !now.isCompacting)) break;
      await new Promise((done) => setTimeout(done, 100));
    }
    await finish();
  };
  /** Ends the turn, with the context that it fills. */
  const finish = async () => {
    const current = turn;
    if (!current) return;
    turn = undefined;
    const last = lastAssistant;
    lastAssistant = undefined;
    const stats = await process_?.command<Json>("get_session_stats").catch(() => undefined);
    const usage = stats?.contextUsage;
    if (typeof usage?.tokens === "number" && usage.contextWindow > 0)
      update({ sessionUpdate: "usage_update", used: usage.tokens, size: usage.contextWindow });
    if (current.stopped || last?.stopReason === "aborted")
      current.done({ stopReason: "cancelled" });
    else if (last?.stopReason === "error")
      current.fail(new RpcError(String(last.errorMessage ?? "Pi's model failed."), -32603));
    else current.done({ stopReason: last?.stopReason === "length" ? "max_tokens" : "end_turn" });
  };

  /** An extension's dialog: yes or no, or one of a few, asks in Med. */
  const ask = async (request: Json) => {
    const pi = process_;
    if (!pi) return;
    if (request.method !== "confirm" && request.method !== "select") {
      if (["input", "editor"].includes(request.method))
        pi.answer({ id: request.id, cancelled: true });
      return;
    }
    const choices: string[] =
      request.method === "confirm" ? ["Yes", "No"] : (request.options ?? []).map(String);
    const refuses = (name: string) => /^(no|deny|block|cancel|reject|abort|skip)/i.test(name);
    try {
      const reply = await rpc.request<Json>("session/request_permission", {
        sessionId: session,
        toolCall: {
          toolCallId: `pi-ui-${request.id}`,
          title: String(request.title ?? "Pi asks"),
          kind: "other",
          rawInput: request.message ? { description: String(request.message) } : {},
          // The card asks the extension's question as it is.
          _meta: { med: { question: String(request.title ?? "Pi asks") } },
        },
        options: choices.map((name, index) => ({
          optionId: String(index),
          name,
          kind: refuses(name) ? "reject_once" : "allow_once",
        })),
      });
      const picked = reply?.outcome?.outcome === "selected" ? Number(reply.outcome.optionId) : -1;
      if (picked < 0) pi.answer({ id: request.id, cancelled: true });
      else if (request.method === "confirm") pi.answer({ id: request.id, confirmed: picked === 0 });
      else pi.answer({ id: request.id, value: choices[picked] });
    } catch {
      pi.answer({ id: request.id, cancelled: true });
    }
  };

  /** Starts Pi in `folder`, on a session's file when it goes on. */
  let commands: {
    name: string;
    description: string;
    input?: { hint: string };
    _meta?: { med?: { kind?: "builtin" | "skill" | "command" } };
  }[] = [
    {
      name: "compact",
      description: "Summarize older messages to free context",
      input: { hint: "what the summary should keep" },
      _meta: { med: { kind: "builtin" } },
    },
  ];
  const open = async (folder: string, file?: string) => {
    process_?.stop();
    cwd = folder;
    const pi = new Pi(
      [...pi_, "--mode", "rpc", ...(file ? ["--session", file] : [])],
      folder,
      onEvent,
    );
    process_ = pi;
    void pi.exited.then((reason) => {
      if (process_ !== pi) return;
      process_ = undefined;
      turn?.fail(new RpcError(reason, -32603));
      turn = undefined;
    });
    // Pi exits at once when it cannot start, such as on a bad argument.
    const answered = await Promise.race([
      pi.command<{ models: PiModel[] }>("get_available_models"),
      pi.exited.then((reason) => Promise.reject(new RpcError(reason, -32603))),
    ]);
    models = answered.models ?? [];
    const discovered = await pi
      .command<{
        commands?: { name?: string; description?: string; source?: string; hint?: string }[];
      }>("get_commands")
      .catch(() => ({ commands: [] }));
    const seen = new Set<string>();
    const list: typeof commands = [];
    for (const entry of Array.isArray(discovered.commands) ? discovered.commands : []) {
      const name = typeof entry?.name === "string" ? entry.name.replace(/^\//, "").trim() : "";
      if (!name || seen.has(name)) continue;
      seen.add(name);
      const kind =
        entry.source === "skill" ? "skill" : entry.source === "builtin" ? "builtin" : "command";
      list.push({
        name,
        description: String(entry.description ?? ""),
        ...(typeof entry.hint === "string" && entry.hint ? { input: { hint: entry.hint } } : {}),
        _meta: { med: { kind } },
      });
    }
    if (!seen.has("compact"))
      list.push({
        name: "compact",
        description: "Summarize older messages to free context",
        input: { hint: "what the summary should keep" },
        _meta: { med: { kind: "builtin" } },
      });
    commands = list;
    await refresh(pi);
    return pi;
  };
  const pi_ = pi;
  /** The `/` menu's commands, after the session's answer. */
  const offerCommands = () =>
    setTimeout(() =>
      update({
        sessionUpdate: "available_commands_update",
        availableCommands: commands,
      }),
    );
  const running = () => {
    if (!process_) throw new RpcError("Pi is not running. Send again to start it.", -32603);
    return process_;
  };

  const rpc = createJsonRpc(send, {
    async request(method, params) {
      const input = (params ?? {}) as Json;
      switch (method) {
        case "initialize":
          return {
            protocolVersion: 1,
            agentCapabilities: {
              loadSession: false,
              promptCapabilities: { image: true, audio: false, embeddedContext: false },
              sessionCapabilities: { resume: {} },
            },
            agentInfo: { name: "Pi" },
            authMethods: [],
          };
        case "session/new": {
          await open(String(input.cwd ?? cwd));
          session = state.sessionId ?? "";
          offerCommands();
          return { sessionId: session, configOptions: options() };
        }
        case "session/resume": {
          const folder = String(input.cwd ?? cwd);
          session = String(input.sessionId);
          await open(folder, sessionFile(env, folder, session));
          offerCommands();
          return { configOptions: options() };
        }
        case "session/set_config_option": {
          const pi = running();
          const value = String(input.value);
          if (input.configId === "model") {
            // A model's ID may hold a slash too, as OpenRouter's do.
            const model = models.find((entry) => modelValue(entry) === value);
            if (!model) throw new RpcError(`Pi has no model ${value}.`, -32602);
            const level = state.thinkingLevel;
            await pi.command("set_model", { provider: model.provider, modelId: model.id });
            // Pi gives a new model its default level; the chosen one stays
            // where the model has it.
            if (level && piLevels(model).includes(level))
              await pi.command("set_thinking_level", { level }).catch(() => {});
          } else if (input.configId === "thought_level")
            await pi.command("set_thinking_level", { level: value });
          else throw new RpcError(`Pi has no ${String(input.configId)}.`, -32602);
          return { configOptions: await refresh(pi) };
        }
        case "session/prompt": {
          const pi = running();
          const blocks = (Array.isArray(input.prompt) ? input.prompt : []) as Json[];
          const message = blocks
            .map((block) =>
              block.type === "text"
                ? String(block.text ?? "")
                : block.type === "resource_link"
                  ? String(block.uri ?? "")
                  : "",
            )
            .filter(Boolean)
            .join("\n");
          const images = blocks
            .filter((block) => block.type === "image" && typeof block.data === "string")
            .map((block) => ({ type: "image", data: block.data, mimeType: block.mimeType }));
          // `/compact`, from the reader or from Med past its autocompact:
          // Pi summarizes the session's older messages.
          const compact = /^\/compact(?:\s+([\s\S]*))?$/.exec(message.trim());
          if (compact && !images.length) {
            const instructions = compact[1]?.trim();
            await pi
              .command("compact", instructions ? { customInstructions: instructions } : {})
              .catch((error: Error) => Promise.reject(new RpcError(error.message, -32603)));
            return { stopReason: "end_turn" };
          }
          return new Promise((done, fail) => {
            turn = { done, fail, stopped: false };
            lastAssistant = undefined;
            pi.command("prompt", {
              message,
              ...(images.length ? { images } : {}),
              ...(state.isStreaming ? { streamingBehavior: "followUp" } : {}),
            }).catch((error: Error) => {
              turn = undefined;
              fail(new RpcError(error.message, -32603));
            });
          });
        }
        default:
          throw new RpcError(`Pi's bridge does not offer ${method}.`, -32601);
      }
    },
    notify(method) {
      if (method === "session/cancel" && process_ && turn) {
        turn.stopped = true;
        void process_.command("abort").catch(() => {});
      }
    },
  });

  return {
    receive: (line: string) => rpc.receive(line),
    close() {
      process_?.stop();
      process_ = undefined;
    },
  };
}
