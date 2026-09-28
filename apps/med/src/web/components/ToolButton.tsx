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
        <Tooltip.Positioner side="bottom" sideOffset={7} {...stylex.props(styles.positioner)}>
          <Tooltip.Popup role="tooltip" {...stylex.props(styles.popup)}>
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
  ...props
}: Omit<ComponentProps<"button">, "children" | "title"> & {
  label: string;
  shortcut?: string;
  icon: IconName;
  active?: boolean;
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
        <Icon name={icon} size={15} />
      </button>
    </ActionTooltip>
  );
}
const styles = stylex.create({
  positioner: { zIndex: 150 },
  popup: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    maxWidth: "min(320px, 90vw)",
    paddingBlock: 7,
    paddingInline: 10,
    borderRadius: 9,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: tokens.border,
    backgroundColor: tokens.raised,
    color: tokens.text,
    boxShadow: tokens.shadow,
    fontFamily: tokens.ui,
    fontSize: 11,
    lineHeight: 1.4,
  },
});
