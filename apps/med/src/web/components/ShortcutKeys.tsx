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
  keys: { display: "inline-flex", alignItems: "center", gap: 3, flexShrink: 0 },
  kbd: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    boxSizing: "border-box",
    fontFamily: tokens.ui,
    fontSize: 10,
    fontWeight: 450,
    minWidth: 19,
    height: 20,
    paddingInline: 4,
    lineHeight: 1,
    color: tokens.muted,
    backgroundColor: `color-mix(in srgb, ${tokens.text} 5%, transparent)`,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: `color-mix(in srgb, ${tokens.text} 9%, transparent)`,
    borderRadius: 5,
    boxShadow: `0 1px 0 color-mix(in srgb, ${tokens.text} 8%, transparent)`,
  },
});
