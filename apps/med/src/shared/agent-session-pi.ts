import type {
  ContentBlock,
  MedMeta,
  SessionEvent,
  SessionUpdate,
  ToolCallContent,
  ToolCallLocation,
  ToolKind,
} from "./agent-session";

/* Pi's session file: ~/.pi/agent/sessions/--<cwd>--/<time>_<id>.jsonl.
 * Each line is a JSON object with a `type` field (`session`, `message`,
 * `compaction`, `session_info`, `custom_message`, `model_change`, etc.).
 * Messages carry `role`: "user", "assistant", "toolResult", "bashExecution",
 * or "custom". Unknown lines make no updates. */

type Json = Record<string, unknown>;
type DiffContent = Extract<ToolCallContent, { type: "diff" }>;
const record = (value: unknown): Json | undefined =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : undefined;
const text = (value: unknown) => (typeof value === "string" ? value : undefined);
const list = (value: unknown) => (Array.isArray(value) ? value : []);

const isAbsolutePath = (path: string) => /^(?:\/|[A-Za-z]:[\\/])/.test(path);

function joinPath(base: string, path: string): string {
  if (!base || isAbsolutePath(path)) return path;
  const trimmedBase = base.replace(/\/+$/, "");
  const trimmedPath = path.replace(/^\/+/, "");
  return `${trimmedBase}/${trimmedPath}`;
}

function relativePath(base: string | undefined, path: string): string {
  if (!base || !isAbsolutePath(path)) return path;
  const prefix = base.endsWith("/") ? base : `${base}/`;
  if (path === base) return ".";
  return path.startsWith(prefix) ? path.slice(prefix.length) : path;
}

function toolMeta(
  name: string,
  args: Json,
  cwd: string | undefined,
): { title: string; kind: ToolKind; locations: ToolCallLocation[] } {
  const rawPath = text(args.path);
  const shown = rawPath ? relativePath(cwd, rawPath) : undefined;
  const absolute = rawPath ? (cwd ? joinPath(cwd, rawPath) : rawPath) : undefined;
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
      return { title: name || "Tool", kind: "other", locations };
  }
}

function diffOf(name: string, args: Json, cwd: string | undefined): DiffContent[] {
  const rawPath = text(args.path);
  if (!rawPath) return [];
  const absolute = cwd ? joinPath(cwd, rawPath) : rawPath;
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

function contentBlocks(content: unknown): ContentBlock[] {
  if (typeof content === "string") return content ? [{ type: "text", text: content }] : [];
  const blocks: ContentBlock[] = [];
  for (const item of list(content)) {
    const part = record(item);
    if (!part) continue;
    if (part.type === "text" && typeof part.text === "string" && part.text)
      blocks.push({ type: "text", text: part.text });
    else if (
      part.type === "image" &&
      typeof part.data === "string" &&
      typeof part.mimeType === "string"
    )
      blocks.push({ type: "image", data: part.data, mimeType: part.mimeType });
  }
  return blocks;
}

function timestampOf(entry: Json, message?: Json): number {
  if (typeof message?.timestamp === "number" && Number.isFinite(message.timestamp))
    return message.timestamp;
  const iso = text(entry.timestamp);
  const parsed = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Converts Pi `.jsonl` session lines to Med `SessionEvent`s one line at a
 * time, tracking pending tool calls and whether the turn is idle.
 */
export function createPiTranscriptReader() {
  const tools = new Map<string, { name: string; args: Json; diffs: DiffContent[] }>();
  let idle = true;
  let at = 0;
  let cwd: string | undefined;
  let bashIndex = 0;

  return {
    /** Whether the session's last turn has ended. */
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

      const type = text(entry.type);
      const time = timestampOf(entry, record(entry.message));
      if (time > 0) at = time;

      const emit = (update: SessionUpdate): SessionEvent => ({ at: time || at, update });

      if (type === "session") {
        cwd = text(entry.cwd) ?? cwd;
        return [];
      }

      if (type === "session_info") {
        const name = text(entry.name)?.trim();
        return name ? [emit({ sessionUpdate: "session_info_update", title: name })] : [];
      }

      if (type === "compaction") {
        const summary = text(entry.summary);
        const compactionId = text(entry.id) ?? `pi-compaction-${at}`;
        return [
          emit({
            sessionUpdate: "compaction_update",
            compactionId,
            status: "completed",
            summary: summary ? [{ type: "text", text: summary }] : null,
          }),
        ];
      }

      if (type === "custom_message") {
        if (entry.display !== true) return [];
        const blocks = contentBlocks(entry.content);
        return blocks.map((content) => emit({ sessionUpdate: "agent_message_chunk", content }));
      }

      if (type !== "message") return [];
      const message = record(entry.message);
      if (!message) return [];
      const role = text(message.role);

      if (role === "user") {
        const blocks = contentBlocks(message.content);
        if (!blocks.length) return [];
        idle = false;
        return blocks.map((content) => emit({ sessionUpdate: "user_message_chunk", content }));
      }

      if (role === "assistant") {
        const events: SessionEvent[] = [];
        let sawToolCall = false;
        let sawText = false;
        for (const item of list(message.content)) {
          const part = record(item);
          if (!part) continue;
          if (part.type === "thinking" && typeof part.thinking === "string" && part.thinking) {
            events.push(
              emit({
                sessionUpdate: "agent_thought_chunk",
                content: { type: "text", text: part.thinking },
              }),
            );
          } else if (part.type === "text" && typeof part.text === "string" && part.text) {
            sawText = true;
            events.push(
              emit({
                sessionUpdate: "agent_message_chunk",
                content: { type: "text", text: part.text },
              }),
            );
          } else if (part.type === "toolCall") {
            const toolCallId = text(part.id);
            const name = text(part.name) ?? "tool";
            if (!toolCallId) continue;
            sawToolCall = true;
            const args = record(part.arguments) ?? {};
            const diffs = diffOf(name, args, cwd);
            tools.set(toolCallId, { name, args, diffs });
            const meta: Partial<{ _meta: MedMeta }> =
              name === "write" ? { _meta: { med: { tool: "Write" } } } : {};
            events.push(
              emit({
                sessionUpdate: "tool_call",
                toolCallId,
                ...toolMeta(name, args, cwd),
                status: "in_progress",
                rawInput: args,
                ...(diffs.length ? { content: diffs } : {}),
                ...meta,
              }),
            );
          }
        }
        const stopReason = text(message.stopReason);
        if (stopReason === "error" && !sawText) {
          const err = text(message.errorMessage);
          if (err)
            events.push(
              emit({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: err } }),
            );
        }
        idle = stopReason === "toolUse" ? false : stopReason ? true : !sawToolCall;
        return events;
      }

      if (role === "toolResult") {
        const toolCallId = text(message.toolCallId);
        if (!toolCallId) return [];
        idle = false;
        const call = tools.get(toolCallId);
        tools.delete(toolCallId);
        const isError = message.isError === true;
        const output = contentBlocks(message.content)
          .filter(
            (block): block is Extract<ContentBlock, { type: "text" }> => block.type === "text",
          )
          .map((block) => block.text)
          .join("\n");
        const diffs = call?.diffs ?? [];
        const content: ToolCallContent[] = [
          ...diffs,
          ...(output && (!diffs.length || isError)
            ? [{ type: "content" as const, content: { type: "text" as const, text: output } }]
            : []),
        ];
        return [
          emit({
            sessionUpdate: "tool_call_update",
            toolCallId,
            status: isError ? "failed" : "completed",
            ...(content.length ? { content } : {}),
            ...(output ? { rawOutput: output } : {}),
          }),
        ];
      }

      if (role === "bashExecution") {
        const command = text(message.command) ?? "bash";
        const output = text(message.output) ?? "";
        const failed =
          message.cancelled === true ||
          (typeof message.exitCode === "number" && message.exitCode !== 0);
        const toolCallId = text(entry.id) ?? `pi-bash-${++bashIndex}`;
        return [
          emit({
            sessionUpdate: "tool_call",
            toolCallId,
            title: command,
            kind: "execute",
            status: failed ? "failed" : "completed",
            rawInput: { command },
            ...(output
              ? {
                  content: [{ type: "content", content: { type: "text", text: output } }],
                  rawOutput: output,
                }
              : {}),
          }),
        ];
      }

      if (role === "custom" && message.display === true) {
        const blocks = contentBlocks(message.content);
        return blocks.map((content) => emit({ sessionUpdate: "agent_message_chunk", content }));
      }

      return [];
    },
  };
}
