import * as stylex from "@stylexjs/stylex";
import { ContextMenu } from "@base-ui/react/context-menu";
import { useRef, useState, type MouseEvent, type ReactElement, type ReactNode } from "react";
import { tokens, ui } from "../theme.stylex";

export interface PathTarget {
  /** The checkout that holds the file; null when the file has no working copy. */
  repo: string | null;
  /** Path relative to the checkout. */
  path: string;
}
export interface PathMenuItem {
  label: string;
  run(): void;
  disabled?: boolean;
}

/** App services for path menus. Without them, only the copy actions work. */
export interface PathActions {
  reveal(target: PathTarget & { repo: string }): Promise<void>;
  notify(text: string): void;
}

const platform = typeof navigator === "undefined" ? "" : navigator.platform;
const REVEAL_LABEL = /Mac/.test(platform)
  ? "Reveal in Finder"
  : /Win/.test(platform)
    ? "Show in Explorer"
    : "Show in folder";

/** The file's absolute path, joined with the separator its checkout uses. */
export function absolutePath(target: PathTarget) {
  if (!target.repo) return target.path;
  const separator = target.repo.includes("\\") && !target.repo.includes("/") ? "\\" : "/";
  return `${target.repo.replace(/[\\/]+$/, "")}${separator}${target.path.replaceAll("/", separator)}`;
}

/**
 * A right-click menu for files: reveal in the file manager and copy paths.
 * `locate` names the file under the pointer, so one menu can serve a whole
 * tree; with no file there, the menu stays closed.
 */
export function PathContextMenu({
  actions,
  locate,
  items,
  render,
  className,
  children,
}: {
  actions?: PathActions;
  locate(event: MouseEvent): PathTarget | null;
  /** More actions after the path actions, such as closing a tab. */
  items?(target: PathTarget): PathMenuItem[];
  render?: ReactElement;
  className?: string;
  children: ReactNode;
}) {
  const located = useRef<PathTarget | null>(null);
  const [target, setTarget] = useState<PathTarget | null>(null);
  const [open, setOpen] = useState(false);
  const copy = (text: string, message: string) =>
    void navigator.clipboard.writeText(text).then(
      () => actions?.notify(message),
      () => actions?.notify("Copying needs clipboard access."),
    );
  const entries: (PathMenuItem | null)[] = target
    ? [
        {
          label: REVEAL_LABEL,
          disabled: !target.repo || !actions,
          run: () => {
            const repo = target.repo;
            if (!repo || !actions) return;
            actions
              .reveal({ ...target, repo })
              .catch((error: unknown) =>
                actions.notify(error instanceof Error ? error.message : "The file was not found."),
              );
          },
        },
        null,
        { label: "Copy path", run: () => copy(absolutePath(target), "Path copied.") },
        { label: "Copy relative path", run: () => copy(target.path, "Relative path copied.") },
        ...(items ? [null, ...items(target)] : []),
      ]
    : [];
  return (
    <ContextMenu.Root open={open} onOpenChange={(next) => setOpen(next && !!located.current)}>
      <ContextMenu.Trigger
        render={render}
        className={className}
        onContextMenuCapture={(event) => {
          located.current = locate(event);
          setTarget(located.current);
        }}
      >
        {children}
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Positioner {...stylex.props(styles.positioner)}>
          <ContextMenu.Popup
            aria-label={target ? `${target.path} actions` : "File actions"}
            {...stylex.props(ui.popup, styles.menu)}
          >
            {entries.map((entry, index) =>
              entry ? (
                <ContextMenu.Item
                  key={entry.label}
                  disabled={entry.disabled}
                  onClick={entry.run}
                  className={(state) =>
                    stylex.props(
                      ui.menuItem,
                      state.highlighted && !entry.disabled && ui.menuHighlighted,
                      entry.disabled && styles.disabled,
                    ).className
                  }
                >
                  {entry.label}
                </ContextMenu.Item>
              ) : (
                <ContextMenu.Separator
                  key={`separator-${index}`}
                  {...stylex.props(styles.separator)}
                />
              ),
            )}
          </ContextMenu.Popup>
        </ContextMenu.Positioner>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}

/** The `[data-item-path]` row of a Pierre tree under the pointer. */
export function treeRowPath(event: MouseEvent) {
  const row = event.nativeEvent
    .composedPath()
    .find((node) => node instanceof HTMLElement && node.dataset.itemPath !== undefined) as
    | HTMLElement
    | undefined;
  return row?.dataset.itemPath?.replace(/\/$/, "") || null;
}

const styles = stylex.create({
  positioner: { zIndex: 60 },
  menu: { minWidth: 200 },
  separator: { height: 1, marginBlock: 4, marginInline: 4, backgroundColor: tokens.line },
  disabled: {
    color: tokens.faint,
    backgroundColor: { default: "transparent", ":hover": "transparent" },
  },
});
