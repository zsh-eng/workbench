import * as stylex from "@stylexjs/stylex";
import { Fragment } from "react";
import {
  describeShortcut,
  isModifier,
  isPlaceholder,
  keyLabel,
  parseShortcut,
  splitLegacyKeys,
} from "../data/keys";
import { tokens } from "../theme.stylex";

/**
 * Keycaps for a chord or a short list of keys. Accepts the key notation from
 * `data/keys.ts` ("Mod+Shift+K") and legacy glyph strings ("⌘ ⇧ K"). Modifiers
 * render for the current platform.
 */
export function ShortcutKeys({ value }: { value?: string }) {
  if (!value) return null;
  const keys = /\w\+\S/.test(value) ? parseShortcut(value).flat() : splitLegacyKeys(value);
  return (
    <span {...stylex.props(styles.keys)}>
      {keys.map((key, index) => (
        <kbd key={`${index}-${key}`} {...stylex.props(styles.kbd)}>
          {keyLabel(key)}
        </kbd>
      ))}
    </span>
  );
}

/**
 * A full shortcut in key notation. Chord keys sit together; sequence steps are
 * joined by a quiet chevron; placeholders such as {char} use a dashed cap.
 */
export function KeySequence({ value }: { value: string }) {
  const steps = parseShortcut(value);
  return (
    <span {...stylex.props(styles.keys)} title={describeShortcut(value)}>
      {steps.map((chord, step) => (
        <Fragment key={step}>
          {step > 0 && (
            <span aria-hidden="true" {...stylex.props(styles.then)}>
              ›
            </span>
          )}
          <span {...stylex.props(styles.chord)}>
            {chord.map((key, index) => (
              <kbd
                key={`${index}-${key}`}
                {...stylex.props(
                  styles.kbd,
                  isPlaceholder(key) && styles.placeholder,
                  chord.length > 1 && isModifier(key) && styles.modifier,
                )}
              >
                {keyLabel(key)}
              </kbd>
            ))}
          </span>
        </Fragment>
      ))}
    </span>
  );
}

const styles = stylex.create({
  keys: { display: "inline-flex", alignItems: "center", gap: 2, flexShrink: 0 },
  chord: { display: "inline-flex", alignItems: "center", gap: 2 },
  then: { color: tokens.faint, fontSize: 11, marginInline: 2, lineHeight: 1 },
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
    fontVariantNumeric: "tabular-nums",
  },
  modifier: { color: tokens.faint },
  placeholder: {
    borderStyle: "dashed",
    borderColor: tokens.lineStrong,
    backgroundColor: "transparent",
    boxShadow: "none",
    color: tokens.faint,
    fontStyle: "italic",
    fontWeight: 450,
    paddingInline: 5,
  },
});
