import * as stylex from "@stylexjs/stylex";
import { memo } from "react";
import type { PullRequestState } from "../../shared/saved-review";
import type { Stack, StackLayer } from "../data/stack";
import { picked, tokens, ui } from "../theme.stylex";
import { ChoiceSelect } from "./Controls";
import { Icon } from "./Icon";
import { clippedTooltip } from "./ToolButton";

/** What the Review shows of a stack: one layer, every layer, or a range. */
export type StackMode =
  | { kind: "layer" }
  | { kind: "whole" }
  | { kind: "range"; from: number; to: number };

export interface StackRailProps {
  stack: Stack;
  /** The shown layer's index, bottom first. */
  current: number;
  mode: StackMode;
  onLayer(index: number): void;
  /** Shows layers `from` to `to` as one diff; all of them is Whole stack. */
  onRange(from: number, to: number): void;
}

const stateLabels: Record<PullRequestState, string> = {
  open: "Open",
  draft: "Draft",
  merged: "Merged",
  closed: "Closed",
};

/** The base that a layer's diff starts from, when it is not the layer below:
 * a pull request that GitHub moved to main after the one below merged. */
function movedBase(layers: readonly StackLayer[], index: number) {
  const below = layers[index - 1];
  const layer = layers[index]!;
  return below?.head && layer.base && layer.base !== below.head ? layer.base : undefined;
}

export const modeLabel = (stack: Stack, mode: StackMode) =>
  mode.kind === "whole"
    ? "Whole stack"
    : mode.kind === "range"
      ? `Layers ${mode.from + 1}–${mode.to + 1}`
      : stack.shape === "set"
        ? "This part"
        : "This layer";

/**
 * A stack's layers at the top of the Review's rail, top to bottom as git
 * draws them, with the base branch under the bottom one (docs/STACKS.md).
 * A click shows one layer; Shift-click shows the layers from the shown one to
 * it as one diff. A set lists its parts with nothing under them.
 */
export const StackRail = memo(function StackRail({
  stack,
  current,
  mode,
  onLayer,
  onRange,
}: StackRailProps) {
  const { layers } = stack;
  const isStack = stack.shape === "stack";
  const spanned = (index: number) =>
    mode.kind === "whole" ||
    (mode.kind === "range" && index >= mode.from && index <= mode.to) ||
    (mode.kind === "layer" && index === current);
  return (
    <section
      aria-label={isStack ? "Stack" : "Set"}
      data-stack-rail=""
      {...stylex.props(styles.rail)}
    >
      <div {...stylex.props(styles.head)}>
        <span {...stylex.props(ui.label)}>{isStack ? "Stack" : "Set"}</span>
      </div>
      {isStack && (
        <div role="group" aria-label="Diff" {...stylex.props(styles.modes)}>
          <button
            type="button"
            aria-pressed={mode.kind === "layer"}
            onClick={() => onLayer(current)}
            {...stylex.props(styles.mode, mode.kind === "layer" && styles.modeOn)}
          >
            This layer
          </button>
          <button
            type="button"
            aria-pressed={mode.kind === "whole"}
            onClick={() => onRange(0, layers.length - 1)}
            {...stylex.props(styles.mode, mode.kind === "whole" && styles.modeOn)}
          >
            Whole stack
          </button>
          {mode.kind === "range" && (
            <span aria-current="true" {...stylex.props(styles.mode, styles.modeOn, styles.span)}>
              {modeLabel(stack, mode)}
            </span>
          )}
        </div>
      )}
      <ol aria-label={isStack ? "Layers, top first" : "Parts"} {...stylex.props(styles.list)}>
        {layers
          .map((layer, index) => ({ layer, index }))
          .toReversed()
          .map(({ layer, index }) => {
            const on = spanned(index);
            const here = mode.kind === "layer" && index === current;
            const base = isStack ? movedBase(layers, index) : undefined;
            const gone = layer.state === "merged" || layer.state === "closed";
            return (
              <li key={layer.id}>
                <button
                  type="button"
                  data-layer={index + 1}
                  aria-current={here ? "page" : undefined}
                  aria-label={[
                    `${isStack ? "Layer" : "Part"} ${index + 1}: ${layer.title}`,
                    layer.state && stateLabels[layer.state],
                  ]
                    .filter(Boolean)
                    .join(", ")}
                  onClick={(event) => {
                    if (event.shiftKey && isStack && index !== current)
                      onRange(Math.min(current, index), Math.max(current, index));
                    else onLayer(index);
                  }}
                  {...clippedTooltip(layer.pullRequestTitle ?? layer.title)}
                  {...stylex.props(
                    styles.row,
                    on && styles.inSpan,
                    here && [styles.on, picked],
                    gone && styles.gone,
                  )}
                >
                  <span {...stylex.props(styles.number)}>{index + 1}</span>
                  <span {...stylex.props(styles.body)}>
                    <span {...stylex.props(styles.title)}>{layer.title}</span>
                    <span {...stylex.props(styles.meta)}>
                      {layer.state && (
                        <span {...stylex.props(styles.state, stateStyles[layer.state])}>
                          {stateLabels[layer.state]}
                        </span>
                      )}
                      {base && <span title={`Its diff starts from ${base}`}>on {base}</span>}
                      {layer.additions !== undefined && (
                        <span {...stylex.props(ui.added)}>+{layer.additions}</span>
                      )}
                      {layer.deletions !== undefined && (
                        <span {...stylex.props(ui.removed)}>−{layer.deletions}</span>
                      )}
                      {layer.comments > 0 && (
                        <span {...stylex.props(styles.notes)}>
                          <Icon name="note" size={10} />
                          {layer.comments}
                        </span>
                      )}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
      </ol>
      {isStack && (
        <div {...stylex.props(styles.base)} title="The branch under the bottom layer">
          <Icon name="gitBranch" size={12} />
          <span>{stack.base}</span>
        </div>
      )}
    </section>
  );
});

/**
 * The layers as a menu, for a pane too narrow for the rail: in the review's
 * row, beside its version.
 */
export function LayerMenu({
  stack,
  current,
  mode,
  onLayer,
  onRange,
}: Pick<StackRailProps, "stack" | "current" | "mode" | "onLayer" | "onRange">) {
  const { layers } = stack;
  const isStack = stack.shape === "stack";
  const value =
    mode.kind === "whole" ? "whole" : mode.kind === "range" ? "range" : `layer:${current}`;
  return (
    <ChoiceSelect
      label={isStack ? "Layer" : "Part"}
      value={value}
      // A short trigger, so the review's tabs keep their names in a narrow pane.
      display={
        mode.kind === "layer"
          ? `${isStack ? "Layer" : "Part"} ${current + 1}/${layers.length}`
          : modeLabel(stack, mode)
      }
      choices={[
        ...layers
          .map((layer, index) => ({
            value: `layer:${index}`,
            label: `${index + 1} · ${layer.title}`,
            ...(layer.state && { description: stateLabels[layer.state] }),
          }))
          .toReversed(),
        ...(isStack
          ? [{ value: "whole", label: "Whole stack", description: `${stack.base} to the top` }]
          : []),
        ...(mode.kind === "range" ? [{ value: "range", label: modeLabel(stack, mode) }] : []),
      ]}
      onChange={(next) => {
        if (next === "whole") onRange(0, layers.length - 1);
        else if (next.startsWith("layer:")) onLayer(Number(next.slice(6)));
      }}
    />
  );
}

const stateStyles = stylex.create({
  open: { color: tokens.green },
  draft: { color: tokens.faint },
  merged: { color: tokens.accent },
  closed: { color: tokens.red },
});

const styles = stylex.create({
  rail: {
    flexShrink: 0,
    display: "flex",
    flexDirection: "column",
    maxHeight: "45%",
    minHeight: 0,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: tokens.line,
    fontFamily: tokens.ui,
  },
  head: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    height: 36,
    flexShrink: 0,
    paddingInlineStart: 14,
    paddingInlineEnd: 8,
  },
  modes: {
    display: "flex",
    gap: 2,
    flexShrink: 0,
    marginInline: 8,
    marginBottom: 6,
    padding: 2,
    borderRadius: `calc(7px * ${tokens.round})`,
    backgroundColor: tokens.fill,
  },
  mode: {
    flex: "1",
    height: 22,
    paddingInline: 6,
    borderWidth: 0,
    borderRadius: `calc(5px * ${tokens.round})`,
    backgroundColor: "transparent",
    color: { default: tokens.muted, ":hover": tokens.text },
    fontFamily: tokens.ui,
    fontSize: 11.5,
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
  modeOn: {
    backgroundColor: tokens.raised,
    color: tokens.text,
    boxShadow: `0 0 0 1px ${tokens.line}`,
  },
  span: { display: "inline-flex", alignItems: "center", justifyContent: "center" },
  list: {
    listStyle: "none",
    margin: 0,
    paddingBlock: 0,
    paddingInline: 6,
    overflowY: "auto",
    scrollbarWidth: "thin",
    minHeight: 0,
  },
  row: {
    position: "relative",
    display: "flex",
    alignItems: "center",
    gap: 9,
    width: "100%",
    boxSizing: "border-box",
    paddingBlock: 5,
    paddingInline: 8,
    marginBottom: 1,
    borderWidth: 0,
    borderRadius: `calc(7px * ${tokens.round})`,
    backgroundColor: { default: "transparent", ":hover": tokens.fill },
    color: tokens.text,
    fontFamily: tokens.ui,
    textAlign: "left",
    cursor: "pointer",
    outline: { default: "none", ":focus-visible": `2px solid ${tokens.accentLine}` },
    outlineOffset: -2,
  },
  inSpan: { backgroundColor: { default: tokens.accentSoft, ":hover": tokens.accentSoft } },
  on: {
    backgroundColor: { default: tokens.pick, ":hover": tokens.pick },
    color: tokens.selectedText,
  },
  gone: { opacity: 0.6 },
  number: {
    flexShrink: 0,
    width: 14,
    color: tokens.faint,
    fontFamily: tokens.code,
    fontSize: 11,
    textAlign: "right",
    fontVariantNumeric: "tabular-nums",
  },
  body: { display: "flex", flexDirection: "column", gap: 2, flex: "1", minWidth: 0 },
  title: {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    fontSize: 12.5,
    fontWeight: 500,
    lineHeight: 1.35,
  },
  meta: {
    display: "flex",
    alignItems: "center",
    gap: 7,
    minWidth: 0,
    color: tokens.faint,
    fontFamily: tokens.code,
    fontSize: 10.5,
    fontVariantNumeric: "tabular-nums",
    whiteSpace: "nowrap",
  },
  state: { fontFamily: tokens.ui, fontWeight: 500 },
  notes: { display: "inline-flex", alignItems: "center", gap: 3, color: tokens.accent },
  base: {
    display: "flex",
    alignItems: "center",
    gap: 7,
    marginInline: 6,
    paddingBlock: 4,
    paddingInlineStart: 30,
    color: tokens.faint,
    fontFamily: tokens.code,
    fontSize: 11,
  },
});
