import * as stylex from "@stylexjs/stylex";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type {
  OwnedPermission,
  OwnedQuestion,
  PermissionReply,
} from "../../../shared/owned-session";
import { tokens, ui } from "../../theme.stylex";
import { ChoiceSelect } from "../Controls";
import { Icon } from "../Icon";
import { SessionMarkdown } from "./SessionMarkdown";

/** Takes a key that the composer passes on while its field is empty, as the
 * terminal gives a question the keys. True when the card took it. */
export type CardKeys = (event: KeyboardEvent) => boolean;

type Answer = (option: string, reply?: PermissionReply) => void;

/** One question's choices so far: labels, and text of its own. */
interface Picked {
  labels: string[];
  other: string;
  /** The text is the answer, or one of the answers. */
  otherOn: boolean;
}
const NONE: Picked = { labels: [], other: "", otherOn: false };
const answerOf = ({ labels, other, otherOn }: Picked) =>
  [...labels, ...(otherOn && other.trim() ? [other.trim()] : [])].join(", ");

/**
 * Claude Code's AskUserQuestion: each question with its choices, and Other
 * for an answer of the user's own. Number keys pick a choice of the current
 * question; one question with one answer goes as soon as it is picked.
 */
export function QuestionCard({
  permission,
  questions,
  onAnswer,
  onKeys,
}: {
  permission: OwnedPermission;
  questions: OwnedQuestion[];
  onAnswer: Answer;
  /** Hands the composer the card's keys, and undefined when it goes. */
  onKeys?(keys: CardKeys | undefined): void;
}) {
  const [picked, setPicked] = useState<Picked[]>(() => questions.map(() => NONE));
  const [current, setCurrent] = useState(0);
  const others = useRef<(HTMLInputElement | null)[]>([]);
  const instant = questions.length === 1 && !questions[0]!.multiSelect;
  const complete = picked.every((entry) => answerOf(entry) !== "");

  const send = (all: Picked[]) => {
    if (!all.every((entry) => answerOf(entry) !== "")) return;
    onAnswer("answer", {
      answers: Object.fromEntries(
        questions.map((question, index) => [question.question, answerOf(all[index]!)]),
      ),
    });
  };
  const next = (all: Picked[], from: number) => {
    const open = all.findIndex((entry, index) => index > from && answerOf(entry) === "");
    if (open >= 0) setCurrent(open);
  };
  const pick = (index: number, label: string) => {
    const question = questions[index]!;
    const was = picked[index]!;
    const now: Picked = question.multiSelect
      ? {
          ...was,
          labels: was.labels.includes(label)
            ? was.labels.filter((entry) => entry !== label)
            : // In the question's order.
              question.options
                .map((option) => option.label)
                .filter((entry) => entry === label || was.labels.includes(entry)),
        }
      : { labels: [label], other: was.other, otherOn: false };
    const all = picked.map((entry, at) => (at === index ? now : entry));
    setPicked(all);
    setCurrent(index);
    if (instant) send(all);
    else if (!question.multiSelect) next(all, index);
  };
  const write = (index: number, text: string) =>
    setPicked((all) =>
      all.map((entry, at) =>
        at !== index
          ? entry
          : questions[index]!.multiSelect
            ? { ...entry, other: text, otherOn: text.trim() !== "" }
            : { labels: [], other: text, otherOn: true },
      ),
    );
  /** A number picks a choice of the current question; the number after the
   * last choice goes to Other. Enter answers once each question has one. */
  const onKey = (event: KeyboardEvent) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return false;
    const question = questions[current]!;
    const number = /^[1-9]$/.test(event.key) ? Number(event.key) : 0;
    if (number && number <= question.options.length) {
      event.preventDefault();
      pick(current, question.options[number - 1]!.label);
      return true;
    }
    if (number === question.options.length + 1) {
      event.preventDefault();
      others.current[current]?.focus();
      return true;
    }
    return false;
  };
  useEffect(() => {
    onKeys?.(onKey);
    return () => onKeys?.(undefined);
  });

  return (
    // Number keys pick a choice while the focus is in the card.
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <div
      role="group"
      aria-label="Question"
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.target instanceof HTMLInputElement) return;
        if (onKey(event)) return;
        if (event.key === "Enter" && complete) {
          event.preventDefault();
          send(picked);
        }
      }}
      {...stylex.props(styles.card)}
    >
      <div {...stylex.props(styles.title)}>
        <Icon name="ask" size={13} />
        {permission.title}
      </div>
      {questions.map((question, index) => {
        const entry = picked[index]!;
        const here = index === current;
        return (
          <div
            key={question.question}
            role="group"
            aria-label={question.question}
            {...stylex.props(styles.question, questions.length > 1 && here && styles.current)}
          >
            <div {...stylex.props(styles.prompt)}>
              {question.header && <span {...stylex.props(styles.header)}>{question.header}</span>}
              <span>{question.question}</span>
              {question.multiSelect && <span {...stylex.props(styles.hint)}>Choose any</span>}
            </div>
            <div {...stylex.props(styles.choices)}>
              {question.options.map((option, at) => {
                const on = entry.labels.includes(option.label);
                return (
                  <button
                    key={option.label}
                    type="button"
                    aria-pressed={on}
                    onClick={() => pick(index, option.label)}
                    {...stylex.props(styles.choice, on && styles.choiceOn)}
                  >
                    <kbd aria-hidden="true" {...stylex.props(styles.key, !here && styles.keyAway)}>
                      {at + 1}
                    </kbd>
                    <span {...stylex.props(styles.choiceText)}>
                      <span {...stylex.props(styles.choiceLabel)}>{option.label}</span>
                      {option.description && (
                        <span {...stylex.props(styles.choiceNote)}>{option.description}</span>
                      )}
                    </span>
                    {on && <Icon name="check" size={12} />}
                  </button>
                );
              })}
              <label
                {...stylex.props(styles.choice, styles.other, entry.otherOn && styles.choiceOn)}
              >
                <kbd aria-hidden="true" {...stylex.props(styles.key, !here && styles.keyAway)}>
                  {question.options.length + 1}
                </kbd>
                <input
                  ref={(input) => {
                    others.current[index] = input;
                  }}
                  aria-label={`Other answer to ${question.question}`}
                  placeholder="Other…"
                  value={entry.other}
                  onFocus={() => setCurrent(index)}
                  onChange={(event) => write(index, event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" || !entry.other.trim()) return;
                    event.preventDefault();
                    const all = picked.map((value, at) =>
                      at === index ? { ...value, otherOn: true } : value,
                    );
                    if (all.every((value) => answerOf(value) !== "")) send(all);
                    else next(all, index);
                  }}
                  {...stylex.props(styles.otherInput)}
                />
              </label>
            </div>
          </div>
        );
      })}
      <div {...stylex.props(styles.actions)}>
        {(!instant || picked[0]!.otherOn) && (
          <button
            type="button"
            disabled={!complete}
            onClick={() => send(picked)}
            {...stylex.props(ui.button, ui.pressable, ui.primary, styles.button)}
          >
            Answer
          </button>
        )}
        <button
          type="button"
          onClick={() => onAnswer("deny")}
          {...stylex.props(ui.button, ui.pressable, ui.outlined, styles.button)}
        >
          Skip
        </button>
      </div>
    </div>
  );
}

/**
 * Claude Code's ExitPlanMode: the plan as Markdown, Approve with the mode
 * that the work continues in, and Keep planning with what should change.
 */
export function PlanCard({
  permission,
  plan,
  onAnswer,
}: {
  permission: OwnedPermission;
  plan: NonNullable<OwnedPermission["plan"]>;
  onAnswer: Answer;
}) {
  const [mode, setMode] = useState(plan.mode);
  const [keeping, setKeeping] = useState(false);
  const [message, setMessage] = useState("");
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (keeping) field.current?.focus();
  }, [keeping]);
  return (
    <div role="group" aria-label="Plan" {...stylex.props(styles.card)}>
      <div {...stylex.props(styles.title)}>
        <Icon name="tasks" size={13} />
        {permission.title}
      </div>
      <div {...stylex.props(styles.plan)}>
        <SessionMarkdown text={plan.text} streaming={false} />
      </div>
      {keeping ? (
        <form
          aria-label="Keep planning"
          onSubmit={(event) => {
            event.preventDefault();
            onAnswer("deny", message.trim() ? { message: message.trim() } : {});
          }}
          {...stylex.props(styles.actions)}
        >
          <input
            ref={field}
            aria-label="What should change"
            placeholder="What should change? (optional)"
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Escape") return;
              event.preventDefault();
              event.stopPropagation();
              setKeeping(false);
            }}
            {...stylex.props(ui.input, styles.feedback)}
          />
          <button
            type="submit"
            {...stylex.props(ui.button, ui.pressable, ui.primary, styles.button)}
          >
            Keep planning
          </button>
          <button
            type="button"
            onClick={() => setKeeping(false)}
            {...stylex.props(ui.button, ui.pressable, ui.outlined, styles.button)}
          >
            Cancel
          </button>
        </form>
      ) : (
        <div {...stylex.props(styles.actions)}>
          <button
            type="button"
            onClick={() => onAnswer("approve", { mode })}
            {...stylex.props(ui.button, ui.pressable, ui.primary, styles.button)}
          >
            Approve
          </button>
          <span {...stylex.props(styles.then)}>then</span>
          <ChoiceSelect
            label="Mode after the plan"
            value={mode}
            choices={plan.modes.map((entry) => ({ value: entry.value, label: entry.name }))}
            onChange={setMode}
            trigger={styles.picker}
          />
          <button
            type="button"
            onClick={() => setKeeping(true)}
            {...stylex.props(ui.button, ui.pressable, ui.outlined, styles.button, styles.end)}
          >
            Keep planning
          </button>
        </div>
      )}
    </div>
  );
}

const styles = stylex.create({
  card: {
    flexShrink: 0,
    display: "flex",
    flexDirection: "column",
    gap: 10,
    marginInline: 12,
    marginBottom: 8,
    padding: 10,
    borderRadius: `calc(12px * ${tokens.round})`,
    backgroundColor: tokens.raised,
    boxShadow: `inset 0 0 0 1px ${tokens.accentLine}`,
    outline: "none",
  },
  title: {
    display: "flex",
    alignItems: "center",
    gap: 7,
    color: tokens.text,
    fontSize: 12.5,
    fontWeight: 500,
  },
  question: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    paddingInlineStart: 8,
    borderInlineStartWidth: 2,
    borderInlineStartStyle: "solid",
    borderInlineStartColor: "transparent",
  },
  current: { borderInlineStartColor: tokens.accent },
  prompt: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "baseline",
    gap: 6,
    color: tokens.text,
    fontSize: 13,
    lineHeight: 1.45,
  },
  header: {
    paddingInline: 6,
    paddingBlock: 1,
    borderRadius: `calc(4px * ${tokens.round})`,
    backgroundColor: tokens.accentSoft,
    color: tokens.accent,
    fontSize: 11,
    fontWeight: 500,
  },
  hint: { color: tokens.muted, fontSize: 11.5 },
  choices: { display: "flex", flexDirection: "column", gap: 4 },
  choice: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    minHeight: 30,
    paddingInline: 8,
    paddingBlock: 4,
    borderWidth: 0,
    borderRadius: `calc(8px * ${tokens.round})`,
    backgroundColor: { default: tokens.fill, ":hover": tokens.hover },
    color: tokens.text,
    font: "inherit",
    textAlign: "start",
    cursor: "pointer",
  },
  choiceOn: {
    backgroundColor: { default: tokens.accentSoft, ":hover": tokens.accentSoft },
    boxShadow: `inset 0 0 0 1px ${tokens.accentLine}`,
  },
  key: {
    flexShrink: 0,
    minWidth: 16,
    paddingInline: 4,
    borderRadius: `calc(4px * ${tokens.round})`,
    boxShadow: `inset 0 0 0 1px ${tokens.line}`,
    color: tokens.muted,
    fontFamily: tokens.code,
    fontSize: 10.5,
    lineHeight: "16px",
    textAlign: "center",
  },
  keyAway: { opacity: 0.4 },
  choiceText: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "baseline",
    columnGap: 8,
    flexGrow: 1,
    minWidth: 0,
  },
  choiceLabel: { fontSize: 12.5, fontWeight: 500 },
  choiceNote: { color: tokens.muted, fontSize: 12 },
  other: { cursor: "text" },
  otherInput: {
    flexGrow: 1,
    minWidth: 0,
    padding: 0,
    borderWidth: 0,
    backgroundColor: "transparent",
    color: tokens.text,
    font: "inherit",
    fontSize: 12.5,
    outline: "none",
    "::placeholder": { color: tokens.faint },
  },
  plan: {
    maxHeight: "min(40vh, 360px)",
    overflowY: "auto",
    paddingInline: 10,
    paddingBlock: 4,
    borderRadius: `calc(8px * ${tokens.round})`,
    backgroundColor: tokens.panel,
    boxShadow: `inset 0 0 0 1px ${tokens.line}`,
    fontSize: 13,
  },
  actions: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6 },
  button: { minHeight: 26, fontSize: 12 },
  then: { color: tokens.muted, fontSize: 12 },
  picker: { minHeight: 26, fontSize: 12 },
  end: { marginInlineStart: "auto" },
  feedback: { flexGrow: 1, minWidth: 160, minHeight: 26, fontSize: 12 },
});
