import * as stylex from "@stylexjs/stylex";
import { Menu } from "@base-ui/react/menu";
import { useMemo } from "react";
import { picked, tokens, ui } from "../theme.stylex";

export interface PointMenuItem {
  label: string;
  run(): void;
}

export interface PointMenuState {
  x: number;
  y: number;
  label: string;
  items: (PointMenuItem | null)[];
}

/**
 * A right-click menu at a point, for content that the page builds outside
 * React, such as a Markdown image or diagram. The owner opens it from its
 * own `contextmenu` listener, so text elsewhere keeps the browser's menu.
 */
export function PointMenu({ menu, onClose }: { menu: PointMenuState | null; onClose(): void }) {
  const anchor = useMemo(
    () =>
      menu && {
        getBoundingClientRect: () =>
          DOMRect.fromRect({ x: menu.x, y: menu.y, width: 0, height: 0 }),
      },
    [menu],
  );
  return (
    <Menu.Root open={!!menu} onOpenChange={(open) => !open && onClose()}>
      <Menu.Portal>
        <Menu.Positioner
          anchor={anchor}
          side="bottom"
          align="start"
          sideOffset={2}
          {...stylex.props(styles.positioner)}
        >
          <Menu.Popup aria-label={menu?.label} {...stylex.props(ui.popup, styles.menu)}>
            {menu?.items.map((item, index) =>
              item ? (
                <Menu.Item
                  key={item.label}
                  onClick={item.run}
                  className={(state) =>
                    stylex.props(ui.menuItem, state.highlighted && [ui.menuHighlighted, picked])
                      .className
                  }
                >
                  {item.label}
                </Menu.Item>
              ) : (
                <Menu.Separator key={`separator-${index}`} {...stylex.props(styles.separator)} />
              ),
            )}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

const styles = stylex.create({
  positioner: { zIndex: 60 },
  menu: { minWidth: 180 },
  separator: { height: 1, marginBlock: 4, marginInline: 4, backgroundColor: tokens.line },
});
