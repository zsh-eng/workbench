import * as stylex from "@stylexjs/stylex";
import { GENERATED_LABELS, type GeneratedKind } from "../../shared/generated";
import { tokens, ui } from "../theme.stylex";
import { DiffStat } from "./DiffStat";
import { Icon } from "./Icon";

/** One generated file of the group (docs/GENERATED.md). */
export interface GeneratedRow {
  id: string;
  path: string;
  kind: GeneratedKind;
  additions: number;
  deletions: number;
  /** What changed, in a few words: "37 packages updated". */
  summary?: string;
  /** The command that wrote it, from the thread's agent sessions. */
  command?: string;
  /** The file in the comparison whose change made it. */
  source?: { id: string; path: string };
  /** Something to check: a hand edit, or a lockfile without its manifest. */
  warning?: string;
  viewed: boolean;
}

/** Rows that the folded group lists; the rest are counted. */
const LISTED = 12;

/**
 * The generated files at the end of the stream, folded to one row with a
 * line for each file. Opened, the files join the stream above it, each folded
 * to its header. Their lines are not in the headline totals.
 */
export function GeneratedGroup({
  rows,
  open,
  onToggle,
  onReveal,
  onViewed,
}: {
  rows: readonly GeneratedRow[];
  open: boolean;
  onToggle(): void;
  onReveal(id: string): void;
  /** Marks every generated file; absent where viewed marks do not apply. */
  onViewed?(ids: string[], viewed: boolean): void;
}) {
  const additions = rows.reduce((sum, row) => sum + row.additions, 0);
  const deletions = rows.reduce((sum, row) => sum + row.deletions, 0);
  const allViewed = rows.every((row) => row.viewed);
  const warnings = rows.filter((row) => row.warning).length;
  return (
    <section aria-label="Generated files" data-generated-group={open ? "open" : "folded"}>
      <div {...stylex.props(styles.header)}>
        <button
          type="button"
          {...stylex.props(styles.toggle)}
          aria-expanded={open}
          aria-label={`${open ? "Fold" : "Show"} ${rows.length} generated ${rows.length === 1 ? "file" : "files"}`}
          onClick={onToggle}
        />
        <span {...stylex.props(styles.chevron, !open && styles.folded)}>
          <Icon name="chevron" size={14} />
        </span>
        <span {...stylex.props(styles.title)}>Generated</span>
        <span {...stylex.props(styles.count)}>
          {rows.length} {rows.length === 1 ? "file" : "files"}
        </span>
        {warnings > 0 && (
          <span {...stylex.props(styles.warningCount)}>
            <Icon name="alert" size={12} />
            {warnings} to check
          </span>
        )}
        <span {...stylex.props(ui.grow)} />
        <span {...stylex.props(styles.stats)}>
          <span {...stylex.props(ui.added)}>+{additions.toLocaleString()}</span>
          <span {...stylex.props(ui.removed)}>−{deletions.toLocaleString()}</span>
          <DiffStat additions={additions} deletions={deletions} />
        </span>
        {onViewed && (
          <button
            type="button"
            role="checkbox"
            aria-checked={allViewed}
            aria-label="Viewed all generated files"
            title={allViewed ? "All generated files viewed" : "Mark every generated file viewed"}
            onClick={() =>
              onViewed(
                rows.map((row) => row.id),
                !allViewed,
              )
            }
            {...stylex.props(styles.viewed)}
          >
            <span {...stylex.props(styles.box, allViewed && styles.boxOn)}>
              {allViewed && <Icon name="check" size={10} />}
            </span>
            Viewed
          </button>
        )}
      </div>
      {!open && (
        <ul {...stylex.props(styles.list)}>
          {rows.slice(0, LISTED).map((row) => {
            const slash = row.path.lastIndexOf("/") + 1;
            return (
              <li key={row.id} data-generated-file={row.path} {...stylex.props(styles.row)}>
                <button
                  type="button"
                  role="link"
                  aria-label={row.path}
                  title={`Show ${row.path}`}
                  onClick={() => onReveal(row.id)}
                  {...stylex.props(styles.path)}
                >
                  <span {...stylex.props(styles.directory)}>{row.path.slice(0, slash)}</span>
                  <span {...stylex.props(styles.name, row.viewed && styles.viewedName)}>
                    {row.path.slice(slash)}
                  </span>
                </button>
                <span {...stylex.props(styles.details)}>
                  <span {...stylex.props(styles.kind)}>{GENERATED_LABELS[row.kind]}</span>
                  {row.summary && <span>{row.summary}</span>}
                  {row.command && (
                    <span {...stylex.props(styles.command)} title={row.command}>
                      written by <code {...stylex.props(styles.code)}>{row.command}</code>
                    </span>
                  )}
                  {row.source && (
                    <button
                      type="button"
                      role="link"
                      onClick={() => onReveal(row.source!.id)}
                      title={`Show ${row.source.path}`}
                      {...stylex.props(styles.source)}
                    >
                      from {row.source.path.slice(row.source.path.lastIndexOf("/") + 1)}
                    </button>
                  )}
                  {row.warning && (
                    <span {...stylex.props(styles.warning)}>
                      <Icon name="alert" size={12} />
                      {row.warning}
                    </span>
                  )}
                </span>
                <span {...stylex.props(styles.rowStats)}>
                  <span {...stylex.props(ui.added)}>+{row.additions.toLocaleString()}</span>
                  <span {...stylex.props(ui.removed)}>−{row.deletions.toLocaleString()}</span>
                </span>
              </li>
            );
          })}
          {rows.length > LISTED && (
            <li {...stylex.props(styles.more)}>
              and {(rows.length - LISTED).toLocaleString()} more
            </li>
          )}
        </ul>
      )}
    </section>
  );
}

const headerBackground = `color-mix(in srgb, ${tokens.canvas} 96%, ${tokens.text})`;

const styles = stylex.create({
  header: {
    position: "relative",
    display: "flex",
    alignItems: "center",
    gap: 8,
    minHeight: 36,
    marginTop: 12,
    paddingInlineStart: 8,
    paddingInlineEnd: 14,
    backgroundColor: headerBackground,
    boxShadow: `inset 0 -1px 0 ${tokens.line}, inset 0 1px 0 ${tokens.line}`,
    color: tokens.text,
    fontFamily: tokens.ui,
    fontSize: 12.5,
  },
  toggle: {
    position: "absolute",
    inset: 0,
    borderWidth: 0,
    backgroundColor: { default: "transparent", ":hover": tokens.fill },
    cursor: "pointer",
    outline: { default: "none", ":focus-visible": `2px solid ${tokens.accentLine}` },
    outlineOffset: -2,
  },
  chevron: {
    position: "relative",
    pointerEvents: "none",
    display: "inline-flex",
    color: tokens.faint,
    transitionProperty: "transform",
    transitionDuration: "150ms",
  },
  folded: { transform: "rotate(-90deg)" },
  title: { position: "relative", pointerEvents: "none", fontWeight: 550 },
  count: { position: "relative", pointerEvents: "none", color: tokens.faint, fontSize: 11.5 },
  warningCount: {
    position: "relative",
    pointerEvents: "none",
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    color: tokens.warning,
    fontSize: 11.5,
  },
  stats: {
    position: "relative",
    pointerEvents: "none",
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    fontFamily: tokens.code,
    fontSize: 11,
  },
  viewed: {
    position: "relative",
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    height: 24,
    marginInlineStart: 4,
    paddingInline: 7,
    borderWidth: 0,
    borderRadius: `calc(6px * ${tokens.round})`,
    backgroundColor: { default: "transparent", ":hover": tokens.fill },
    color: { default: tokens.faint, ":hover": tokens.text },
    fontFamily: tokens.ui,
    fontSize: 11.5,
    cursor: "pointer",
    outline: { default: "none", ":focus-visible": `2px solid ${tokens.accentLine}` },
  },
  box: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 13,
    height: 13,
    boxSizing: "border-box",
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: tokens.lineStrong,
    borderRadius: `calc(4px * ${tokens.round})`,
    color: tokens.canvas,
  },
  boxOn: { borderColor: tokens.green, backgroundColor: tokens.green },
  list: {
    margin: 0,
    paddingBlock: 4,
    paddingInline: 0,
    listStyle: "none",
    backgroundColor: tokens.canvas,
    fontFamily: tokens.ui,
    fontSize: 12,
  },
  row: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "baseline",
    columnGap: 12,
    rowGap: 2,
    paddingBlock: 5,
    paddingInlineStart: 30,
    paddingInlineEnd: 14,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: tokens.line,
  },
  path: {
    display: "inline-flex",
    minWidth: 0,
    maxWidth: "100%",
    padding: 0,
    borderWidth: 0,
    backgroundColor: "transparent",
    color: tokens.text,
    fontFamily: tokens.ui,
    fontSize: 12,
    cursor: "pointer",
    whiteSpace: "nowrap",
    textDecoration: { default: "none", ":hover": "underline" },
    textDecorationColor: tokens.lineStrong,
    textUnderlineOffset: 3,
  },
  directory: { color: tokens.muted, overflow: "hidden", textOverflow: "ellipsis" },
  name: { fontWeight: 550, flexShrink: 0 },
  viewedName: { color: tokens.muted, fontWeight: 450 },
  details: {
    display: "inline-flex",
    flexWrap: "wrap",
    alignItems: "baseline",
    columnGap: 10,
    rowGap: 2,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: "auto",
    minWidth: 0,
    color: tokens.muted,
  },
  kind: { color: tokens.faint },
  command: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 360 },
  code: { fontFamily: tokens.code, fontSize: 11, color: tokens.text },
  source: {
    padding: 0,
    borderWidth: 0,
    backgroundColor: "transparent",
    color: tokens.accent,
    fontFamily: tokens.ui,
    fontSize: 12,
    cursor: "pointer",
    textDecoration: { default: "none", ":hover": "underline" },
    textUnderlineOffset: 3,
  },
  warning: { display: "inline-flex", alignItems: "center", gap: 4, color: tokens.warning },
  rowStats: {
    display: "inline-flex",
    gap: 6,
    marginInlineStart: "auto",
    fontFamily: tokens.code,
    fontSize: 11,
  },
  more: { paddingBlock: 6, paddingInlineStart: 30, color: tokens.faint },
});
