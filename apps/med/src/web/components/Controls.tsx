import { ActionTooltip } from "./ToolButton";
import { focusPaletteInput } from "../data/palette-focus";
import * as stylex from "@stylexjs/stylex";
import { Menu } from "@base-ui/react/menu";
import { Select } from "@base-ui/react/select";
import { Dialog } from "@base-ui/react/dialog";
import { Fragment, useEffect, useRef, useState, type ReactNode, type Ref } from "react";
import { ShortcutKeys } from "./ShortcutKeys";
export { ShortcutKeys } from "./ShortcutKeys";
import { Icon, type IconName } from "./Icon";
import { picked, tokens, ui } from "../theme.stylex";

export interface Choice {
  value: string;
  label: string;
  description?: string;
}
export interface MenuAction {
  label: string;
  shortcut?: string;
  /** A toggle. Renders as a checkbox item with its state. */
  checked?: boolean;
  /** A checked item that is a choice, so choosing it closes the menu. */
  choice?: boolean;
  disabled?: boolean;
  /** A letter that chooses the item while its menu is open. The label
   * underlines it. */
  letter?: string;
  onClick(): void;
}
/** Items that open beside their item, such as a menu's view options. */
export interface MenuSubmenu {
  label: string;
  items: MenuAction[];
}
export type MenuEntry = MenuAction | MenuSubmenu;
export interface ReviewCommand {
  managesFocus?: boolean;
  id: string;
  label: string;
  shortcut?: string;
  disabled?: boolean;
  run(): void;
}

/** A value that no choice has: an action's item in a ChoiceSelect. */
const ACTION = "\u0000action:";

export function ChoiceSelect({
  value,
  choices,
  onChange,
  label,
  icon,
  trigger,
  disabled,
  actions = [],
  triggerRef,
}: {
  value: string;
  choices: Choice[];
  onChange(value: string): void;
  label: string;
  icon?: ReactNode;
  /** The trigger's look, in place of a toolbar button. */
  trigger?: stylex.StyleXStyles;
  disabled?: boolean;
  /** Items after the choices, below a rule, that act and keep the value. A
   * `checked` item is a toggle and shows its state. */
  actions?: { label: string; checked?: boolean; onSelect(): void }[];
  triggerRef?: Ref<HTMLButtonElement>;
}) {
  return (
    <Select.Root
      value={value}
      onValueChange={(next) => {
        if (next === null) return;
        if (next.startsWith(ACTION)) actions[Number(next.slice(ACTION.length))]?.onSelect();
        else onChange(next);
      }}
      items={choices}
      disabled={disabled}
    >
      <Select.Trigger
        ref={triggerRef}
        {...stylex.props(ui.button, ui.strong, styles.trigger, trigger)}
        aria-label={label}
      >
        {icon}
        <Select.Value {...stylex.props(styles.value)} />
        <Select.Icon {...stylex.props(styles.chevron)}>
          <Icon name="chevron" size={14} />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Positioner
          sideOffset={6}
          align="start"
          alignItemWithTrigger={false}
          {...stylex.props(styles.positioner)}
        >
          <Select.Popup {...stylex.props(ui.popup, ui.pop)}>
            <Select.List>
              {choices.map((choice) => (
                <Select.Item
                  key={choice.value}
                  value={choice.value}
                  className={(state) =>
                    stylex.props(
                      ui.menuItem,
                      styles.choice,
                      !!choice.description && styles.describedChoice,
                      state.highlighted && [ui.menuHighlighted, picked],
                    ).className
                  }
                >
                  <span {...stylex.props(styles.check)}>
                    <Select.ItemIndicator {...stylex.props(styles.indicator)}>
                      <Icon name="check" size={14} />
                    </Select.ItemIndicator>
                  </span>
                  <span {...stylex.props(styles.choiceText)}>
                    <Select.ItemText {...stylex.props(styles.choiceLabel)}>
                      {choice.label}
                    </Select.ItemText>
                    {choice.description && (
                      <span {...stylex.props(styles.choiceDescription)}>{choice.description}</span>
                    )}
                  </span>
                </Select.Item>
              ))}
              {actions.length > 0 && <Select.Separator {...stylex.props(ui.separator)} />}
              {actions.map((action, index) => (
                <Select.Item
                  key={action.label}
                  value={`${ACTION}${index}`}
                  {...(action.checked !== undefined && {
                    "aria-label": `${action.label}, ${action.checked ? "on" : "off"}`,
                  })}
                  className={(state) =>
                    stylex.props(
                      ui.menuItem,
                      styles.choice,
                      state.highlighted && [ui.menuHighlighted, picked],
                    ).className
                  }
                >
                  <span {...stylex.props(styles.check)}>
                    {action.checked && <Icon name="check" size={14} />}
                  </span>
                  <Select.ItemText {...stylex.props(styles.choiceLabel)}>
                    {action.label}
                  </Select.ItemText>
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
  sections,
  trigger,
  align = "end",
}: {
  children?: ReactNode;
  label?: string;
  /** Groups of related actions, separated by rules. */
  sections: MenuEntry[][];
  /** The trigger's look, in place of a toolbar button. */
  trigger?: stylex.StyleXStyles;
  align?: "start" | "end";
}) {
  const [open, setOpen] = useState(false);
  // While the menu is open, a letter chooses its item as a click does, also
  // in a submenu; a toggle keeps the menu open. The key goes to the menu
  // wherever focus is, as focus moves into the menu a moment after it opens.
  useEffect(() => {
    if (!open) return;
    const choose = (event: globalThis.KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || event.key.length !== 1) return;
      const key = event.key.toLowerCase();
      const action = sections
        .flat()
        .flatMap((entry) => ("items" in entry ? entry.items : [entry]))
        .find((entry) => entry.letter === key && !entry.disabled);
      if (!action) return;
      event.preventDefault();
      event.stopPropagation();
      if (action.checked === undefined || action.choice) setOpen(false);
      action.onClick();
    };
    window.addEventListener("keydown", choose, true);
    return () => window.removeEventListener("keydown", choose, true);
  }, [open, sections]);
  return (
    <Menu.Root open={open} onOpenChange={setOpen}>
      <ActionTooltip label={label}>
        <Menu.Trigger
          {...stylex.props(trigger ?? [ui.button, children ? null : ui.iconButton])}
          aria-label={label}
        >
          {children ?? <Icon name="settings" size={15} />}
        </Menu.Trigger>
      </ActionTooltip>
      <Menu.Portal>
        <Menu.Positioner align={align} sideOffset={6} {...stylex.props(styles.positioner)}>
          <Menu.Popup {...stylex.props(ui.popup, ui.pop, styles.menu)}>
            <MenuSections sections={sections} />
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

/** A menu's groups of items, with a check column when any item toggles. */
function MenuSections({ sections }: { sections: MenuEntry[][] }) {
  const toggles = sections.some((section) =>
    section.some((action) => !("items" in action) && action.checked !== undefined),
  );
  const className = (state: { highlighted: boolean }) =>
    stylex.props(ui.menuItem, state.highlighted && [ui.menuHighlighted, picked]).className;
  const check = (indicator: ReactNode) =>
    toggles && <span {...stylex.props(styles.check)}>{indicator}</span>;
  return sections
    .filter((section) => section.length)
    .map((section, index) => (
      <Fragment key={section.map((action) => action.label).join()}>
        {index > 0 && <Menu.Separator {...stylex.props(ui.separator)} />}
        <Menu.Group>
          {section.map((action) => {
            if ("items" in action)
              return (
                <Menu.SubmenuRoot key={action.label}>
                  <Menu.SubmenuTrigger className={className}>
                    <span {...stylex.props(ui.row)}>
                      {check(null)}
                      {action.label}
                    </span>
                    <span {...stylex.props(styles.submenuArrow)}>
                      <Icon name="chevron" size={12} />
                    </span>
                  </Menu.SubmenuTrigger>
                  <Menu.Portal>
                    <Menu.Positioner sideOffset={4} {...stylex.props(styles.positioner)}>
                      <Menu.Popup {...stylex.props(ui.popup, ui.pop, styles.menu)}>
                        <MenuSections sections={[action.items]} />
                      </Menu.Popup>
                    </Menu.Positioner>
                  </Menu.Portal>
                </Menu.SubmenuRoot>
              );
            const content = (
              <>
                <span {...stylex.props(ui.row)}>
                  {check(
                    action.checked !== undefined && (
                      <Menu.CheckboxItemIndicator {...stylex.props(styles.indicator)}>
                        <Icon name="check" size={14} />
                      </Menu.CheckboxItemIndicator>
                    ),
                  )}
                  <Lettered label={action.label} letter={action.letter} />
                </span>
                <ShortcutKeys value={action.shortcut} />
              </>
            );
            return action.checked === undefined ? (
              <Menu.Item
                key={action.label}
                aria-keyshortcuts={action.letter}
                onClick={action.onClick}
                disabled={action.disabled}
                className={className}
              >
                {content}
              </Menu.Item>
            ) : (
              <Menu.CheckboxItem
                key={action.label}
                aria-keyshortcuts={action.letter}
                disabled={action.disabled}
                checked={action.checked}
                closeOnClick={action.choice}
                onCheckedChange={action.onClick}
                className={className}
              >
                {content}
              </Menu.CheckboxItem>
            );
          })}
        </Menu.Group>
      </Fragment>
    ));
}

/** A label with its letter underlined: the first at the start of a word, or
 * else the first anywhere. */
function Lettered({ label, letter }: { label: string; letter?: string }) {
  if (!letter) return label;
  const word = label.search(new RegExp(`\\b${letter}`, "i"));
  const at = word >= 0 ? word : label.toLowerCase().indexOf(letter);
  if (at < 0) return label;
  return (
    <span>
      {label.slice(0, at)}
      <span {...stylex.props(styles.letter)}>{label[at]}</span>
      {label.slice(at + 1)}
    </span>
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
        <Dialog.Backdrop {...stylex.props(ui.scrim, styles.backdrop, ui.instant)} />
        <Dialog.Popup
          initialFocus={() => {
            commandManagesFocus.current = false;
            return focusPaletteInput(inputRef.current);
          }}
          finalFocus={() => !commandManagesFocus.current}
          {...stylex.props(ui.palette, styles.dialog, ui.instant)}
        >
          <Dialog.Title {...stylex.props(styles.hidden)}>{title}</Dialog.Title>
          <Dialog.Description {...stylex.props(styles.hidden)}>
            Find and run a review command.
          </Dialog.Description>
          <div {...stylex.props(ui.paletteInput)}>
            <Icon name="command" />
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
              {...stylex.props(ui.paletteField)}
              placeholder="Type a command…"
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
                  index === active && [ui.menuHighlighted, picked],
                  command.disabled && styles.disabled,
                )}
              >
                <span {...stylex.props(styles.commandText)}>{command.label}</span>
                <ShortcutKeys value={command.shortcut} />
              </button>
            ))}
            {results.length === 0 && (
              <div {...stylex.props(styles.empty)}>No matching commands</div>
            )}
          </div>
          <div {...stylex.props(ui.paletteFooter)}>
            <span {...stylex.props(styles.footerHint)}>
              <ShortcutKeys value="↑ ↓" /> Navigate
            </span>
            <span {...stylex.props(styles.footerHint)}>
              <ShortcutKeys value="↵" /> Run
            </span>
            <span {...stylex.props(ui.grow)} />
            <span {...stylex.props(styles.footerHint)}>
              {results.filter((command) => !command.disabled).length} available
            </span>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/**
 * Two or three exclusive options with a pill that slides to the pressed one.
 * The view changes at once; the pill only shows where the choice moved.
 */
export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string; icon: IconName; shortcut?: string; disabled?: boolean }[];
  onChange(value: T): void;
  label: string;
}) {
  const index = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );
  return (
    <div role="group" aria-label={label} {...stylex.props(styles.segmented)}>
      <span
        aria-hidden="true"
        {...stylex.props(styles.segmentPill, styles.segmentPosition(options.length, index))}
      />
      {options.map((option) => (
        <ActionTooltip key={option.value} label={option.label} shortcut={option.shortcut}>
          <button
            type="button"
            aria-label={option.label}
            aria-pressed={option.value === value}
            aria-disabled={option.disabled || undefined}
            onClick={() => !option.disabled && onChange(option.value)}
            {...stylex.props(
              ui.button,
              ui.iconButton,
              styles.segment,
              option.value === value && styles.segmentActive,
              option.disabled && styles.disabled,
            )}
          >
            <Icon name={option.icon} size={15} />
          </button>
        </ActionTooltip>
      ))}
    </div>
  );
}

const styles = stylex.create({
  disabled: { opacity: 0.45 },
  positioner: { zIndex: 100, outline: "none" },
  check: { display: "inline-flex", flexShrink: 0, width: 14, color: tokens.accent },
  indicator: { display: "inline-flex", color: tokens.accent },
  submenuArrow: { display: "inline-flex", transform: "rotate(-90deg)", color: tokens.faint },
  letter: {
    textDecorationLine: "underline",
    textDecorationThickness: 1,
    textUnderlineOffset: 2.5,
  },
  menu: { minWidth: 220 },
  choice: { justifyContent: "flex-start", gap: 8, minWidth: 220 },
  describedChoice: { alignItems: "flex-start", paddingBlock: 6 },
  choiceText: { display: "flex", flexDirection: "column", gap: 2, minWidth: 0 },
  choiceLabel: { fontSize: 12.5 },
  choiceDescription: { color: tokens.faint, fontSize: 11, lineHeight: 1.35 },
  // In a narrow toolbar the value truncates before the trigger overflows.
  trigger: { gap: 4, minWidth: 0, paddingInlineEnd: 5 },
  value: { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" },
  chevron: { display: "inline-flex", color: tokens.faint },
  backdrop: { zIndex: 110 },
  dialog: { zIndex: 111 },
  hidden: {
    position: "absolute",
    width: 1,
    height: 1,
    overflow: "hidden",
    clipPath: "inset(50%)",
    whiteSpace: "nowrap",
  },
  commandResults: { padding: 4, maxHeight: "min(360px, 55vh)", overflowY: "auto" },
  commandRow: {
    width: "100%",
    minHeight: 32,
    paddingInline: 10,
    textAlign: "left",
    borderRadius: `calc(6px * ${tokens.round})`,
    fontSize: 12.5,
    color: { default: tokens.text, ":hover:not(:disabled)": tokens.text },
  },
  commandText: {
    flex: "1",
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  footerHint: { display: "inline-flex", alignItems: "center", gap: 6 },
  empty: { padding: 24, textAlign: "center", fontSize: 12.5, color: tokens.muted },
  segmented: {
    position: "relative",
    display: "flex",
    padding: 2,
    borderRadius: `calc(8px * ${tokens.round})`,
    backgroundColor: tokens.fill,
    boxShadow: `inset 0 0 0 1px ${tokens.line}`,
  },
  segmentPill: {
    position: "absolute",
    top: 2,
    bottom: 2,
    left: 2,
    borderRadius: `calc(6px * ${tokens.round})`,
    backgroundColor: tokens.segment,
    boxShadow: `0 0 0 1px ${tokens.lineStrong}, 0 1px 2px #0000001f`,
    transitionProperty: "transform",
    transitionTimingFunction: tokens.easeOut,
    transitionDuration: { default: "200ms", "@media (prefers-reduced-motion: reduce)": "0ms" },
    pointerEvents: "none",
  },
  segmentPosition: (count: number, index: number) => ({
    width: `calc((100% - 4px) / ${count})`,
    transform: `translateX(${index * 100}%)`,
  }),
  segment: {
    position: "relative",
    width: 28,
    minWidth: 28,
    minHeight: 24,
    height: 24,
    borderRadius: `calc(6px * ${tokens.round})`,
    backgroundColor: { default: "transparent", ":hover:not(:disabled)": "transparent" },
    color: { default: tokens.faint, ":hover:not(:disabled)": tokens.text },
  },
  segmentActive: {
    color: { default: tokens.selectedText, ":hover:not(:disabled)": tokens.selectedText },
  },
});
