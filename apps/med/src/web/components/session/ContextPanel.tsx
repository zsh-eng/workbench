import * as stylex from "@stylexjs/stylex";
import type { ContextBreakdown } from "../../../shared/owned-session";
import { relativeTime, useMinuteClock } from "../../data/relative-time";
import { tokens } from "../../theme.stylex";
import { Icon } from "../Icon";
import { ContextNotes, type ShownContext } from "./ThreadUsage";
import "./SessionThread.css";

// The side panel's Context card, as Claude Desktop's: the share in use, a bar
// of what fills it, and, for an agent that Med runs, each part with its
// tokens (docs/SESSIONS.md#side-panel).

/** 466.9k, 500k, 225. */
export function compactTokens(value: number) {
  const short = (number: number, unit: string) => `${number.toFixed(1).replace(/\.0$/, "")}${unit}`;
  if (value >= 1_000_000) return short(value / 1_000_000, "M");
  if (value >= 1000) return short(value / 1000, "k");
  return String(Math.round(value));
}

type Category = ContextBreakdown["categories"][number];

/** A part's colour: the ones that fill a window most have their own, as in
 * Claude Desktop; the rest are grey. */
const COLORS: Record<string, string> = {
  Messages: tokens.accent,
  "System tools": `color-mix(in srgb, ${tokens.red} 55%, ${tokens.warning})`,
  "MCP tools": tokens.green,
  "System prompt": tokens.warning,
};
const colorOf = (category: Category) =>
  category.kind === "free"
    ? tokens.fillStrong
    : category.kind === "buffer" || category.kind === "deferred"
      ? tokens.lineStrong
      : (COLORS[category.name] ?? tokens.faint);

/** What a part's name means, where it is not plain. */
const MEANINGS: Record<string, string> = {
  "MCP tools": "The tools of MCP servers that the agent has loaded",
  "MCP server instructions": "What the MCP servers tell the agent about their tools",
  Skills: "The name and description of each skill the agent can use",
  "Memory files": "CLAUDE.md and the other memory files",
  "Custom agents": "The description of each subagent the agent can start",
  "Autocompact buffer": "Room kept free, so that compaction has space to run",
};

/** The parts in Claude Desktop's order: those in use, largest first, then
 * the buffer and the free space; the deferred ones apart. */
function parts(breakdown: ContextBreakdown) {
  const used = breakdown.categories
    .filter((category) => category.kind === "used")
    .toSorted((a, b) => b.tokens - a.tokens);
  const rest = breakdown.categories.filter(
    (category) => category.kind === "buffer" || category.kind === "free",
  );
  const deferred = breakdown.categories.filter((category) => category.kind === "deferred");
  return { used, shown: [...used, ...rest], deferred };
}

/** The share in use and the bar, folded or open. */
export function ContextSummary({
  context,
  breakdown,
}: {
  context: ShownContext;
  breakdown?: ContextBreakdown;
}) {
  const share = context.window ? context.used / context.window : 0;
  const near = context.used >= 0.8 * (context.compaction?.at ?? context.window);
  const at = context.compaction?.at;
  const percent = (count: number) => `${Math.min(100, (count / context.window) * 100)}%`;
  return (
    <div {...stylex.props(styles.summary)}>
      <p {...stylex.props(styles.headline)}>
        <span {...stylex.props(styles.share)}>{Math.round(share * 100)}% used</span>
        <span {...stylex.props(styles.count)}>
          {compactTokens(context.used)} / {compactTokens(context.window)}
        </span>
      </p>
      <div
        role="meter"
        aria-label="Context in use"
        aria-valuemin={0}
        aria-valuemax={context.window}
        aria-valuenow={context.used}
        aria-valuetext={`${Math.round(share * 100)}%`}
        {...stylex.props(styles.bar)}
      >
        {breakdown ? (
          parts(breakdown)
            .shown.filter((category) => category.kind !== "free" && category.tokens > 0)
            .map((category) => (
              <span
                key={category.name}
                title={`${category.name}: ${compactTokens(category.tokens)}`}
                {...stylex.props(
                  styles.segment,
                  styles.segmentSize(percent(category.tokens), colorOf(category)),
                )}
              />
            ))
        ) : (
          <span
            {...stylex.props(
              styles.segment,
              styles.segmentSize(percent(context.used), near ? tokens.accent : tokens.muted),
            )}
          />
        )}
        {!breakdown && at !== undefined && at < context.window && (
          <span
            {...stylex.props(styles.mark, styles.left(percent(at)))}
            title={`Compacts at ${compactTokens(at)}`}
          />
        )}
      </div>
    </div>
  );
}

/** Each part with its tokens and share, and the lists behind them, while the
 * card is open. Without a breakdown, where the window and compaction come from. */
export function ContextDetails({
  context,
  breakdown,
  working,
}: {
  context: ShownContext;
  breakdown?: ContextBreakdown;
  working: boolean;
}) {
  const now = useMinuteClock(!!breakdown);
  if (!breakdown)
    return (
      <div {...stylex.props(styles.notes)}>
        <ContextNotes context={context} />
      </div>
    );
  const { shown, deferred } = parts(breakdown);
  const share = (count: number) =>
    context.window ? `${((count / context.window) * 100).toFixed(1)}%` : "";
  const row = (category: Category, figure: string) => (
    <li key={category.name} {...stylex.props(styles.row)}>
      <span
        aria-hidden="true"
        {...stylex.props(styles.swatch, styles.swatchColor(colorOf(category)))}
      />
      <span
        title={MEANINGS[category.name]}
        {...stylex.props(styles.name, !!MEANINGS[category.name] && styles.explained)}
      >
        {category.name}
      </span>
      <span {...stylex.props(styles.number)}>{compactTokens(category.tokens)}</span>
      <span {...stylex.props(styles.number, styles.percent)}>{figure}</span>
    </li>
  );
  type Item = { key: string; name: string; title?: string; detail?: string; tokens: number };
  const lists: { label: string; count: number; items: Item[] }[] = [
    {
      label: "MCP tools",
      count: breakdown.mcpServers.reduce((sum, server) => sum + server.tools, 0),
      items: breakdown.mcpServers.map((server) => ({
        key: server.name,
        name: server.name,
        detail: `${server.tools} ${server.tools === 1 ? "tool" : "tools"}`,
        tokens: server.tokens,
      })),
    },
    {
      label: "Memory files",
      count: breakdown.memoryFiles.length,
      items: breakdown.memoryFiles.map((file) => ({
        key: file.path,
        name: file.path.split("/").filter(Boolean).slice(-2).join("/"),
        title: file.path,
        tokens: file.tokens,
      })),
    },
    {
      label: "Custom agents",
      count: breakdown.agents.length,
      items: breakdown.agents.map((agent) => ({
        key: agent.name,
        name: agent.name,
        tokens: agent.tokens,
      })),
    },
    {
      label: "Skills",
      count: breakdown.skills.length,
      items: breakdown.skills.map((skill) => ({
        key: skill.name,
        name: skill.name,
        tokens: skill.tokens,
      })),
    },
  ].filter((list) => list.count > 0);
  const updated = relativeTime(breakdown.at, Math.max(now, breakdown.at));
  return (
    <>
      <ul aria-label="What fills the context" {...stylex.props(styles.rows)}>
        {shown.map((category) => row(category, share(category.tokens)))}
      </ul>
      {deferred.length > 0 && (
        <ul
          aria-label="Loaded when the agent uses them"
          title="Loaded when the agent uses them"
          {...stylex.props(styles.rows)}
        >
          {deferred.map((category) => row(category, "—"))}
        </ul>
      )}
      {lists.length > 0 && (
        <div {...stylex.props(styles.lists)}>
          {lists.map((list) => (
            <details key={list.label} {...stylex.props(styles.list)}>
              <summary {...stylex.props(styles.listHead)}>
                <span {...chevronProps}>
                  <Icon name="chevron" size={10} />
                </span>
                <span {...stylex.props(styles.name)}>{list.label}</span>
                <span {...stylex.props(styles.number)}>{list.count}</span>
              </summary>
              <ul {...stylex.props(styles.items)}>
                {list.items.map((item) => (
                  <li key={item.key} {...stylex.props(styles.item)}>
                    <span
                      title={item.title ?? item.name}
                      {...stylex.props(styles.name, styles.itemName)}
                    >
                      {item.name}
                    </span>
                    {item.detail && <span {...stylex.props(styles.itemDetail)}>{item.detail}</span>}
                    <span {...stylex.props(styles.number)}>{compactTokens(item.tokens)}</span>
                  </li>
                ))}
              </ul>
            </details>
          ))}
        </div>
      )}
      <p {...stylex.props(styles.footer)}>
        Last updated {updated}.{" "}
        {working ? "Refreshes when this turn ends." : "Refreshes at the end of each turn."}
      </p>
    </>
  );
}

const styles = stylex.create({
  summary: { display: "flex", flexDirection: "column", gap: 8 },
  headline: {
    display: "flex",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: 12,
    margin: 0,
    fontVariantNumeric: "tabular-nums",
  },
  share: { color: tokens.text, fontSize: 14, fontWeight: 500 },
  count: { color: tokens.muted, fontSize: 12 },
  bar: {
    position: "relative",
    display: "flex",
    gap: 2,
    height: 6,
    overflow: "hidden",
    borderRadius: 3,
    backgroundColor: tokens.fill,
  },
  segment: { flexShrink: 0, height: "100%", borderRadius: 3 },
  segmentSize: (width: string, color: string) => ({ width, minWidth: 3, backgroundColor: color }),
  mark: {
    position: "absolute",
    insetBlock: 0,
    width: 2,
    marginLeft: -1,
    backgroundColor: tokens.text,
  },
  left: (left: string) => ({ left }),
  notes: { display: "flex", flexDirection: "column", gap: 4 },
  rows: { display: "flex", flexDirection: "column", gap: 2, margin: 0, padding: 0 },
  row: {
    display: "grid",
    gridTemplateColumns: "12px minmax(0, 1fr) auto 48px",
    alignItems: "center",
    columnGap: 10,
    minHeight: 24,
    listStyle: "none",
    fontSize: 12.5,
    color: tokens.text,
  },
  swatch: { width: 10, height: 10, borderRadius: 2 },
  swatchColor: (color: string) => ({ backgroundColor: color }),
  name: { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  explained: {
    textDecorationLine: "underline",
    textDecorationStyle: "dotted",
    textDecorationColor: tokens.faint,
    textUnderlineOffset: 3,
    cursor: "help",
  },
  number: {
    color: tokens.muted,
    fontVariantNumeric: "tabular-nums",
    textAlign: "right",
    whiteSpace: "nowrap",
  },
  percent: { color: tokens.faint },
  lists: { display: "flex", flexDirection: "column", gap: 2 },
  list: { minWidth: 0 },
  listHead: {
    display: "grid",
    gridTemplateColumns: "12px minmax(0, 1fr) auto",
    alignItems: "center",
    columnGap: 10,
    minHeight: 24,
    listStyle: "none",
    cursor: "pointer",
    fontSize: 12.5,
    color: tokens.text,
    borderRadius: `calc(4px * ${tokens.round})`,
    outline: { default: "none", ":focus-visible": `2px solid ${tokens.accentLine}` },
  },
  listChevron: {
    display: "inline-flex",
    justifyContent: "center",
    color: tokens.faint,
    transform: "rotate(-90deg)",
    transitionProperty: "transform",
    transitionDuration: "120ms",
  },
  items: {
    display: "flex",
    flexDirection: "column",
    margin: 0,
    paddingBlock: 2,
    paddingInlineStart: 22,
    paddingInlineEnd: 0,
  },
  item: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    minHeight: 22,
    listStyle: "none",
    fontSize: 12,
    color: tokens.muted,
  },
  itemName: { flexGrow: 1 },
  itemDetail: { color: tokens.faint, fontSize: 11.5, flexShrink: 0 },
  footer: { margin: 0, color: tokens.faint, fontSize: 11.5, lineHeight: 1.5 },
});

// details[open] turns it (SessionThread.css).
const chevronProps = (() => {
  const props = stylex.props(styles.listChevron);
  return { ...props, className: `${props.className ?? ""} med-context-chevron` };
})();
