import * as stylex from "@stylexjs/stylex";
import { ContextMenu } from "@base-ui/react/context-menu";
import { useRef, useState, type MouseEvent, type ReactElement, type ReactNode } from "react";
import type { OpenInLinks } from "../data/api";
import { picked, tokens, ui } from "../theme.stylex";

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
  /** Open in's links and editors, where the host has them. */
  openIn?: {
    links(repo: string): Promise<OpenInLinks>;
    open(target: PathTarget & { repo: string }, line: number, editor: string): Promise<void>;
  };
}

/** A checkout's links, asked again after a minute, as a push gives its branch a page. */
const asked = new Map<string, { at: number; links: Promise<OpenInLinks> }>();
export function linksOf(actions: PathActions, repo: string) {
  const known = asked.get(repo);
  if (known && Date.now() - known.at < 60_000) return known.links;
  const links = actions.openIn!.links(repo).catch(() => ({ editors: [], host: null, links: [] }));
  asked.set(repo, { at: Date.now(), links });
  return links;
}

const segments = (path: string) => path.split("/").map(encodeURIComponent).join("/");
/** The page of a file's line under a branch's page on its code host. */
export const lineLink = (base: string, path: string, line?: number) =>
  `${base}/${segments(path)}${line ? `#L${line}` : ""}`;
/** A link from the settings, such as Sourcegraph's, at a file's line. */
export const fillLink = (template: string, path: string, line: number) =>
  template.replaceAll("{path}", segments(path)).replaceAll("{line}", String(line));

const platform = typeof navigator === "undefined" ? "" : navigator.platform;
export const REVEAL_LABEL = /Mac/.test(platform)
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
  // The code host's page and Settings' links, such as Sourcegraph's, once
  // the checkout's links have come.
  const [links, setLinks] = useState<{ repo: string; links: OpenInLinks } | null>(null);
  const shownLinks = target?.repo && links?.repo === target.repo ? links.links : null;
  const host = shownLinks?.host;
  const web: PathMenuItem[] = target
    ? [
        ...(host && "base" in host
          ? [
              {
                label: `Open on ${host.name}`,
                run: () => window.open(lineLink(host.base, target.path), "_blank", "noopener"),
              },
            ]
          : []),
        ...(shownLinks?.links ?? []).flatMap((link) =>
          "template" in link
            ? [
                {
                  label: `Open in ${link.name}`,
                  run: () =>
                    window.open(fillLink(link.template, target.path, 1), "_blank", "noopener"),
                },
              ]
            : [],
        ),
      ]
    : [];
  const entries: (PathMenuItem | null)[] = target
    ? [
        ...(web.length ? [...web, null] : []),
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
          const repo = located.current?.repo;
          if (repo && actions?.openIn)
            void linksOf(actions, repo).then((next) => setLinks({ repo, links: next }));
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
                      state.highlighted && !entry.disabled && [ui.menuHighlighted, picked],
                      entry.disabled && styles.disabled,
                    ).className
                  }
                >
                  {entry.label}
                </ContextMenu.Item>
              ) : (
                <ContextMenu.Separator key={`separator-${index}`} {...stylex.props(ui.separator)} />
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
  disabled: {
    color: tokens.faint,
    backgroundColor: { default: "transparent", ":hover": "transparent" },
  },
});
