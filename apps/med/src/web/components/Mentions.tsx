import * as stylex from "@stylexjs/stylex";
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import {
  expandMentions,
  findMentions,
  mentionLabel,
  startsWithMention,
  threadReference,
  type Mention,
  type MentionCandidate,
  type MentionSources,
} from "../data/mentions";
import { tokens, ui } from "../theme.stylex";
import { Icon } from "./Icon";
import type { RichPromptEditorHandle } from "./RichPromptEditor";

const ICONS = { file: "file", note: "vault", thread: "sessions" } as const;
const GROUPS = { file: "Files", note: "Notes", thread: "Threads" } as const;

/**
 * @ in a message box: a menu of files, vault notes, and threads, atomic chips
 * rendered inside RichPromptEditor, and expansion to absolute paths on send.
 */
export function useMentions({
  text,
  setText,
  sources,
  onWanted,
  off = false,
  editor: given,
  initial,
}: {
  /** The prompt editor's ref, if the box has one. */
  editor?: RefObject<RichPromptEditorHandle | null>;
  /** The mentions of a text that the box restores, such as a kept draft. */
  initial?: Mention[];
  text: string;
  setText(text: string): void;
  /** Without sources, @ is text. */
  sources?: MentionSources;
  /** @ opened: the workspace reads what it can name again. */
  onWanted?(): void;
  /** Another menu, such as `/` commands, has the keys. */
  off?: boolean;
}) {
  const id = useId();
  const own = useRef<RichPromptEditorHandle | null>(null);
  const editor = given ?? own;
  const [caret, setCaret] = useState(0);
  const [mentioned, setMentioned] = useState<Mention[]>(initial ?? []);
  // Escape closes the menu for this @: the text up to it names it.
  const [closed, setClosed] = useState<string | null>(null);
  const [highlight, setHighlight] = useState(0);
  const placeCaret = useRef<number | null>(null);

  // @ at the start of a word, before the caret, opens the menu. Its query can
  // have spaces, as note names do, while something matches.
  const before = text.slice(0, caret);
  const found = sources && !off ? /(?:^|\s)@([^\s@][^\n@]{0,59})?$/.exec(before) : null;
  const query = found?.[1] ?? "";
  const anchor = found ? before.slice(0, before.length - query.length) : "";
  const live = !!found && closed !== anchor && !startsWithMention(query, mentioned);
  useEffect(() => {
    if (live) onWanted?.();
  }, [live, onWanted]);
  const sections = sources && live ? findMentions(sources, query) : [];
  const options = sections.flatMap((section) => section.items);
  const at = live && (options.length > 0 || !/\s/.test(query)) ? found : null;
  const open = !!at;
  const active = Math.min(highlight, Math.max(0, options.length - 1));
  // The arrows keep their option in view.
  useEffect(() => {
    if (open) document.getElementById(`${id}-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [active, id, open]);

  const choose = (candidate: MentionCandidate) => {
    if (!at || !sources) return;
    const label = mentionLabel(candidate, mentioned);
    const start = caret - at[0].length + (at[0].startsWith("@") ? 0 : 1);
    const token = `@${label} `;
    setText(text.slice(0, start) + token + text.slice(caret));
    const path = candidate.path ?? threadReference(candidate.thread!);
    setMentioned((current) => [
      ...current.filter((entry) => entry.label !== label),
      { label, path, kind: candidate.kind },
    ]);
    placeCaret.current = start + token.length;
    setCaret(start + token.length);
    setHighlight(0);
  };
  // The caret goes after an inserted mention, once the editor has the text.
  useLayoutEffect(() => {
    const pos = placeCaret.current;
    if (pos === null || !editor.current) return;
    placeCaret.current = null;
    editor.current.setSelection(pos);
  });

  /** Handles the menu's keys; true when it used the key. */
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (!at || event.nativeEvent.isComposing) return false;
    const move = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
    if (move && options.length) {
      event.preventDefault();
      setHighlight((active + move + options.length) % options.length);
      return true;
    }
    if (
      options.length &&
      ((event.key === "Enter" && !event.metaKey && !event.ctrlKey && !event.shiftKey) ||
        event.key === "Tab")
    ) {
      event.preventDefault();
      choose(options[active]!);
      return true;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setClosed(anchor);
      return true;
    }
    return false;
  };

  const menu: ReactNode = at && (
    <div
      id={`${id}-menu`}
      role="listbox"
      aria-label="Mentions"
      {...stylex.props(ui.popup, mentionPopover.over, styles.menu)}
    >
      {options.length === 0 && (
        <span {...stylex.props(styles.empty)}>
          {query
            ? "Nothing matches. Files, vault notes, and threads can be named."
            : "Type to name a file, a vault note, or a thread."}
        </span>
      )}
      {sections.map((section) => (
        <div key={section.kind} role="group" aria-label={GROUPS[section.kind]}>
          <span aria-hidden="true" {...stylex.props(styles.group)}>
            {GROUPS[section.kind]}
          </span>
          {section.items.map((candidate) => {
            const index = options.indexOf(candidate);
            return (
              <button
                type="button"
                key={candidate.id}
                id={`${id}-${index}`}
                role="option"
                tabIndex={-1}
                aria-selected={index === active}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setHighlight(index)}
                onClick={() => choose(candidate)}
                {...stylex.props(styles.option, index === active && styles.active)}
              >
                <Icon name={ICONS[candidate.kind]} size={13} />
                <span {...stylex.props(styles.name)}>{candidate.name}</span>
                <span {...stylex.props(styles.detail)}>{candidate.detail}</span>
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );

  return {
    open,
    menu,
    editorRef: editor,
    mentioned,
    ariaControls: at ? `${id}-menu` : undefined,
    ariaActiveDescendant: at && options.length ? `${id}-${active}` : undefined,
    onSelect: (pos: number) => setCaret(pos),
    /** Call with each change of the text and its caret. */
    changed(pos: number) {
      setCaret(pos);
      setHighlight(0);
    },
    onKeyDown,
    /** The message with each mention's absolute path. */
    expand: (message: string) => expandMentions(message, mentioned),
    /** The chosen mentions whose paths Med has. */
    known: mentioned.filter(
      (entry): entry is Mention & { path: string } => typeof entry.path === "string",
    ),
    clear: () => setMentioned([]),
  };
}

const styles = stylex.create({
  menu: { display: "flex", flexDirection: "column", gap: 1, scrollbarWidth: "thin" },
  group: {
    display: "block",
    paddingTop: 6,
    paddingBottom: 2,
    paddingInline: 6,
    color: tokens.faint,
    fontFamily: tokens.ui,
    fontSize: 11,
    fontWeight: 500,
  },
  option: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    width: "100%",
    paddingBlock: 4,
    paddingInline: 6,
    borderWidth: 0,
    borderRadius: `calc(6px * ${tokens.round})`,
    backgroundColor: "transparent",
    color: tokens.muted,
    fontFamily: tokens.ui,
    fontSize: 12,
    textAlign: "start",
    cursor: "pointer",
  },
  active: { backgroundColor: tokens.fill, color: tokens.text },
  name: {
    flexShrink: 0,
    maxWidth: "60%",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    color: tokens.text,
  },
  detail: { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  empty: {
    paddingBlock: 4,
    paddingInline: 6,
    color: tokens.faint,
    fontFamily: tokens.ui,
    fontSize: 12,
  },
});

/**
 * A message box's list, such as @ mentions or / commands: a popover over what
 * is above the box, as wide as the box, so the box keeps its size.
 */
export const mentionPopover = stylex.create({
  over: {
    position: "absolute",
    insetInline: 0,
    bottom: "calc(100% + 6px)",
    maxHeight: "min(280px, 40vh)",
    overflowY: "auto",
  },
});
