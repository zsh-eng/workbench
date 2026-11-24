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
import { column } from "./session-styles";

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
  const groups = useRef<(HTMLDivElement | null)[]>([]);
  const instant = questions.length === 1 && !questions[0]!.multiSelect;
  const answeredCount = picked.filter((entry) => answerOf(entry) !== "").length;
  const complete = answeredCount === questions.length;

  useEffect(() => {
    if (questions.length > 1) groups.current[current]?.scrollIntoView({ block: "nearest" });
  }, [current, questions.length]);

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
      {...stylex.props(styles.card, column.bar)}
    >
      <div {...stylex.props(styles.cardHead)}>
        <span aria-hidden="true" {...stylex.props(styles.badge)}>
          <Icon name="ask" size={13} />
        </span>
        <span {...stylex.props(styles.titleText)}>{permission.title}</span>
        {questions.length > 1 && (
          <span {...stylex.props(styles.progress)}>
            {answeredCount} of {questions.length} answered
          </span>
        )}
      </div>
      <div {...stylex.props(styles.body)}>
        {questions.map((question, index) => {
          const entry = picked[index]!;
          const here = index === current;
          const answered = answerOf(entry) !== "";
          return (
            <div
              key={question.question}
              ref={(node) => {
                groups.current[index] = node;
              }}
              role="group"
              aria-label={question.question}
              {...stylex.props(
                styles.question,
                index > 0 && styles.questionSplit,
                questions.length > 1 && styles.questionMulti,
                questions.length > 1 && here && styles.current,
              )}
            >
              <div {...stylex.props(styles.prompt)}>
                {question.header && <span {...stylex.props(styles.header)}>{question.header}</span>}
                <span {...stylex.props(styles.promptText)}>{question.question}</span>
                {question.multiSelect && <span {...stylex.props(styles.hint)}>Select any</span>}
                {questions.length > 1 && answered && (
                  <span aria-hidden="true" {...stylex.props(styles.answeredDot)}>
                    <Icon name="check" size={11} />
                  </span>
                )}
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
                      <kbd
                        aria-hidden="true"
                        {...stylex.props(
                          styles.key,
                          on && styles.keyOn,
                          !here && !on && styles.keyAway,
                        )}
                      >
                        {at + 1}
                      </kbd>
                      <span {...stylex.props(styles.choiceText)}>
                        <span {...stylex.props(styles.choiceLabel)}>{option.label}</span>
                        {option.description && (
                          <span {...stylex.props(styles.choiceNote)}>{option.description}</span>
                        )}
                      </span>
                      <span
                        aria-hidden="true"
                        {...stylex.props(
                          styles.indicator,
                          question.multiSelect ? styles.indicatorBox : styles.indicatorRadio,
                          on && styles.indicatorOn,
                        )}
                      >
                        {on && <Icon name="check" size={11} />}
                      </span>
                    </button>
                  );
                })}
                <label
                  {...stylex.props(styles.choice, styles.other, entry.otherOn && styles.choiceOn)}
                >
                  <kbd
                    aria-hidden="true"
                    {...stylex.props(
                      styles.key,
                      entry.otherOn && styles.keyOn,
                      !here && !entry.otherOn && styles.keyAway,
                    )}
                  >
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
      </div>
      <div {...stylex.props(styles.footer)}>
        <span {...stylex.props(styles.shortcutHint)}>
          {instant ? "Press 1–9 to answer" : "Press 1–9 to pick · Enter to submit"}
        </span>
        <div {...stylex.props(styles.footerButtons)}>
          <button
            type="button"
            onClick={() => onAnswer("deny")}
            {...stylex.props(ui.button, ui.pressable, ui.outlined, styles.button)}
          >
            Skip
          </button>
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
        </div>
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
    <div role="group" aria-label="Plan" {...stylex.props(styles.card, column.bar)}>
      <div {...stylex.props(styles.cardHead)}>
        <span aria-hidden="true" {...stylex.props(styles.badge)}>
          <Icon name="tasks" size={13} />
        </span>
        <span {...stylex.props(styles.titleText)}>{permission.title}</span>
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
          {...stylex.props(styles.footer, styles.actions)}
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
        <div {...stylex.props(styles.footer, styles.actions)}>
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
    maxHeight: "min(56vh, 460px)",
    marginInline: 12,
    marginBottom: 8,
    overflow: "hidden",
    borderRadius: `calc(14px * ${tokens.round})`,
    backgroundColor: tokens.menu,
    boxShadow: `${tokens.shadow}, inset 0 0 0 1px ${tokens.lineStrong}`,
    outline: "none",
  },
  cardHead: {
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    gap: 8,
    paddingInline: 12,
    paddingBlock: 9,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: tokens.line,
    backgroundColor: tokens.raised,
  },
  badge: {
    flexShrink: 0,
    display: "grid",
    placeItems: "center",
    width: 22,
    height: 22,
    borderRadius: `calc(6px * ${tokens.round})`,
    backgroundColor: tokens.accentSoft,
    color: tokens.accent,
  },
  titleText: {
    minWidth: 0,
    color: tokens.text,
    fontSize: 12.5,
    fontWeight: 600,
    letterSpacing: "-0.005em",
  },
  progress: {
    marginInlineStart: "auto",
    flexShrink: 0,
    paddingInline: 7,
    paddingBlock: 2,
    borderRadius: 999,
    backgroundColor: tokens.fill,
    color: tokens.muted,
    fontSize: 11,
    fontWeight: 500,
    fontVariantNumeric: "tabular-nums",
  },
  body: {
    flexGrow: 1,
    flexShrink: 1,
    minHeight: 0,
    overflowY: "auto",
    scrollbarWidth: "thin",
    display: "flex",
    flexDirection: "column",
    gap: 12,
    paddingInline: 12,
    paddingBlock: 11,
  },
  question: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
  },
  questionSplit: {
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopStyle: "solid",
    borderTopColor: tokens.line,
  },
  questionMulti: {
    paddingInlineStart: 10,
    borderInlineStartWidth: 2,
    borderInlineStartStyle: "solid",
    borderInlineStartColor: "transparent",
    transition: "border-color 140ms ease",
  },
  current: { borderInlineStartColor: tokens.accent },
  prompt: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 6,
    color: tokens.text,
    fontSize: 13,
    lineHeight: 1.45,
  },
  promptText: {
    fontWeight: 500,
    color: tokens.text,
  },
  header: {
    paddingInline: 6,
    paddingBlock: 1,
    borderRadius: `calc(5px * ${tokens.round})`,
    backgroundColor: tokens.accentSoft,
    color: tokens.accent,
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: "0.01em",
  },
  hint: {
    color: tokens.muted,
    fontSize: 11.5,
  },
  answeredDot: {
    marginInlineStart: "auto",
    display: "grid",
    placeItems: "center",
    width: 18,
    height: 18,
    borderRadius: 999,
    backgroundColor: tokens.accentSoft,
    color: tokens.accent,
  },
  choices: {
    display: "flex",
    flexDirection: "column",
    gap: 5,
  },
  choice: {
    display: "flex",
    alignItems: "flex-start",
    gap: 9,
    minHeight: 34,
    paddingInline: 10,
    paddingBlock: 7,
    borderWidth: 0,
    borderRadius: `calc(9px * ${tokens.round})`,
    backgroundColor: { default: tokens.panel, ":hover": tokens.hover },
    boxShadow: {
      default: `inset 0 0 0 1px ${tokens.line}`,
      ":hover": `inset 0 0 0 1px ${tokens.lineStrong}`,
    },
    color: tokens.text,
    font: "inherit",
    textAlign: "start",
    cursor: "pointer",
    transition: "background-color 120ms ease, box-shadow 120ms ease",
    outline: { default: "none", ":focus-visible": `2px solid ${tokens.accentLine}` },
  },
  choiceOn: {
    backgroundColor: { default: tokens.accentSoft, ":hover": tokens.accentSoft },
    boxShadow: {
      default: `inset 0 0 0 1px ${tokens.accentLine}`,
      ":hover": `inset 0 0 0 1px ${tokens.accentLine}`,
    },
  },
  key: {
    flexShrink: 0,
    marginTop: 1,
    minWidth: 18,
    height: 18,
    paddingInline: 4,
    display: "inline-grid",
    placeItems: "center",
    borderRadius: `calc(5px * ${tokens.round})`,
    backgroundColor: tokens.fill,
    boxShadow: `inset 0 0 0 1px ${tokens.line}`,
    color: tokens.muted,
    fontFamily: tokens.code,
    fontSize: 10.5,
    fontWeight: 500,
    lineHeight: 1,
    transition: "background-color 120ms ease, color 120ms ease, opacity 120ms ease",
  },
  keyOn: {
    backgroundColor: tokens.accent,
    boxShadow: "none",
    color: tokens.canvas,
  },
  keyAway: { opacity: 0.45 },
  choiceText: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
    flexGrow: 1,
    minWidth: 0,
  },
  choiceLabel: {
    fontSize: 12.5,
    fontWeight: 500,
    lineHeight: 1.35,
    color: tokens.text,
  },
  choiceNote: {
    color: tokens.muted,
    fontSize: 12,
    lineHeight: 1.4,
  },
  indicator: {
    flexShrink: 0,
    marginTop: 2,
    display: "grid",
    placeItems: "center",
    width: 16,
    height: 16,
    boxShadow: `inset 0 0 0 1.25px ${tokens.lineStrong}`,
    color: tokens.canvas,
    transition: "background-color 120ms ease, box-shadow 120ms ease",
  },
  indicatorRadio: { borderRadius: 999 },
  indicatorBox: { borderRadius: `calc(4px * ${tokens.round})` },
  indicatorOn: {
    backgroundColor: tokens.accent,
    boxShadow: "none",
  },
  other: {
    alignItems: "center",
    cursor: "text",
  },
  otherInput: {
    flexGrow: 1,
    minWidth: 0,
    padding: 0,
    borderWidth: 0,
    backgroundColor: "transparent",
    color: tokens.text,
    font: "inherit",
    fontSize: 12.5,
    lineHeight: 1.4,
    outline: "none",
    "::placeholder": { color: tokens.faint },
  },
  plan: {
    flexGrow: 1,
    flexShrink: 1,
    minHeight: 0,
    maxHeight: "min(40vh, 340px)",
    overflowY: "auto",
    scrollbarWidth: "thin",
    paddingInline: 14,
    paddingBlock: 10,
    backgroundColor: tokens.panel,
    fontSize: 13,
  },
  footer: {
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    paddingInline: 12,
    paddingBlock: 8,
    borderTopWidth: 1,
    borderTopStyle: "solid",
    borderTopColor: tokens.line,
    backgroundColor: tokens.raised,
  },
  footerButtons: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    marginInlineStart: "auto",
  },
  shortcutHint: {
    color: tokens.faint,
    fontSize: 11,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  actions: {
    justifyContent: "flex-start",
    flexWrap: "wrap",
    gap: 6,
  },
  button: { minHeight: 27, paddingInline: 11, fontSize: 12 },
  then: { color: tokens.muted, fontSize: 12 },
  picker: { minHeight: 27, fontSize: 12 },
  end: { marginInlineStart: "auto" },
  feedback: { flexGrow: 1, minWidth: 160, minHeight: 27, fontSize: 12 },
});
