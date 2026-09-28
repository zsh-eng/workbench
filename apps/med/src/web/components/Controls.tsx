import { ActionTooltip } from "./ToolButton";
import { focusPaletteInput } from "../data/palette-focus";
import * as stylex from "@stylexjs/stylex";
import { Menu } from "@base-ui/react/menu";
import { Select } from "@base-ui/react/select";
import { Dialog } from "@base-ui/react/dialog";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ShortcutKeys } from "./ShortcutKeys";
export { ShortcutKeys } from "./ShortcutKeys";
import { Icon, type IconName } from "./Icon";
import { tokens, ui } from "../theme.stylex";

export interface Choice {
  value: string;
  label: string;
  description?: string;
}
export interface ReviewCommand {
  icon?: IconName;
  managesFocus?: boolean;
  id: string;
  label: string;
  shortcut?: string;
  disabled?: boolean;
  run(): void;
}

export function ChoiceSelect({
  value,
  choices,
  onChange,
  label,
  icon,
}: {
  value: string;
  choices: Choice[];
  onChange(value: string): void;
  label: string;
  icon?: ReactNode;
}) {
  return (
    <Select.Root
      value={value}
      onValueChange={(next) => {
        if (next !== null) onChange(next);
      }}
      items={choices}
    >
      <Select.Trigger {...stylex.props(ui.button, ui.strong)} aria-label={label}>
        {icon}
        <Select.Value />
        <Select.Icon>
          <Icon name="chevron" size={12} />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Positioner
          sideOffset={6}
          align="start"
          {...stylex.props(styles.positioner, ui.instant)}
        >
          <Select.Popup {...stylex.props(ui.popup, ui.instant)}>
            <Select.List>
              {choices.map((choice) => (
                <Select.Item
                  key={choice.value}
                  value={choice.value}
                  className={(state) =>
                    stylex.props(ui.menuItem, state.highlighted && ui.menuHighlighted).className
                  }
                >
                  <Select.ItemText>{choice.label}</Select.ItemText>
                  <Select.ItemIndicator>
                    <Icon name="check" size={12} />
                  </Select.ItemIndicator>
                </Select.Item>
              ))}
            </Select.List>
          </Select.Popup>
        </Select.Positioner>
      </Select.Portal>
    </Select.Root>
  );
}

export function ActionMenu({
  children,
  label = "View options",
  actions,
}: {
  children?: ReactNode;
  label?: string;
  actions: { label: string; shortcut?: string; checked?: boolean; onClick(): void }[];
}) {
  return (
    <Menu.Root>
      <ActionTooltip label={label}>
        <Menu.Trigger
          {...stylex.props(ui.button, children ? null : ui.iconButton)}
          aria-label={label}
        >
          {children ?? <Icon name="settings" />}
        </Menu.Trigger>
      </ActionTooltip>
      <Menu.Portal>
        <Menu.Positioner
          align="end"
          sideOffset={6}
          {...stylex.props(styles.positioner, ui.instant)}
        >
          <Menu.Popup {...stylex.props(ui.popup, ui.instant)}>
            {actions.map((action) => (
              <Menu.Item
                key={action.label}
                onClick={action.onClick}
                className={(state) =>
                  stylex.props(ui.menuItem, state.highlighted && ui.menuHighlighted).className
                }
              >
                <span {...stylex.props(ui.row)}>
                  {action.checked !== undefined && (
                    <span {...stylex.props(styles.check)}>
                      {action.checked ? <Icon name="check" size={12} /> : null}
                    </span>
                  )}
                  {action.label}
                </span>
                <ShortcutKeys value={action.shortcut} />
              </Menu.Item>
            ))}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

export function CommandDialog({
  open,
  onOpenChange,
  commands,
  title = "Commands",
  searchLabel = "Search commands",
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  title?: string;
  searchLabel?: string;
  commands: ReviewCommand[];
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const commandManagesFocus = useRef(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const resultList = useRef<HTMLDivElement>(null);
  const results = commands
    .filter((command) => command.label.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => Number(!!a.disabled) - Number(!!b.disabled));
  useEffect(() => {
    resultList.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [active]);
  const run = (index: number) => {
    const command = results[index];
    if (command && !command.disabled) {
      commandManagesFocus.current = !!command.managesFocus;
      onOpenChange(false);
      setActive(0);
      command.run();
    }
  };
  return (
    <Dialog.Root
      open={open}
      onOpenChange={onOpenChange}
      onOpenChangeComplete={(next) => {
        if (!next) {
          setActive(0);
        }
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop {...stylex.props(styles.backdrop, ui.instant)} />
        <Dialog.Popup
          initialFocus={() => {
            commandManagesFocus.current = false;
            return focusPaletteInput(inputRef.current);
          }}
          finalFocus={() => !commandManagesFocus.current}
          {...stylex.props(styles.dialog, ui.instant)}
        >
          <Dialog.Title {...stylex.props(styles.hidden)}>{title}</Dialog.Title>
          <Dialog.Description {...stylex.props(styles.hidden)}>
            Find and run a review command.
          </Dialog.Description>
          <div {...stylex.props(styles.commandInput)}>
            <Icon name="search" />
            <input
              ref={inputRef}
              value={query}
              onFocus={(event) => event.currentTarget.select()}
              onChange={(event) => {
                setQuery(event.target.value);
                setActive(0);
              }}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  setActive((index) => Math.min(index + 1, results.length - 1));
                } else if (event.key === "ArrowUp") {
                  event.preventDefault();
                  setActive((index) => Math.max(0, index - 1));
                } else if (event.key === "Enter") {
                  event.preventDefault();
                  run(active);
                }
              }}
              {...stylex.props(styles.commandField)}
              placeholder="Search commands…"
              aria-label={searchLabel}
              role="combobox"
              aria-expanded="true"
              aria-controls="command-results"
              aria-activedescendant={results[active] ? `command-${results[active].id}` : undefined}
            />
            <ShortcutKeys value="Esc" />
          </div>
          <div
            id="command-results"
            ref={resultList}
            role="listbox"
            aria-label="Commands"
            {...stylex.props(styles.commandResults)}
          >
            {results.map((command, index) => (
              <button
                type="button"
                tabIndex={-1}
                id={`command-${command.id}`}
                key={command.id}
                role="option"
                aria-selected={index === active}
                aria-disabled={command.disabled || undefined}
                onMouseMove={() => setActive(index)}
                onClick={() => run(index)}
                {...stylex.props(
                  ui.button,
                  ui.menuItem,
                  styles.commandRow,
                  index === active && ui.menuHighlighted,
                  command.disabled && styles.disabled,
                )}
              >
                <span {...stylex.props(styles.commandLabel)}>
                  <Icon name={command.icon ?? "command"} size={15} />
                  <span {...stylex.props(styles.commandText)}>{command.label}</span>
                </span>
                <ShortcutKeys value={command.shortcut} />
              </button>
            ))}
            {results.length === 0 && (
              <div {...stylex.props(styles.empty)}>No matching commands</div>
            )}
          </div>
          <div {...stylex.props(styles.commandFooter)}>
            <span {...stylex.props(styles.footerHint)}>
              <ShortcutKeys value="↑ ↓" /> Navigate
            </span>
            <span {...stylex.props(styles.footerHint)}>
              Run command <ShortcutKeys value="↵" />
            </span>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

const styles = stylex.create({
  disabled: { opacity: 0.45 },
  positioner: { zIndex: 100 },
  check: { display: "inline-flex", width: 13 },
  backdrop: { position: "fixed", inset: 0, backgroundColor: "#00000050", zIndex: 110 },
  dialog: {
    position: "fixed",
    top: "18vh",
    left: "50%",
    transform: "translateX(-50%)",
    width: "min(560px, calc(100vw - 32px))",
    backgroundColor: tokens.panel,
    color: tokens.text,
    fontFamily: tokens.ui,
    borderRadius: 16,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: tokens.border,
    boxShadow: tokens.shadow,
    zIndex: 111,
    overflow: "hidden",
    outline: "none",
  },
  hidden: {
    position: "absolute",
    width: 1,
    height: 1,
    overflow: "hidden",
    clipPath: "inset(50%)",
    whiteSpace: "nowrap",
  },
  commandInput: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    minHeight: 52,
    paddingInline: 16,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: tokens.border,
    color: tokens.muted,
  },
  commandField: {
    flex: "1",
    minWidth: 0,
    borderWidth: 0,
    outline: "none",
    backgroundColor: "transparent",
    color: tokens.text,
    fontFamily: tokens.ui,
    fontSize: 14,
  },
  commandResults: { padding: 6, maxHeight: "min(352px, 55vh)", overflowY: "auto" },
  commandRow: {
    width: "100%",
    minHeight: 34,
    paddingInline: 10,
    textAlign: "left",
    borderRadius: 8,
  },
  commandText: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  commandLabel: {
    flex: "1",
    display: "flex",
    alignItems: "center",
    gap: 10,
    minWidth: 0,
  },
  commandFooter: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 36,
    paddingInline: 16,
    borderTopWidth: 1,
    borderTopStyle: "solid",
    borderTopColor: tokens.border,
    color: tokens.muted,
    fontSize: 10,
  },
  footerHint: { display: "inline-flex", alignItems: "center", gap: 6 },
  empty: { padding: 20, textAlign: "center", fontSize: 13, color: tokens.muted },
});
