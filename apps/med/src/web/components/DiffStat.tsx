import * as stylex from "@stylexjs/stylex";
import { tokens } from "../theme.stylex";

/**
 * Five blocks in the proportion of added to deleted lines, as on GitHub.
 * Small changes colour only as many blocks as they have lines.
 */
export function DiffStat({ additions, deletions }: { additions: number; deletions: number }) {
  const total = additions + deletions;
  const colored = Math.min(5, total);
  let green = total ? Math.round((colored * additions) / total) : 0;
  if (additions && !green) green = 1;
  if (deletions && colored - green < 1 && colored > 1) green = colored - 1;
  const red = colored - green;
  return (
    <span aria-hidden="true" {...stylex.props(styles.blocks)}>
      {[0, 1, 2, 3, 4].map((index) => (
        <span
          key={index}
          {...stylex.props(
            styles.block,
            index < green ? styles.added : index < green + red ? styles.deleted : null,
          )}
        />
      ))}
    </span>
  );
}

const styles = stylex.create({
  blocks: { display: "inline-flex", gap: 2, flexShrink: 0 },
  block: {
    width: 7,
    height: 7,
    borderRadius: `calc(2px * ${tokens.round})`,
    backgroundColor: tokens.fillStrong,
  },
  added: { backgroundColor: tokens.green },
  deleted: { backgroundColor: tokens.red },
});
