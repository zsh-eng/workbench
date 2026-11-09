import * as stylex from "@stylexjs/stylex";
import { Popover } from "@base-ui/react/popover";
import { useEffect, useId, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import type { ThreadList } from "../../../shared/threads";
import { tokens, ui } from "../../theme.stylex";
import { Icon } from "../Icon";

type Repository = ThreadList["repositories"][number];

/**
 * New thread's question of where to work, from the repository's chip under
 * the composer: a popover with the repositories, most recent first, and a
 * filter on top. Typing filters, the arrow keys move, and Enter picks; Escape
 * clears the filter, then closes the popover. Add a folder… registers another.
 */
export function RepositoryPicker({
  repositories,
  chosen,
  onPick,
  onAdd,
  open,
  onOpenChange,
  trigger,
  children,
}: {
  repositories: readonly Repository[];
  chosen?: string;
  onPick(id: string): void;
  onAdd(): void;
  open: boolean;
  onOpenChange(open: boolean): void;
  trigger: stylex.StyleXStyles;
  /** The chip: the chosen repository's name, or the ask to choose one. */
  children: ReactNode;
}) {
  const filter = useRef<HTMLInputElement>(null);
  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Trigger aria-label="Repository" {...stylex.props(trigger)}>
        {children}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner
          side="bottom"
          align="start"
          sideOffset={6}
          {...stylex.props(styles.positioner)}
        >
          <Popover.Popup
            initialFocus={filter}
            aria-label="Where to work"
            data-where-to-work=""
            {...stylex.props(ui.popup, ui.pop, styles.popup)}
          >
            <WhereToWork
              repositories={repositories}
              chosen={chosen}
              filterRef={filter}
              onPick={onPick}
              onAdd={onAdd}
            />
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

/**
 * The repositories in one list with a filter on top, and Add a folder… at
 * its foot.
 */
export function WhereToWork({
  repositories,
  chosen,
  onPick,
  onAdd,
  filterRef,
}: {
  repositories: readonly Repository[];
  chosen?: string;
  onPick(id: string): void;
  onAdd(): void;
  filterRef?: RefObject<HTMLInputElement | null>;
}) {
  const id = useId();
  const [filter, setFilter] = useState("");
  const shown = useMemo(() => {
    const query = filter.trim().toLowerCase();
    if (!query) return repositories;
    return repositories.filter(
      (entry) =>
        entry.name.toLowerCase().includes(query) || entry.path.toLowerCase().includes(query),
    );
  }, [filter, repositories]);
  // The option the arrows are on: the chosen repository until they move.
  const [moved, setMoved] = useState<string>();
  const active =
    shown.find((entry) => entry.id === moved) ??
    shown.find((entry) => entry.id === chosen) ??
    shown[0];
  const activeIndex = active ? shown.indexOf(active) : -1;
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    list.current
      ?.querySelector(`[data-index="${activeIndex}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  return (
    <div {...stylex.props(styles.box)}>
      <label {...stylex.props(styles.filter)}>
        <Icon name="search" size={13} style={{ flexShrink: 0, opacity: 0.6 }} />
        <input
          ref={filterRef}
          value={filter}
          placeholder="Filter repositories"
          aria-label="Filter repositories"
          role="combobox"
          aria-expanded
          aria-controls={`${id}-list`}
          aria-activedescendant={active ? `${id}-${activeIndex}` : undefined}
          aria-autocomplete="list"
          spellCheck={false}
          autoComplete="off"
          onChange={(event) => {
            setFilter(event.target.value);
            setMoved(undefined);
          }}
          onKeyDown={(event) => {
            const move = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
            if (move && shown.length) {
              event.preventDefault();
              const next = Math.min(shown.length - 1, Math.max(0, activeIndex + move));
              setMoved(shown[next]!.id);
            } else if (event.key === "Enter" && active && !event.nativeEvent.isComposing) {
              event.preventDefault();
              onPick(active.id);
            } else if (event.key === "Escape" && filter) {
              // The first Escape clears the filter; the next closes the list.
              event.preventDefault();
              event.stopPropagation();
              setFilter("");
              setMoved(undefined);
            }
          }}
          {...stylex.props(styles.input)}
        />
      </label>
      <div
        ref={list}
        id={`${id}-list`}
        role="listbox"
        aria-label="Repositories"
        {...stylex.props(styles.list)}
      >
        {shown.map((entry, index) => {
          const selected = entry.id === chosen;
          return (
            <button
              type="button"
              key={entry.id}
              id={`${id}-${index}`}
              role="option"
              tabIndex={-1}
              aria-selected={selected}
              data-index={index}
              // The filter keeps focus; a click only picks.
              onMouseDown={(event) => event.preventDefault()}
              onMouseMove={() => entry.id !== active?.id && setMoved(entry.id)}
              onClick={() => onPick(entry.id)}
              {...stylex.props(
                styles.option,
                entry === active && styles.active,
                selected && styles.selected,
              )}
            >
              <Icon name="folder" size={14} style={{ flexShrink: 0, opacity: 0.7 }} />
              <span {...stylex.props(styles.name)}>{entry.name}</span>
              <span {...stylex.props(styles.path)}>{entry.path}</span>
              <span {...stylex.props(styles.check)}>
                {selected && <Icon name="check" size={14} />}
              </span>
            </button>
          );
        })}
        {!shown.length && (
          <p {...stylex.props(styles.empty)}>
            {repositories.length
              ? `No repository matches “${filter.trim()}”.`
              : "Add a repository to start a thread."}
          </p>
        )}
      </div>
      <button type="button" onClick={onAdd} {...stylex.props(styles.add)}>
        <Icon name="plus" size={13} style={{ flexShrink: 0 }} />
        Add a folder…
      </button>
    </div>
  );
}

const styles = stylex.create({
  positioner: { zIndex: 100, outline: "none" },
  // The popup is the list's frame: its rows reach its edges.
  popup: {
    width: "min(520px, calc(100vw - 32px))",
    maxHeight: "none",
    padding: 0,
    overflow: "hidden",
  },
  box: { display: "flex", flexDirection: "column", minHeight: 0 },
  filter: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexShrink: 0,
    paddingInline: 12,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: tokens.line,
    color: tokens.muted,
  },
  input: {
    flex: "1",
    minWidth: 0,
    height: 36,
    borderWidth: 0,
    backgroundColor: "transparent",
    color: tokens.text,
    fontFamily: tokens.ui,
    fontSize: 13,
    outline: "none",
    "::placeholder": { color: tokens.faint },
  },
  // The list scrolls when it is long.
  list: { overflowY: "auto", maxHeight: 264, paddingBlock: 4, minHeight: 0 },
  option: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    boxSizing: "border-box",
    width: "calc(100% - 8px)",
    height: 34,
    marginInline: 4,
    paddingInline: 8,
    borderWidth: 0,
    backgroundColor: "transparent",
    textAlign: "start",
    borderRadius: `calc(6px * ${tokens.round})`,
    color: tokens.muted,
    fontFamily: tokens.ui,
    fontSize: 13,
    cursor: "pointer",
  },
  active: { backgroundColor: tokens.fill, color: tokens.text },
  selected: { color: tokens.text },
  name: {
    flexShrink: 0,
    maxWidth: "45%",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  path: {
    flex: "1",
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    color: tokens.faint,
    fontFamily: tokens.code,
    fontSize: 11.5,
  },
  check: { display: "flex", flexShrink: 0, width: 14, color: tokens.accent },
  empty: {
    margin: 0,
    paddingBlock: 10,
    paddingInline: 14,
    color: tokens.faint,
    fontFamily: tokens.ui,
    fontSize: 12.5,
  },
  add: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexShrink: 0,
    height: 34,
    paddingInline: 14,
    borderWidth: 0,
    borderTopWidth: 1,
    borderTopStyle: "solid",
    borderTopColor: tokens.line,
    backgroundColor: { default: "transparent", ":hover": tokens.fill },
    color: { default: tokens.muted, ":hover": tokens.text },
    fontFamily: tokens.ui,
    fontSize: 12.5,
    textAlign: "start",
    cursor: "pointer",
    outline: "none",
    boxShadow: { default: "none", ":focus-visible": `inset 0 0 0 2px ${tokens.accentLine}` },
  },
});
