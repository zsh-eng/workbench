import * as stylex from "@stylexjs/stylex";
import { GENERATED_LABELS, type GeneratedKind } from "../../shared/generated";
import { tokens } from "../theme.stylex";
import { PathLabel } from "./PathLabel";
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
}: {
  rows: readonly GeneratedRow[];
  open: boolean;
  onToggle(): void;
  onReveal(id: string): void;
}) {
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
      </div>
      {!open && (
        <ul {...stylex.props(styles.list)}>
          {rows.slice(0, LISTED).map((row) => {
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
                  <PathLabel path={row.path} strong />
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
  more: { paddingBlock: 6, paddingInlineStart: 30, color: tokens.faint },
});
