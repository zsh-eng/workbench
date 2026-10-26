import { Tooltip } from "@base-ui/react/tooltip";
import * as stylex from "@stylexjs/stylex";
import type { ReviewFile } from "../../shared/protocol";
import { changeKind, type ChangeKind } from "../data/file-filters";
import { generatedMark } from "../data/generated";
import { tokens, ui } from "../theme.stylex";

type TotalKind = Exclude<ChangeKind, "lockfiles"> | "generated";
const KINDS: { kind: TotalKind; label: string }[] = [
  { kind: "code", label: "Code" },
  { kind: "tests", label: "Tests" },
  { kind: "docs", label: "Docs" },
  { kind: "other", label: "Config and data" },
  { kind: "generated", label: "Generated" },
];

/** The comparison's line totals, without the files that a tool writes
 * (docs/GENERATED.md). Hover or focus splits them by kind of file, with the
 * generated lines apart, so a large change made mostly of tests reads as such. */
export function ChangeTotals({
  files,
  range,
}: {
  files: readonly Pick<ReviewFile, "path" | "additions" | "deletions" | "generated">[];
  /** Base and head, such as "a1b2c3d → working". */
  range: string;
}) {
  const totals = new Map<TotalKind, { files: number; additions: number; deletions: number }>();
  let additions = 0;
  let deletions = 0;
  for (const file of files) {
    const generated = !!generatedMark(file);
    const kind = generated ? "generated" : (changeKind(file.path) as TotalKind);
    const entry = totals.get(kind) ?? { files: 0, additions: 0, deletions: 0 };
    entry.files++;
    entry.additions += file.additions;
    entry.deletions += file.deletions;
    totals.set(kind, entry);
    if (generated) continue;
    additions += file.additions;
    deletions += file.deletions;
  }
  const generated = totals.get("generated");
  const rows = KINDS.flatMap(({ kind, label }) => {
    const entry = totals.get(kind);
    return entry ? [{ kind, label, ...entry }] : [];
  });
  const lines = rows.reduce((sum, row) => sum + row.additions + row.deletions, 0);
  return (
    <Tooltip.Root>
      <Tooltip.Trigger
        render={
          <button
            type="button"
            aria-label={`Comparison total: ${additions} lines added, ${deletions} lines deleted${generated ? `, without ${generated.additions + generated.deletions} generated lines` : ""}`}
            data-change-totals=""
            {...stylex.props(styles.totals)}
          >
            <span {...stylex.props(ui.added)}>+{additions.toLocaleString()}</span>
            <span {...stylex.props(ui.removed)}>−{deletions.toLocaleString()}</span>
          </button>
        }
      />
      <Tooltip.Portal>
        <Tooltip.Positioner
          side="bottom"
          align="start"
          sideOffset={8}
          {...stylex.props(styles.positioner)}
        >
          <Tooltip.Popup {...stylex.props(styles.popup, ui.pop)}>
            <div {...stylex.props(styles.range)}>{range}</div>
            {rows.length > 1 && lines > 0 && (
              <div aria-hidden="true" {...stylex.props(styles.share)}>
                {rows.map((row) => (
                  <span
                    key={row.kind}
                    {...stylex.props(
                      styles.segment,
                      styles[row.kind],
                      styles.grow(row.additions + row.deletions),
                    )}
                  />
                ))}
              </div>
            )}
            <table {...stylex.props(styles.table)}>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.kind} data-kind={row.kind}>
                    <th scope="row" {...stylex.props(styles.label)}>
                      <span aria-hidden="true" {...stylex.props(styles.dot, styles[row.kind])} />
                      {row.label}
                    </th>
                    <td {...stylex.props(styles.count)}>
                      {row.files} {row.files === 1 ? "file" : "files"}
                    </td>
                    <td {...stylex.props(styles.number, row.additions ? ui.added : styles.zero)}>
                      +{row.additions.toLocaleString()}
                    </td>
                    <td {...stylex.props(styles.number, row.deletions ? ui.removed : styles.zero)}>
                      −{row.deletions.toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Tooltip.Popup>
        </Tooltip.Positioner>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

const styles = stylex.create({
  totals: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    marginInlineStart: 8,
    paddingInline: 4,
    marginInline: 4,
    borderRadius: `calc(5px * ${tokens.round})`,
    fontFamily: tokens.code,
    fontSize: 11,
    whiteSpace: "nowrap",
    flexShrink: 0,
    borderWidth: 0,
    color: "inherit",
    cursor: "default",
    outline: "none",
    backgroundColor: {
      default: "transparent",
      ":hover": tokens.fill,
      ":focus-visible": tokens.fill,
    },
  },
  positioner: { zIndex: 150 },
  popup: {
    boxSizing: "border-box",
    minWidth: 240,
    paddingBlock: 8,
    paddingInline: 10,
    borderRadius: `calc(9px * ${tokens.round})`,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: tokens.lineStrong,
    backgroundColor: tokens.raised,
    color: tokens.text,
    boxShadow: tokens.shadow,
    fontFamily: tokens.ui,
    fontSize: 12,
  },
  range: { marginBottom: 6, color: tokens.faint, fontFamily: tokens.code, fontSize: 11 },
  table: { width: "100%", borderCollapse: "collapse" },
  label: {
    display: "flex",
    alignItems: "center",
    gap: 7,
    paddingBlock: 3,
    paddingInlineEnd: 16,
    textAlign: "left",
    fontWeight: 450,
    whiteSpace: "nowrap",
  },
  // Each kind's share of the changed lines, in the dots' colors.
  share: {
    display: "flex",
    gap: 2,
    height: 4,
    marginBottom: 8,
    borderRadius: `calc(2px * ${tokens.round})`,
    overflow: "hidden",
  },
  segment: { minWidth: 3, flexBasis: 0 },
  grow: (share: number) => ({ flexGrow: share }),
  dot: { width: 6, height: 6, borderRadius: `calc(2px * ${tokens.round})`, flexShrink: 0 },
  code: { backgroundColor: tokens.accent },
  tests: { backgroundColor: tokens.warning },
  docs: { backgroundColor: tokens.muted },
  other: { backgroundColor: tokens.faint },
  generated: { backgroundColor: tokens.lineStrong },
  zero: { color: tokens.faint },
  count: { paddingInlineEnd: 14, color: tokens.faint, whiteSpace: "nowrap", textAlign: "right" },
  number: {
    paddingInlineStart: 8,
    fontFamily: tokens.code,
    fontSize: 11,
    textAlign: "right",
    fontVariantNumeric: "tabular-nums",
  },
});
