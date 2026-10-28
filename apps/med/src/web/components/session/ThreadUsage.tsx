import * as stylex from "@stylexjs/stylex";
import { Popover } from "@base-ui/react/popover";
import { canonicalModel, type ThreadUsage } from "../../../shared/model-usage";
import { tokens, ui } from "../../theme.stylex";

// A thread's context and spend (docs/SESSIONS.md#spend-and-context): a chip
// in the session's header, whose popover has the details, and the same
// blocks for the side panel's cards.

/** The context to show: the host's reading, or what Med's runner reports
 * before the transcript has a request. */
export type ShownContext = Pick<NonNullable<ThreadUsage["context"]>, "used" | "window"> &
  Partial<NonNullable<ThreadUsage["context"]>>;

export const tokenCount = (value: number) =>
  value >= 1_000_000
    ? `${Number((value / 1_000_000).toFixed(value % 1_000_000 ? 2 : 0))}M`
    : value >= 1000
      ? `${Math.round(value / 1000)}k`
      : String(value);

export const dollars = (value: number) =>
  value > 0 && value < 0.01 ? "<$0.01" : `$${value.toFixed(2)}`;

/** "claude-opus-5-5" as "Opus 5.5"; another ID as it is. */
export function modelName(model: string) {
  const match = /^claude-([a-z]+)-(\d+)(?:-(\d))?$/.exec(canonicalModel(model));
  if (!match) return model;
  const [, family, major, minor] = match;
  return `${family![0]!.toUpperCase()}${family!.slice(1)} ${major}${minor ? `.${minor}` : ""}`;
}

/** Near enough to compaction, or to the window's end, to say so. */
const nearFull = (context: ShownContext) =>
  context.used >= 0.8 * (context.compaction?.at ?? context.window);

function Ring({ share, full }: { share: number; full: boolean }) {
  const radius = 5.25;
  const length = 2 * Math.PI * radius;
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 14 14"
      aria-hidden="true"
      {...stylex.props(full && styles.full)}
    >
      <circle cx={7} cy={7} r={radius} {...stylex.props(styles.track)} />
      <circle
        cx={7}
        cy={7}
        r={radius}
        strokeDasharray={`${Math.min(1, share) * length} ${length}`}
        transform="rotate(-90 7 7)"
        {...stylex.props(styles.value)}
      />
    </svg>
  );
}

/** The share of the window in use, and where compaction starts. */
export function ContextBlock({ context }: { context: ShownContext }) {
  const share = context.window ? context.used / context.window : 0;
  const at = context.compaction?.at;
  return (
    <div {...stylex.props(styles.block)}>
      <div
        role="meter"
        aria-label="Context in use"
        aria-valuemin={0}
        aria-valuemax={context.window}
        aria-valuenow={context.used}
        aria-valuetext={`${Math.round(share * 100)}%`}
        {...stylex.props(styles.bar)}
      >
        <span
          {...stylex.props(
            styles.fill,
            styles.width(`${Math.min(100, share * 100)}%`),
            nearFull(context) && styles.fillFull,
          )}
        />
        {at !== undefined && at < context.window && (
          <span
            {...stylex.props(styles.mark, styles.left(`${(at / context.window) * 100}%`))}
            title={`Compacts at ${tokenCount(at)}`}
          />
        )}
      </div>
      <p {...stylex.props(styles.line)}>
        <span>
          {context.used.toLocaleString()} of {tokenCount(context.window)} tokens
        </span>
        <span {...stylex.props(styles.note)}>
          {context.windowFrom === "assumed"
            ? "window assumed"
            : context.windowFrom === "agent"
              ? "window from the agent"
              : context.model
                ? `${modelName(context.model)}'s window`
                : ""}
        </span>
      </p>
      {context.compaction && (
        <p {...stylex.props(styles.line)}>
          <span>
            {at === undefined
              ? "Autocompact is off"
              : `Autocompact at ${context.compaction.approximate ? "about " : ""}${tokenCount(at)}`}
          </span>
          <span {...stylex.props(styles.note)} title={context.compaction.from}>
            {context.compaction.from}
          </span>
        </p>
      )}
      {context.compacted && (
        <p {...stylex.props(styles.line, styles.note)}>
          Compacted since; the next request tells the new size.
        </p>
      )}
    </div>
  );
}

/** The thread's total, its subagents' share, and each model's tokens. */
export function SpendBlock({ usage, table = true }: { usage: ThreadUsage; table?: boolean }) {
  const { spend } = usage;
  const unpriced = spend.models.filter((model) => model.cost === null);
  return (
    <div {...stylex.props(styles.block)}>
      <p {...stylex.props(styles.line)}>
        <span {...stylex.props(styles.total)}>{dollars(spend.total)}</span>
        {spend.subagents.count > 0 && (
          <span {...stylex.props(styles.note)}>
            {dollars(spend.subagents.cost)} by {spend.subagents.count}{" "}
            {spend.subagents.count === 1 ? "subagent" : "subagents"}
          </span>
        )}
      </p>
      {table ? (
        <table {...stylex.props(styles.table)}>
          <thead>
            <tr>
              <th {...stylex.props(styles.th, styles.start)}>Model</th>
              <th {...stylex.props(styles.th)}>Input</th>
              <th {...stylex.props(styles.th)}>Output</th>
              <th {...stylex.props(styles.th)} title="Cache writes, 5-minute and 1-hour">
                Cache write
              </th>
              <th {...stylex.props(styles.th)}>Cache read</th>
              <th {...stylex.props(styles.th)}>Cost</th>
            </tr>
          </thead>
          <tbody>
            {spend.models.map((model) => (
              <tr key={model.model}>
                <td
                  {...stylex.props(styles.td, styles.start)}
                  title={`${model.model}: ${model.requests} ${model.requests === 1 ? "request" : "requests"}${model.webSearches ? `, ${model.webSearches} web searches` : ""}`}
                >
                  {modelName(model.model)}
                </td>
                <td {...stylex.props(styles.td)}>{tokenCount(model.input)}</td>
                <td {...stylex.props(styles.td)}>{tokenCount(model.output)}</td>
                <td {...stylex.props(styles.td)}>
                  {tokenCount(model.cacheWrite5m + model.cacheWrite1h)}
                </td>
                <td {...stylex.props(styles.td)}>{tokenCount(model.cacheRead)}</td>
                <td {...stylex.props(styles.td)}>
                  {model.cost === null ? "No price" : dollars(model.cost)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        spend.models.map((model) => (
          <p key={model.model} {...stylex.props(styles.line)}>
            <span>{modelName(model.model)}</span>
            <span {...stylex.props(styles.note)}>
              {model.cost === null
                ? `${tokenCount(model.input + model.cacheRead + model.output)} tokens`
                : dollars(model.cost)}
            </span>
          </p>
        ))
      )}
      {unpriced.length > 0 && (
        <p {...stylex.props(styles.line, styles.note)}>
          Med has no price for {unpriced.map((model) => modelName(model.model)).join(", ")}, so the
          total leaves {unpriced.length === 1 ? "it" : "them"} out.
        </p>
      )}
      {spend.missing.length > 0 && (
        <p {...stylex.props(styles.line, styles.note)}>
          Not available for {[...new Set(spend.missing)].join(", ")}: no token counts in the
          transcript.
        </p>
      )}
      <p {...stylex.props(styles.line, styles.note)}>
        An estimate at list price from the transcripts; Claude Code also makes small requests that
        they leave out. Prices read {usage.prices.readAt} from{" "}
        <a
          href={usage.prices.source}
          target="_blank"
          rel="noreferrer"
          {...stylex.props(styles.link)}
        >
          Anthropic's pricing page
        </a>
        .
      </p>
    </div>
  );
}

/** The chip in the session's header: context and spend at a glance, the
 * details one click away. */
export function UsageChip({
  usage,
  context,
}: {
  usage: ThreadUsage | null;
  context: ShownContext | undefined;
}) {
  if (!usage && !context) return null;
  const share = context?.window ? context.used / context.window : 0;
  const percent = Math.round(share * 100);
  return (
    <Popover.Root>
      <Popover.Trigger
        aria-label="Context and spend"
        {...stylex.props(ui.button, ui.pressable, styles.chip)}
      >
        {context && (
          <span
            role="img"
            aria-label={`Context ${percent}% full`}
            {...stylex.props(styles.part, nearFull(context) && styles.full)}
          >
            <Ring share={share} full={nearFull(context)} />
            {percent}%
          </span>
        )}
        {usage && (
          <span {...stylex.props(styles.part, context && styles.divided)}>
            {dollars(usage.spend.total)}
          </span>
        )}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner align="end" sideOffset={6} {...stylex.props(styles.positioner)}>
          <Popover.Popup {...stylex.props(ui.popup, styles.popup)}>
            {context && (
              <section aria-label="Context" {...stylex.props(styles.section)}>
                <h3 {...stylex.props(ui.label, styles.heading)}>
                  Context<span {...stylex.props(styles.figure)}>{percent}%</span>
                </h3>
                <ContextBlock context={context} />
              </section>
            )}
            {usage && (
              <section aria-label="Spend" {...stylex.props(styles.section)}>
                <h3 {...stylex.props(ui.label, styles.heading)}>Spend in this thread</h3>
                <SpendBlock usage={usage} />
              </section>
            )}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

const styles = stylex.create({
  chip: {
    flexShrink: 0,
    gap: 0,
    height: 24,
    paddingInline: 7,
    color: tokens.faint,
    fontSize: 11.5,
    fontVariantNumeric: "tabular-nums",
  },
  part: { display: "inline-flex", alignItems: "center", gap: 4 },
  divided: {
    marginInlineStart: 7,
    paddingInlineStart: 7,
    borderInlineStartWidth: 1,
    borderInlineStartStyle: "solid",
    borderInlineStartColor: tokens.line,
  },
  full: { color: tokens.accent },
  track: { fill: "none", stroke: tokens.line, strokeWidth: 1.75 },
  value: { fill: "none", stroke: "currentColor", strokeWidth: 1.75, strokeLinecap: "round" },
  positioner: { zIndex: 100, outline: "none" },
  popup: {
    width: 420,
    maxWidth: "calc(100vw - 24px)",
    maxHeight: "min(560px, 80vh)",
    padding: 0,
  },
  section: {
    paddingInline: 14,
    paddingBlock: 12,
    borderTopWidth: { default: 1, ":first-child": 0 },
    borderTopStyle: "solid",
    borderTopColor: tokens.line,
  },
  heading: {
    display: "flex",
    justifyContent: "space-between",
    margin: 0,
    marginBottom: 8,
  },
  figure: { color: tokens.text, fontVariantNumeric: "tabular-nums" },
  block: { display: "flex", flexDirection: "column", gap: 6, minWidth: 0 },
  bar: {
    position: "relative",
    height: 6,
    borderRadius: 3,
    backgroundColor: tokens.fillStrong,
    marginBottom: 2,
  },
  fill: {
    position: "absolute",
    insetBlock: 0,
    left: 0,
    borderRadius: 3,
    backgroundColor: tokens.muted,
  },
  fillFull: { backgroundColor: tokens.accent },
  width: (width: string) => ({ width }),
  left: (left: string) => ({ left }),
  mark: {
    position: "absolute",
    top: -3,
    bottom: -3,
    width: 2,
    marginLeft: -1,
    borderRadius: 1,
    backgroundColor: tokens.text,
  },
  line: {
    display: "flex",
    flexWrap: "wrap",
    justifyContent: "space-between",
    columnGap: 12,
    rowGap: 2,
    margin: 0,
    color: tokens.text,
    fontSize: 12,
    lineHeight: 1.5,
    fontVariantNumeric: "tabular-nums",
  },
  note: { color: tokens.faint, fontSize: 11.5, minWidth: 0, overflowWrap: "anywhere" },
  total: { fontSize: 15, fontWeight: 500 },
  table: {
    width: "100%",
    borderCollapse: "collapse",
    fontSize: 11.5,
    fontVariantNumeric: "tabular-nums",
  },
  th: {
    paddingBlock: 4,
    paddingInlineStart: 8,
    color: tokens.faint,
    fontWeight: 400,
    textAlign: "right",
    whiteSpace: "nowrap",
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: tokens.line,
  },
  td: { paddingBlock: 4, paddingInlineStart: 8, textAlign: "right", whiteSpace: "nowrap" },
  start: { paddingInlineStart: 0, textAlign: "left" },
  link: { color: tokens.muted, textDecorationColor: tokens.lineStrong },
});
