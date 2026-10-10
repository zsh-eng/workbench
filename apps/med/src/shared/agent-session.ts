/**
 * An agent session as a stream of updates, in the shapes of the Agent Client
 * Protocol (ACP, agentclientprotocol.com): the `session/update` notifications
 * that an agent sends to its client while it works.
 *
 * Med reads sessions from two sources and makes the same updates from both:
 * the transcript file that Claude Code or Codex writes (one line per finished
 * block), and, later, an agent process that Med starts and that streams
 * updates token by token. The renderer only knows these updates.
 *
 * ACP fields keep their names. Med adds three things that ACP leaves out:
 * the time of each update (`SessionEvent.at`), a few `_meta.med` fields, and
 * the `notice` and `compaction_update` details marked below.
 */

export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string; uri?: string | null }
  | { type: "resource_link"; name: string; uri: string; title?: string | null };

export type ToolKind =
  | "read"
  | "edit"
  | "delete"
  | "move"
  | "search"
  | "execute"
  | "think"
  | "fetch"
  | "switch_mode"
  | "other";

export type ToolCallStatus = "pending" | "in_progress" | "completed" | "failed";

export type ToolCallContent =
  | { type: "content"; content: ContentBlock }
  /** `oldText` is null for a new file. Paths are absolute, as ACP requires. */
  | {
      type: "diff";
      path: string;
      oldText?: string | null;
      newText: string;
      /** Med: the texts are a part of the file, so their line numbers are unknown. */
      _meta?: { med?: { excerpt?: boolean } };
    }
  | { type: "terminal"; terminalId: string };

export interface ToolCallLocation {
  path: string;
  line?: number | null;
}

export interface PlanEntry {
  content: string;
  priority: "high" | "medium" | "low";
  status: "pending" | "in_progress" | "completed";
}

/** Med's additions, under ACP's reserved `_meta` key. */
export interface MedMeta {
  med?: {
    /** The tool call that started the subagent this update belongs to. */
    parentToolCallId?: string;
    /** A background shell or agent that reports back later. */
    background?: { id: string; kind: "shell" | "agent" };
    /** How long the agent thought, when the transcript keeps no thought text. */
    durationMs?: number;
    /** The tool's own name, such as Bash or apply_patch. */
    tool?: string;
    /** A user message that waited in the queue while the agent worked. */
    queued?: boolean;
    model?: string;
  };
}

interface Chunk extends Partial<Meta> {
  content: ContentBlock;
  /** Chunks with the same ID form one message. */
  messageId?: string | null;
}
type Meta = { _meta: MedMeta };

export interface ToolCallFields {
  toolCallId: string;
  title: string;
  kind?: ToolKind;
  status?: ToolCallStatus;
  content?: ToolCallContent[];
  locations?: ToolCallLocation[];
  rawInput?: unknown;
  rawOutput?: unknown;
}

export type SessionUpdate =
  | ({ sessionUpdate: "user_message_chunk" } & Chunk)
  | ({ sessionUpdate: "agent_message_chunk" } & Chunk)
  | ({ sessionUpdate: "agent_thought_chunk" } & Chunk)
  | ({ sessionUpdate: "tool_call" } & ToolCallFields & Partial<Meta>)
  | ({ sessionUpdate: "tool_call_update" } & Partial<ToolCallFields> & {
        toolCallId: string;
      } & Partial<Meta>)
  /** The whole plan; each update replaces it. */
  | ({ sessionUpdate: "plan"; entries: PlanEntry[] } & Partial<Meta>)
  | ({
      sessionUpdate: "session_info_update";
      title?: string | null;
      updatedAt?: string | null;
    } & Partial<Meta>)
  /** Context window use in tokens. */
  | ({ sessionUpdate: "usage_update"; size: number; used: number } & Partial<Meta>)
  /** Med's severities; ACP defines its own set. */
  | ({
      sessionUpdate: "notice";
      title: string;
      severity: "info" | "warning" | "error";
      description?: string | null;
    } & Partial<Meta>)
  /** Med's statuses; ACP defines its own set. */
  | ({
      sessionUpdate: "compaction_update";
      compactionId: string;
      status: "completed" | "failed";
      summary?: ContentBlock[] | null;
    } & Partial<Meta>);

/** One update and when the agent sent it, in milliseconds since the epoch. */
export interface SessionEvent {
  at: number;
  update: SessionUpdate;
}

export type SessionAgent = "claude" | "codex";
