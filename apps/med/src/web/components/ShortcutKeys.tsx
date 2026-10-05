import * as stylex from "@stylexjs/stylex";
import { tokens } from "../theme.stylex";

export function ShortcutKeys({ value }: { value?: string }) {
  if (!value) return null;
  return (
    <span {...stylex.props(styles.keys)}>
      {value
        .trim()
        .split(/\s+|(?=[⌘⇧⌥])|(?<=[⌘⇧⌥])/)
        .filter(Boolean)
        .map((key, index) => (
          <kbd key={`${index}-${key}`} {...stylex.props(styles.kbd)}>
            {key}
          </kbd>
        ))}
    </span>
  );
}

const styles = stylex.create({
  keys: { display: "inline-flex", alignItems: "center", gap: 2, flexShrink: 0 },
  kbd: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    boxSizing: "border-box",
    fontFamily: tokens.ui,
    fontSize: 10.5,
    fontWeight: 500,
    minWidth: 18,
    height: 18,
    paddingInline: 4,
    lineHeight: 1,
    color: tokens.muted,
    backgroundColor: tokens.fill,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: tokens.line,
    borderRadius: 4,
    boxShadow: `0 1px 0 ${tokens.line}`,
  },
});
