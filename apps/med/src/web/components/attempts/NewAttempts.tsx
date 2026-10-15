import * as stylex from "@stylexjs/stylex";
import { useState } from "react";
import { attemptLetter, MAX_ATTEMPTS } from "../../../shared/attempts";
import type { AgentOptions, AgentPreset } from "../../../shared/owned-session";
import { startAttempts, type AttemptStart } from "../../data/attempts";
import { useAgentOptions } from "../../data/owned-session";
import { AgentRows, ChoiceRow, choiceStyles } from "../shell/ChoiceRows";
import { sessionChoices } from "../shell/NewThread";

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

/** The count of attempts, a row of New thread's choices. */
export function AttemptsCount({ attempts }: { attempts: Attempts }) {
  return (
    <ChoiceRow
      label="Attempts"
      choices={Array.from({ length: MAX_ATTEMPTS }, (_, index) => ({
        value: String(index + 1),
        text: String(index + 1),
      }))}
      value={String(attempts.count)}
      onChange={(value) => attempts.setCount(Number(value))}
    />
  );
}

/** The agent, model, and effort of each attempt, under its letter. */
export function AttemptRows({
  attempts,
  agents,
  first,
  onFirst,
}: {
  attempts: Attempts;
  agents: AgentPreset[];
  first: AttemptPick;
  onFirst(next: AttemptChoice): void;
}) {
  return [first, ...attempts.others].map((pick, index) => {
    const letter = attemptLetter(index + 1);
    return (
      <div
        key={letter}
        role="group"
        aria-label={`Attempt ${letter}`}
        {...stylex.props(choiceStyles.attempt)}
      >
        <AgentRows
          pick={pick}
          agents={agents}
          letter={letter}
          onChoose={(next) => (index ? attempts.choose(index - 1, next) : onFirst(next))}
        />
      </div>
    );
  });
}

/** What Start does with several attempts, under the choices. */
export function AttemptsHint({ count, repository }: { count: number; repository?: string }) {
  return (
    <>
      Med gives the task to {count === 2 ? "both" : "all three"} agents, each on its own branch in a
      new worktree of {repository ?? "the repository"}. Then you compare the attempts and keep one.
    </>
  );
}
