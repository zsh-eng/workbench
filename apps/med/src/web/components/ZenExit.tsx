import * as stylex from "@stylexjs/stylex";
import { useState } from "react";
import { tokens } from "../theme.stylex";
import { Icon } from "./Icon";
import { ShortcutKeys } from "./ShortcutKeys";

const HINT_LIMIT = 3;

/**
 * Zen mode has no bars. The way out waits in the review's top-right corner and
 * appears when the pointer reaches it or it takes focus. It sits inside the
 * review, so panels shown in zen mode keep their own controls.
 */
export function ZenExit({ onExit }: { onExit(): void }) {
  return (
    <div {...stylex.props(styles.corner)}>
      <button
        type="button"
        aria-label="Exit zen mode"
        aria-keyshortcuts="Alt+Z"
        data-zen-exit
        onClick={onExit}
        {...stylex.props(styles.exit)}
      >
        <Icon name="focusExit" size={14} />
        <span>Leave zen</span>
        <ShortcutKeys value="⌥ Z" />
      </button>
    </div>
  );
}

/**
 * The first few times zen mode starts, a brief hint names the keys for leaving
 * and for the panels that still work. Long loads show a hairline at the top.
 */
export function ZenHint({ loading, session }: { loading?: boolean; session?: boolean }) {
  const [hint] = useState(() => {
    try {
      const shown = Number(localStorage.getItem("med:zen-hints") ?? 0);
      if (shown >= HINT_LIMIT) return false;
      localStorage.setItem("med:zen-hints", String(shown + 1));
    } catch {
      /* Without storage, show the hint each time. */
    }
    return true;
  });
  return (
    <>
      {hint && (
        <div aria-hidden="true" {...stylex.props(styles.hint)}>
          <span {...stylex.props(styles.hintItem)}>
            <ShortcutKeys value="⌥ Z" /> Leave
          </span>
          <span {...stylex.props(styles.hintItem)}>
            <ShortcutKeys value="⌘ B" /> Sidebar
          </span>
          {session && (
            <span {...stylex.props(styles.hintItem)}>
              <ShortcutKeys value="⌘ ⇧ B" /> Session
            </span>
          )}
        </div>
      )}
      {loading && (
        <span role="presentation" {...stylex.props(styles.loadingTrack)}>
          <span {...stylex.props(styles.loadingBar)} />
        </span>
      )}
    </>
  );
}

const appear = stylex.keyframes({ from: { opacity: 0 }, to: { opacity: 1 } });
// One gesture: rise in, rest long enough to read, then fade where it stands.
const hint = stylex.keyframes({
  "0%": { opacity: 0, transform: "translate(-50%, 8px) scale(0.98)" },
  "9%": { opacity: 1, transform: "translate(-50%, 0) scale(1)" },
  "82%": { opacity: 1, transform: "translate(-50%, 0) scale(1)" },
  "100%": { opacity: 0, transform: "translate(-50%, 0) scale(1)" },
});
const hintStill = stylex.keyframes({
  "0%": { opacity: 0 },
  "9%": { opacity: 1 },
  "82%": { opacity: 1 },
  "100%": { opacity: 0 },
});
const sweep = stylex.keyframes({
  from: { transform: "translateX(-100%)" },
  to: { transform: "translateX(320%)" },
});
const reduced = "@media (prefers-reduced-motion: reduce)";

const styles = stylex.create({
  // Only the button takes the pointer; the corner itself lets clicks through.
  corner: {
    position: "absolute",
    top: 6,
    right: 8,
    zIndex: 40,
    pointerEvents: "none",
  },
  exit: {
    display: "flex",
    alignItems: "center",
    gap: 7,
    height: 28,
    paddingInlineStart: 9,
    paddingInlineEnd: 5,
    borderWidth: 0,
    borderRadius: `calc(8px * ${tokens.round})`,
    backgroundColor: tokens.raised,
    boxShadow: `0 0 0 1px ${tokens.lineStrong}, 0 8px 24px -12px rgb(0 0 0 / 0.45)`,
    color: tokens.muted,
    fontFamily: tokens.ui,
    fontSize: 12,
    cursor: "pointer",
    pointerEvents: "auto",
    opacity: { default: 0, ":hover": 1, ":focus-visible": 1 },
    transform: {
      default: "translateY(-3px)",
      ":hover": "none",
      ":focus-visible": "none",
      [reduced]: "none",
    },
    transitionProperty: "opacity, transform",
    transitionDuration: "160ms",
    transitionTimingFunction: tokens.easeOut,
    outline: { default: "none", ":focus-visible": `2px solid ${tokens.accentLine}` },
    outlineOffset: 2,
  },
  hint: {
    position: "fixed",
    left: "50%",
    bottom: 22,
    zIndex: 40,
    display: "flex",
    alignItems: "center",
    gap: 14,
    height: 32,
    paddingInline: 12,
    borderRadius: `calc(10px * ${tokens.round})`,
    backgroundColor: tokens.raised,
    boxShadow: `0 0 0 1px ${tokens.lineStrong}, 0 12px 32px -14px rgb(0 0 0 / 0.5)`,
    color: tokens.muted,
    fontSize: 12,
    whiteSpace: "nowrap",
    pointerEvents: "none",
    opacity: 0,
    transform: "translateX(-50%)",
    animationName: { default: hint, [reduced]: hintStill },
    animationDuration: "2600ms",
    animationTimingFunction: tokens.easeOut,
    animationFillMode: "forwards",
  },
  hintItem: { display: "flex", alignItems: "center", gap: 6 },
  loadingTrack: {
    position: "fixed",
    insetInline: 0,
    top: 0,
    zIndex: 40,
    height: 2,
    overflow: "hidden",
    pointerEvents: "none",
    opacity: 0,
    animationName: appear,
    animationDuration: "200ms",
    animationDelay: "300ms",
    animationFillMode: "forwards",
  },
  loadingBar: {
    display: "block",
    width: "30%",
    height: "100%",
    backgroundImage: `linear-gradient(90deg, transparent, ${tokens.accent}, transparent)`,
    animationName: { default: sweep, [reduced]: "none" },
    animationDuration: "1100ms",
    animationTimingFunction: tokens.easeInOut,
    animationIterationCount: "infinite",
  },
});
