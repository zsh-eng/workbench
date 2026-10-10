import type {
  ContentBlock,
  MedMeta,
  PlanEntry,
  SessionEvent,
  SessionUpdate,
  ToolCallContent,
  ToolCallLocation,
  ToolCallStatus,
  ToolKind,
} from "./agent-session";

/* Claude Code's transcript: ~/.claude/projects/<project>/<session>.jsonl.
 * Claude Code appends one line per finished block: a text reply, a thought, a
 * tool call, or a tool result. Most other lines are bookkeeping. The format is
 * not documented and changes between versions, so every field is optional
 * here and unknown lines make no updates. */

type Json = Record<string, unknown>;
type DiffContent = Extract<ToolCallContent, { type: "diff" }>;
const record = (value: unknown): Json | undefined =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : undefined;
const text = (value: unknown) => (typeof value === "string" ? value : undefined);
const list = (value: unknown) => (Array.isArray(value) ? value : []);

const KINDS: Record<string, ToolKind> = {
  Read: "read",
  NotebookRead: "read",
  Edit: "edit",
  MultiEdit: "edit",
  Write: "edit",
  NotebookEdit: "edit",
  Grep: "search",
  Glob: "search",
  ToolSearch: "search",
  Skill: "think",
  AskUserQuestion: "other",
  Bash: "execute",
  BashOutput: "execute",
  KillShell: "execute",
  TaskStop: "execute",
  Monitor: "execute",
  WebFetch: "fetch",
  WebSearch: "fetch",
  TodoWrite: "think",
  TaskCreate: "think",
  TaskUpdate: "think",
  TaskList: "think",
  TaskGet: "think",
  EnterPlanMode: "switch_mode",
  ExitPlanMode: "switch_mode",
};
/** System reminders and similar wrappers that the agent reads but the user did not write. */
const HIDDEN = /<(system-reminder|local-command-caveat)>[\s\S]*?<\/\1>/g;

function oneLine(value: string, length = 96) {
  const line = value.trim().split("\n")[0]!.replace(/\s+/g, " ");
  return line.length > length ? `${line.slice(0, length - 1)}…` : line;
}

export interface ClaudeReaderOptions {
  /** Updates of a subagent's transcript belong to the parent's tool call. */
  parentToolCallId?: string;
  /** A tool call started a subagent; its transcript is subagents/agent-<id>.jsonl. */
  onSubagent?(agentId: string, toolCallId: string): void;
}

/**
 * Converts transcript lines to session updates, one line at a time, so a
 * reader can follow a live transcript as it grows. It keeps the tool calls it
 * has seen, because a result arrives on a later line than its call.
 */
export function createClaudeTranscriptReader(options: ClaudeReaderOptions = {}) {
  const tools = new Map<string, { name: string; input: Json; diff?: DiffContent }>();
  // Files whose whole text the session has shown, to give later edits line numbers.
  const files = new Map<string, string>();
  // Background shells and agents report on later lines; map them to their calls.
  const background = new Map<string, string>();
  const tasks = new Map<string, PlanEntry>();
  const queued = new Set<string>();
  let compaction: string | undefined;
  // The agent waits for the user after a reply that ends its turn.
  let idle = true;
  let at = 0;
  let cwd: string | undefined;

  const meta = (extra?: NonNullable<MedMeta["med"]>): Partial<{ _meta: MedMeta }> => {
    const med = {
      ...(options.parentToolCallId ? { parentToolCallId: options.parentToolCallId } : {}),
      ...extra,
    };
    return Object.keys(med).length ? { _meta: { med } } : {};
  };
  const relative = (path: string) =>
    cwd && path.startsWith(`${cwd}/`) ? path.slice(cwd.length + 1) : path;
  const plan = (): SessionUpdate => ({
    sessionUpdate: "plan",
    entries: [...tasks.values()],
    ...meta(),
  });

  function titleOf(name: string, input: Json): string {
    const path = text(input.file_path) ?? text(input.notebook_path) ?? text(input.path);
    switch (name) {
      case "Bash":
        return oneLine(text(input.description) ?? text(input.command) ?? "Run a command");
      case "Read": {
        const offset = Number(input.offset);
        const limit = Number(input.limit);
        const range =
          Number.isFinite(offset) && Number.isFinite(limit)
            ? ` · lines ${offset}–${offset + limit - 1}`
            : "";
        return `Read ${relative(path ?? "a file")}${range}`;
      }
      case "Edit":
      case "MultiEdit":
        return `Edit ${relative(path ?? "a file")}`;
      case "Write":
        return `Write ${relative(path ?? "a file")}`;
      case "Grep":
        // A search of the whole working directory names no folder.
        return `Search “${oneLine(text(input.pattern) ?? "", 48)}”${path && path !== cwd ? ` in ${relative(path)}` : ""}`;
      case "Glob":
        return `Find ${text(input.pattern) ?? "files"}`;
      case "WebFetch":
        return `Fetch ${text(input.url) ?? "a page"}`;
      case "WebSearch":
        return `Search the web for “${oneLine(text(input.query) ?? "", 60)}”`;
      case "Agent":
      case "Task":
        return oneLine(text(input.description) ?? "Run a subagent");
      case "Skill":
        return `Use the ${text(input.skill) ?? "a"} skill`;
      case "AskUserQuestion": {
        const question = record(list(input.questions)[0]);
        return `Ask “${oneLine(text(question?.question) ?? "a question", 60)}”`;
      }
      case "TaskStop":
      case "KillShell":
        return `Stop task ${text(input.task_id) ?? text(input.shell_id) ?? ""}`.trim();
      case "SendUserFile": {
        const files = list(input.files).map((file) => String(file).split("/").at(-1));
        return `Send ${files.join(", ") || "a file"}`;
      }
      case "ToolSearch":
        return `Find tools “${oneLine(text(input.query) ?? "", 48)}”`;
      case "TodoWrite":
        return "Update the plan";
      case "TaskCreate":
        return `Add task “${oneLine(text(input.subject) ?? text(input.description) ?? "", 60)}”`;
      case "TaskUpdate":
        return `Mark a task ${text(input.status)?.replace("_", " ") ?? "changed"}`;
      default: {
        const mcp = /^mcp__(.+?)__(.+)$/.exec(name);
        if (mcp) return `${mcp[2]!.replaceAll("_", " ")} · ${mcp[1]!.replace(/^[^_]*_/, "")}`;
        return name;
      }
    }
  }

  function locationsOf(name: string, input: Json): ToolCallLocation[] | undefined {
    const path = text(input.file_path) ?? text(input.notebook_path);
    if (!path) return undefined;
    const line = Number(input.offset);
    return [{ path, ...(name === "Read" && Number.isFinite(line) ? { line } : {}) }];
  }

  /** The diff of an edit: the whole file when its text is known, else the edited part. */
  function editDiff(name: string, input: Json, before?: string): DiffContent | undefined {
    const path = text(input.file_path);
    if (!path) return undefined;
    if (name === "Write")
      return { type: "diff", path, oldText: before ?? null, newText: text(input.content) ?? "" };
    if (name !== "Edit") return undefined;
    const oldText = text(input.old_string) ?? "";
    const newText = text(input.new_string) ?? "";
    if (before !== undefined && before.includes(oldText)) {
      const after = input.replace_all
        ? before.split(oldText).join(newText)
        : before.replace(oldText, () => newText);
      return { type: "diff", path, oldText: before, newText: after };
    }
    return { type: "diff", path, oldText, newText, _meta: { med: { excerpt: true } } };
  }

  function call(id: string, name: string, input: Json): SessionUpdate[] {
    const path = text(input.file_path);
    const diff = editDiff(name, input, path ? files.get(path) : undefined);
    tools.set(id, { name, input, diff });
    // A subagent's report to its caller is its last message and ends its turn.
    if (name === "SubagentHandback") idle = true;
    if (name === "SubagentHandback" && text(input.message))
      return [
        {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: text(input.message)! },
          messageId: id,
          ...meta(),
        },
      ];
    const updates: SessionUpdate[] = [];
    const locations = locationsOf(name, input);
    updates.push({
      sessionUpdate: "tool_call",
      toolCallId: id,
      title: titleOf(name, input),
      kind: KINDS[name] ?? "other",
      status: "in_progress",
      rawInput: input,
      ...(diff ? { content: [diff] } : {}),
      ...(locations ? { locations } : {}),
      ...meta({ tool: name }),
    });
    // A stopped background task sends no notification; the stop ends its call.
    if (name === "TaskStop" || name === "KillShell") {
      const stopped = background.get(text(input.task_id) ?? text(input.shell_id) ?? "");
      if (stopped)
        updates.push({
          sessionUpdate: "tool_call_update",
          toolCallId: stopped,
          status: "completed",
          ...meta(),
        });
    }
    if (name === "TodoWrite") {
      tasks.clear();
      list(input.todos).forEach((todo, index) => {
        const item = record(todo);
        const status = text(item?.status);
        tasks.set(String(index), {
          content: text(item?.content) ?? "",
          priority: "medium",
          status: status === "completed" || status === "in_progress" ? status : "pending",
        });
      });
      updates.push(plan());
    }
    if (name === "TaskUpdate") {
      const task = tasks.get(String(input.taskId));
      const status = text(input.status);
      if (task && (status === "pending" || status === "in_progress" || status === "completed")) {
        tasks.set(String(input.taskId), { ...task, status });
        updates.push(plan());
      } else if (task && status === "deleted") {
        tasks.delete(String(input.taskId));
        updates.push(plan());
      }
    }
    return updates;
  }

  function outputOf(block: Json): ContentBlock[] {
    const content = block.content;
    const clean = (value: string) => value.replace(/<\/?tool_use_error>/g, "");
    if (typeof content === "string") return content ? [{ type: "text", text: clean(content) }] : [];
    return list(content).flatMap((part): ContentBlock[] => {
      const item = record(part);
      if (item?.type === "text" && text(item.text))
        return [{ type: "text", text: clean(text(item.text)!) }];
      const source = record(item?.source);
      if (item?.type === "image" && text(source?.data))
        return [
          {
            type: "image",
            data: text(source!.data)!,
            mimeType: text(source!.media_type) ?? "image/png",
          },
        ];
      return [];
    });
  }

  function result(block: Json, structured: unknown): SessionUpdate[] {
    const id = text(block.tool_use_id);
    if (!id) return [];
    const tool = tools.get(id);
    const name = tool?.name ?? "";
    if (name === "SubagentHandback") return [];
    const input = tool?.input ?? {};
    const detail = record(structured);
    let status: ToolCallStatus = block.is_error ? "failed" : "completed";
    const output: ToolCallContent[] = outputOf(block).map((part) => ({
      type: "content",
      content: part,
    }));
    const extra: NonNullable<MedMeta["med"]> = { tool: name };
    const updates: SessionUpdate[] = [];
    if (name === "Bash" && detail) {
      if (detail.interrupted) status = "failed";
      const task = text(detail.backgroundTaskId);
      if (task) {
        background.set(task, id);
        extra.background = { id: task, kind: "shell" };
        status = "in_progress";
      }
    }
    if ((name === "Agent" || name === "Task") && detail) {
      const agent = text(detail.agentId);
      if (agent) options.onSubagent?.(agent, id);
      if (agent && (detail.isAsync || detail.status === "async_launched")) {
        background.set(agent, id);
        extra.background = { id: agent, kind: "agent" };
        status = "in_progress";
      }
    }
    // An edit shows its diff. The result adds the file's text before the
    // edit when Claude Code records it, so the diff gets line numbers.
    let content = output;
    const path = text(input.file_path);
    if ((name === "Edit" || name === "Write") && path) {
      const before =
        detail && typeof detail.originalFile === "string" ? detail.originalFile : files.get(path);
      const diff = before !== undefined ? editDiff(name, input, before) : tool?.diff;
      if (diff) content = status === "failed" ? [diff, ...output] : [diff];
      if (status === "completed" && diff && !diff._meta?.med?.excerpt)
        files.set(path, diff.newText);
      else if (status === "completed") files.delete(path);
    }
    if (name === "TaskCreate") {
      const said = output
        .map((part) =>
          part.type === "content" && part.content.type === "text" ? part.content.text : "",
        )
        .join(" ");
      const task = record(detail?.task);
      const taskId = task?.id !== undefined ? String(task.id) : /#(\d+)/.exec(said)?.[1];
      if (taskId) {
        tasks.set(taskId, {
          content: text(input.subject) ?? text(input.description) ?? `Task ${taskId}`,
          priority: "medium",
          status: "pending",
        });
        updates.push(plan());
      }
    }
    updates.unshift({
      sessionUpdate: "tool_call_update",
      toolCallId: id,
      status,
      content,
      rawOutput: structured,
      ...meta(extra),
    });
    return updates;
  }

  /** `<task-notification>` messages report on background shells and agents. */
  function notification(body: string): SessionUpdate[] {
    const field = (name: string) =>
      new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(body)?.[1]?.trim();
    const task = field("task-id");
    const id = task ? background.get(task) : undefined;
    if (!id) return [];
    const state = field("status");
    const summary = field("summary");
    return [
      {
        sessionUpdate: "tool_call_update",
        toolCallId: id,
        status:
          state === "completed"
            ? "completed"
            : state === "failed" || state === "killed"
              ? "failed"
              : "in_progress",
        ...(summary
          ? { content: [{ type: "content", content: { type: "text", text: summary } }] }
          : {}),
        ...meta(),
      },
    ];
  }

  function userText(raw: string): SessionUpdate[] {
    if (raw.includes("<task-notification>")) return notification(raw);
    if (/^\s*\[Request interrupted by user/.test(raw))
      return [{ sessionUpdate: "notice", title: "Interrupted", severity: "warning", ...meta() }];
    const command = /<command-name>([\s\S]*?)<\/command-name>/.exec(raw);
    if (command)
      return [
        {
          sessionUpdate: "notice",
          title: `Ran ${command[1]!.trim()}`,
          severity: "info",
          ...meta(),
        },
      ];
    if (raw.includes("<local-command-stdout>")) return [];
    const visible = raw.replace(HIDDEN, "").trim();
    if (!visible) return [];
    if (queued.delete(visible)) return [];
    return [
      { sessionUpdate: "user_message_chunk", content: { type: "text", text: visible }, ...meta() },
    ];
  }

  function convert(entry: Json): SessionUpdate[] {
    const type = entry.type;
    if (typeof entry.cwd === "string") cwd = entry.cwd;
    if (type === "custom-title" || type === "summary") {
      const title = text(entry.customTitle) ?? text(entry.summary);
      return title ? [{ sessionUpdate: "session_info_update", title, ...meta() }] : [];
    }
    const message = record(entry.message);
    if (type === "assistant" && message) idle = message.stop_reason === "end_turn";
    if (type === "user" && message && !entry.isMeta && !entry.isCompactSummary) {
      const content = message.content;
      const prompt = (
        typeof content === "string"
          ? content
          : list(content)
              .map((part) =>
                record(part)?.type === "text" ? (text(record(part)!.text) ?? "") : "",
              )
              .join("")
      )
        .replace(HIDDEN, "")
        .trim();
      // A typed prompt starts a turn; notifications and command output do not.
      if (/^\[Request interrupted by user/.test(prompt)) idle = true;
      else if (prompt && !prompt.startsWith("<")) idle = false;
    }
    if (type === "assistant" && message) {
      if (entry.isApiErrorMessage) {
        const body = list(message.content)
          .map((block) => text(record(block)?.text) ?? "")
          .join("");
        return [
          {
            sessionUpdate: "notice",
            title: oneLine(body || "API error"),
            severity: "error",
            ...meta(),
          },
        ];
      }
      // Each line holds one block; blocks of one reply are separate messages here,
      // so two text blocks do not run together.
      const messageId = text(entry.uuid) ?? text(message.id);
      return list(message.content).flatMap((part): SessionUpdate[] => {
        const block = record(part);
        if (!block) return [];
        if (block.type === "text" && text(block.text)?.trim())
          return [
            {
              sessionUpdate: "agent_message_chunk",
              content: { type: "text", text: text(block.text)! },
              messageId,
              ...meta({ ...(text(message.model) ? { model: text(message.model) } : {}) }),
            },
          ];
        if (block.type === "thinking" || block.type === "redacted_thinking")
          return [
            {
              sessionUpdate: "agent_thought_chunk",
              content: { type: "text", text: text(block.thinking) ?? "" },
              messageId: `${messageId}:thought`,
              ...meta(
                typeof entry.thinkingDurationMs === "number"
                  ? { durationMs: entry.thinkingDurationMs }
                  : {},
              ),
            },
          ];
        if (block.type === "tool_use" && text(block.id) && text(block.name))
          return call(text(block.id)!, text(block.name)!, record(block.input) ?? {});
        return [];
      });
    }
    if (type === "user" && message) {
      if (entry.isCompactSummary) {
        const body = typeof message.content === "string" ? message.content : "";
        const id = compaction ?? text(entry.uuid) ?? String(at);
        compaction = undefined;
        return [
          {
            sessionUpdate: "compaction_update",
            compactionId: id,
            status: "completed",
            summary: body ? [{ type: "text", text: body }] : null,
            ...meta(),
          },
        ];
      }
      if (entry.isMeta) return [];
      if (typeof message.content === "string") return userText(message.content);
      return list(message.content).flatMap((part): SessionUpdate[] => {
        const block = record(part);
        if (block?.type === "tool_result") return result(block, entry.toolUseResult);
        if (block?.type === "text" && text(block.text)) return userText(text(block.text)!);
        const source = record(block?.source);
        if (block?.type === "image" && text(source?.data))
          return [
            {
              sessionUpdate: "user_message_chunk",
              content: {
                type: "image",
                data: text(source!.data)!,
                mimeType: text(source!.media_type) ?? "image/png",
              },
              ...meta(),
            },
          ];
        return [];
      });
    }
    if (type === "system") {
      if (entry.subtype === "compact_boundary") {
        compaction = text(entry.uuid) ?? String(at);
        return [
          {
            sessionUpdate: "compaction_update",
            compactionId: compaction,
            status: "completed",
            ...meta(),
          },
        ];
      }
      if (entry.subtype === "api_error") {
        const attempt = Number(entry.retryAttempt);
        const max = Number(entry.maxRetries);
        return [
          {
            sessionUpdate: "notice",
            title: "The API returned an error",
            severity: "warning",
            description:
              Number.isFinite(attempt) && Number.isFinite(max)
                ? `Retry ${attempt} of ${max}`
                : null,
            ...meta(),
          },
        ];
      }
      return [];
    }
    if (type === "attachment") {
      const attachment = record(entry.attachment);
      if (attachment?.type === "queued_command" && text(attachment.prompt)) {
        const prompt = text(attachment.prompt)!.replace(HIDDEN, "").trim();
        if (!prompt || attachment.humanTurn === false) return [];
        queued.add(prompt);
        return [
          {
            sessionUpdate: "user_message_chunk",
            content: { type: "text", text: prompt },
            ...meta({ queued: true }),
          },
        ];
      }
      if (attachment?.type === "task_status") {
        const id = background.get(text(attachment.taskId) ?? "");
        const state = text(attachment.status);
        if (!id || !state || state === "running") return [];
        return [
          {
            sessionUpdate: "tool_call_update",
            toolCallId: id,
            status: state === "completed" ? "completed" : "failed",
            ...meta(),
          },
        ];
      }
    }
    return [];
  }

  return {
    /** The updates of one transcript line; none for bookkeeping lines. */
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
    /** True after a reply that ends the agent's turn, until the next prompt. */
    idle: () => idle,
    /** The subagent a tool call started, to read its own transcript. */
    subagentOf(toolCallId: string) {
      for (const [agent, id] of background) if (id === toolCallId) return agent;
      return undefined;
    },
  };
}

/** Converts a whole transcript. */
export function readClaudeTranscript(
  source: string,
  options?: ClaudeReaderOptions,
): SessionEvent[] {
  const reader = createClaudeTranscriptReader(options);
  return source.split("\n").flatMap((line) => reader.line(line));
}
