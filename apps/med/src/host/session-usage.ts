import { open, readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  canonicalModel,
  claudeWindow,
  defaultCompaction,
  PRICE_TABLE,
  requestCost,
  type RequestTokens,
  type ThreadUsage,
} from "../shared/model-usage";
import { agentName, type AgentSession } from "../shared/saved-review";
import { AUTO_COMPACT_FROM } from "../shared/agent-defaults";
import { findTranscript } from "./agent-transcripts";
import { userHome } from "./service/discover";
import { changedSince, transcriptReads } from "./transcript-reads";

// A thread's spend and its current session's context, from the agents'
// transcripts (docs/SESSIONS.md#spend-and-context). Each transcript is read
// once; a later call reads only the lines that the agent wrote since.
//
// - Claude Code writes each block of a response as its own line, and each
//   line carries the response's `usage`, so a response counts once by its
//   message ID. The session's subagents are in `<session>/subagents/`.
// - Codex 0.160 writes each response's usage as a `token_usage_record`, by
//   its response ID. Older rollouts have only running totals
//   (`token_count`); each total that grows adds its `last_token_usage`, and
//   a record of the same total replaces it. Pricing each response applies
//   the long-context rate. A subagent's own rollout counts with its parent.
// - An ACP agent keeps no transcript that Med can read: Med's own file of
//   the session's updates has its `token_usage` updates, from agy's prompt
//   results (a turn each) and from the bridge to Pi (a request each), and
//   its `usage_update`s for the context.
//
// Each request pays the prices of the day it ran (model-prices.json).

const CHUNK = 4 * 1024 * 1024;

type Json = Record<string, unknown>;
const record = (value: unknown) =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : undefined;
const count = (value: unknown) => (typeof value === "number" && value > 0 ? value : 0);

interface Request {
  model: string;
  tokens: RequestTokens;
  /** When it ran, for a price that changed. */
  at?: number;
  /** An ACP turn's sum of its requests. */
  whole?: boolean;
  /** The agent's own price, for a model that Med has none for, and its name. */
  agentCost?: { cost: number; agent: string };
}

/** One transcript, read up to `offset`. */
interface Read {
  offset: number;
  /** A line that the agent has not finished writing. */
  rest: Buffer;
  /** Claude Code: the requests, by message ID. */
  requests: Map<string, Request>;
  /** The last request of the main conversation: its prompt's tokens. */
  last?: { used: number; model?: string; at?: number; window?: number };
  /** A compaction came after the last request. */
  compacted: boolean;
  /** Codex: the model of the turn, the running totals so far, and the
   * subagents' threads. `file` keeps one rollout's keys apart from another's. */
  codex?: { file: number; model?: string; totals: Json; children: Set<string> };
  /** An ACP session's file: its lines so far, which key its requests. */
  acp?: { lines: number };
}

let codexFiles = 0;
/** A running total's size, for its key. */
const totalOf = (usage: Json | undefined) =>
  count(usage?.total_tokens) || count(usage?.input_tokens) + count(usage?.output_tokens);

/** A Codex usage object as Med's tokens. Cached input and cache writes are
 * part of Codex's input count. */
function codexTokens(usage: Json): RequestTokens {
  const cached = count(usage.cached_input_tokens);
  const written = count(usage.cache_write_input_tokens);
  return {
    input: Math.max(0, count(usage.input_tokens) - cached - written),
    output: count(usage.output_tokens),
    cacheWrite5m: written,
    cacheWrite1h: 0,
    cacheRead: cached,
    webSearches: 0,
  };
}

function tokensOf(usage: Json): RequestTokens {
  const written = count(usage.cache_creation_input_tokens);
  const split = record(usage.cache_creation);
  const hour = count(split?.ephemeral_1h_input_tokens);
  const minutes = count(split?.ephemeral_5m_input_tokens);
  return {
    input: count(usage.input_tokens),
    output: count(usage.output_tokens),
    // A write without its lifetime is the API's default, 5 minutes.
    cacheWrite5m: hour + minutes ? minutes : written,
    cacheWrite1h: hour,
    cacheRead: count(usage.cache_read_input_tokens),
    webSearches: count(record(usage.server_tool_use)?.web_search_requests),
    ...(typeof usage.speed === "string" ? { speed: usage.speed } : {}),
    ...(typeof usage.inference_geo === "string" ? { geo: usage.inference_geo } : {}),
  };
}

const promptOf = (tokens: RequestTokens) =>
  tokens.input + tokens.cacheRead + tokens.cacheWrite5m + tokens.cacheWrite1h;

function claudeLine(line: string, state: Read) {
  // Only these lines are parsed; the text tests are a cheap first look, and
  // either can also match a line of the other kind, such as a call that
  // searches for "compact_boundary".
  const boundary = line.includes('"compact_boundary"');
  if (!boundary && (!line.includes('"usage"') || !line.includes('"assistant"'))) return;
  let entry: Json | undefined;
  try {
    entry = record(JSON.parse(line));
  } catch {
    return;
  }
  if (entry?.type === "system" && entry.subtype === "compact_boundary") {
    state.compacted = true;
    return;
  }
  const message = record(entry?.message);
  const usage = record(message?.usage);
  const model = typeof message?.model === "string" ? message.model : undefined;
  if (entry?.type !== "assistant" || !usage || !model || model === "<synthetic>") return;
  const tokens = tokensOf(usage);
  const id = String(message?.id ?? entry.requestId ?? entry.uuid ?? "");
  if (!id) return;
  const known = state.requests.get(id);
  // Each block of a response repeats its usage; a later line may carry the
  // final output count.
  const at = Date.parse(String(entry.timestamp ?? ""));
  if (known) known.tokens.output = Math.max(known.tokens.output, tokens.output);
  else state.requests.set(id, { model, tokens, ...(Number.isFinite(at) ? { at } : {}) });
  if (entry.isSidechain || !promptOf(tokens)) return;
  state.last = { used: promptOf(tokens), model, ...(Number.isFinite(at) ? { at } : {}) };
  state.compacted = false;
}

function codexLine(line: string, state: Read) {
  if (
    !line.includes('"token_count"') &&
    !line.includes('"turn_context"') &&
    !line.includes('"token_usage_record"') &&
    !line.includes('"SubAgentActivity"')
  )
    return;
  let entry: Json | undefined;
  try {
    entry = record(JSON.parse(line));
  } catch {
    return;
  }
  const payload = record(entry?.payload);
  const codex = (state.codex ??= { file: ++codexFiles, totals: {}, children: new Set() });
  const time = Date.parse(String(entry?.timestamp ?? ""));
  const when = Number.isFinite(time) ? { at: time } : {};
  const model = () => codex.model ?? "Codex";
  if (entry?.type === "turn_context" && typeof payload?.model === "string")
    codex.model = payload.model;
  if (entry?.type === "token_usage_record") {
    const usage = record(payload?.usage);
    const id = typeof payload?.response_id === "string" ? payload.response_id : undefined;
    if (!usage || !id) return;
    // A total that counted before this record is this response.
    const totals = record(payload?.thread_token_usage);
    if (totals) {
      state.requests.delete(`${codex.file}:${totalOf(totals)}`);
      if (totalOf(totals) >= totalOf(codex.totals)) codex.totals = totals;
    }
    state.requests.set(id, { model: model(), tokens: codexTokens(usage), ...when });
    return;
  }
  if (entry?.type !== "event_msg") return;
  if (payload?.type === "item_completed") {
    const item = record(payload.item);
    if (item?.type === "SubAgentActivity" && item.kind === "started")
      if (typeof item.agent_thread_id === "string") codex.children.add(item.agent_thread_id);
    return;
  }
  if (payload?.type !== "token_count") return;
  const info = record(payload.info);
  const totals = record(info?.total_token_usage);
  const last = record(info?.last_token_usage);
  if (totals && totalOf(totals) > totalOf(codex.totals)) {
    // What the total grew by is one response, or more when Codex wrote no
    // count between them.
    const grown: Json = {};
    for (const key of [
      "input_tokens",
      "cached_input_tokens",
      "cache_write_input_tokens",
      "output_tokens",
    ])
      grown[key] = count(totals[key]) - count(codex.totals[key]);
    state.requests.set(`${codex.file}:${totalOf(totals)}`, {
      model: model(),
      tokens: codexTokens(grown),
      ...when,
    });
    codex.totals = totals;
  }
  const used = count(last?.input_tokens);
  const window = count(info?.model_context_window);
  if (used && window) state.last = { used, window, ...when };
}

/**
 * A line of Med's file of an ACP session's updates (owned-sessions.ts): a
 * `token_usage` update is a request, or a turn's requests; a `usage_update`
 * is the context, which a compaction after it leaves to the next request.
 */
function acpLine(line: string, state: Read, agent: string) {
  const acp = (state.acp ??= { lines: 0 });
  const index = acp.lines++;
  if (
    !line.includes('"token_usage"') &&
    !line.includes('"usage_update"') &&
    !line.includes('"compaction_update"')
  )
    return;
  let entry: Json | undefined;
  try {
    entry = record(JSON.parse(line));
  } catch {
    return;
  }
  const update = record(entry?.update);
  const at = typeof entry?.at === "number" ? entry.at : undefined;
  const when = at ? { at } : {};
  if (update?.sessionUpdate === "compaction_update" && update.status === "completed")
    state.compacted = true;
  if (update?.sessionUpdate === "usage_update") {
    const used = count(update.used);
    const window = count(update.size);
    if (window) {
      state.last = { used, window, ...when };
      state.compacted = false;
    }
  }
  if (update?.sessionUpdate !== "token_usage") return;
  const model = typeof update.model === "string" && update.model ? update.model : agent;
  const written = count(update.cacheWrite);
  const hour = update.cacheWriteHour === true;
  const cost = count(update.cost);
  state.requests.set(`acp:${index}`, {
    model,
    tokens: {
      input: count(update.input),
      output: count(update.output),
      cacheWrite5m: hour ? 0 : written,
      cacheWrite1h: hour ? written : 0,
      cacheRead: count(update.cacheRead),
      webSearches: 0,
    },
    ...when,
    ...(update.turn === true ? { whole: true } : {}),
    ...(cost ? { agentCost: { cost, agent } } : {}),
  });
}

/** Reads the lines that a transcript gained since the last read. */
async function readMore(agent: "claude" | "codex" | "acp", path: string, state: Read, name = "") {
  // A finished transcript, such as a done subagent's, costs one stat.
  if (!(await changedSince(path, state.offset))) return;
  const handle = await open(path, "r");
  try {
    const { size } = await handle.stat();
    // A file that got shorter is a new file: read it again.
    if (size < state.offset)
      Object.assign(state, {
        offset: 0,
        rest: Buffer.alloc(0),
        requests: new Map(),
        last: undefined,
        compacted: false,
        codex: undefined,
        acp: undefined,
      });
    while (state.offset < size) {
      const length = Math.min(CHUNK, size - state.offset);
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await handle.read(buffer, 0, length, state.offset);
      if (!bytesRead) break;
      state.offset += bytesRead;
      const bytes = Buffer.concat([state.rest, buffer.subarray(0, bytesRead)]);
      const end = bytes.lastIndexOf(10);
      state.rest = Buffer.from(end < 0 ? bytes : bytes.subarray(end + 1));
      if (end < 0) continue;
      for (const line of bytes.toString("utf8", 0, end).split("\n"))
        if (agent === "claude") claudeLine(line, state);
        else if (agent === "codex") codexLine(line, state);
        else acpLine(line, state, name);
    }
  } finally {
    await handle.close();
  }
}

/** A window size from a setting: a token count, with an optional k or M. */
function windowSetting(value: unknown): number | "auto" | undefined {
  if (value === "auto") return "auto";
  const match =
    typeof value === "number"
      ? [String(value), String(value), ""]
      : typeof value === "string"
        ? /^\s*(\d+(?:\.\d+)?)\s*([kKmM]?)\s*$/.exec(value)
        : null;
  if (!match) return undefined;
  const number = Number(match[1]) * (/k/i.test(match[2]!) ? 1e3 : /m/i.test(match[2]!) ? 1e6 : 1);
  if (!Number.isFinite(number) || number <= 0) return undefined;
  // Claude Code takes 100K to 1M.
  return Math.min(1_000_000, Math.max(100_000, Math.round(number)));
}

const truthy = (value: unknown) => value === true || value === "1" || value === "true";

/**
 * Where Claude Code compacts a session on `model`, from the settings that
 * https://code.claude.com/docs/en/model-config#set-the-auto-compact-window
 * names, read only: `CLAUDE_CODE_AUTO_COMPACT_WINDOW` in the environment of
 * an agent that Med starts or in a settings file's `env`; a window saved
 * for the model under `modelSettings`, which wins over a top-level
 * `autoCompactWindow` in the same file; `autoCompactEnabled: false` or
 * `DISABLE_AUTO_COMPACT`. The local, project, and user files count in that
 * order; Med does not read managed settings or a terminal's environment or
 * `--autocompact` flag, so a session started with those can differ. Med's
 * own setting (`setting`, agent-defaults.ts) is the variable for the
 * sessions that Med starts.
 */
export async function claudeCompaction(
  model: string | undefined,
  window: number,
  cwd: string | undefined,
  options: { home: string; env?: NodeJS.ProcessEnv; setting?: number },
): Promise<NonNullable<ThreadUsage["context"]>["compaction"]> {
  const home = options.home;
  const short = (path: string) =>
    path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
  const paths = [
    ...(cwd
      ? [join(cwd, ".claude", "settings.local.json"), join(cwd, ".claude", "settings.json")]
      : []),
    join(home, ".claude", "settings.json"),
  ];
  const files = (
    await Promise.all(
      paths.map(async (path) => {
        try {
          const data = record(JSON.parse(await readFile(path, "utf8")));
          return data ? [{ path: short(path), data }] : [];
        } catch {
          return [];
        }
      }),
    )
  ).flat();
  const variable = (name: string) => {
    if (options.env?.[name] !== undefined) return { value: options.env[name], from: name };
    for (const file of files) {
      const value = record(file.data.env)?.[name];
      if (value !== undefined) return { value, from: `${name} in ${file.path}` };
    }
    return undefined;
  };
  const disabled = variable("DISABLE_AUTO_COMPACT");
  if (disabled && truthy(disabled.value)) return { from: disabled.from, approximate: false };
  const enabled = files.find((file) => typeof file.data.autoCompactEnabled === "boolean");
  if (enabled?.data.autoCompactEnabled === false)
    return { from: `autoCompactEnabled in ${enabled.path}`, approximate: false };
  if (options.setting)
    return { at: Math.min(options.setting, window), from: AUTO_COMPACT_FROM, approximate: false };
  const set = (value: unknown, from: string) => {
    const size = windowSetting(value);
    if (size === undefined) return undefined;
    return size === "auto" ? undefined : { at: Math.min(size, window), from, approximate: false };
  };
  const forced = variable("CLAUDE_CODE_AUTO_COMPACT_WINDOW");
  const fromVariable = forced && set(forced.value, forced.from);
  if (fromVariable) return fromVariable;
  const id = model ? canonicalModel(model) : undefined;
  for (const file of files) {
    const own = id
      ? Object.entries(record(file.data.modelSettings) ?? {}).find(
          ([key, value]) =>
            canonicalModel(key) === id && record(value)?.autoCompactWindow !== undefined,
        )
      : undefined;
    const value = own ? record(own[1])!.autoCompactWindow : file.data.autoCompactWindow;
    if (value === undefined) continue;
    // The file that sets a window decides, also when it says "auto".
    return (
      set(value, own ? `modelSettings in ${file.path}` : `autoCompactWindow in ${file.path}`) ?? {
        at: defaultCompaction(window),
        from: "Claude Code's default",
        approximate: true,
      }
    );
  }
  return { at: defaultCompaction(window), from: "Claude Code's default", approximate: true };
}

/**
 * Where Pi compacts a session with a `window`: at the window less the tokens
 * that its settings keep free (`compaction.reserveTokens`, 16384 unless the
 * project's .pi/settings.json or Pi's own say otherwise), or past Med's
 * `setting` when that comes first. Pi compacts by itself unless
 * `compaction.enabled` is false.
 */
export async function piCompaction(
  window: number,
  cwd: string | undefined,
  options: { home: string; env?: NodeJS.ProcessEnv; setting?: number },
): Promise<NonNullable<ThreadUsage["context"]>["compaction"]> {
  const agentDir =
    options.env?.PI_CODING_AGENT_DIR ||
    process.env.PI_CODING_AGENT_DIR ||
    join(options.home, ".pi", "agent");
  let enabled = true;
  let reserve = 16_384;
  for (const path of [
    join(agentDir, "settings.json"),
    ...(cwd ? [join(cwd, ".pi", "settings.json")] : []),
  ]) {
    try {
      const compaction = record(record(JSON.parse(await readFile(path, "utf8")))?.compaction);
      if (typeof compaction?.enabled === "boolean") enabled = compaction.enabled;
      if (typeof compaction?.reserveTokens === "number") reserve = compaction.reserveTokens;
    } catch {
      /* No file, or not JSON. */
    }
  }
  const own = enabled && window > reserve ? window - reserve : undefined;
  if (options.setting && (own === undefined || options.setting < own))
    return { at: Math.min(options.setting, window), from: AUTO_COMPACT_FROM, approximate: false };
  return own === undefined
    ? { from: "Pi's settings", approximate: false }
    : { at: own, from: "Pi's default", approximate: true };
}

/** What Med's runner of a session reports: its window, its variables, and
 * the agent and autocompact it runs with. */
export interface OwnedReport {
  window?: number;
  env?: NodeJS.ProcessEnv;
  preset?: string;
  autoCompact?: number;
}

export function createSessionUsage(
  options: {
    home?: () => string;
    /** Med's file of an ACP session's updates, by the session's ID. */
    logs?: (sessionId: string) => string;
  } = {},
) {
  const home = options.home ?? userHome;
  const reads = transcriptReads<Read>(() => ({
    offset: 0,
    rest: Buffer.alloc(0),
    requests: new Map(),
    compacted: false,
  }));
  const running = new Map<string, Promise<Read>>();

  const readFile = (agent: "claude" | "codex" | "acp", path: string, name?: string) => {
    let read = running.get(path);
    if (read) return read;
    const current = reads.get(path);
    read = readMore(agent, path, current, name)
      .then(() => current)
      .finally(() => running.delete(path));
    running.set(path, read);
    return read;
  };

  /** A session's transcripts: its own, and for Claude Code its subagents';
   * for an ACP agent, Med's file of its updates. */
  const transcripts = async (session: AgentSession) => {
    if (session.agent === "acp") {
      const path = options.logs?.(session.id);
      return path
        ? { main: await readFile("acp", path, agentName(session)), subagents: [] as Read[] }
        : undefined;
    }
    const path = await findTranscript(session, home());
    if (!path) return undefined;
    const main = await readFile(session.agent, path);
    if (session.agent === "codex") {
      const children = await Promise.all(
        [...(main.codex?.children ?? [])].map(async (id) => {
          const child = await findTranscript({ agent: "codex", id }, home());
          return child ? readFile("codex", child).catch(() => undefined) : undefined;
        }),
      );
      return { main, subagents: children.filter((entry): entry is Read => !!entry) };
    }
    if (session.agent !== "claude") return { main, subagents: [] };
    const folder = join(dirname(path), session.id, "subagents");
    const names = await readdir(folder).catch(() => [] as string[]);
    const subagents = await Promise.all(
      names
        .filter((name) => name.endsWith(".jsonl"))
        .map((name) => readFile("claude", join(folder, name)).catch(() => undefined)),
    );
    return { main, subagents: subagents.filter((entry): entry is Read => !!entry) };
  };

  return {
    /**
     * The spend of a thread's sessions and the context of `current`, or of
     * the latest session. `owned` gives what an agent that Med runs reports.
     */
    async thread(
      sessions: readonly AgentSession[],
      current: string | undefined,
      owned: (sessionId: string) => OwnedReport | undefined = () => undefined,
    ): Promise<ThreadUsage> {
      const requests = new Map<string, Request & { subagent: boolean }>();
      const models = new Map<string, NonNullable<ThreadUsage["spend"]["models"][number]>>();
      const missing: string[] = [];
      let subagents = 0;
      let subagentCost = 0;
      let total = 0;
      const add = (
        model: string,
        tokens: RequestTokens,
        cost: number | undefined,
        pricedBy?: string,
      ) => {
        const entry = models.get(model) ?? {
          model,
          requests: 0,
          input: 0,
          output: 0,
          cacheWrite5m: 0,
          cacheWrite1h: 0,
          cacheRead: 0,
          webSearches: 0,
          cost: 0,
        };
        entry.requests += 1;
        entry.input += tokens.input;
        entry.output += tokens.output;
        entry.cacheWrite5m += tokens.cacheWrite5m;
        entry.cacheWrite1h += tokens.cacheWrite1h;
        entry.cacheRead += tokens.cacheRead;
        entry.webSearches += tokens.webSearches;
        entry.cost = cost === undefined || entry.cost === null ? null : entry.cost + cost;
        if (pricedBy) entry.pricedBy = pricedBy;
        models.set(model, entry);
        if (cost !== undefined) total += cost;
      };
      const shown = sessions.find((session) => session.id === current) ?? sessions.at(-1);
      let context: ThreadUsage["context"];
      for (const session of sessions) {
        const read = await transcripts(session).catch(() => undefined);
        if (!read) {
          missing.push(agentName(session));
          continue;
        }
        if (session.agent !== "claude" && !read.main.requests.size)
          missing.push(agentName(session));
        // A fork starts with its original's history: a response counts once
        // in the thread, by its message ID.
        for (const [index, file] of [read.main, ...read.subagents].entries()) {
          if (index && file.requests.size) subagents++;
          for (const [id, request] of file.requests) {
            const seen = requests.get(id);
            if (seen) seen.tokens.output = Math.max(seen.tokens.output, request.tokens.output);
            else
              requests.set(id, { ...request, tokens: { ...request.tokens }, subagent: index > 0 });
          }
        }
        if (session !== shown || !read.main.last) continue;
        const last = read.main.last;
        const reported = owned(session.id);
        // Med's autocompact, as the agent runs with it.
        const set = reported?.autoCompact;
        const window = last.window ?? 0;
        const medCompacts =
          set && window
            ? { at: Math.min(set, window), from: AUTO_COMPACT_FROM, approximate: false }
            : undefined;
        if (session.agent === "codex" || session.agent === "acp") {
          const compaction =
            reported?.preset === "pi"
              ? await piCompaction(window, session.cwd, {
                  home: home(),
                  ...(reported.env ? { env: reported.env } : {}),
                  ...(set ? { setting: set } : {}),
                })
              : medCompacts;
          context = {
            sessionId: session.id,
            agent: session.agent,
            ...(read.main.codex?.model ? { model: read.main.codex.model } : {}),
            used: last.used,
            window,
            windowFrom: "agent",
            ...(compaction ? { compaction } : {}),
            compacted: read.main.compacted,
            ...(last.at ? { at: last.at } : {}),
          };
          continue;
        }
        const table = claudeWindow(last.model ?? "");
        const claude = reported?.window ?? table.size;
        context = {
          sessionId: session.id,
          agent: "claude",
          ...(last.model ? { model: last.model } : {}),
          used: last.used,
          window: claude,
          windowFrom: reported?.window ? "agent" : table.known ? "model" : "assumed",
          compaction: await claudeCompaction(last.model, claude, session.cwd, {
            home: home(),
            ...(reported?.env ? { env: reported.env } : {}),
            ...(set ? { setting: set } : {}),
          }),
          compacted: read.main.compacted,
          ...(last.at ? { at: last.at } : {}),
        };
      }
      for (const request of requests.values()) {
        const listed = requestCost(request.model, request.tokens, {
          ...(request.at ? { at: request.at } : {}),
          ...(request.whole ? { whole: true } : {}),
        });
        // A model without Med's price takes the agent's own, as Pi gives it.
        const cost = listed ?? request.agentCost?.cost;
        add(
          request.model,
          request.tokens,
          cost,
          listed === undefined ? request.agentCost?.agent : undefined,
        );
        if (request.subagent && cost !== undefined) subagentCost += cost;
      }
      return {
        ...(context ? { context } : {}),
        spend: {
          total,
          subagents: { count: subagents, cost: subagentCost },
          models: [...models.values()].sort((a, b) => (b.cost ?? -1) - (a.cost ?? -1)),
          missing,
        },
        prices: PRICE_TABLE,
      };
    },
  };
}
