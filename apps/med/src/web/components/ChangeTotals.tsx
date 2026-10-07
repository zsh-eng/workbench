import { Tooltip } from "@base-ui/react/tooltip";
import * as stylex from "@stylexjs/stylex";
import { changeKind, type ChangeKind } from "../data/file-filters";
import { tokens, ui } from "../theme.stylex";

const KINDS: { kind: ChangeKind; label: string }[] = [
  { kind: "code", label: "Code" },
  { kind: "tests", label: "Tests" },
  { kind: "docs", label: "Docs" },
  { kind: "other", label: "Config and data" },
  { kind: "lockfiles", label: "Lockfiles" },
];

/** The comparison's line totals. Hover or focus splits them by kind of file,
 * so a large change made mostly of lockfiles or tests reads as such. */
export function ChangeTotals({
  files,
  range,
}: {
  files: readonly { path: string; additions: number; deletions: number; binary?: boolean }[];
  /** Base and head, such as "a1b2c3d → working". */
  range: string;
}) {
  const totals = new Map<ChangeKind, { files: number; additions: number; deletions: number }>();
  let additions = 0;
  let deletions = 0;
  for (const file of files) {
    const kind = changeKind(file.path);
    const entry = totals.get(kind) ?? { files: 0, additions: 0, deletions: 0 };
    entry.files++;
    entry.additions += file.additions;
    entry.deletions += file.deletions;
    totals.set(kind, entry);
    additions += file.additions;
    deletions += file.deletions;
  }
  const rows = KINDS.flatMap(({ kind, label }) => {
    const entry = totals.get(kind);
    return entry ? [{ kind, label, ...entry }] : [];
  });
  const lines = additions + deletions;
  return (
    <Tooltip.Root>
      <Tooltip.Trigger
        render={
          <span
            role="group"
            tabIndex={0}
            aria-label={`Comparison total: ${additions} lines added, ${deletions} lines deleted`}
            data-change-totals=""
            {...stylex.props(styles.totals)}
          >
            <span {...stylex.props(ui.added)}>+{additions.toLocaleString()}</span>
            <span {...stylex.props(ui.removed)}>−{deletions.toLocaleString()}</span>
          </span>
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
                    {...stylex.props(styles.segment, styles[row.kind])}
                    style={{ flexGrow: row.additions + row.deletions }}
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
    borderRadius: 5,
    fontFamily: tokens.code,
    fontSize: 11,
    whiteSpace: "nowrap",
    flexShrink: 0,
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
    borderRadius: 9,
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
    borderRadius: 2,
    overflow: "hidden",
  },
  segment: { minWidth: 3, flexBasis: 0 },
  dot: { width: 6, height: 6, borderRadius: 2, flexShrink: 0 },
  code: { backgroundColor: tokens.accent },
  tests: { backgroundColor: tokens.warning },
  docs: { backgroundColor: tokens.muted },
  other: { backgroundColor: tokens.faint },
  lockfiles: { backgroundColor: tokens.lineStrong },
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
