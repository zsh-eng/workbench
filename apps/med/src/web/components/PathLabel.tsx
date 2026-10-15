import * as stylex from "@stylexjs/stylex";
import { tokens } from "../theme.stylex";

/**
 * A file's path in a narrow place. The folder part gives way first, cut at
 * its end; then the name, which keeps its extension. Its parts carry
 * `data-clip`, so `clippedTooltip` on a row can tell when it is cut.
 */
export function PathLabel({
  path,
  folder = true,
  quiet = true,
}: {
  path: string;
  /** Shows the folders; else the file name only. */
  folder?: boolean;
  /** The folders in the faint text color. */
  quiet?: boolean;
}) {
  const slash = path.lastIndexOf("/") + 1;
  const name = path.slice(slash);
  const dot = name.lastIndexOf(".");
  // A short extension, as ".tsx"; ".test" in "x.test.tsx" may go.
  const extension = dot > 0 && name.length - dot <= 8 ? name.slice(dot) : "";
  return (
    <span {...stylex.props(styles.label)}>
      {folder && slash > 0 && (
        <span data-clip="" {...stylex.props(styles.part, styles.folder, quiet && styles.quiet)}>
          {path.slice(0, slash)}
        </span>
      )}
      <span data-clip="" {...stylex.props(styles.part, styles.name)}>
        {name.slice(0, name.length - extension.length)}
      </span>
      {extension && <span {...stylex.props(styles.extension)}>{extension}</span>}
    </span>
  );
}

const styles = stylex.create({
  label: { display: "flex", minWidth: 0, overflow: "hidden", whiteSpace: "nowrap" },
  part: { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  // Folders shrink long before the name does, to a letter and its "…", so
  // that a cut path still shows that it has folders.
  folder: { flexGrow: 0, flexShrink: 100000, flexBasis: "auto", minWidth: "2ch" },
  quiet: { color: tokens.faint },
  name: { flexGrow: 0, flexShrink: 1, flexBasis: "auto" },
  extension: { flex: "none" },
});
