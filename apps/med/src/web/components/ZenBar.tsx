import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";
import { tokens, ui } from "../theme.stylex";
import { ShortcutKeys } from "./ShortcutKeys";
import { ToolButton } from "./ToolButton";

const appear = stylex.keyframes({ from: { opacity: 0 }, to: { opacity: 1 } });

/**
 * The only chrome in zen mode. It keeps the reader oriented (repository,
 * branch, what is being reviewed, open files) and keeps the palette and the
 * way out within reach. Everything else waits behind the command palette.
 */
export function ZenBar({
  repository,
  branch,
  context,
  tabs,
  unsaved,
  loading,
  onCommands,
  onExit,
}: {
  repository?: string;
  branch?: string;
  context?: string;
  tabs?: ReactNode;
  unsaved: number;
  loading?: boolean;
  onCommands(): void;
  onExit(): void;
}) {
  return (
    <header aria-label="Zen mode" data-zen-bar {...stylex.props(styles.bar)}>
      <div {...stylex.props(styles.identity)}>
        {repository && <span {...stylex.props(styles.repository)}>{repository}</span>}
        {repository && branch && <span {...stylex.props(styles.slash)}>/</span>}
        {branch && <span {...stylex.props(styles.branch)}>{branch}</span>}
        {context && <span {...stylex.props(styles.context)}>{context}</span>}
      </div>
      <div {...stylex.props(styles.center)}>{tabs}</div>
      <div {...stylex.props(styles.actions)}>
        {unsaved > 0 && (
          <span role="status" {...stylex.props(styles.unsaved)}>
            <span {...stylex.props(styles.dot)} />
            {unsaved} unsaved
          </span>
        )}
        <ToolButton label="Command palette" shortcut="⌘ K" icon="search" onClick={onCommands} />
        <button
          type="button"
          aria-label="Exit zen mode"
          {...stylex.props(ui.button, ui.pressable, styles.exit)}
          onClick={onExit}
        >
          Exit zen
          <ShortcutKeys value="⌥ Z" />
        </button>
      </div>
      {loading && (
        <span role="presentation" {...stylex.props(styles.loadingTrack)}>
          <span {...stylex.props(styles.loadingBar)} />
        </span>
      )}
    </header>
  );
}

const sweep = stylex.keyframes({
  from: { transform: "translateX(-100%)" },
  to: { transform: "translateX(320%)" },
});
const reduced = "@media (prefers-reduced-motion: reduce)";

const styles = stylex.create({
  bar: {
    position: "relative",
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) auto minmax(0, 1fr)",
    alignItems: "center",
    gap: 12,
    flexShrink: 0,
    height: 38,
    minHeight: 38,
    paddingInline: 12,
    backgroundColor: tokens.panel,
    color: tokens.faint,
    fontSize: 12,
    // A quiet fade marks the change of mode; layout itself switches at once.
    animationName: { default: appear, [reduced]: "none" },
    animationDuration: "180ms",
    animationTimingFunction: tokens.easeOut,
  },
  identity: {
    display: "flex",
    alignItems: "baseline",
    gap: 5,
    minWidth: 0,
    overflow: "hidden",
    whiteSpace: "nowrap",
  },
  repository: { color: tokens.faint, overflow: "hidden", textOverflow: "ellipsis" },
  slash: { color: tokens.faint, opacity: 0.6 },
  branch: { color: tokens.muted, overflow: "hidden", textOverflow: "ellipsis" },
  context: {
    marginInlineStart: 8,
    color: tokens.faint,
    fontFamily: tokens.code,
    fontSize: 11,
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  center: { display: "flex", justifyContent: "center", minWidth: 0, maxWidth: "52vw" },
  actions: { display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 4 },
  unsaved: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    marginInlineEnd: 6,
    color: tokens.warning,
    fontSize: 11.5,
    whiteSpace: "nowrap",
  },
  dot: { width: 6, height: 6, borderRadius: "50%", backgroundColor: tokens.warning },
  exit: { gap: 8, paddingInlineStart: 9, paddingInlineEnd: 5, color: tokens.muted },
  loadingTrack: {
    position: "absolute",
    insetInline: 0,
    bottom: 0,
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
