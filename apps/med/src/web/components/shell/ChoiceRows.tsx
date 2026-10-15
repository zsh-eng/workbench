import { Combobox } from "@base-ui/react/combobox";
import * as stylex from "@stylexjs/stylex";
import {
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import type { AgentPreset } from "../../../shared/owned-session";
import { picked, tokens, ui } from "../../theme.stylex";
import { Icon } from "../Icon";
import type { AttemptChoice, AttemptPick } from "../attempts/NewAttempts";

// New thread's choices as a spec sheet: a muted label, then every option as
// plain text, so a choice is one click. A row with too many options for its
// line shows the ones that fit, and More… lists them all with a filter.

/** One option of a row. */
interface Choice {
  value: string;
  /** The name that More… shows and filters. */
  text: string;
  /** What the row shows; the text when absent. */
  label?: ReactNode;
  title?: string;
}

/** A model's or an effort's option, with Claude Code's "Default (recommended)" as "Default". */
const optionChoice = (option: { value: string; name: string; description?: string }) => ({
  value: option.value,
  text: option.value === "default" ? "Default" : option.name,
  title: option.description,
});

const GAP = 2;

/**
 * The options that fit on one line: the first ones in order, and the chosen
 * one wherever it is. Null when all fit. `widths` are the options' widths,
 * `more` the width of More…, and `room` the line's width.
 */
function fitChoices(widths: number[], more: number, room: number, chosen: number) {
  const all = widths.reduce((sum, width) => sum + width + GAP, -GAP);
  if (all <= room + 0.5) return null;
  let used = more + (chosen >= 0 ? widths[chosen]! + GAP : 0);
  const shown: number[] = [];
  for (let index = 0; index < widths.length; index++) {
    if (index === chosen) continue;
    if (used + widths[index]! + GAP > room + 0.5) break;
    used += widths[index]! + GAP;
    shown.push(index);
  }
  if (chosen >= 0) shown.push(chosen);
  return shown.sort((a, b) => a - b);
}

/** Measures the options in `ruler` against the width of `line`, again when either changes. */
function useFit(
  line: RefObject<HTMLDivElement | null>,
  ruler: RefObject<HTMLDivElement | null>,
  enabled: boolean,
  chosen: number,
  key: string,
) {
  const [fit, setFit] = useState<number[] | null>(null);
  useLayoutEffect(() => {
    const box = line.current;
    const measure = ruler.current;
    if (!enabled || !box || !measure) return;
    const update = () => {
      const widths = [...measure.children].map((child) => child.getBoundingClientRect().width);
      const more = widths.pop() ?? 0;
      const next = fitChoices(widths, more, box.clientWidth, chosen);
      setFit((last) => (String(last) === String(next) ? last : next));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(box);
    observer.observe(measure);
    return () => observer.disconnect();
  }, [line, ruler, enabled, chosen, key]);
  return enabled ? fit : null;
}

/**
 * One labelled row of choices, a radio group: ← and → move and choose, Tab
 * leaves for the next row. One option shows as plain text. With `more` (the
 * noun of its options, such as "repositories"), the row keeps to one line.
 */
export function ChoiceRow({
  label,
  name = label,
  mark,
  indent = false,
  choices,
  value,
  onChange,
  more,
}: {
  label: string;
  /** The group's accessible name, such as "Model for attempt B". */
  name?: string;
  /** The attempt's letter, before the label. */
  mark?: string;
  /** In line with a label that has a mark above it. */
  indent?: boolean;
  choices: Choice[];
  value: string | undefined;
  onChange(value: string): void;
  more?: string;
}) {
  const line = useRef<HTMLDivElement>(null);
  const ruler = useRef<HTMLDivElement>(null);
  const chosen = choices.findIndex((choice) => choice.value === value);
  const fit = useFit(
    line,
    ruler,
    !!more && choices.length > 1,
    chosen,
    choices.map((choice) => `${choice.value}\n${choice.text}`).join("\n"),
  );
  // A fit for other options lasts one render: the row measures again before
  // the screen paints, and More… stays open meanwhile.
  const shown = fit ? fit.flatMap((index) => choices[index] ?? []) : choices;
  // The chosen option takes Tab; with none chosen, the first does.
  const tabStop = chosen >= 0 ? value : shown[0]?.value;

  const keyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!step || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
    const group = event.currentTarget.closest('[role="radiogroup"]');
    const radios = [
      ...(group?.querySelectorAll<HTMLButtonElement>('[role="radio"]:not(:disabled)') ?? []),
    ];
    const at = radios.indexOf(event.currentTarget);
    if (at < 0) return;
    event.preventDefault();
    const next = radios[(at + step + radios.length) % radios.length]!;
    next.focus();
    onChange(next.dataset.value!);
  };

  const single = choices.length === 1;
  return (
    <div {...stylex.props(styles.row)}>
      <span
        aria-hidden={!single}
        {...stylex.props(ui.label, styles.label, indent && styles.indent)}
      >
        {mark && <span {...stylex.props(styles.mark)}>{mark}</span>}
        {label}
      </span>
      <div ref={line} {...stylex.props(styles.line, !more && styles.wraps)}>
        {single ? (
          <span title={choices[0]!.title} {...stylex.props(styles.plain)}>
            <span>{choices[0]!.label ?? choices[0]!.text}</span>
          </span>
        ) : (
          <div
            role="radiogroup"
            aria-label={name}
            {...stylex.props(styles.radios, !more && styles.wraps)}
          >
            {shown.map((choice) => {
              const on = choice.value === value;
              return (
                <button
                  key={choice.value}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  tabIndex={choice.value === tabStop ? 0 : -1}
                  data-value={choice.value}
                  title={choice.title}
                  onClick={() => onChange(choice.value)}
                  onKeyDown={keyDown}
                  {...stylex.props(styles.option, on && [styles.on, picked])}
                >
                  <span {...stylex.props(styles.text)}>{choice.label ?? choice.text}</span>
                </button>
              );
            })}
          </div>
        )}
        {fit && more && (
          <MoreChoices
            noun={more}
            // "More models for attempt B"
            name={`More ${more}${name.startsWith(label) ? name.slice(label.length) : ""}`}
            choices={choices}
            value={value}
            onChange={onChange}
          />
        )}
        {more && !single && (
          // Every option at its width, out of sight, so the row knows what fits.
          <div aria-hidden="true" {...stylex.props(styles.ruler)}>
            <div ref={ruler} {...stylex.props(styles.rulerLine)}>
              {choices.map((choice) => (
                <span key={choice.value} {...stylex.props(styles.option)}>
                  <span {...stylex.props(styles.text)}>{choice.label ?? choice.text}</span>
                </span>
              ))}
              <span {...stylex.props(styles.option)}>More…</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** More…: every option of a row, filtered as the user types. */
function MoreChoices({
  noun,
  name,
  choices,
  value,
  onChange,
}: {
  noun: string;
  /** The trigger's accessible name. */
  name: string;
  choices: Choice[];
  value: string | undefined;
  onChange(value: string): void;
}) {
  return (
    <Combobox.Root<Choice>
      items={choices}
      value={choices.find((choice) => choice.value === value) ?? null}
      onValueChange={(choice) => {
        if (choice) onChange(choice.value);
      }}
      itemToStringLabel={(choice) => choice.text}
      isItemEqualToValue={(item, chosen) => item.value === chosen.value}
      autoHighlight
    >
      <Combobox.Trigger aria-label={name} {...stylex.props(styles.option, styles.more)}>
        More…
      </Combobox.Trigger>
      <Combobox.Portal>
        <Combobox.Positioner
          side="bottom"
          align="start"
          sideOffset={4}
          {...stylex.props(styles.layer)}
        >
          <Combobox.Popup {...stylex.props(ui.popup, ui.pop, styles.popup)}>
            <div {...stylex.props(styles.search)}>
              <Icon name="search" size={13} />
              <Combobox.Input
                aria-label={`Filter ${noun}`}
                placeholder={`Filter ${noun}…`}
                {...stylex.props(styles.filter)}
              />
            </div>
            <Combobox.Empty>
              <div {...stylex.props(styles.empty)}>No {noun} match.</div>
            </Combobox.Empty>
            <Combobox.List aria-label={noun} {...stylex.props(styles.list)}>
              {(choice: Choice) => (
                <Combobox.Item
                  key={choice.value}
                  value={choice}
                  title={choice.title}
                  className={(state) =>
                    stylex.props(
                      ui.menuItem,
                      styles.item,
                      state.highlighted && [ui.menuHighlighted, picked],
                    ).className
                  }
                >
                  <span {...stylex.props(styles.text)}>{choice.text}</span>
                  <Combobox.ItemIndicator {...stylex.props(styles.check)}>
                    <Icon name="check" size={13} />
                  </Combobox.ItemIndicator>
                </Combobox.Item>
              )}
            </Combobox.List>
          </Combobox.Popup>
        </Combobox.Positioner>
      </Combobox.Portal>
    </Combobox.Root>
  );
}

/** An agent's rows: the agent, its model, and its effort, for one attempt or the thread. */
export function AgentRows({
  pick,
  agents,
  onChoose,
  letter,
}: {
  pick: AttemptPick;
  agents: AgentPreset[];
  onChoose(next: AttemptChoice): void;
  /** The attempt's letter, when there are several. */
  letter?: string;
}) {
  const of = (label: string) => (letter ? `${label} for attempt ${letter}` : label);
  return (
    <>
      {agents.length > 0 && (
        <ChoiceRow
          label="Agent"
          name={of("Agent")}
          mark={letter}
          choices={agents.map((agent) => ({ value: agent.id, text: agent.name }))}
          value={pick.agent?.id}
          onChange={(preset) => onChoose({ preset })}
          more="agents"
        />
      )}
      {pick.options?.model && pick.model && (
        <ChoiceRow
          label="Model"
          name={of("Model")}
          indent={!!letter}
          choices={pick.options.model.options.map(optionChoice)}
          value={pick.model}
          onChange={(model) => onChoose({ model })}
          more="models"
        />
      )}
      {pick.effort && (
        <ChoiceRow
          label="Effort"
          name={of("Effort")}
          indent={!!letter}
          choices={pick.efforts.map(optionChoice)}
          value={pick.effort}
          onChange={(effort) => onChoose({ effort })}
          more="efforts"
        />
      )}
    </>
  );
}

// Below this width of New thread's column, each label goes above its options.
const narrow = "@container (max-width: 639px)";

export const choiceStyles = stylex.create({
  /** The rows under the task, below a hairline. */
  sheet: {
    display: "flex",
    flexDirection: "column",
    gap: { default: 4, [narrow]: 8 },
    marginTop: 22,
    paddingTop: 14,
    paddingInline: 16,
    borderTopWidth: 1,
    borderTopStyle: "solid",
    borderTopColor: tokens.line,
  },
  /** An attempt's rows, a little apart from the next attempt's. */
  attempt: {
    display: "flex",
    flexDirection: "column",
    gap: { default: 4, [narrow]: 8 },
    paddingTop: 6,
  },
  code: { fontFamily: tokens.code, fontSize: 11.5 },
  dot: { color: tokens.faint },
});

const styles = stylex.create({
  // The label sits on the first line's baseline, also when the options wrap.
  row: {
    display: "grid",
    gridTemplateColumns: { default: "96px minmax(0, 1fr)", [narrow]: "minmax(0, 1fr)" },
    alignItems: "baseline",
    columnGap: 12,
    rowGap: 2,
  },
  label: {
    display: "flex",
    alignItems: "baseline",
    gap: 6,
    minWidth: 0,
    whiteSpace: "nowrap",
  },
  // Above its options, a label keeps to the left edge as they do.
  indent: { paddingInlineStart: { default: 24, [narrow]: 0 } },
  // As on the Attempts page.
  mark: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    width: 18,
    height: 18,
    borderRadius: `calc(5px * ${tokens.round})`,
    boxShadow: `inset 0 0 0 1px ${tokens.lineStrong}`,
    color: tokens.text,
    fontFamily: tokens.code,
    fontSize: 10.5,
    fontWeight: 500,
    textTransform: "none",
    letterSpacing: "normal",
  },
  // The options start where an option's text would: the fill reaches out to the left.
  line: {
    position: "relative",
    display: "flex",
    alignItems: "center",
    gap: GAP,
    minWidth: 0,
    marginInlineStart: -8,
  },
  wraps: { flexWrap: "wrap" },
  radios: { display: "flex", alignItems: "center", gap: GAP, minWidth: 0 },
  option: {
    display: "inline-flex",
    alignItems: "center",
    flexShrink: 0,
    boxSizing: "border-box",
    maxWidth: "100%",
    height: 24,
    paddingInline: 8,
    borderWidth: 0,
    borderRadius: `calc(6px * ${tokens.round})`,
    backgroundColor: { default: "transparent", ":hover": tokens.fill },
    color: { default: tokens.muted, ":hover": tokens.text },
    fontFamily: tokens.ui,
    fontSize: 12,
    fontWeight: 450,
    whiteSpace: "nowrap",
    cursor: "pointer",
    outline: { default: "none", ":focus-visible": `2px solid ${tokens.accentLine}` },
    outlineOffset: -1,
  },
  // The chosen option, as the sidebar marks its current row.
  on: {
    backgroundColor: { default: tokens.pick, ":hover": tokens.pick },
    color: { default: tokens.selectedText, ":hover": tokens.selectedText },
    cursor: "default",
  },
  more: { color: { default: tokens.faint, ":hover": tokens.text } },
  text: { display: "block", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" },
  // The only option: a fact, not a choice. A long one wraps.
  plain: {
    minWidth: 0,
    paddingBlock: 4,
    paddingInline: 8,
    color: tokens.text,
    fontFamily: tokens.ui,
    fontSize: 12,
    fontWeight: 450,
    lineHeight: "16px",
    overflowWrap: "anywhere",
  },
  // Clipped to the line, so it never widens the page.
  ruler: {
    position: "absolute",
    insetInline: 0,
    top: 0,
    height: 0,
    overflow: "hidden",
    visibility: "hidden",
    pointerEvents: "none",
  },
  rulerLine: { display: "flex", gap: GAP, width: "max-content" },
  layer: { zIndex: 60 },
  popup: { width: 260, padding: 0, overflowY: "hidden" },
  search: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    height: 34,
    paddingInline: 10,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: tokens.line,
    color: tokens.faint,
  },
  filter: {
    flex: "1",
    minWidth: 0,
    borderWidth: 0,
    outline: "none",
    backgroundColor: "transparent",
    color: tokens.text,
    fontFamily: tokens.ui,
    fontSize: 12,
    "::placeholder": { color: tokens.faint },
  },
  list: { maxHeight: "min(260px, 40vh)", overflowY: "auto", padding: 4, outline: "none" },
  item: { justifyContent: "flex-start", gap: 8 },
  check: { display: "inline-flex", marginInlineStart: "auto", color: tokens.muted },
  empty: { paddingBlock: 14, paddingInline: 10, color: tokens.faint, fontSize: 12 },
});
