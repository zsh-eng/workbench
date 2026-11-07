import * as stylex from "@stylexjs/stylex";
import { useEffect, useState } from "react";
import type { OpenInLinks } from "../data/api";
import { tokens } from "../theme.stylex";
import { ActionMenu, type MenuAction } from "./Controls";
import { absolutePath, REVEAL_LABEL, type PathActions, type PathTarget } from "./PathMenu";

/** A checkout's links, asked again after a minute, as a push gives its branch a page. */
const asked = new Map<string, { at: number; links: Promise<OpenInLinks> }>();
function linksOf(actions: PathActions, repo: string) {
  const known = asked.get(repo);
  if (known && Date.now() - known.at < 60_000) return known.links;
  const links = actions.openIn!.links(repo).catch(() => ({ editors: [], host: null }));
  asked.set(repo, { at: Date.now(), links });
  return links;
}

/** The page of a file's line under a branch's page on its code host. */
export const lineLink = (base: string, path: string, line: number) =>
  `${base}/${path.split("/").map(encodeURIComponent).join("/")}#L${line}`;

/**
 * Open in, above a file: the code host's page at the same line on the
 * branch, the editors on this Mac, Reveal in Finder, Copy path, and Copy
 * link, each with a letter while the menu is open.
 */
export function OpenInMenu({
  actions,
  target,
  line,
}: {
  actions: PathActions;
  target: PathTarget & { repo: string };
  /** The line that the file shows, as the menu opens. */
  line(): number;
}) {
  const [links, setLinks] = useState<OpenInLinks | null>(null);
  useEffect(() => {
    if (!actions.openIn) return;
    let current = true;
    void linksOf(actions, target.repo).then((next) => current && setLinks(next));
    return () => {
      current = false;
    };
  }, [actions, target.repo]);
  const host = links?.host;
  const copy = (text: string, message: string) =>
    void navigator.clipboard.writeText(text).then(
      () => actions.notify(message),
      () => actions.notify("Copying needs clipboard access."),
    );
  const failed = (error: unknown) =>
    actions.notify(error instanceof Error ? error.message : "Med could not open the file.");
  // The fixed items keep their letters; each editor takes the first free
  // letter of its name.
  const taken = new Set(["g", "r", "p", "l"]);
  const editors: MenuAction[] = (links?.editors ?? []).map((editor) => {
    const letter = [...editor.name.toLowerCase()].find(
      (char) => /[a-z]/.test(char) && !taken.has(char),
    );
    if (letter) taken.add(letter);
    return {
      label: editor.name,
      letter,
      onClick: () => void actions.openIn?.open(target, line(), editor.id).catch(failed),
    };
  });
  const sections: MenuAction[][] = [
    host
      ? [
          "base" in host
            ? {
                label: host.name,
                letter: "g",
                onClick: () =>
                  window.open(lineLink(host.base, target.path, line()), "_blank", "noopener"),
              }
            : {
                label: `Push to open on ${host.name}`,
                disabled: true,
                hint: `The branch is not pushed, so ${host.name} has no page for it.`,
                onClick: () => {},
              },
        ]
      : [],
    editors,
    [
      {
        label: REVEAL_LABEL,
        letter: "r",
        onClick: () => void actions.reveal(target).catch(failed),
      },
      {
        label: "Copy path",
        letter: "p",
        onClick: () => copy(absolutePath(target), "Path copied."),
      },
      ...(host && "base" in host
        ? [
            {
              label: "Copy link",
              letter: "l",
              onClick: () => copy(lineLink(host.base, target.path, line()), "Link copied."),
            },
          ]
        : []),
    ],
  ];
  return (
    <ActionMenu label="Open in" trigger={styles.trigger} sections={sections}>
      <span {...stylex.props(styles.text)}>Open in</span>
    </ActionMenu>
  );
}

const styles = stylex.create({
  trigger: {
    display: "inline-flex",
    alignItems: "center",
    flexShrink: 0,
    height: 24,
    paddingInline: 8,
    borderWidth: 0,
    borderRadius: `calc(6px * ${tokens.round})`,
    backgroundColor: { default: "transparent", ":hover": tokens.fill },
    color: { default: tokens.muted, ":hover": tokens.text },
    fontFamily: tokens.ui,
    fontSize: 12,
    cursor: "pointer",
    outline: "none",
    boxShadow: { default: "none", ":focus-visible": `0 0 0 2px ${tokens.accentLine}` },
  },
  text: { whiteSpace: "nowrap" },
});
