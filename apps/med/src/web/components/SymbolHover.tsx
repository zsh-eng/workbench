import * as stylex from "@stylexjs/stylex";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import type { SymbolDefinition, SymbolHover } from "../../shared/symbols";
import { tokens } from "../theme.stylex";

// A card under a name in a file, as an editor's hover: where the name is
// defined, the lines that declare it, and its doc comment. It comes from
// Med's symbol index (Ctags, or the project's index), not from a language
// server, so it finds a name's definitions, not its type.

/** How long the pointer rests on a name before its card shows. */
const SHOW_MS = 450;
/** How long the card stays after the pointer leaves, to reach it. */
const HIDE_MS = 200;
const cache = new Map<string, Promise<SymbolHover>>();
/** Words that a hover skips: they name no definition. */
const keywords = new Set(
  "as async await break case catch class const continue def default do elif else enum export extends false fn for from func function go if impl import in instanceof interface let match mod mut new nil none null package pass private protected pub public return self static struct super switch this throw true try type typeof undefined use var void while with yield".split(
    " ",
  ),
);
/** The name in a token that a hover looks up, if it is one. */
export function hoverName(text: string) {
  const name = text.trim();
  return /^[\p{L}_$][\p{L}\p{N}_$]*$/u.test(name) && !keywords.has(name.toLowerCase())
    ? name
    : undefined;
}

export interface SymbolHoverSource {
  /** Distinguishes one file's version from another's, for the cache. */
  key: string;
  /** `at` is the place that `enter` named, such as a diff's file and side. */
  load(name: string, signal: AbortSignal, at: string): Promise<SymbolHover>;
  /** The part of a place that the definitions depend on, for the cache: a
   * view of several files names the file. */
  scopeOf?(at: string): string;
  /** Opens a definition, as `gd` does. */
  open(definition: SymbolDefinition): void;
}

type Anchor = () => DOMRect | undefined;
interface Shown {
  /** The name's place: the same place keeps its card while the pointer moves. */
  at: string;
  name: string;
  anchor: Anchor;
  hover?: SymbolHover;
}

/** The hover's state for one file view: `enter` and `leave` follow the
 * pointer over names; `show` opens a card at once, as Vim's `K` does. */
export function useSymbolHover(source: SymbolHoverSource | undefined) {
  const [shown, setShown] = useState<Shown | null>(null);
  const pending = useRef<{ at: string; timer: ReturnType<typeof setTimeout> } | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const request = useRef<AbortController>(undefined);
  /** The pointer is on the card. React tells the card first, then the
   * view that the pointer left, so the view's leave waits for the card's. */
  const onCard = useRef(false);
  const latest = useRef(source);
  const current = useRef<Shown | null>(null);
  useLayoutEffect(() => {
    latest.current = source;
    current.current = shown;
  });
  const hide = useCallback(() => {
    clearTimeout(hideTimer.current);
    if (pending.current) clearTimeout(pending.current.timer);
    pending.current = null;
    request.current?.abort();
    onCard.current = false;
    setShown(null);
  }, []);
  const open = useCallback((at: string, name: string, anchor: Anchor) => {
    const from = latest.current;
    if (!from) return;
    request.current?.abort();
    const abort = new AbortController();
    request.current = abort;
    const key = JSON.stringify([from.key, name, from.scopeOf?.(at) ?? ""]);
    let loading = cache.get(key);
    if (!loading) {
      loading = from.load(name, abort.signal, at);
      cache.set(key, loading);
      if (cache.size > 200) cache.delete(cache.keys().next().value!);
      // A failed or stopped read is not kept.
      loading.catch(() => cache.delete(key));
    }
    void loading.then(
      (hover) => {
        if (abort.signal.aborted) return;
        // A name with no definition shows nothing.
        if (!hover.definitions.length) onCard.current = false;
        setShown(hover.definitions.length ? { at, name, anchor, hover } : null);
      },
      () => {},
    );
  }, []);
  const enter = useCallback(
    (at: string, name: string, anchor: Anchor) => {
      clearTimeout(hideTimer.current);
      if (current.current?.at === at || pending.current?.at === at) return;
      if (pending.current) clearTimeout(pending.current.timer);
      pending.current = {
        at,
        timer: setTimeout(() => {
          pending.current = null;
          open(at, name, anchor);
        }, SHOW_MS),
      };
    },
    [open],
  );
  const leave = useCallback(() => {
    if (pending.current) clearTimeout(pending.current.timer);
    pending.current = null;
    if (onCard.current) return;
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      request.current?.abort();
      setShown(null);
    }, HIDE_MS);
  }, []);
  const show = useCallback(
    (name: string, anchor: Anchor) => {
      if (pending.current) clearTimeout(pending.current.timer);
      pending.current = null;
      open(`key:${name}`, name, anchor);
    },
    [open],
  );
  useEffect(() => hide, [hide, source?.key]);
  // Esc, a key, a scroll, or a click elsewhere puts the card away.
  useEffect(() => {
    if (!shown) return;
    const away = (event: Event) => {
      if (event.target instanceof Node && card.current?.contains(event.target)) return;
      hide();
    };
    const keys = (event: KeyboardEvent) => {
      if (event.key === "Escape") event.preventDefault();
      hide();
    };
    addEventListener("keydown", keys, true);
    addEventListener("pointerdown", away, true);
    addEventListener("wheel", away, { capture: true, passive: true });
    return () => {
      removeEventListener("keydown", keys, true);
      removeEventListener("pointerdown", away, true);
      removeEventListener("wheel", away, true);
    };
  }, [shown, hide]);
  const card = useRef<HTMLDivElement>(null);
  const element: ReactNode =
    shown?.hover && source
      ? createPortal(
          <SymbolHoverCard
            ref={card}
            hover={shown.hover}
            anchor={shown.anchor}
            onEnter={() => {
              // The pointer reached the card: what it crossed on the way stays shut.
              onCard.current = true;
              clearTimeout(hideTimer.current);
              if (pending.current) clearTimeout(pending.current.timer);
              pending.current = null;
            }}
            onLeave={() => {
              onCard.current = false;
              leave();
            }}
            onOpen={(definition) => {
              hide();
              source.open(definition);
            }}
          />,
          document.body,
        )
      : null;
  return { enter, leave, show, hide, element };
}

/** A doc comment's text, with its `code` spans set as code. */
function docText(text: string) {
  return text.split(/(`[^`\n]+`)/).map((part, index) =>
    index % 2 ? (
      <code key={index} {...stylex.props(styles.code)}>
        {part.slice(1, -1)}
      </code>
    ) : (
      part
    ),
  );
}

const plural = (count: number, one: string) => `${count} ${one}${count === 1 ? "" : "s"}`;

function SymbolHoverCard({
  ref,
  hover,
  anchor,
  onEnter,
  onLeave,
  onOpen,
}: {
  ref: RefObject<HTMLDivElement | null>;
  hover: SymbolHover;
  anchor: Anchor;
  onEnter(): void;
  onLeave(): void;
  onOpen(definition: SymbolDefinition): void;
}) {
  const [place, setPlace] = useState<{ left: number; top: number } | null>(null);
  // Under the name, or above it when the window has no room below.
  useLayoutEffect(() => {
    const at = anchor();
    const box = ref.current?.getBoundingClientRect();
    if (!at || !box) return;
    const gap = 6;
    const below = at.bottom + gap + box.height <= innerHeight - 8;
    setPlace({
      left: Math.max(8, Math.min(at.left, innerWidth - box.width - 8)),
      top: below ? at.bottom + gap : Math.max(8, at.top - gap - box.height),
    });
  }, [anchor, ref, hover]);
  const total = hover.definitions.length + hover.more;
  return (
    <div
      ref={ref}
      role="tooltip"
      aria-label={`Definition of ${hover.name}`}
      data-symbol-hover=""
      onPointerEnter={onEnter}
      onPointerLeave={onLeave}
      {...stylex.props(styles.card, styles.place(place?.left ?? -9999, place?.top ?? 0))}
    >
      {hover.definitions.map((definition) => (
        <section key={`${definition.path}:${definition.line}`} {...stylex.props(styles.definition)}>
          <header {...stylex.props(styles.header)}>
            <span {...stylex.props(styles.kind)}>{definition.kind}</span>
            {definition.scope && <span {...stylex.props(styles.scope)}>in {definition.scope}</span>}
            <button
              type="button"
              title="Go to definition"
              onClick={() => onOpen(definition)}
              {...stylex.props(styles.location)}
            >
              {definition.path.split("/").pop()}:{definition.line}
            </button>
          </header>
          {definition.signature.length > 0 && (
            <pre {...stylex.props(styles.signature)}>{definition.signature.join("\n")}</pre>
          )}
          {definition.doc.length > 0 && (
            <p {...stylex.props(styles.doc)}>{docText(definition.doc.join("\n"))}</p>
          )}
        </section>
      ))}
      {total > 1 && (
        <p {...stylex.props(styles.more)}>
          {plural(total, "definition")} of {hover.name}
          {hover.more ? `; gd lists them all` : ""}
        </p>
      )}
    </div>
  );
}

const styles = stylex.create({
  card: {
    position: "fixed",
    zIndex: 60,
    boxSizing: "border-box",
    display: "grid",
    gap: 8,
    width: "max-content",
    maxWidth: "min(560px, calc(100vw - 16px))",
    maxHeight: "min(360px, calc(100vh - 16px))",
    overflow: "auto",
    paddingBlock: 8,
    paddingInline: 10,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: tokens.line,
    borderRadius: `calc(8px * ${tokens.round})`,
    backgroundColor: tokens.panel,
    color: tokens.text,
    boxShadow: tokens.shadow,
    fontFamily: tokens.ui,
    fontSize: 12,
    lineHeight: "18px",
  },
  place: (left: number, top: number) => ({ left, top }),
  definition: { display: "grid", gap: 4, minWidth: 0 },
  header: { display: "flex", alignItems: "baseline", gap: 6, color: tokens.muted },
  kind: { fontWeight: 550, color: tokens.text },
  scope: { color: tokens.faint },
  location: {
    marginInlineStart: "auto",
    paddingBlock: 0,
    paddingInline: 0,
    borderWidth: 0,
    backgroundColor: "transparent",
    color: { default: tokens.muted, ":hover": tokens.accent },
    fontFamily: tokens.code,
    fontSize: 11,
    cursor: "pointer",
    textDecoration: { default: "none", ":hover": "underline" },
  },
  signature: {
    margin: 0,
    paddingBlock: 6,
    paddingInline: 8,
    borderRadius: `calc(6px * ${tokens.round})`,
    backgroundColor: tokens.canvas,
    fontFamily: tokens.code,
    fontSize: 12,
    lineHeight: "18px",
    whiteSpace: "pre",
    overflowX: "auto",
  },
  doc: { margin: 0, whiteSpace: "pre-wrap", overflowWrap: "anywhere", color: tokens.text },
  code: { fontFamily: tokens.code, fontSize: 11.5 },
  more: { margin: 0, color: tokens.faint, fontSize: 11 },
});
