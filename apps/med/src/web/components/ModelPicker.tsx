import * as stylex from "@stylexjs/stylex";
import { Combobox } from "@base-ui/react/combobox";
import { useMemo, useState, type KeyboardEvent, type ReactNode } from "react";
import { Icon } from "./Icon";
import { Matched, matchRanges } from "./Palette";
import { tooltip } from "./ToolButton";
import { picked, tokens, ui } from "../theme.stylex";

export interface ModelChoice {
  value: string;
  name: string;
  /** Who offers it, such as Pi's providers: the list's sections. */
  group?: string;
}
export interface LevelChoice {
  value: string;
  name: string;
}

/** A level's name in the row, where up to seven share its width; its full
 * name is its label. */
const SHORT: Record<string, string> = {
  default: "Auto",
  off: "Off",
  minimal: "Min",
  low: "Low",
  medium: "Med",
  high: "High",
  xhigh: "XHigh",
  max: "Max",
};
const shortName = (level: LevelChoice) => SHORT[level.value] ?? level.name.replace(/ effort$/i, "");

/** Every word of the query, in the model's name or its section's. */
const matches = (model: ModelChoice, query: string) => {
  const text = `${model.name} ${model.group ?? ""} ${model.value}`.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => text.includes(word));
};

/**
 * The model and how hard it thinks, in one control: the trigger names both,
 * and its panel has a search field, the models in their sections, and the
 * levels as a row under them. On the new thread page, the agents come first.
 * Names only: the user knows the models and what the levels mean.
 *
 * Type to narrow the models, ↑ ↓ and Enter to pick one; with the field
 * empty, ← → step the level.
 */
export function ModelPicker({
  label = "Model",
  models,
  model,
  onModel,
  levels,
  agents,
  icon,
  harness,
  placeholder,
  disabled,
  align = "end",
  side,
  trigger,
}: {
  label?: string;
  models: ModelChoice[];
  model: string;
  onModel(value: string): void;
  /** The levels of the chosen model, such as Claude Code's effort or Pi's
   * thinking; none for a model without them. */
  levels?: {
    label: string;
    value: string;
    options: LevelChoice[];
    onChange(value: string): void;
    disabled?: boolean;
  };
  /** The agents to choose from, on the new thread page. */
  agents?: {
    value: string;
    options: { value: string; label: string }[];
    onChange(value: string): void;
  };
  /** Before the model's name in the trigger, such as the agent's mark. */
  icon?: ReactNode;
  /** The agent's name before the model's, where its mark does not say it,
   * such as Pi's: GPT-5.4 runs in Codex or in Pi. */
  harness?: string;
  /** The trigger's text while no model is chosen, such as the agent's name. */
  placeholder?: string;
  disabled?: boolean;
  align?: "start" | "center" | "end";
  side?: "top" | "bottom";
  trigger?: stylex.StyleXStyles;
}) {
  const [query, setQuery] = useState("");
  const names = useMemo(() => new Map(models.map((entry) => [entry.value, entry])), [models]);
  // The sections in the order that the agent lists them; one without a name
  // for an agent that has none.
  const groups = useMemo(() => {
    const order = new Map<string, string[]>();
    for (const entry of models) {
      const group = entry.group ?? "";
      order.set(group, [...(order.get(group) ?? []), entry.value]);
    }
    return [...order].map(([value, items]) => ({ value, items }));
  }, [models]);
  const chosen = names.get(model);
  const level = levels?.options.find((option) => option.value === levels.value);
  const step = (by: number) => {
    if (!levels || levels.disabled || !levels.options.length) return;
    const at = levels.options.findIndex((option) => option.value === levels.value);
    const next = levels.options[Math.min(levels.options.length - 1, Math.max(0, at + by))];
    if (next && next.value !== levels.value) levels.onChange(next.value);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (query || event.altKey || event.metaKey || event.ctrlKey || event.shiftKey) return;
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      step(event.key === "ArrowLeft" ? -1 : 1);
    }
  };
  const levelIndex = levels
    ? Math.max(
        0,
        levels.options.findIndex((option) => option.value === levels.value),
      )
    : 0;

  return (
    <Combobox.Root<string>
      items={groups}
      value={model}
      onValueChange={(next) => {
        if (next !== null && next !== model) onModel(next);
      }}
      inputValue={query}
      onInputValueChange={setQuery}
      onOpenChange={(open) => {
        if (!open) setQuery("");
      }}
      itemToStringLabel={(item) => names.get(item)?.name ?? item}
      filter={(item, text) => {
        const entry = names.get(item);
        return !text.trim() || (!!entry && matches(entry, text));
      }}
      disabled={disabled}
      autoHighlight
    >
      <Combobox.Trigger
        aria-label={label}
        {...stylex.props(ui.button, ui.strong, styles.trigger, trigger)}
      >
        {icon}
        {harness && (chosen || model) && <span {...stylex.props(styles.harness)}>{harness}</span>}
        <span data-choice-value="" {...stylex.props(styles.name)}>
          {chosen?.name ?? (model || placeholder)}
        </span>
        {level && level.value !== "default" && (
          <span {...stylex.props(styles.level)}>{level.name}</span>
        )}
        <Combobox.Icon {...stylex.props(styles.chevron)}>
          <Icon name="chevron" size={14} />
        </Combobox.Icon>
      </Combobox.Trigger>
      <Combobox.Portal>
        <Combobox.Positioner
          sideOffset={6}
          align={align}
          {...(side ? { side } : {})}
          {...stylex.props(styles.positioner)}
        >
          <Combobox.Popup aria-label={label} {...stylex.props(ui.popup, ui.pop, styles.popup)}>
            {agents && agents.options.length > 1 && (
              <div role="group" aria-label="Agent" {...stylex.props(styles.agents)}>
                {agents.options.map((agent) => (
                  <button
                    key={agent.value}
                    type="button"
                    aria-pressed={agent.value === agents.value}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => agent.value !== agents.value && agents.onChange(agent.value)}
                    {...stylex.props(
                      ui.button,
                      styles.agent,
                      agent.value === agents.value && styles.agentOn,
                    )}
                  >
                    {agent.label}
                  </button>
                ))}
              </div>
            )}
            {models.length > 0 && (
              <div {...stylex.props(styles.search)}>
                <Icon name="search" size={13} />
                <Combobox.Input
                  aria-label={`Search ${label.toLowerCase()}s`}
                  placeholder={`Search ${label.toLowerCase()}s`}
                  onKeyDown={onKeyDown}
                  {...stylex.props(styles.input)}
                />
              </div>
            )}
            <Combobox.Empty>
              {models.length > 0 && (
                <p {...stylex.props(styles.empty)}>No model matches “{query.trim()}”</p>
              )}
            </Combobox.Empty>
            <Combobox.List {...stylex.props(styles.list)}>
              {(group: { value: string; items: string[] }, groupIndex: number) => (
                <Combobox.Group
                  key={group.value}
                  items={group.items}
                  {...stylex.props(styles.group, groupIndex > 0 && styles.groupSplit)}
                >
                  {group.value && (
                    <Combobox.GroupLabel {...stylex.props(styles.groupLabel)}>
                      {group.value}
                    </Combobox.GroupLabel>
                  )}
                  <Combobox.Collection>
                    {(item: string) => {
                      const name = names.get(item)?.name ?? item;
                      return (
                        <Combobox.Item
                          key={item}
                          value={item}
                          title={name}
                          className={(state) =>
                            stylex.props(
                              ui.menuItem,
                              styles.item,
                              state.highlighted && [ui.menuHighlighted, picked],
                            ).className
                          }
                        >
                          <span {...stylex.props(styles.itemName)}>
                            <Matched text={name} ranges={matchRanges(name, query)} />
                          </span>
                          <span data-check="" {...stylex.props(styles.check)}>
                            <Combobox.ItemIndicator {...stylex.props(styles.indicator)}>
                              <Icon name="check" size={14} />
                            </Combobox.ItemIndicator>
                          </span>
                        </Combobox.Item>
                      );
                    }}
                  </Combobox.Collection>
                </Combobox.Group>
              )}
            </Combobox.List>
            {levels && levels.options.length > 1 && (
              <div
                role="radiogroup"
                aria-label={levels.label}
                aria-disabled={levels.disabled || undefined}
                {...stylex.props(styles.levels)}
              >
                <span
                  aria-hidden="true"
                  {...stylex.props(
                    styles.levelPill,
                    styles.levelPosition(levels.options.length, levelIndex),
                  )}
                />
                {levels.options.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={option.value === levels.value}
                    aria-label={option.name}
                    disabled={levels.disabled}
                    {...tooltip(option.name)}
                    // A click keeps the search field's focus, where ← → step.
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => option.value !== levels.value && levels.onChange(option.value)}
                    {...stylex.props(
                      styles.levelButton,
                      option.value === levels.value && styles.levelOn,
                    )}
                  >
                    {shortName(option)}
                  </button>
                ))}
              </div>
            )}
          </Combobox.Popup>
        </Combobox.Positioner>
      </Combobox.Portal>
    </Combobox.Root>
  );
}

const styles = stylex.create({
  // In a narrow toolbar the name truncates before the trigger overflows.
  trigger: { gap: 5, minWidth: 0, paddingInlineEnd: 5 },
  name: { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  level: { flexShrink: 0, color: tokens.faint, fontWeight: 400 },
  harness: { flexShrink: 0, color: tokens.muted, fontWeight: 400 },
  chevron: { display: "inline-flex", color: tokens.faint },
  positioner: { zIndex: 100, outline: "none" },
  popup: {
    display: "flex",
    flexDirection: "column",
    width: 300,
    maxWidth: "calc(100vw - 16px)",
    maxHeight: "min(440px, var(--available-height))",
    overflowY: "hidden",
  },
  agents: {
    display: "flex",
    flexWrap: "wrap",
    gap: 4,
    flexShrink: 0,
    paddingBottom: 6,
    marginBottom: 2,
  },
  agent: {
    height: 24,
    paddingInline: 9,
    borderRadius: 999,
    backgroundColor: { default: "transparent", ":hover": tokens.fill },
    color: { default: tokens.muted, ":hover": tokens.text },
    fontSize: 12,
  },
  agentOn: {
    backgroundColor: { default: tokens.accentSoft, ":hover": tokens.accentSoft },
    color: { default: tokens.accent, ":hover": tokens.accent },
  },
  search: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexShrink: 0,
    height: 32,
    marginBottom: 4,
    paddingInline: 8,
    borderRadius: `calc(7px * ${tokens.round})`,
    backgroundColor: tokens.fill,
    color: tokens.faint,
  },
  input: {
    flex: "1",
    minWidth: 0,
    height: "100%",
    paddingInline: 0,
    borderWidth: 0,
    outline: "none",
    backgroundColor: "transparent",
    color: tokens.text,
    font: "inherit",
    fontSize: 13,
  },
  empty: {
    margin: 0,
    paddingBlock: 10,
    paddingInline: 10,
    color: tokens.faint,
    fontSize: 12.5,
  },
  list: { flex: "1", minHeight: 0, overflowY: "auto", outline: "none", scrollPaddingBlock: 6 },
  group: { display: "flex", flexDirection: "column" },
  groupSplit: {
    marginTop: 4,
    paddingTop: 4,
    borderTopWidth: 1,
    borderTopStyle: "solid",
    borderTopColor: tokens.line,
  },
  // A section's name stays at the list's top while its models scroll under it.
  groupLabel: {
    position: "sticky",
    top: 0,
    zIndex: 1,
    backgroundColor: tokens.menu,
    paddingInline: 10,
    paddingTop: 6,
    paddingBottom: 3,
    color: tokens.faint,
    fontSize: 11.5,
    fontWeight: 500,
  },
  item: { justifyContent: "flex-start", gap: 12 },
  itemName: {
    flex: "1",
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  check: { display: "inline-flex", justifyContent: "center", flexShrink: 0, width: 14 },
  indicator: { display: "inline-flex", color: tokens.accent },
  // The levels: a track with a pill that slides to the chosen one.
  levels: {
    position: "relative",
    display: "flex",
    flexShrink: 0,
    marginTop: 6,
    padding: 2,
    borderRadius: `calc(8px * ${tokens.round})`,
    backgroundColor: tokens.fill,
    boxShadow: `inset 0 0 0 1px ${tokens.line}`,
  },
  levelPill: {
    position: "absolute",
    top: 2,
    bottom: 2,
    left: 2,
    borderRadius: `calc(6px * ${tokens.round})`,
    backgroundColor: tokens.segment,
    boxShadow: `0 0 0 1px ${tokens.lineStrong}, 0 1px 2px #0000001f`,
    transitionProperty: "transform",
    transitionTimingFunction: tokens.easeOut,
    transitionDuration: { default: "180ms", "@media (prefers-reduced-motion: reduce)": "0ms" },
    pointerEvents: "none",
  },
  levelPosition: (count: number, index: number) => ({
    width: `calc((100% - 4px) / ${count})`,
    transform: `translateX(${index * 100}%)`,
  }),
  levelButton: {
    position: "relative",
    flex: "1",
    minWidth: 0,
    height: 24,
    paddingInline: 2,
    borderWidth: 0,
    borderRadius: `calc(6px * ${tokens.round})`,
    backgroundColor: "transparent",
    color: { default: tokens.faint, ":hover:not(:disabled)": tokens.text },
    font: "inherit",
    fontSize: 12,
    cursor: { default: "pointer", ":disabled": "default" },
    whiteSpace: "nowrap",
  },
  levelOn: {
    color: { default: tokens.selectedText, ":hover:not(:disabled)": tokens.selectedText },
  },
});
