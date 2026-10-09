import type {
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
const CONTEXT = /^\s*<(environment_context|user_instructions|user_shell_command|turn_aborted)>/;

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

/** Converts rollout lines to session updates, one line at a time. */
export function createCodexRolloutReader() {
  const calls = new Map<string, { kind: ToolKind; name: string }>();
  let at = 0;
  let cwd: string | undefined;
  let sequence = 0;
  const relative = (path: string) =>
    cwd && path.startsWith(`${cwd}/`) ? path.slice(cwd.length + 1) : path;

  function call(id: string, name: string, args: Json, raw: unknown): SessionUpdate[] {
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
      calls.set(id, { kind: "edit", name });
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
    calls.set(id, { kind: "other", name });
    return [
      {
        sessionUpdate: "tool_call",
        toolCallId: id,
        title: name,
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
    // Older rollouts wrap the output as JSON with its exit code; newer ones write
    // "Exit code: N" and the output as text.
    const parsed = parseJson(raw);
    const body = text(parsed?.output) ?? text(raw) ?? "";
    const code = Number(
      record(parsed?.metadata)?.exit_code ?? /^Exit code: (\d+)/m.exec(body)?.[1] ?? 0,
    );
    const shown = body
      .replace(/^(Exit code: \d+|Wall time: .*|Total output lines: \d+)\n/gm, "")
      .replace(/^Output:\n/m, "");
    const failed = code !== 0 || /^(apply_patch )?(verification )?failed/i.test(shown.trim());
    return [
      {
        sessionUpdate: "tool_call_update",
        toolCallId: id,
        status: failed ? "failed" : "completed",
        // An edit keeps its diff; a failed edit adds the message.
        ...(known.kind !== "edit"
          ? {
              content: shown.trim()
                ? [{ type: "content", content: { type: "text", text: shown.trimEnd() } }]
                : [],
            }
          : failed
            ? { content: [{ type: "content", content: { type: "text", text: shown.trim() } }] }
            : {}),
        rawOutput: raw,
      },
    ];
  }

  function convert(entry: Json): SessionUpdate[] {
    const payload = record(entry.payload);
    if (!payload) return [];
    if (entry.type === "session_meta" || entry.type === "turn_context") {
      cwd = text(payload.cwd) ?? cwd;
      return [];
    }
    if (entry.type === "event_msg") {
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
          ? call(id, name, parseJson(payload.arguments) ?? {}, payload.arguments)
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
      return convert(entry).map((update) => ({ at, update }));
    },
  };
}

export function readCodexRollout(source: string): SessionEvent[] {
  const reader = createCodexRolloutReader();
  return source.split("\n").flatMap((line) => reader.line(line));
}
