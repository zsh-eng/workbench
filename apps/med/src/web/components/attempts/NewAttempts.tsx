import * as stylex from "@stylexjs/stylex";
import { useState } from "react";
import { attemptLetter, MAX_ATTEMPTS } from "../../../shared/attempts";
import type { AgentOptions, AgentPreset } from "../../../shared/owned-session";
import { startAttempts, type AttemptStart } from "../../data/attempts";
import { useAgentOptions } from "../../data/owned-session";
import { tokens } from "../../theme.stylex";
import { Select, sessionChoices } from "../shell/NewThread";

// New thread with two or three attempts: the count, and for each attempt its
// agent, model, and effort. Attempt A uses New thread's own choice; B and C
// are kept here.

const ATTEMPTS_KEY = "med:new-thread:attempts";

/** An attempt's agent and the model and effort chosen for it. */
export interface AttemptChoice {
  preset?: string;
  model?: string;
  effort?: string;
}

interface Stored {
  count: number;
  /** B, then C. */
  others: AttemptChoice[];
}

function readStored(): Stored {
  try {
    const value = JSON.parse(localStorage.getItem(ATTEMPTS_KEY) ?? "{}") as Partial<Stored>;
    const count = Number(value.count);
    return {
      count: Number.isInteger(count) && count >= 1 && count <= MAX_ATTEMPTS ? count : 1,
      others: Array.isArray(value.others)
        ? value.others.map((entry) => (entry && typeof entry === "object" ? entry : {}))
        : [],
    };
  } catch {
    return { count: 1, others: [] };
  }
}

/** One attempt as its pickers show it. */
export interface AttemptPick {
  agent: AgentPreset | undefined;
  options: AgentOptions | undefined;
  model?: string;
  effort?: string;
  efforts: { value: string; name: string }[];
}

/** "Codex · gpt-6-astra": the agent and model as the pickers name them. */
export function attemptLabel(pick: Pick<AttemptPick, "agent" | "options" | "model">) {
  const model = pick.options?.model?.options.find((option) => option.value === pick.model)?.name;
  return [pick.agent?.name, model].filter(Boolean).join(" · ") || undefined;
}

const startOf = (pick: AttemptPick): AttemptStart => ({
  preset: pick.agent!.id,
  choices: { model: pick.model, effort: pick.effort },
  ...(attemptLabel(pick) ? { label: attemptLabel(pick) } : {}),
});

/**
 * The count of attempts, and the agents of B and C. By default B and C use
 * agents that A does not, so different agents try the same task.
 */
export function useAttempts(
  agents: AgentPreset[] | undefined,
  first: AgentPreset | undefined,
  fetcher: typeof fetch,
) {
  const [stored, setStored] = useState(readStored);
  const save = (next: Stored) => {
    setStored(next);
    try {
      localStorage.setItem(ATTEMPTS_KEY, JSON.stringify(next));
    } catch {
      /* The choice lasts for this view. */
    }
  };
  const count = stored.count;
  const used = [first?.id];
  const agentFor = (index: number) => {
    const chosen = agents?.find((entry) => entry.id === stored.others[index]?.preset);
    const agent =
      chosen ?? agents?.find((entry) => !used.includes(entry.id)) ?? first ?? agents?.[0];
    used.push(agent?.id);
    return agent;
  };
  const b = agentFor(0);
  const c = agentFor(1);
  // Hooks run for each slot; a slot that does not show reads nothing.
  const bOptions = useAgentOptions(count > 1 ? b?.id : undefined, fetcher);
  const cOptions = useAgentOptions(count > 2 ? c?.id : undefined, fetcher);
  const others: AttemptPick[] = [
    { agent: b, options: bOptions },
    { agent: c, options: cOptions },
  ]
    .slice(0, count - 1)
    .map((slot, index) => {
      const last = stored.others[index];
      const own = last?.preset === slot.agent?.id ? last : undefined;
      return { ...slot, ...sessionChoices(slot.options, own) };
    });

  return {
    count,
    setCount(value: number) {
      save({ ...stored, count: value });
    },
    /** B and C, as many as the count asks for. */
    others,
    /** Changes the agent, model, or effort of B (0) or C (1). */
    choose(index: number, next: AttemptChoice) {
      const list = [...stored.others];
      const agent = index === 0 ? b : c;
      list[index] = next.preset
        ? { preset: next.preset }
        : { ...list[index], preset: agent?.id, ...next };
      save({ ...stored, others: list });
    },
    ready: others.every((pick) => !!pick.agent),
    /** Starts A with New thread's choice, and the others with theirs. */
    start(
      input: { repositoryId: string; prompt: string; title: string; first: AttemptPick },
      fetcher: typeof fetch,
    ) {
      return startAttempts(
        {
          repositoryId: input.repositoryId,
          prompt: input.prompt,
          title: input.title,
          attempts: [input.first, ...others].map(startOf),
        },
        fetcher,
      );
    },
  };
}
export type Attempts = ReturnType<typeof useAttempts>;

/** The count of attempts, in New thread's controls. */
export function AttemptsCount({ attempts }: { attempts: Attempts }) {
  return (
    <Select
      label="Attempts"
      icon="compare"
      value={String(attempts.count)}
      options={Array.from({ length: MAX_ATTEMPTS }, (_, index) => ({
        value: String(index + 1),
        label: index ? `${index + 1} attempts` : "1 attempt",
      }))}
      onChange={(value) => attempts.setCount(Number(value))}
    />
  );
}

/**
 * One line for each attempt: its letter, agent, model, effort, and the branch
 * that Med creates for it.
 */
export function AttemptRows({
  attempts,
  agents,
  first,
  onFirst,
  branch,
}: {
  attempts: Attempts;
  agents: AgentPreset[];
  first: AttemptPick;
  onFirst(next: AttemptChoice): void;
  branch: string;
}) {
  return (
    <div role="group" aria-label="Attempts" {...stylex.props(styles.rows)}>
      {[first, ...attempts.others].map((pick, index) => {
        const letter = attemptLetter(index + 1);
        const choose = (next: AttemptChoice) =>
          index ? attempts.choose(index - 1, next) : onFirst(next);
        return (
          <div key={letter} {...stylex.props(styles.row)}>
            <span aria-hidden {...stylex.props(styles.letter)}>
              {letter}
            </span>
            <div {...stylex.props(styles.pickers)}>
              <Select
                label={`Agent for attempt ${letter}`}
                icon={pick.agent?.kind === "claude" ? "claude" : "agent"}
                value={pick.agent?.id ?? ""}
                options={agents.map((entry) => ({ value: entry.id, label: entry.name }))}
                onChange={(value) => choose({ preset: value })}
              />
              {pick.options?.model && pick.model && (
                <Select
                  label={`Model for attempt ${letter}`}
                  value={pick.model}
                  options={pick.options.model.options.map((option) => ({
                    value: option.value,
                    label: option.name,
                  }))}
                  onChange={(value) => choose({ model: value })}
                />
              )}
              {pick.effort && (
                <Select
                  label={`Effort for attempt ${letter}`}
                  value={pick.effort}
                  options={pick.efforts.map((option) => ({
                    value: option.value,
                    label: option.name,
                  }))}
                  onChange={(value) => choose({ effort: value })}
                />
              )}
            </div>
            <code {...stylex.props(styles.branch)}>
              {branch}-{letter.toLowerCase()}
            </code>
          </div>
        );
      })}
    </div>
  );
}

/** What Start does with several attempts, under the card. */
export function AttemptsHint({ count, repository }: { count: number; repository?: string }) {
  return (
    <>
      Med gives the task to {count === 2 ? "both" : "all three"} agents, each on its own branch in a
      new worktree of {repository ?? "the repository"}. Then you compare the attempts and keep one.
    </>
  );
}

/** Checkout is off while there are several attempts: each needs a worktree. */
export const attemptStyles = stylex.create({
  off: { opacity: 0.45, cursor: "default", pointerEvents: "none" },
});

const styles = stylex.create({
  rows: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
    marginInline: 8,
    paddingBlock: 6,
    borderTopWidth: 1,
    borderTopStyle: "solid",
    borderTopColor: tokens.line,
  },
  row: { display: "flex", alignItems: "center", gap: 6, minWidth: 0, paddingInlineStart: 6 },
  // As on the Attempts page.
  letter: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    width: 20,
    height: 20,
    marginInlineEnd: 2,
    borderRadius: `calc(5px * ${tokens.round})`,
    boxShadow: `inset 0 0 0 1px ${tokens.lineStrong}`,
    color: tokens.text,
    fontFamily: tokens.code,
    fontSize: 11,
    fontWeight: 500,
  },
  pickers: { display: "flex", alignItems: "center", flexWrap: "wrap", gap: 2, minWidth: 0 },
  branch: {
    flexShrink: 1,
    minWidth: 0,
    marginInlineStart: "auto",
    paddingInlineEnd: 8,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    color: tokens.faint,
    fontFamily: tokens.code,
    fontSize: 11.5,
  },
});
