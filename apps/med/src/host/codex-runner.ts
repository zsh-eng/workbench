import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import {
  AGENT_CAPABILITIES,
  type AgentChoices,
  OwnedPermission,
  OwnedQuestion,
  OwnedSetting,
  OwnedState,
} from "../shared/owned-session";
import type { AgentSession } from "../shared/saved-review";
import { attachHeld, forgetLog, startHeld, type HeldAgent, type HeldEvents } from "./held-agent";
import { createJsonRpc, parseRpc, RpcError, type JsonRpc } from "./json-rpc";
import {
  agentEnvironment,
  createState,
  kept,
  lastLines,
  type OwnedRunner,
  type RunnableAgent,
} from "./owned-sessions";
import { HostError } from "./runtime/errors";
import { userHome } from "./service/discover";

// Codex through its app-server: `codex app-server`, JSON-RPC 2.0 over stdio,
// from the binary that the user installed (docs/AGENT_WORKSPACES.md). Med
// starts and resumes a thread, sends turns (`turn/start`), steers the one
// that runs (`turn/steer`), interrupts it, and answers Codex's approval
// requests with cards. The thread's rollout in ~/.codex/sessions is the
// thread's history, as for a session that Med finds; Med adds the reply
// that streams (`item/agentMessage/delta`) until the rollout has it.
// Subagents are child threads, which the rollout reader nests.
//
// Codex names a new thread, so the holder of a new thread's process has a
// key of Med's own until the next start, which uses the thread's ID.
//
// The method names and shapes are Codex 0.160's, from `codex app-server
// generate-ts` and a recorded session (tests/fixtures/agents/codex-app-server.jsonl).
// T3 Code drives the same server (github.com/pingdotgg/t3code, MIT,
// apps/server/src/provider/CodexProvider.ts); Med's runner is its own.

/** A model that Codex offers (`model/list`). */
export interface CodexModel {
  id: string;
  name: string;
  description?: string;
  efforts: string[];
  defaultEffort?: string;
  isDefault?: boolean;
}

const CLIENT = { name: "med", title: "Med", version: "1" };
/** Notifications that Med does not read; Codex leaves them out of the log. */
const QUIET = [
  "turn/moderationMetadata",
  "item/reasoning/textDelta",
  "item/reasoning/summaryTextDelta",
  "item/reasoning/summaryPartAdded",
  "item/commandExecution/outputDelta",
  "item/fileChange/outputDelta",
  "process/outputDelta",
  "rawResponseItem/completed",
  "rawResponse/completed",
  "account/rateLimits/updated",
  "mcpServer/startupStatus/updated",
  "remoteControl/status/changed",
  "skills/changed",
];
const initialize = {
  clientInfo: CLIENT,
  capabilities: {
    experimentalApi: true,
    requestAttestation: false,
    optOutNotificationMethods: QUIET,
  },
};

type Json = Record<string, any>;
const record = (value: unknown): Json | undefined =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : undefined;

function modelsOf(result: unknown): CodexModel[] {
  const data = Array.isArray(record(result)?.data) ? (record(result)!.data as unknown[]) : [];
  return data.flatMap((raw) => {
    const model = record(raw);
    if (!model || model.hidden || typeof model.id !== "string") return [];
    const efforts = Array.isArray(model.supportedReasoningEfforts)
      ? model.supportedReasoningEfforts.flatMap((entry: unknown) =>
          typeof record(entry)?.reasoningEffort === "string"
            ? [record(entry)!.reasoningEffort]
            : [],
        )
      : [];
    return [
      {
        id: model.id,
        name: typeof model.displayName === "string" ? model.displayName : model.id,
        ...(typeof model.description === "string" ? { description: model.description } : {}),
        efforts,
        ...(typeof model.defaultReasoningEffort === "string"
          ? { defaultEffort: model.defaultReasoningEffort }
          : {}),
        ...(model.isDefault ? { isDefault: true } : {}),
      },
    ];
  });
}

/**
 * The models that Codex offers. `model/list` answers without a thread, so
 * nothing is written and no model runs; Med stops the server after it.
 */
export async function probeCodex(agent: Pick<RunnableAgent, "command" | "args">) {
  const child = spawn(agent.command, [...agent.args, "app-server"], {
    cwd: userHome(),
    env: agentEnvironment(),
    stdio: ["pipe", "pipe", "ignore"],
  });
  try {
    return await new Promise<CodexModel[]>((resolve) => {
      const timer = setTimeout(() => resolve([]), 20_000);
      const done = (models: CodexModel[]) => {
        clearTimeout(timer);
        resolve(models);
      };
      child.on("error", () => done([]));
      child.on("exit", () => done([]));
      child.stdin.on("error", () => {});
      const rpc = createJsonRpc((line) => child.stdin.write(`${line}\n`), {
        request: async () => {
          throw new RpcError("Med does not answer this.", -32601);
        },
        notify() {},
      });
      createInterface({ input: child.stdout, crlfDelay: Infinity }).on("line", (line) =>
        rpc.receive(line),
      );
      void rpc
        .request("initialize", initialize)
        .then(() => {
          rpc.notify("initialized", undefined);
          return rpc.request("model/list", {});
        })
        .then(
          (result) => done(modelsOf(result)),
          () => done([]),
        );
    });
  } finally {
    child.kill("SIGTERM");
  }
}

/** Codex's approval and sandbox presets, as its `/approvals` names them. */
const CODEX_MODES = [
  {
    value: "default",
    name: "Codex's setting",
    description: "The approval policy and sandbox in your Codex config",
  },
  { value: "untrusted", name: "Ask", description: "Ask before commands that Codex does not trust" },
  { value: "auto", name: "Auto", description: "Work in the checkout; ask before going outside it" },
  { value: "read-only", name: "Read only", description: "Read and answer; ask before any change" },
  {
    value: "full-access",
    name: "Full access",
    description: "Run every command, with network access, without asking",
    confirm:
      "Codex will edit any file and run any command, with network access, without asking, until you change the mode. Use it only where a mistake costs nothing, such as a throwaway clone.",
  },
];

/** What a mode asks of Codex at a thread's start, and of a turn after a change. */
function modePolicy(mode: string) {
  switch (mode) {
    case "untrusted":
      return { approvalPolicy: "untrusted", sandbox: "workspace-write" } as const;
    case "auto":
      return { approvalPolicy: "on-request", sandbox: "workspace-write" } as const;
    case "read-only":
      return { approvalPolicy: "on-request", sandbox: "read-only" } as const;
    case "full-access":
      return { approvalPolicy: "never", sandbox: "danger-full-access" } as const;
    default:
      return undefined;
  }
}
const sandboxPolicy = (sandbox: "workspace-write" | "read-only" | "danger-full-access") =>
  sandbox === "danger-full-access"
    ? { type: "dangerFullAccess" }
    : sandbox === "read-only"
      ? { type: "readOnly", networkAccess: false }
      : {
          type: "workspaceWrite",
          writableRoots: [],
          networkAccess: false,
          excludeTmpdirEnvVar: false,
          excludeSlashTmp: false,
        };

const capitalized = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);
const effortName = (level: string) =>
  level === "xhigh" ? "Extra high" : level === "none" ? "None" : capitalized(level);

/** A card's choices for an approval: Codex's decisions. */
const APPROVE: OwnedPermission["options"] = [
  { id: "accept", name: "Allow", kind: "allow_once" },
  { id: "acceptForSession", name: "Allow for this session", kind: "allow_always" },
  { id: "decline", name: "Deny", kind: "reject_once" },
];

/** A user prompt as Codex's input: images as data URLs, then the text. */
const inputOf = (text: string, images: { data: string; mimeType: string }[] = []) => [
  ...images.map((image) => ({ type: "image", url: `data:${image.mimeType};base64,${image.data}` })),
  ...(text ? [{ type: "text", text, text_elements: [] }] : []),
];

export interface CodexOptions {
  /** The folder of the agents' holders and their logs. */
  holders: string;
  /** A thread that exists: Med resumes it (`thread/resume`) when it starts
   * the agent, with its next prompt. Without it, Med starts a new thread. */
  thread?: string;
  /** The holder that runs the thread now, when its key is not the thread's. */
  holder?: string;
  /** The holder's key changed, to keep with the session's record. */
  onHolder?(key: string): void;
  env?: () => Record<string, string>;
  /** The model, effort, and mode to start with. */
  choices?: AgentChoices;
  models?: CodexModel[] | Promise<CodexModel[]>;
  /** A session from before the host restarted: attach to its holder. */
  attach?: boolean;
  halt?: OwnedState["halt"];
  /** Whether another process, such as Codex Desktop, has the thread open. */
  elsewhere?(threadId: string): Promise<boolean>;
}

/**
 * A Codex thread that Med runs. `attached` settles when the thread has its
 * ID: at once for a thread that exists, or after `thread/start`.
 */
export function startCodex(agent: RunnableAgent, cwd: string, options: CodexOptions): OwnedRunner {
  const session: AgentSession = { agent: "codex", id: options.thread ?? "", cwd };
  const store = createState({
    sessionId: session.id,
    preset: agent.id,
    name: agent.name,
    status: options.thread ? "idle" : "starting",
    settings: [],
    commands: [],
    turns: 0,
    capabilities: AGENT_CAPABILITIES.codex,
    images: true,
  });
  let holderKey = options.holder ?? options.thread ?? randomUUID();
  let held: HeldAgent | undefined;
  let active: object | undefined;
  let replaying = false;
  let stopping = false;
  /** The thread is loaded in the app-server that runs now. */
  let loaded = false;
  let turnId: string | undefined;
  let models: CodexModel[] = Array.isArray(options.models) ? options.models : [];
  const wanted = options.choices ?? {};
  let chosen = {
    model: wanted.model ?? "default",
    effort: wanted.effort ?? "default",
    mode: wanted.mode ?? "default",
  };
  /** The mode changed since Codex last heard it: the next turn says so. */
  let modeChanged = false;
  let streaming: OwnedState["streaming"];
  let streamTimer: ReturnType<typeof setTimeout> | undefined;
  /** Approval requests that wait for the user, by the card's ID. */
  const asking = new Map<
    string,
    { method: string; params: Json; resolve(result: unknown): void; questions?: Json[] }
  >();

  const settings = (): OwnedSetting[] => {
    const model =
      models.find((entry) => entry.id === chosen.model) ?? models.find((entry) => entry.isDefault);
    return [
      ...(models.length
        ? [
            {
              id: "model",
              name: "Model",
              category: "model" as const,
              value: models.some((entry) => entry.id === chosen.model) ? chosen.model : "default",
              options: [
                { value: "default", name: "Codex's default" },
                ...models.map((entry) => ({
                  value: entry.id,
                  name: entry.name,
                  ...(entry.description ? { description: entry.description } : {}),
                })),
              ],
            },
          ]
        : []),
      ...(model?.efforts.length
        ? [
            {
              id: "effort",
              name: "Effort",
              category: "effort" as const,
              value: model.efforts.includes(chosen.effort) ? chosen.effort : "default",
              options: [
                { value: "default", name: "Default effort" },
                ...model.efforts.map((level) => ({ value: level, name: effortName(level) })),
              ],
            },
          ]
        : []),
      {
        id: "mode",
        name: "Mode",
        category: "mode" as const,
        value: CODEX_MODES.some((entry) => entry.value === chosen.mode) ? chosen.mode : "default",
        options: CODEX_MODES,
        cycle: ["untrusted", "auto", "read-only"],
      },
    ];
  };
  store.set({ settings: settings(), ...(options.halt ? { halt: options.halt } : {}) });
  void Promise.resolve(options.models).then((offered) => {
    if (models.length || !offered?.length) return;
    models = offered;
    store.set({ settings: settings() });
  });

  const write = (line: string) => {
    if (!replaying) held?.write(line);
  };
  const flushStreaming = () => {
    streamTimer = undefined;
    store.set({ streaming });
  };
  const clearTurn = () => {
    clearTimeout(streamTimer);
    streamTimer = undefined;
    streaming = undefined;
    turnId = undefined;
  };
  const ours = (params: Json | undefined) => !params?.threadId || params.threadId === session.id;
  const fail = (error: unknown) =>
    store.set({ error: error instanceof Error ? error.message : String(error) });

  /** The card for an approval request, and its choices. */
  const card = (id: string, method: string, params: Json): OwnedPermission | undefined => {
    if (method === "item/commandExecution/requestApproval")
      return {
        id,
        title: `${agent.name} wants to run a command`,
        detail: [params.command, params.reason]
          .filter((part) => typeof part === "string")
          .join("\n"),
        options: APPROVE,
      };
    if (method === "item/fileChange/requestApproval")
      return {
        id,
        title: `${agent.name} wants to edit files`,
        ...(params.reason || params.grantRoot
          ? { detail: String(params.reason ?? `Write in ${params.grantRoot}`) }
          : {}),
        options: APPROVE,
      };
    if (method === "item/permissions/requestApproval")
      return {
        id,
        title: `${agent.name} asks for more access`,
        detail: [params.reason, JSON.stringify(params.permissions)].filter(Boolean).join("\n"),
        options: APPROVE,
      };
    if (method === "item/tool/requestUserInput") {
      const questions = (Array.isArray(params.questions) ? params.questions : []).flatMap(
        (raw: unknown): OwnedQuestion[] => {
          const question = record(raw);
          if (!question || typeof question.question !== "string" || question.isSecret) return [];
          return [
            {
              question: question.question,
              ...(typeof question.header === "string" ? { header: question.header } : {}),
              options: (Array.isArray(question.options) ? question.options : []).flatMap(
                (option: unknown) =>
                  typeof record(option)?.label === "string"
                    ? [
                        {
                          label: record(option)!.label,
                          ...(typeof record(option)!.description === "string"
                            ? { description: record(option)!.description }
                            : {}),
                        },
                      ]
                    : [],
              ),
            },
          ];
        },
      );
      if (!questions.length) return undefined;
      return {
        id,
        title: `${agent.name} asks`,
        options: [
          { id: "answer", name: "Answer", kind: "allow_once" },
          { id: "decline", name: "Skip", kind: "reject_once" },
        ],
        questions,
      };
    }
    return undefined;
  };
  /** The answer to an approval request, for the user's choice. */
  const reply = (
    method: string,
    params: Json,
    option: string,
    answers?: Record<string, string>,
  ) => {
    if (method === "item/tool/requestUserInput") {
      if (option !== "answer") return { answers: {} };
      const result: Record<string, { answers: string[] }> = {};
      for (const raw of Array.isArray(params.questions) ? params.questions : []) {
        const question = record(raw);
        const answer = question && answers?.[String(question.question)]?.trim();
        if (question && typeof question.id === "string" && answer)
          result[question.id] = { answers: answer.split(", ") };
      }
      return { answers: result };
    }
    if (method === "item/permissions/requestApproval")
      return option === "decline" || option === "cancel"
        ? { permissions: {}, scope: "turn" }
        : {
            permissions: {
              ...(params.permissions?.network ? { network: params.permissions.network } : {}),
              ...(params.permissions?.fileSystem
                ? { fileSystem: params.permissions.fileSystem }
                : {}),
            },
            scope: option === "acceptForSession" ? "session" : "turn",
          };
    return {
      decision: ["accept", "acceptForSession", "decline", "cancel"].includes(option)
        ? option
        : "decline",
    };
  };
  const showNext = () => {
    const [id, next] = [...asking][0] ?? [];
    store.set({ permission: id && next ? card(id, next.method, next.params) : undefined });
  };

  const rpc: JsonRpc = createJsonRpc(write, {
    request(method, raw) {
      const params = record(raw) ?? {};
      const id = String(params.itemId ?? params.approvalId ?? randomUUID());
      if (!card(id, method, params)) {
        if (method === "mcpServer/elicitation/request")
          return Promise.resolve({ action: "decline", content: null, _meta: null });
        return Promise.reject(new RpcError(`Med does not offer ${method}.`, -32601));
      }
      return new Promise((resolve) => {
        asking.set(id, { method, params, resolve });
        showNext();
      });
    },
    notify(method, raw) {
      const params = record(raw);
      if (!ours(params)) return;
      switch (method) {
        case "thread/started":
          return;
        case "turn/started":
          turnId = String(params?.turn?.id ?? "") || turnId;
          store.set({ status: "working", error: undefined });
          return;
        case "turn/completed": {
          const turn = record(params?.turn);
          clearTurn();
          // Approvals of the turn have no use now.
          for (const entry of asking.values())
            entry.resolve(reply(entry.method, entry.params, "cancel"));
          asking.clear();
          store.set({
            status: store.get().status === "exited" ? "exited" : "idle",
            streaming: undefined,
            permission: undefined,
            ...(turn?.status === "failed"
              ? { error: String(turn.error?.message ?? "The turn failed.") }
              : { error: undefined }),
          });
          if (!replaying)
            held?.checkpoint({
              state: kept(store.get()),
              chosen,
              models,
              thread: session.id,
              lastId: rpc.last(),
            });
          return;
        }
        case "item/started": {
          const item = record(params?.item);
          if (item?.type === "agentMessage")
            streaming = { id: String(item.id ?? randomUUID()), text: "" };
          return;
        }
        case "item/agentMessage/delta":
          if (!streaming || streaming.id !== params?.itemId)
            streaming = { id: String(params?.itemId ?? randomUUID()), text: "" };
          streaming = { ...streaming, text: streaming.text + String(params?.delta ?? "") };
          streamTimer ??= setTimeout(flushStreaming, 80);
          return;
        case "thread/tokenUsage/updated": {
          const usage = record(params?.tokenUsage);
          const used = Number(usage?.last?.inputTokens);
          const total = Number(usage?.modelContextWindow);
          if (used > 0 && total > 0) store.set({ context: { used, total } });
          return;
        }
        case "error":
          if (params?.willRetry) return;
          return fail(params?.error?.message ?? "Codex reported an error.");
      }
    },
  });

  // What each answer to Med's requests changes, live or read again.
  const answered = (
    method: string,
    _params: Json | undefined,
    result: Json | undefined,
    error?: RpcError,
  ) => {
    if (method === "turn/start") {
      if (error) {
        fail(error);
        store.set({ status: "idle" });
      } else if (result?.turn?.id) turnId = String(result.turn.id);
      return;
    }
    if (error) return;
    if (method === "thread/start" || method === "thread/resume") {
      const id = String(result?.thread?.id ?? "");
      if (id && !session.id) {
        (session as { id: string }).id = id;
        store.set({ sessionId: id });
      }
      loaded = true;
      if (
        typeof result?.model === "string" &&
        chosen.model === "default" &&
        method === "thread/resume"
      )
        chosen.model = result.model;
      if (store.get().status === "starting") store.set({ status: "idle" });
      store.set({ settings: settings() });
    } else if (method === "model/list") {
      const offered = modelsOf(result);
      if (offered.length) {
        models = offered;
        store.set({ settings: settings() });
      }
    }
  };
  const call = <T = Json>(method: string, params: Json) =>
    rpc.request<T>(method, params, (result, error) =>
      answered(method, params, record(result), error),
    );

  // A host that attaches reads the holder's log: Med's requests that wait
  // for answers, and Codex's that wait for the user.
  const sent = new Map<number, { method: string; params: Json }>();
  const asked = new Map<number | string, { method: string; params: unknown }>();
  let lastId = 0;
  const onSent = (line: string) => {
    const message = parseRpc(line);
    if (!message) return;
    if (
      (message.method === "turn/start" || message.method === "turn/steer") &&
      typeof message.id === "number"
    )
      store.set({
        status: "working",
        turns: store.get().turns + (message.method === "turn/start" ? 1 : 0),
      });
    if (message.method !== undefined && typeof message.id === "number") {
      sent.set(message.id, { method: message.method, params: record(message.params) ?? {} });
      lastId = Math.max(lastId, message.id);
    } else if (message.method === undefined && message.id !== undefined) asked.delete(message.id);
  };
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
        record(message.result),
        message.error
          ? new RpcError(
              message.error.message ?? "Codex returned an error.",
              message.error.code ?? 0,
            )
          : undefined,
      );
    }
  };
  const restore = (checkpoint: Json | undefined) => {
    if (!checkpoint?.state) return;
    chosen = checkpoint.chosen ?? chosen;
    models = checkpoint.models ?? models;
    if (typeof checkpoint.thread === "string" && !session.id)
      (session as { id: string }).id = checkpoint.thread;
    loaded = true;
    lastId = Math.max(lastId, Number(checkpoint.lastId) || 0);
    sent.clear();
    asked.clear();
    clearTurn();
    store.set({
      ...checkpoint.state,
      permission: undefined,
      streaming: undefined,
      settings: settings(),
    });
  };

  let errors = "";
  const events = (token: object, done: () => void): HeldEvents => ({
    entry(entry, replay) {
      if (active !== token) return;
      replaying = replay;
      try {
        if (entry.kind === "h") store.set({ halt: undefined });
        else if (entry.kind === "m" && replay) restore(JSON.parse(entry.text).checkpoint);
        else if (entry.kind === "o" && replay) onReplayed(entry.text);
        else if (entry.kind === "o") rpc.receive(entry.text);
        else if (entry.kind === "i" && replay) onSent(entry.text);
        else if (entry.kind === "e") errors = `${errors}${entry.text}\n`.slice(-4000);
      } catch {
        /* Not a message. */
      } finally {
        replaying = false;
      }
    },
    live() {
      if (active !== token) return done();
      rpc.resume(
        new Map(
          [...sent].map(([id, { method, params }]) => [
            id,
            (result: unknown, error?: RpcError) => answered(method, params, record(result), error),
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
      loaded = false;
      void forgetLog(options.holders, holderKey);
      rpc.close(`${agent.name} stopped.`);
      for (const entry of asking.values())
        entry.resolve(reply(entry.method, entry.params, "cancel"));
      asking.clear();
      if (stopping) return;
      const before = store.get().status;
      clearTurn();
      // The thread stays on disk: the next prompt starts Codex again.
      const reason =
        exit.error ??
        (exit.requested
          ? undefined
          : exit.signal
            ? `Stopped by ${exit.signal}`
            : exit.code
              ? `Exited with code ${exit.code}`
              : undefined);
      const lines = lastLines(exit.errors || errors);
      store.set({
        status: session.id ? "idle" : "exited",
        permission: undefined,
        streaming: undefined,
        ...(exit.lost && before === "working"
          ? {
              halt: {
                kind: "interrupted" as const,
                detail: "The agent's process ended during the turn",
              },
            }
          : !exit.requested && (reason || before === "working")
            ? {
                halt: {
                  kind: "stopped" as const,
                  detail: reason ?? "Exited during the turn",
                  ...(lines ? { lines } : {}),
                  at: Date.now(),
                },
              }
            : {}),
      });
    },
  });

  /** Starts the app-server in a holder and opens the thread in it. */
  const launch = () => {
    const token = {};
    active = token;
    if (session.id && holderKey !== session.id) {
      holderKey = session.id;
      options.onHolder?.(holderKey);
    }
    held = startHeld(
      options.holders,
      {
        sessionId: holderKey,
        kind: "codex",
        name: agent.name,
        command: agent.command,
        args: [...agent.args, "app-server"],
        cwd,
        env: agentEnvironment(options.env?.()),
      },
      events(token, () => {}),
    );
    const policy = modePolicy(chosen.mode);
    return (async () => {
      await call("initialize", initialize);
      rpc.notify("initialized", undefined);
      if (!models.length) await call("model/list", {}).catch(() => undefined);
      const common = {
        cwd,
        ...(chosen.model !== "default" ? { model: chosen.model } : {}),
        ...(policy ? { approvalPolicy: policy.approvalPolicy, sandbox: policy.sandbox } : {}),
      };
      if (session.id)
        await call("thread/resume", { threadId: session.id, excludeTurns: true, ...common });
      else await call("thread/start", { ...common, serviceName: "Med" });
      modeChanged = false;
    })();
  };

  let attached: Promise<void> = Promise.resolve();
  if (options.attach) {
    const token = {};
    active = token;
    attached = new Promise<void>((done) => {
      void attachHeld(options.holders, holderKey, events(token, done)).then(
        (found) => {
          if (!found) {
            active = undefined;
            done();
          } else if (active === token) {
            held = found;
            loaded = true;
          }
        },
        () => {
          active = undefined;
          done();
        },
      );
    });
  } else if (!options.thread) {
    attached = launch().catch((error: unknown) => {
      fail(error);
      stopping = true;
      held?.stop();
      store.set({ status: "exited" });
      throw error instanceof Error ? error : new Error(String(error));
    });
  }

  let waking: Promise<void> | undefined;
  /** Starts Codex for a thread that no process of Med's runs now. */
  const wake = async () => {
    await attached.catch(() => {});
    if (held && loaded) return;
    if (stopping) throw new HostError("session-stopped", "This session has stopped.", 409);
    if (session.id && (await options.elsewhere?.(session.id)))
      throw new HostError(
        "session-busy",
        `Another ${agent.name} process has this thread open, such as Codex Desktop. Close it there, then send again.`,
        409,
      );
    await launch();
  };
  const ensure = () =>
    held && loaded
      ? Promise.resolve()
      : (waking ??= wake().finally(() => {
          waking = undefined;
        }));

  /** The settings that a turn carries: the model, effort, and a changed mode. */
  const turnSettings = () => {
    const policy = modeChanged ? modePolicy(chosen.mode) : undefined;
    return {
      ...(chosen.model !== "default" ? { model: chosen.model } : {}),
      ...(chosen.effort !== "default" ? { effort: chosen.effort } : {}),
      ...(policy
        ? { approvalPolicy: policy.approvalPolicy, sandboxPolicy: sandboxPolicy(policy.sandbox) }
        : {}),
    };
  };
  const startTurn = async (text: string, images: { data: string; mimeType: string }[]) => {
    store.set({
      status: "working",
      turns: store.get().turns + 1,
      error: undefined,
      halt: undefined,
    });
    const settings = turnSettings();
    modeChanged = false;
    await call("turn/start", {
      threadId: session.id,
      input: inputOf(text, images),
      ...settings,
    }).catch((error: unknown) => {
      store.set({ status: "idle" });
      throw new HostError(
        "agent-error",
        error instanceof Error ? error.message : String(error),
        502,
      );
    });
  };

  const prompt = async (text: string, images: { data: string; mimeType: string }[] = []) => {
    if (store.get().status === "exited")
      throw new HostError("session-stopped", "This session has stopped.", 409);
    await ensure();
    await startTurn(text, images);
  };

  return {
    session,
    attached,
    state: store.get,
    dormant: () => !held,
    pid: () => held?.pid(),
    subscribe: store.subscribe,
    prompt,
    async steer(text, images = []) {
      if (store.get().status !== "working" || !turnId) return prompt(text, images);
      try {
        await call("turn/steer", {
          threadId: session.id,
          expectedTurnId: turnId,
          input: inputOf(text, images),
        });
      } catch {
        // The turn ended meanwhile: the message starts the next one.
        await startTurn(text, images);
      }
    },
    answer(id, option, answer = {}) {
      const entry = asking.get(id);
      if (!entry) return;
      if (entry.method === "item/tool/requestUserInput" && option === "answer") {
        const given = Object.values(answer.answers ?? {}).some((value) => value.trim());
        if (!given) throw new HostError("no-answer", "Choose an answer first.", 400);
      }
      asking.delete(id);
      entry.resolve(reply(entry.method, entry.params, option, answer.answers));
      showNext();
    },
    interrupt() {
      for (const entry of asking.values())
        entry.resolve(reply(entry.method, entry.params, "cancel"));
      asking.clear();
      store.set({ permission: undefined });
      if (held && turnId)
        void call("turn/interrupt", { threadId: session.id, turnId }).catch(() => {});
    },
    async set(id, value) {
      const setting = store.get().settings.find((entry) => entry.id === id);
      if (!setting || !setting.options.some((option) => option.value === value))
        throw new HostError("invalid-setting", "The agent does not offer this choice.", 400);
      // Codex takes each choice with the next turn.
      if (id === "model") chosen.model = value;
      else if (id === "effort") chosen.effort = value;
      else if (id === "mode") {
        chosen.mode = value;
        modeChanged = true;
      }
      store.set({ settings: settings() });
    },
    async restart() {
      if (store.get().status === "exited")
        throw new HostError("session-stopped", "This session has stopped.", 409);
      await ensure();
      store.set({ halt: undefined, error: undefined });
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
