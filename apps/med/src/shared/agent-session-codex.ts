import type {
  MedMeta,
  PlanEntry,
  SessionEvent,
  SessionUpdate,
  ToolCallContent,
  ToolKind,
} from "./agent-session";

/* Codex's rollout: ~/.codex/sessions/YYYY/MM/DD/rollout-<time>-<id>.jsonl.
 * Each line is { timestamp, type, payload }. `response_item` lines hold the
 * model's items (messages, reasoning, tool calls, and their outputs);
 * `event_msg` lines repeat some of them for the terminal and add token
 * counts. The reader takes content from response items and only usage and
 * interruptions from events, so nothing shows twice. */

type Json = Record<string, unknown>;
type DiffContent = Extract<ToolCallContent, { type: "diff" }>;
const record = (value: unknown): Json | undefined =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : undefined;
const text = (value: unknown) => (typeof value === "string" ? value : undefined);
const list = (value: unknown) => (Array.isArray(value) ? value : []);

/** Context that Codex adds to the user's turn; the user did not write it. */
const CONTEXT =
  /^\s*(<(environment_context|user_instructions|user_shell_command|turn_aborted|codex_delegation|[a-z_]+_context)>|# AGENTS\.md instructions\b)/;

/* Codex's subagents (multi-agent v2). The main thread calls tools of the
 * `collaboration` namespace: `spawn_agent` starts a child thread, which has
 * its own rollout; `wait_agent` waits for children; `send_message` and
 * `close_agent` talk to one. The parent's rollout links each spawn call to
 * its child with an `item_completed` event of a `SubAgentActivity` item (its
 * `id` is the call's ID, and it names the child's thread), and a child's
 * report comes back as an `agent_message` item whose author is the child's
 * path. The child's rollout names its parent in
 * `session_meta.source.subagent.thread_spawn.parent_thread_id`. */
const COLLABORATION = new Set([
  "spawn_agent",
  "wait_agent",
  "close_agent",
  "send_message",
  "send_input",
  "followup_task",
  "resume_agent",
  "interrupt_agent",
  "list_agents",
]);

/** Where a Codex rollout comes from, by its `session_meta.source`: one of the
 * user's sessions, an automatic review ("guardian"), or a subagent that a
 * thread spawned. */
export type RolloutSource =
  | { kind: "session" }
  | { kind: "guardian" }
  | { kind: "subagent"; parent: string; path?: string; nickname?: string };

export function rolloutSource(meta: Record<string, unknown> | undefined): RolloutSource {
  const subagent = record(record(meta?.source)?.subagent);
  if (!subagent) return { kind: "session" };
  const spawn = record(subagent.thread_spawn);
  const parent = text(spawn?.parent_thread_id);
  if (parent)
    return {
      kind: "subagent",
      parent,
      ...(text(spawn?.agent_path) ? { path: text(spawn?.agent_path) } : {}),
      ...(text(spawn?.agent_nickname) ? { nickname: text(spawn?.agent_nickname) } : {}),
    };
  // `{ other: "guardian" }`, and any other automatic thread.
  return { kind: "guardian" };
}

/** A subagent's name from its path, such as `/root/backup_review`. */
const agentName = (path: string) =>
  (path.split("/").filter(Boolean).at(-1) ?? path).replaceAll("_", " ");

/** The report in an agent message: its type and its plain payload. */
function agentReport(content: unknown) {
  const header = list(content)
    .map((part) => (record(part)?.type === "input_text" ? (text(record(part)?.text) ?? "") : ""))
    .join("");
  const type = /^Message Type: (\w+)/m.exec(header)?.[1];
  const payload = /\nPayload:\n([\s\S]*)$/.exec(header)?.[1]?.trim();
  return { type, payload };
}

function parseJson(value: unknown): Json | undefined {
  if (typeof value !== "string") return record(value);
  try {
    return record(JSON.parse(value));
  } catch {
    return undefined;
  }
}

/** The script of a shell call: `["bash", "-lc", "rg foo"]` runs "rg foo". */
function scriptOf(args: Json) {
  const command = args.command ?? args.cmd;
  if (typeof command === "string") return command;
  const parts = list(command).map(String);
  if (parts.length === 3 && /(^|\/)(ba|z)?sh$/.test(parts[0]!) && /^-l?c$/.test(parts[1]!))
    return parts[2]!;
  return parts.map((part) => (/\s/.test(part) ? JSON.stringify(part) : part)).join(" ");
}

/** Codex reads and searches through the shell; the first program says which. */
function shellKind(script: string): ToolKind {
  const program = script
    .replace(/^\s*cd\s+\S+\s*&&\s*/, "")
    .trim()
    .split(/\s+/)[0];
  if (["rg", "grep", "ls", "find", "fd"].includes(program ?? "")) return "search";
  if (["cat", "sed", "head", "tail", "nl", "less", "bat"].includes(program ?? "")) return "read";
  return "execute";
}

/** The files of an apply_patch call, as diffs of the changed parts. */
export function patchDiffs(patch: string): DiffContent[] {
  const diffs: DiffContent[] = [];
  let current: { path: string; added: boolean; old: string[]; new: string[] } | undefined;
  const flush = () => {
    if (!current) return;
    diffs.push({
      type: "diff",
      path: current.path,
      oldText: current.added ? null : current.old.join("\n"),
      newText: current.new.join("\n"),
      ...(current.added ? {} : { _meta: { med: { excerpt: true } } }),
    });
    current = undefined;
  };
  for (const line of patch.split("\n")) {
    const header = /^\*\*\* (Add|Update|Delete) File: (.+)$/.exec(line);
    if (header) {
      flush();
      current = { path: header[2]!.trim(), added: header[1] === "Add", old: [], new: [] };
      if (header[1] === "Delete") current.old.push("");
      continue;
    }
    if (!current || line.startsWith("***") || line.startsWith("@@")) continue;
    const mark = line[0];
    const body = line.slice(1);
    if (mark === "+") current.new.push(body);
    else if (mark === "-") current.old.push(body);
    else if (mark === " ") {
      current.old.push(body);
      current.new.push(body);
    }
  }
  flush();
  return diffs;
}

/** The JavaScript string literals passed as `key: "…"` or as the first argument. */
function literals(source: string, pattern: RegExp) {
  const values: string[] = [];
  for (const match of source.matchAll(pattern)) {
    const start = match.index + match[0].length - 1;
    const quote = source[start];
    let end = start + 1;
    while (end < source.length && source[end] !== quote) end += source[end] === "\\" ? 2 : 1;
    const literal = source.slice(start, end + 1);
    try {
      values.push(quote === '"' ? (JSON.parse(literal) as string) : literal.slice(1, -1));
    } catch {
      values.push(literal.slice(1, -1));
    }
  }
  return values;
}

/** Codex Desktop runs tools from a short JavaScript program (`exec`) that calls
 * `tools.exec_command`, `tools.apply_patch`, and other tools. */
export function execProgram(source: string) {
  const tools = [...source.matchAll(/tools\.(\w+)\(/g)].map((match) => match[1]!);
  return {
    tools,
    commands: literals(source, /tools\.exec_command\(\s*\{\s*cmd\s*:\s*["']/g),
    patches: literals(source, /tools\.apply_patch\(\s*["']/g),
  };
}

/** Text of an output that Codex wrote as a list of content parts. */
function outputText(raw: unknown) {
  const parts = Array.isArray(raw)
    ? raw
    : typeof raw === "string" && raw.startsWith("[")
      ? (() => {
          try {
            return JSON.parse(raw) as unknown[];
          } catch {
            return undefined;
          }
        })()
      : undefined;
  if (!parts) return undefined;
  // Each part is a block; most do not end with a newline.
  return parts
    .map((part) => text(record(part)?.text) ?? "")
    .map((part, index, all) =>
      index < all.length - 1 && !part.endsWith("\n") ? `${part}\n` : part,
    )
    .join("");
}

/** One tool result that an exec program printed: a command's output and exit
 * code, an MCP result, or a settled promise around either. */
function execResult(result: Json): { output?: string; exit: number; rejected: boolean } {
  if (result.status === "rejected") {
    const reason = result.reason;
    return {
      output: text(reason) ?? text(record(reason)?.message) ?? "",
      exit: 1,
      rejected: true,
    };
  }
  const inner = record(result.result) ?? record(result.value);
  if (inner) return execResult(inner);
  if (typeof result.value === "string") return { output: result.value, exit: 0, rejected: false };
  const content = list(result.content)
    .map((part) => text(record(part)?.text))
    .filter((part) => part !== undefined);
  return {
    output: text(result.output) ?? (content.length ? content.join("\n") : undefined),
    exit: Number(result.exit_code ?? 0),
    rejected: false,
  };
}

export interface CodexReaderOptions {
  /** Updates of a subagent's rollout belong to the parent's spawn call. */
  parentToolCallId?: string;
  /** A spawn call started a subagent, whose rollout has this thread ID. */
  onSubagent?(threadId: string, toolCallId: string): void;
}

/** Converts rollout lines to session updates, one line at a time. */
export function createCodexRolloutReader(options: CodexReaderOptions = {}) {
  const calls = new Map<
    string,
    { kind: ToolKind; name: string; diffs?: DiffContent[]; command?: boolean }
  >();
  /** Spawn calls by their child's path and by their child's thread. */
  const spawned = new Map<string, string>();
  let at = 0;
  let cwd: string | undefined;
  let sequence = 0;
  let idle = true;
  let metas = 0;
  // A subagent's rollout can start with a copy of its parent's history (a
  // second session_meta); its own work starts when its task arrives.
  let copied = false;
  const relative = (path: string) =>
    cwd && path.startsWith(`${cwd}/`) ? path.slice(cwd.length + 1) : path;
  const withParent = (update: SessionUpdate): SessionUpdate => {
    if (!options.parentToolCallId) return update;
    const meta = (update as { _meta?: MedMeta })._meta;
    return {
      ...update,
      _meta: { med: { ...meta?.med, parentToolCallId: options.parentToolCallId } },
    } as SessionUpdate;
  };
  /** A spawn call's child, by the path or the thread that names it. */
  const spawnOf = (key: string | undefined) => (key ? spawned.get(key) : undefined);

  function call(
    id: string,
    name: string,
    args: Json,
    raw: unknown,
    namespace?: string,
  ): SessionUpdate[] {
    if (name === "update_plan") {
      calls.set(id, { kind: "think", name });
      const entries: PlanEntry[] = list(args.plan).map((step) => {
        const item = record(step);
        const status = text(item?.status);
        return {
          content: text(item?.step) ?? "",
          priority: "medium",
          status: status === "completed" || status === "in_progress" ? status : "pending",
        };
      });
      return [{ sessionUpdate: "plan", entries }];
    }
    if (name === "shell" || name === "exec_command" || name === "local_shell") {
      const script = scriptOf(args);
      const kind = shellKind(script);
      calls.set(id, { kind, name });
      return [
        {
          sessionUpdate: "tool_call",
          toolCallId: id,
          title: script.split("\n")[0]!,
          kind,
          status: "in_progress",
          rawInput: {
            command: script,
            ...(text(args.workdir) ? { workdir: text(args.workdir) } : {}),
          },
          _meta: { med: { tool: name } },
        },
      ];
    }
    if (name === "apply_patch") {
      const diffs = patchDiffs(typeof raw === "string" ? raw : (text(args.input) ?? ""));
      calls.set(id, { kind: "edit", name, diffs });
      const title =
        diffs.length === 1
          ? `${diffs[0]!.oldText === null ? "Write" : "Edit"} ${relative(diffs[0]!.path)}`
          : `Edit ${diffs.length} files`;
      return [
        {
          sessionUpdate: "tool_call",
          toolCallId: id,
          title,
          kind: "edit",
          status: "in_progress",
          content: diffs,
          locations: diffs.map((diff) => ({ path: diff.path })),
          _meta: { med: { tool: name } },
        },
      ];
    }
    if (name === "exec" && typeof args.input === "string") {
      const program = execProgram(args.input);
      const diffs = program.patches.flatMap(patchDiffs);
      const kinds = program.commands.map(shellKind);
      // A patch is the main step of a program that also formats or checks it,
      // so the row is an edit; its commands show in the details.
      const kind: ToolKind = diffs.length
        ? "edit"
        : program.commands.length === 0
          ? program.tools.includes("web__run")
            ? "fetch"
            : "other"
          : kinds.includes("execute")
            ? "execute"
            : kinds.includes("read")
              ? "read"
              : "search";
      const first = program.commands[0]?.split("\n")[0];
      const title =
        diffs.length === 1
          ? `${diffs[0]!.oldText === null ? "Write" : "Edit"} ${relative(diffs[0]!.path)}`
          : diffs.length
            ? `Edit ${diffs.length} files`
            : first
              ? `${first}${program.commands.length > 1 ? ` (+${program.commands.length - 1} more)` : ""}`
              : program.tools.includes("write_stdin")
                ? "Write to a running command"
                : program.tools.includes("view_image")
                  ? "View an image"
                  : program.tools.includes("web__run")
                    ? "Search the web"
                    : (program.tools[0]
                        ?.replace(/^mcp__(.+?)__(.+)$/, "$2 · $1")
                        .replaceAll("_", " ") ?? "Run a script");
      calls.set(id, { kind, name, diffs, command: program.commands.length > 0 });
      return [
        {
          sessionUpdate: "tool_call",
          toolCallId: id,
          title,
          kind,
          status: "in_progress",
          ...(program.commands.length
            ? { rawInput: { command: program.commands.join("\n") } }
            : {}),
          ...(diffs.length
            ? { content: diffs, locations: diffs.map((diff) => ({ path: diff.path })) }
            : {}),
          _meta: { med: { tool: name } },
        },
      ];
    }
    if (COLLABORATION.has(name) && (namespace === undefined || namespace === "collaboration")) {
      calls.set(id, { kind: "other", name });
      const target = text(args.target) ?? text(args.task_name);
      const targets = list(args.targets).map(String);
      const title =
        name === "spawn_agent"
          ? target
            ? capitalize(agentName(target))
            : "Subagent"
          : name === "wait_agent"
            ? targets.length
              ? `Wait for ${targets.map(agentName).join(", ")}`
              : "Wait for subagents"
            : name === "close_agent"
              ? `Close ${target ? agentName(target) : "a subagent"}`
              : name === "list_agents"
                ? "List subagents"
                : name === "interrupt_agent"
                  ? `Interrupt ${target ? agentName(target) : "a subagent"}`
                  : `Message ${target ? agentName(target) : "a subagent"}`;
      if (name === "spawn_agent" && target) spawned.set(`/root/${target}`, id);
      return [
        {
          sessionUpdate: "tool_call",
          toolCallId: id,
          title,
          kind: "other",
          status: "in_progress",
          _meta: {
            med: {
              tool: name,
              ...(name === "spawn_agent" ? { background: { id, kind: "agent" as const } } : {}),
            },
          },
        },
      ];
    }
    calls.set(id, { kind: "other", name });
    const described = text(args.title) ?? text(args.description);
    return [
      {
        sessionUpdate: "tool_call",
        toolCallId: id,
        title:
          described ??
          (namespace
            ? `${name.replaceAll("_", " ")} · ${namespace.replace(/^mcp__/, "").replaceAll("_", " ")}`
            : name),
        kind: "other",
        status: "in_progress",
        rawInput: args,
        _meta: { med: { tool: name } },
      },
    ];
  }

  function output(id: string, raw: unknown): SessionUpdate[] {
    const known = calls.get(id);
    if (!known || known.name === "update_plan") return [];
    if (COLLABORATION.has(known.name)) {
      const result = parseJson(raw);
      if (known.name === "spawn_agent") {
        // The child runs on; its report or its end completes the call.
        const path = text(result?.task_name);
        if (path) spawned.set(path, id);
        const child = text(result?.agent_id) ?? text(result?.thread_id);
        if (child) {
          spawned.set(child, id);
          options.onSubagent?.(child, id);
        }
        return [];
      }
      const message =
        text(result?.message) ?? (typeof raw === "string" && !result ? raw : undefined);
      const timedOut = result?.timed_out === true;
      if (known.name === "close_agent") {
        const done = spawnOf(text(result?.task_name));
        if (done)
          return [{ sessionUpdate: "tool_call_update", toolCallId: done, status: "completed" }];
      }
      return [
        {
          sessionUpdate: "tool_call_update",
          toolCallId: id,
          status: "completed",
          ...(message || timedOut
            ? {
                content: [
                  {
                    type: "content" as const,
                    content: { type: "text" as const, text: timedOut ? "Timed out" : message! },
                  },
                ],
              }
            : {}),
        },
      ];
    }
    // Older rollouts wrap the output as JSON with its exit code; newer ones write
    // "Exit code: N" and the output as text.
    const listed = outputText(raw);
    const parsed = listed === undefined ? parseJson(raw) : undefined;
    const body = listed ?? text(parsed?.output) ?? text(raw) ?? "";
    let code = Number(
      record(parsed?.metadata)?.exit_code ?? /^Exit code: (\d+)/m.exec(body)?.[1] ?? 0,
    );
    let shown = body
      .replace(
        /^(Exit code: \d+|Wall time:? .*|Total output lines: \d+|Script (completed|failed))\n?/gm,
        "",
      )
      .replace(/^Output:\n?/m, "");
    // An exec program prints one JSON result per tool call: its output and exit
    // code. Outputs written as parts can hold the same results.
    if (known.name === "exec" || listed !== undefined) {
      let rejected = /^Script failed/m.test(body);
      shown = shown
        .split("\n")
        .map((line) => {
          const value = parseJson(line.trim().startsWith("{") ? line : undefined);
          if (!value) return line;
          const result = execResult(value);
          if (result.rejected) rejected = true;
          if (result.exit) code = result.exit;
          // A patch's report repeats the diff that the row shows.
          if (result.output?.startsWith("Success. Updated the following files:")) return undefined;
          // An empty result, such as `{}`, adds no line; an unknown one shows as it is.
          if (result.output === undefined) return Object.keys(value).length ? line : undefined;
          return result.output ? result.output.replace(/\n$/, "") : undefined;
        })
        .filter((line) => line !== undefined)
        .join("\n");
      if (rejected && !code) code = 1;
    }
    const failed = code !== 0 || /^(apply_patch )?(verification )?failed/i.test(shown.trim());
    return [
      {
        sessionUpdate: "tool_call_update",
        toolCallId: id,
        status: failed ? "failed" : "completed",
        // A call keeps its diffs; output follows them, except a patch's own report.
        content: [
          ...(known.diffs ?? []),
          ...(shown.trim() && (known.kind !== "edit" || known.command || failed)
            ? [
                {
                  type: "content" as const,
                  content: { type: "text" as const, text: shown.trimEnd() },
                },
              ]
            : []),
        ],
        rawOutput: raw,
      },
    ];
  }

  function convert(entry: Json): SessionUpdate[] {
    const payload = record(entry.payload);
    if (!payload) return [];
    if (entry.type === "session_meta") {
      metas++;
      if (metas === 2 && options.parentToolCallId) copied = true;
      if (metas === 1) cwd = text(payload.cwd) ?? cwd;
      return [];
    }
    if (entry.type === "turn_context") {
      cwd = text(payload.cwd) ?? cwd;
      return [];
    }
    if (copied) {
      // The copy ends where the child's own settings and task arrive.
      if (
        (entry.type === "event_msg" && payload.type === "thread_settings_applied") ||
        entry.type === "inter_agent_communication_metadata" ||
        (entry.type === "response_item" && payload.type === "agent_message")
      )
        copied = false;
      else return [];
    }
    if (entry.type === "event_msg" && payload.type === "item_completed") {
      const item = record(payload.item);
      if (item?.type !== "SubAgentActivity") return [];
      const thread = text(item.agent_thread_id);
      const path = text(item.agent_path);
      const call = text(item.id);
      if (item.kind === "started" && thread && call && calls.has(call)) {
        spawned.set(thread, call);
        if (path) spawned.set(path, call);
        options.onSubagent?.(thread, call);
        return [];
      }
      const done = spawnOf(thread) ?? spawnOf(path);
      return item.kind === "completed" && done
        ? [{ sessionUpdate: "tool_call_update", toolCallId: done, status: "completed" }]
        : [];
    }
    if (entry.type === "event_msg") {
      if (payload.type === "task_started") idle = false;
      if (payload.type === "task_complete" || payload.type === "turn_aborted") idle = true;
      if (payload.type === "token_count") {
        const info = record(payload.info);
        const used = Number(
          record(info?.last_token_usage)?.input_tokens ??
            record(info?.total_token_usage)?.input_tokens,
        );
        const size = Number(info?.model_context_window);
        return Number.isFinite(used) && Number.isFinite(size)
          ? [{ sessionUpdate: "usage_update", size, used }]
          : [];
      }
      if (payload.type === "turn_aborted")
        return [{ sessionUpdate: "notice", title: "Interrupted", severity: "warning" }];
      if (payload.type === "error" && text(payload.message))
        return [{ sessionUpdate: "notice", title: text(payload.message)!, severity: "error" }];
      return [];
    }
    if (entry.type !== "response_item") return [];
    switch (payload.type) {
      case "agent_message": {
        // Between agents: a child's report to its parent, or a parent's task
        // to its child. Codex encrypts a task; a report is plain text.
        const author = text(payload.author);
        const { type, payload: body } = agentReport(payload.content);
        const call = spawnOf(author);
        if (call && body)
          return [
            {
              sessionUpdate: "tool_call_update",
              toolCallId: call,
              ...(type === "FINAL_ANSWER" ? { status: "completed" as const } : {}),
              content: [{ type: "content", content: { type: "text", text: body } }],
            },
          ];
        if (options.parentToolCallId && type === "NEW_TASK" && body)
          return [
            {
              sessionUpdate: "user_message_chunk",
              content: { type: "text", text: body },
              messageId: text(payload.id) ?? `task-${++sequence}`,
            },
          ];
        return [];
      }
      case "message": {
        const role = payload.role;
        if (role !== "user" && role !== "assistant") return [];
        const body = list(payload.content)
          .map((part) => text(record(part)?.text) ?? "")
          .join("");
        if (!body.trim() || (role === "user" && CONTEXT.test(body))) return [];
        const messageId = text(payload.id) ?? `message-${++sequence}`;
        return [
          {
            sessionUpdate: role === "user" ? "user_message_chunk" : "agent_message_chunk",
            content: { type: "text", text: body },
            messageId,
          },
        ];
      }
      case "reasoning": {
        const summary = list(payload.summary)
          .map((part) => text(record(part)?.text) ?? "")
          .filter(Boolean)
          .join("\n\n");
        return [
          {
            sessionUpdate: "agent_thought_chunk",
            content: { type: "text", text: summary },
            messageId: text(payload.id) ?? `reasoning-${++sequence}`,
          },
        ];
      }
      case "function_call": {
        const id = text(payload.call_id);
        const name = text(payload.name);
        return id && name
          ? call(
              id,
              name,
              parseJson(payload.arguments) ?? {},
              payload.arguments,
              text(payload.namespace),
            )
          : [];
      }
      case "custom_tool_call": {
        const id = text(payload.call_id);
        const name = text(payload.name);
        return id && name ? call(id, name, { input: payload.input }, payload.input) : [];
      }
      case "local_shell_call": {
        const id = text(payload.call_id);
        const action = record(payload.action);
        return id ? call(id, "local_shell", { command: action?.command }, action) : [];
      }
      case "function_call_output":
      case "custom_tool_call_output": {
        const id = text(payload.call_id);
        return id ? output(id, payload.output) : [];
      }
      case "compaction":
        return [
          {
            sessionUpdate: "compaction_update",
            compactionId: text(payload.id) ?? `compaction-${++sequence}`,
            status: "completed",
          },
        ];
      case "web_search_call": {
        const query = text(record(payload.action)?.query);
        return [
          {
            sessionUpdate: "tool_call",
            toolCallId: text(payload.id) ?? `search-${++sequence}`,
            title: query ? `Search the web for “${query}”` : "Search the web",
            kind: "fetch",
            status: payload.status === "failed" ? "failed" : "completed",
          },
        ];
      }
    }
    return [];
  }

  return {
    /** True after Codex finishes a task, until the next one starts. */
    idle: () => idle,
    line(raw: string): SessionEvent[] {
      if (!raw.trim()) return [];
      let entry: Json | undefined;
      try {
        entry = record(JSON.parse(raw));
      } catch {
        return [];
      }
      if (!entry) return [];
      const time = Date.parse(text(entry.timestamp) ?? "");
      if (Number.isFinite(time)) at = time;
      return convert(entry).map((update) => ({ at, update: withParent(update) }));
    },
  };
}

const capitalize = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);

export function readCodexRollout(source: string, options?: CodexReaderOptions): SessionEvent[] {
  const reader = createCodexRolloutReader(options);
  return source.split("\n").flatMap((line) => reader.line(line));
}
