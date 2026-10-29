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
import { findTranscript } from "./agent-transcripts";
import { userHome } from "./service/discover";

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

const CHUNK = 4 * 1024 * 1024;
/** Transcripts whose reads Med keeps, at most. */
const MAX_FILES = 128;

type Json = Record<string, unknown>;
const record = (value: unknown) =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : undefined;
const count = (value: unknown) => (typeof value === "number" && value > 0 ? value : 0);

interface Request {
  model: string;
  tokens: RequestTokens;
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
  if (known) known.tokens.output = Math.max(known.tokens.output, tokens.output);
  else state.requests.set(id, { model, tokens });
  if (entry.isSidechain || !promptOf(tokens)) return;
  const at = Date.parse(String(entry.timestamp ?? ""));
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
    state.requests.set(id, { model: model(), tokens: codexTokens(usage) });
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
    });
    codex.totals = totals;
  }
  const used = count(last?.input_tokens);
  const window = count(info?.model_context_window);
  const at = Date.parse(String(entry.timestamp ?? ""));
  if (used && window) state.last = { used, window, ...(Number.isFinite(at) ? { at } : {}) };
}

/** Reads the lines that a transcript gained since the last read. */
async function readMore(agent: "claude" | "codex", path: string, state: Read) {
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
        else codexLine(line, state);
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
 * `--autocompact` flag, so a session started with those can differ.
 */
export async function claudeCompaction(
  model: string | undefined,
  window: number,
  cwd: string | undefined,
  options: { home: string; env?: NodeJS.ProcessEnv },
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

export function createSessionUsage(options: { home?: () => string } = {}) {
  const home = options.home ?? userHome;
  const reads = new Map<string, Read>();
  const running = new Map<string, Promise<Read>>();

  const readFile = (agent: "claude" | "codex", path: string) => {
    let read = running.get(path);
    if (read) return read;
    let state = reads.get(path);
    if (!state) {
      state = { offset: 0, rest: Buffer.alloc(0), requests: new Map(), compacted: false };
      if (reads.size >= MAX_FILES) reads.delete(reads.keys().next().value!);
      reads.set(path, state);
    }
    const current = state;
    read = readMore(agent, path, current)
      .then(() => current)
      .finally(() => running.delete(path));
    running.set(path, read);
    return read;
  };

  /** A session's transcripts: its own, and for Claude Code its subagents'. */
  const transcripts = async (session: AgentSession) => {
    if (session.agent === "acp") return undefined;
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
      owned: (sessionId: string) => { window?: number; env?: NodeJS.ProcessEnv } | undefined = () =>
        undefined,
    ): Promise<ThreadUsage> {
      const requests = new Map<string, Request & { subagent: boolean }>();
      const models = new Map<string, NonNullable<ThreadUsage["spend"]["models"][number]>>();
      const missing: string[] = [];
      let subagents = 0;
      let subagentCost = 0;
      let total = 0;
      const add = (model: string, tokens: RequestTokens, cost: number | undefined) => {
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
        if (session.agent === "codex" && !read.main.requests.size) missing.push(agentName(session));
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
        if (session.agent === "codex") {
          context = {
            sessionId: session.id,
            agent: "codex",
            ...(read.main.codex?.model ? { model: read.main.codex.model } : {}),
            used: last.used,
            window: last.window ?? 0,
            windowFrom: "agent",
            compacted: false,
            ...(last.at ? { at: last.at } : {}),
          };
          continue;
        }
        const table = claudeWindow(last.model ?? "");
        const window = reported?.window ?? table.size;
        context = {
          sessionId: session.id,
          agent: "claude",
          ...(last.model ? { model: last.model } : {}),
          used: last.used,
          window,
          windowFrom: reported?.window ? "agent" : table.known ? "model" : "assumed",
          compaction: await claudeCompaction(last.model, window, session.cwd, {
            home: home(),
            ...(reported?.env ? { env: reported.env } : {}),
          }),
          compacted: read.main.compacted,
          ...(last.at ? { at: last.at } : {}),
        };
      }
      for (const request of requests.values()) {
        const cost = requestCost(request.model, request.tokens);
        add(request.model, request.tokens, cost);
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
