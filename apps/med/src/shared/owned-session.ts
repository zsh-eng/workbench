import { z } from "zod";

/**
 * Sessions that Med starts and owns, as opposed to sessions it attaches to by
 * reading their transcripts. Med starts an agent that the user installed:
 * Claude Code with `stream-json`, or any agent through the Agent Client
 * Protocol (ACP), such as OpenCode.
 */

/** An installed agent that Med can start. */
export const agentPresetSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.enum(["claude", "acp"]),
  /** Not found on this computer; shown so the user knows what to install. */
  available: z.boolean(),
});
export type AgentPreset = z.infer<typeof agentPresetSchema>;

/** A choice the agent offers, such as its model, effort, or mode. */
export const ownedSettingSchema = z.object({
  id: z.string(),
  name: z.string(),
  category: z.enum(["model", "effort", "mode", "other"]),
  value: z.string(),
  options: z.array(
    z.object({ value: z.string(), name: z.string(), description: z.string().optional() }),
  ),
  /** Changes only between turns, such as Claude Code's effort. */
  idleOnly: z.boolean().optional(),
});
export type OwnedSetting = z.infer<typeof ownedSettingSchema>;

/** A command for the `/` menu: a skill or a custom command. */
export const ownedCommandSchema = z.object({
  name: z.string(),
  description: z.string(),
  hint: z.string().optional(),
});
export type OwnedCommand = z.infer<typeof ownedCommandSchema>;

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
  error: z.string().optional(),
  /** When the state last changed, in milliseconds since the epoch. While the
   * session waits, a transcript that changed later is another process's turn. */
  updatedAt: z.number().optional(),
});
export type OwnedState = z.infer<typeof ownedStateSchema>;

/** The model and effort for a new session; the agent's own default otherwise. */
export const agentChoicesSchema = z.object({
  model: z.string().min(1).max(200).optional(),
  effort: z.string().min(1).max(80).optional(),
});
export type AgentChoices = z.infer<typeof agentChoicesSchema>;

/** Med's choices for a new session, where the agent offers them. */
export const AGENT_DEFAULTS: Record<string, AgentChoices> = {
  claude: { model: "opus", effort: "medium" },
  codex: { model: "gpt-6-astra" },
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
  z.object({ action: z.literal("permission"), id: z.string().max(200), option: z.string() }),
  z.object({ action: z.literal("interrupt") }),
  z.object({ action: z.literal("setting"), id: z.string().max(80), value: z.string().max(400) }),
  z.object({ action: z.literal("stop") }),
]);
export type OwnedAction = z.infer<typeof ownedActionSchema>;
