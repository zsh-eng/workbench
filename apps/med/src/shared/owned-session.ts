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
    steer: true,
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
  /** Tokens in the context window, after the last turn. */
  context: z.object({ used: z.number(), total: z.number() }).optional(),
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

export const ownedStartSchema = z.object({
  preset: z.string().min(1).max(80),
  /** The review target whose repository the agent works in. */
  targetId: z.string().max(80).optional(),
  choices: agentChoicesSchema.optional(),
  /**
   * Continue in Med: a Claude session of the review that another process
   * runs. The new session starts from its history (`--fork-session`), and
   * the messages that wait for that process go to the new one.
   */
  fork: z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,128}$/)
    .optional(),
});

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
