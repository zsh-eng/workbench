import { z } from "zod";
import { sessionHaltSchema } from "./agent-status";

/**
 * Sessions that Med starts and owns, as opposed to sessions it attaches to by
 * reading their transcripts. Med starts an agent that the user installed:
 * Claude Code with `stream-json`, or any agent through the Agent Client
 * Protocol (ACP), such as OpenCode.
 */

/**
 * What an agent that Med runs can do, so the page shows only the controls
 * that work (docs/AGENT_WORKSPACES.md#what-each-agent-can-do).
 */
export const agentCapabilitiesSchema = z.object({
  /** Takes a message during its turn: **Send now** on a queued message. */
  steer: z.boolean(),
  /** Stops a turn: **Stop** and Esc. */
  interrupt: z.boolean(),
  /** How a tool that needs approval gets it: a card in Med ("ask"), or the
   * mode and allow rules chosen before the turn ("rules"), as Antigravity's
   * headless mode refuses what they do not allow. */
  approvals: z.enum(["ask", "rules"]),
  /** Takes images in a prompt. */
  images: z.boolean(),
  /** Its session goes on after its process ends: the next message resumes it. */
  resume: z.boolean(),
  /** Its subagents' threads show in the session. */
  subagents: z.boolean(),
  /** Context and spend come from its token counts. */
  usage: z.boolean(),
});
export type AgentCapabilities = z.infer<typeof agentCapabilitiesSchema>;

/** The capabilities of each kind of agent that Med runs. */
export const AGENT_CAPABILITIES: Record<AgentKind, AgentCapabilities> = {
  claude: {
    // A queued message joins the turn by itself, after the tools that run.
    steer: false,
    interrupt: true,
    approvals: "ask",
    images: true,
    resume: true,
    subagents: true,
    usage: true,
  },
  codex: {
    steer: true,
    interrupt: true,
    approvals: "ask",
    images: true,
    resume: true,
    subagents: true,
    usage: true,
  },
  agy: {
    steer: false,
    interrupt: true,
    approvals: "rules",
    images: false,
    resume: true,
    subagents: true,
    // agy reports tokens, but Med has no Gemini prices or context windows.
    usage: false,
  },
  acp: {
    steer: false,
    interrupt: true,
    approvals: "ask",
    images: false,
    resume: false,
    subagents: false,
    usage: false,
  },
};

export const agentKindSchema = z.enum(["claude", "codex", "agy", "acp"]);
export type AgentKind = z.infer<typeof agentKindSchema>;

/** An installed agent that Med can start. */
export const agentPresetSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: agentKindSchema,
  /** Not found on this computer; shown so the user knows what to install. */
  available: z.boolean(),
  capabilities: agentCapabilitiesSchema.optional(),
});
export type AgentPreset = z.infer<typeof agentPresetSchema>;

/** A choice the agent offers, such as its model, effort, or mode. */
export const ownedSettingSchema = z.object({
  id: z.string(),
  name: z.string(),
  category: z.enum(["model", "effort", "mode", "other"]),
  value: z.string(),
  options: z.array(
    z.object({
      value: z.string(),
      name: z.string(),
      description: z.string().optional(),
      /** A choice that asks first, such as Bypass: what it lets the agent do. */
      confirm: z.string().optional(),
    }),
  ),
  /** Changes only between turns, such as Claude Code's effort. */
  idleOnly: z.boolean().optional(),
  /** The values that ⇧Tab steps through, in order, as in Claude Code's terminal. */
  cycle: z.array(z.string()).optional(),
});
export type OwnedSetting = z.infer<typeof ownedSettingSchema>;

/** A command for the `/` menu: a skill or a custom command. */
export const ownedCommandSchema = z.object({
  name: z.string(),
  description: z.string(),
  hint: z.string().optional(),
});
export type OwnedCommand = z.infer<typeof ownedCommandSchema>;

/** A question that the agent asks, with choices: Claude Code's AskUserQuestion. */
export const ownedQuestionSchema = z.object({
  question: z.string(),
  /** A short label, such as "Library". */
  header: z.string().optional(),
  /** The user may pick more than one choice. */
  multiSelect: z.boolean().optional(),
  options: z.array(z.object({ label: z.string(), description: z.string().optional() })),
});
export type OwnedQuestion = z.infer<typeof ownedQuestionSchema>;

/** A tool call that waits for the user's answer. */
export const ownedPermissionSchema = z.object({
  id: z.string(),
  title: z.string(),
  detail: z.string().optional(),
  options: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      kind: z.enum(["allow_once", "allow_always", "reject_once", "reject_always"]),
    }),
  ),
  /** The agent asks these questions; the answer carries the user's choices. */
  questions: z.array(ownedQuestionSchema).optional(),
  /** A plan to approve before the agent edits, as Markdown: Claude Code's
   * ExitPlanMode. Approving it names the mode that the work continues in. */
  plan: z
    .object({
      text: z.string(),
      modes: z.array(z.object({ value: z.string(), name: z.string() })),
      mode: z.string(),
    })
    .optional(),
});
export type OwnedPermission = z.infer<typeof ownedPermissionSchema>;

/** Claude Code's account of the context window, as `/context` shows it, read
 * at a turn's end: what fills it, and what it defers until a tool is used. */
export const contextBreakdownSchema = z.object({
  categories: z
    .array(
      z.object({
        name: z.string(),
        tokens: z.number(),
        kind: z.enum(["used", "deferred", "buffer", "free"]),
      }),
    )
    .max(40),
  /** The MCP servers' tools, by server. */
  mcpServers: z
    .array(z.object({ name: z.string(), tools: z.number(), tokens: z.number() }))
    .max(200),
  memoryFiles: z.array(z.object({ path: z.string(), tokens: z.number() })).max(200),
  agents: z.array(z.object({ name: z.string(), tokens: z.number() })).max(200),
  skills: z.array(z.object({ name: z.string(), tokens: z.number() })).max(500),
  /** When Med read it. */
  at: z.number(),
});
export type ContextBreakdown = z.infer<typeof contextBreakdownSchema>;

/** Claude Code's `get_context_usage` reply as Med keeps it; undefined for a
 * reply without categories. */
export function contextBreakdown(value: unknown, at: number): ContextBreakdown | undefined {
  const reply = (value ?? {}) as Record<string, unknown>;
  const list = (key: string) =>
    (Array.isArray(reply[key]) ? reply[key] : []).filter(
      (entry): entry is Record<string, unknown> => !!entry && typeof entry === "object",
    );
  const tokens = (entry: Record<string, unknown>) =>
    typeof entry.tokens === "number" && entry.tokens >= 0 ? entry.tokens : 0;
  const text = (entry: Record<string, unknown>, key: string) =>
    typeof entry[key] === "string" ? (entry[key] as string) : "";
  const kinds = ["used", "deferred", "buffer", "free"] as const;
  const categories = list("categories").flatMap((entry) => {
    const name = text(entry, "name");
    const kind =
      kinds.find((each) => each === entry.kind) ?? (entry.isDeferred ? "deferred" : "used");
    return name ? [{ name, tokens: tokens(entry), kind }] : [];
  });
  if (!categories.length) return undefined;
  const servers = new Map<string, { name: string; tools: number; tokens: number }>();
  for (const tool of list("mcpTools")) {
    const name = text(tool, "serverName") || "MCP";
    const server = servers.get(name) ?? { name, tools: 0, tokens: 0 };
    server.tools++;
    server.tokens += tokens(tool);
    servers.set(name, server);
  }
  const skills = reply.skills as { skillFrontmatter?: unknown } | undefined;
  return contextBreakdownSchema.parse({
    categories: categories.slice(0, 40),
    mcpServers: [...servers.values()].sort((a, b) => b.tokens - a.tokens).slice(0, 200),
    memoryFiles: list("memoryFiles")
      .flatMap((entry) => {
        const path = text(entry, "path");
        return path ? [{ path, tokens: tokens(entry) }] : [];
      })
      .slice(0, 200),
    agents: list("agents")
      .flatMap((entry) => {
        const name = text(entry, "agentType") || text(entry, "name");
        return name ? [{ name, tokens: tokens(entry) }] : [];
      })
      .slice(0, 200),
    skills: (Array.isArray(skills?.skillFrontmatter) ? skills.skillFrontmatter : [])
      .flatMap((entry: Record<string, unknown>) => {
        const name = entry && typeof entry.name === "string" ? entry.name : "";
        return name ? [{ name, tokens: tokens(entry) }] : [];
      })
      .slice(0, 500),
    at,
  });
}

export const ownedStateSchema = z.object({
  sessionId: z.string(),
  preset: z.string(),
  name: z.string(),
  status: z.enum(["starting", "working", "idle", "exited"]),
  settings: z.array(ownedSettingSchema),
  commands: z.array(ownedCommandSchema),
  permission: ownedPermissionSchema.optional(),
  /** The reply that streams now, before the transcript has it. */
  streaming: z.object({ id: z.string(), text: z.string() }).optional(),
  /** Tokens in the context window, after the last turn, and what fills it. */
  context: z
    .object({ used: z.number(), total: z.number(), breakdown: contextBreakdownSchema.optional() })
    .optional(),
  /** Turns sent so far; the first one starts the transcript. */
  turns: z.number().int().nonnegative(),
  /** The agent takes images in a prompt. */
  images: z.boolean().optional(),
  /** What the agent can do; the page shows only these controls. */
  capabilities: agentCapabilitiesSchema.optional(),
  error: z.string().optional(),
  /** What stopped the session's work: Med shows its cause and one action. */
  halt: sessionHaltSchema
    .extend({
      /** The agent's last error lines. */
      lines: z.string().max(600).optional(),
      /** When the work stopped, in milliseconds since the epoch. */
      at: z.number().optional(),
    })
    .optional(),
  /** When the state last changed, in milliseconds since the epoch. While the
   * session waits, a transcript that changed later is another process's turn. */
  updatedAt: z.number().optional(),
});
export type OwnedState = z.infer<typeof ownedStateSchema>;

/** The model, effort, and permission mode for a new session; the agent's own
 * default otherwise. */
export const agentChoicesSchema = z.object({
  model: z.string().min(1).max(200).optional(),
  effort: z.string().min(1).max(80).optional(),
  mode: z.string().min(1).max(80).optional(),
});
export type AgentChoices = z.infer<typeof agentChoicesSchema>;

/** Med's choices for a new session, where the agent offers them. Claude Code
 * starts in Auto, where a classifier allows safe actions and asks about risky
 * ones. */
export const AGENT_DEFAULTS: Record<string, AgentChoices> = {
  claude: { model: "opus", effort: "medium", mode: "auto" },
  codex: { model: "gpt-6-astra" },
  agy: { mode: "accept-edits" },
};

/**
 * The models and efforts that an agent offers before a session starts. Each
 * setting's value is the choice for a new session.
 */
export const agentOptionsSchema = z.object({
  model: ownedSettingSchema.optional(),
  effort: ownedSettingSchema.optional(),
  /** The efforts of each model, where they depend on the model, as in Claude Code. */
  efforts: z.record(z.string(), z.array(z.string())).optional(),
});
export type AgentOptions = z.infer<typeof agentOptionsSchema>;

/** `POST /api/reviews/:id/start`: an agent for a review that no session
 * handed off, such as a pull request's, in its checkout. The review becomes
 * the new session's. */
export const ownedStartSchema = z.object({
  preset: z.string().min(1).max(80),
  choices: agentChoicesSchema.optional(),
});
/** What a start or Fork in Med answers: the session's thread, which can
 * be another thread than the one asked, and the agent's state. */
export const ownedStartedSchema = z.object({
  thread: z.string(),
  state: ownedStateSchema,
});

/** Fork from here: a new thread whose Claude Code session starts from this
 * session's history, up to one of its replies. */
export const sessionForkSchema = z.object({
  /** The reply's message, by its ID in the transcript. */
  at: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
  /** The new thread's name; without it, Med names it for the thread it forks. */
  title: z.string().trim().min(1).max(120).optional(),
});
export type SessionFork = z.infer<typeof sessionForkSchema>;
/** The new thread of a fork. */
export const sessionForkedSchema = z.object({ id: z.string(), title: z.string() });
export type SessionForked = z.infer<typeof sessionForkedSchema>;

export const ownedActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("prompt"), text: z.string().trim().min(1).max(100_000) }),
  z.object({
    action: z.literal("permission"),
    id: z.string().max(200),
    option: z.string(),
    /** The answer to each question, by its text; choices join with ", ". */
    answers: z.record(z.string().max(2000), z.string().max(10_000)).optional(),
    /** The mode that an approved plan continues in. */
    mode: z.string().max(80).optional(),
    /** What the user says with a refusal, such as what to plan next. */
    message: z.string().max(10_000).optional(),
  }),
  z.object({ action: z.literal("interrupt") }),
  z.object({ action: z.literal("setting"), id: z.string().max(80), value: z.string().max(400) }),
  z.object({ action: z.literal("stop") }),
  /** Starts a stopped agent again; the session resumes. */
  z.object({ action: z.literal("restart") }),
  /** Asks the agent to go on with a turn that stopped before its end. */
  z.object({ action: z.literal("continue") }),
  /** Clears what stopped the work, without an action. */
  z.object({ action: z.literal("dismiss") }),
]);
export type OwnedAction = z.infer<typeof ownedActionSchema>;

/** What the user adds to an answer: the answers to the agent's questions,
 * the mode that an approved plan continues in, or a refusal's words. */
export type PermissionReply = Omit<
  Extract<OwnedAction, { action: "permission" }>,
  "action" | "id" | "option"
>;
