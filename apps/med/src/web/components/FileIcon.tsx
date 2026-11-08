import * as stylex from "@stylexjs/stylex";
import { fileIcon } from "../data/file-icons";

/** The file tree's own icon for a file, outside the tree, as a tab's. */
export function FileIcon({ path, size = 14 }: { path: string; size?: number }) {
  const { name, viewBox, color } = fileIcon(path);
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox={viewBox}
      {...stylex.props(styles.icon(color))}
    >
      <use href={`#${name}`} />
    </svg>
  );
}

const styles = stylex.create({
  icon: (color: string) => ({
    flex: "none",
    color,
    // Med's own icons draw in this, as the tree's do.
    "--trees-file-icon-color": color,
  }),
});
