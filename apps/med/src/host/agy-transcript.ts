import { join } from "node:path";
import type { SessionUpdate, ToolKind } from "../shared/agent-session";
import { HEAD_BYTES, readEdge } from "./session-index";

// What Med reads of an Antigravity conversation without a process: its
// transcript, which `agy` writes under ~/.gemini/antigravity-cli. Med runs
// agy through its ACP server (`agy acp`, owned-sessions.ts); the transcript
// gives the title of a conversation that runs elsewhere, and the history of
// one that Med continues while agy's own process still has it open.
//
// Step shapes are agy 1.4.10's and 1.5.14's; Google publishes no schema.

/** The end of a transcript that a continued conversation shows. */
const MAX_HISTORY_BYTES = 4 * 1024 * 1024;

type Json = Record<string, any>;
const record = (value: unknown): Json | undefined =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : undefined;

const KINDS: Record<string, ToolKind> = {
  run_command: "execute",
  view_file: "read",
  list_dir: "read",
  grep_search: "search",
  find_by_name: "search",
  search_web: "fetch",
  read_url_content: "fetch",
  write_to_file: "edit",
  replace_file_content: "edit",
  multi_replace_file_content: "edit",
  sed_file: "edit",
};

/** A tool call's title and input, from agy's `tool_info`. */
function toolOf(info: Json | undefined, name: string) {
  const parameters = record(info?.parameters) ?? {};
  const unquote = (value: unknown) =>
    typeof value === "string" ? value.replace(/^"([\s\S]*)"$/, "$1") : undefined;
  const command = unquote(parameters.CommandLine);
  const path =
    unquote(parameters.AbsolutePath) ??
    unquote(parameters.TargetFile) ??
    unquote(parameters.DirectoryPath) ??
    unquote(parameters.SearchPath);
  const summary = unquote(parameters.toolSummary);
  const title =
    command ??
    (name === "invoke_subagent"
      ? (unquote(parameters.Role) ?? "Subagent")
      : `${summary ?? name.replaceAll("_", " ")}${path ? ` ${path}` : ""}`);
  return {
    title: title.split("\n")[0]!.slice(0, 300),
    kind: KINDS[name] ?? ("other" as ToolKind),
    ...(command ? { rawInput: { command } } : {}),
  };
}

/** What agy writes for a person in its transcript: the request, without its wrapper. */
const requestText = (content: string) =>
  /<USER_REQUEST>\n?([\s\S]*?)\n?<\/USER_REQUEST>/.exec(content)?.[1] ?? content;

/** Where agy keeps a conversation's transcript. */
export const agyTranscript = (home: string, id: string) =>
  join(
    home,
    ".gemini",
    "antigravity-cli",
    "brain",
    id,
    ".system_generated",
    "logs",
    "transcript.jsonl",
  );

/**
 * Reads an agy transcript (`brain/<id>/.system_generated/logs/transcript.jsonl`)
 * of a conversation that Med did not start. It holds the requests, the
 * replies, and the tool calls; their results follow as their own steps.
 */
function createTranscriptReader(prefix: string) {
  const open: string[] = [];
  return (line: string): SessionUpdate[] => {
    let step: Json | undefined;
    try {
      step = record(JSON.parse(line));
    } catch {
      return [];
    }
    if (!step) return [];
    const id = `${prefix}-${step.step_index}`;
    const content = typeof step.content === "string" ? step.content : "";
    if (step.type === "USER_INPUT")
      return [
        {
          sessionUpdate: "user_message_chunk",
          content: { type: "text", text: requestText(content) },
        },
      ];
    if (step.type === "PLANNER_RESPONSE") {
      const updates: SessionUpdate[] = [];
      if (content.trim())
        updates.push({
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: content },
          messageId: id,
        });
      for (const [index, call] of (Array.isArray(step.tool_calls)
        ? step.tool_calls
        : []
      ).entries()) {
        const name = String(record(call)?.name ?? "tool");
        const callId = `${id}-${index}`;
        open.push(callId);
        updates.push({
          sessionUpdate: "tool_call",
          toolCallId: callId,
          status: "in_progress",
          ...toolOf({ parameters: record(call)?.args }, name),
          _meta: { med: { tool: name } },
        });
      }
      return updates;
    }
    // Any other step is the result of the oldest call that waits.
    const callId = open.shift();
    if (!callId) return [];
    return [
      {
        sessionUpdate: "tool_call_update",
        toolCallId: callId,
        status: step.status === "ERROR" ? "failed" : "completed",
        ...(content || step.error
          ? {
              content: [
                {
                  type: "content" as const,
                  content: {
                    type: "text" as const,
                    text: String(step.error ?? content).slice(0, 4000),
                  },
                },
              ],
            }
          : {}),
      },
    ];
  };
}

/** The first request of an agy conversation, as its title. */
export async function agyTitle(home: string, id: string) {
  const { lines } = await readEdge(agyTranscript(home, id), "head", HEAD_BYTES).catch(() => ({
    lines: [] as string[],
  }));
  for (const line of lines) {
    try {
      const step = record(JSON.parse(line));
      if (step?.type === "USER_INPUT" && typeof step.content === "string")
        return requestText(step.content).trim().split("\n")[0]!.slice(0, 200);
    } catch {
      /* Not a step. */
    }
  }
  return undefined;
}

/** A conversation's history from agy's transcript, for a session that Med
 * continues: it shows before Med's own turns. */
export async function agyHistory(home: string, id: string): Promise<SessionUpdate[]> {
  const path = agyTranscript(home, id);
  const { lines } = await readEdge(path, "tail", MAX_HISTORY_BYTES).catch(() => ({
    lines: [] as string[],
  }));
  const read = createTranscriptReader(id);
  return lines.flatMap((line) => read(line));
}
