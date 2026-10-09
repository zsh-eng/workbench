import type { ComponentProps, ReactElement } from "react";
import { Tooltip } from "@base-ui/react/tooltip";
import * as stylex from "@stylexjs/stylex";
import { tokens, ui } from "../theme.stylex";
import { Icon, type IconName } from "./Icon";
import { ShortcutKeys } from "./ShortcutKeys";

/** One shared delay group lets people scan a toolbar without waiting again. */
export function ActionTooltip({
  label,
  shortcut,
  children,
}: {
  label: string;
  shortcut?: string;
  children: ReactElement;
}) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger render={children} />
      <Tooltip.Portal>
        <Tooltip.Positioner side="bottom" sideOffset={6} {...stylex.props(styles.positioner)}>
          <Tooltip.Popup role="tooltip" {...stylex.props(styles.popup, ui.pop)}>
            <span>{label}</span>
            <ShortcutKeys value={shortcut} />
          </Tooltip.Popup>
        </Tooltip.Positioner>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

export function ToolButton({
  label,
  shortcut,
  icon,
  active,
  busy,
  ...props
}: Omit<ComponentProps<"button">, "children" | "title"> & {
  label: string;
  shortcut?: string;
  icon: IconName;
  active?: boolean;
  /** Turn the icon while this button's own request is running. */
  busy?: boolean;
}) {
  return (
    <ActionTooltip label={label} shortcut={shortcut}>
      <button
        type="button"
        {...stylex.props(ui.button, ui.iconButton, ui.pressable, active && ui.active)}
        {...props}
        data-med-tool-button=""
        aria-label={props["aria-label"] ?? label}
      >
        <span {...stylex.props(styles.icon, busy && styles.spinning)}>
          <Icon name={icon} size={15} />
        </span>
      </button>
    </ActionTooltip>
  );
}
const spin = stylex.keyframes({ to: { transform: "rotate(360deg)" } });

const styles = stylex.create({
  icon: { display: "inline-flex" },
  spinning: {
    animationName: { default: spin, "@media (prefers-reduced-motion: reduce)": "none" },
    animationDuration: "800ms",
    animationTimingFunction: "linear",
    animationIterationCount: "infinite",
  },
  positioner: { zIndex: 150 },
  popup: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    maxWidth: "min(320px, 90vw)",
    overflowWrap: "anywhere",
    whiteSpace: "pre-line",
    paddingBlock: 5,
    paddingInlineStart: 8,
    paddingInlineEnd: 6,
    minHeight: 28,
    boxSizing: "border-box",
    borderRadius: `calc(7px * ${tokens.round})`,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: tokens.lineStrong,
    backgroundColor: tokens.raised,
    color: tokens.text,
    boxShadow: tokens.shadow,
    fontFamily: tokens.ui,
    fontSize: 11.5,
    lineHeight: 1.4,
  },
});
