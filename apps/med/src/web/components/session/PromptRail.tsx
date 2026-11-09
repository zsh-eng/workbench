import * as stylex from "@stylexjs/stylex";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from "react";
import { tokens, ui } from "../../theme.stylex";

/** A prompt of the session, as the rail lists it. */
export interface RailPrompt {
  /** Its unit in the thread, or, for a prompt on a page not yet loaded, its
   * entry in the session's index. */
  key: string;
  at: number;
  text: string;
}

/** A dash's room on the rail, while the rail has room for each. */
const DASH = 8;

const when = (at: number) => {
  const date = new Date(at);
  return date.toDateString() === new Date().toDateString()
    ? date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : date.toLocaleDateString([], { day: "numeric", month: "short" });
};

/**
 * The session's prompts at the thread's right edge, a dash each, the first at
 * the top, so the thread's shape shows at a glance: how many turns, and which
 * one the view reads (its dash is longer and darker). The pointer on the rail,
 * or the focus in it, lists the prompts with their times; a click goes to
 * one, also on a page that has not loaded yet. From the thread, `{` and `}`
 * step through the prompts, as `[` and `]` step through every message.
 */
export function PromptRail({
  prompts,
  current,
  onGo,
  bottom = 0,
  scroller,
}: {
  prompts: readonly RailPrompt[];
  /** The prompt of the turn that the view reads. */
  current?: string;
  onGo(key: string): void;
  /** What covers the thread's foot, such as the message box: the rail centres above it. */
  bottom?: number;
  /** The thread's scroller, whose scroll bar, where it takes room, the rail keeps clear of. */
  scroller?: RefObject<HTMLElement | null>;
}) {
  const [open, setOpen] = useState(false);
  // Measured here, so a change renders the rail alone, not the thread.
  const [gutter, setGutter] = useState(0);
  useLayoutEffect(() => {
    const node = scroller?.current;
    if (!node) return;
    const measure = () => setGutter(node.offsetWidth - node.clientWidth);
    measure();
    const resize = new ResizeObserver(measure);
    resize.observe(node);
    return () => resize.disconnect();
  }, [scroller]);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  // The list opens on the prompt that the view reads; from a key, with the
  // focus on it.
  const focusOnOpen = useRef(false);
  const show = () => {
    clearTimeout(timer.current);
    setOpen(true);
  };
  const hide = (delay: number) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpen(false), delay);
  };
  useEffect(() => () => clearTimeout(timer.current), []);
  useLayoutEffect(() => {
    if (!open) return;
    const at =
      list.current?.querySelector<HTMLElement>("[aria-current='true']") ??
      list.current?.querySelector<HTMLElement>("button:last-of-type");
    at?.scrollIntoView({ block: "center" });
    if (focusOnOpen.current) at?.focus();
    focusOnOpen.current = false;
  }, [open]);
  if (prompts.length < 2) return null;

  const go = (key: string) => {
    setOpen(false);
    onGo(key);
  };
  const keydown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape" && open) {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      trigger.current?.focus();
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    if (!open) {
      focusOnOpen.current = true;
      setOpen(true);
      return;
    }
    const items = [...(list.current?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    const step = event.key === "ArrowDown" ? 1 : -1;
    items[at < 0 ? 0 : Math.max(0, Math.min(items.length - 1, at + step))]?.focus();
  };

  return (
    // The pointer on the rail or its list keeps the list open; the keys open
    // it from the rail's button, and step through it, in the nav.
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <nav
      aria-label="Prompts"
      onPointerEnter={show}
      onPointerLeave={() => hide(180)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) hide(0);
      }}
      onKeyDown={keydown}
      {...stylex.props(styles.place, styles.edge(bottom, gutter))}
    >
      <button
        ref={trigger}
        type="button"
        aria-label={`${prompts.length} prompts`}
        aria-expanded={open}
        // The pointer that clicks has opened it already; a click keeps it open.
        onClick={show}
        {...stylex.props(styles.rail, styles.tall(prompts.length * DASH))}
      >
        {prompts.map((prompt) => (
          <span key={prompt.key} {...stylex.props(styles.slot)}>
            <span
              data-current={prompt.key === current || undefined}
              {...stylex.props(styles.dash, prompt.key === current && styles.dashOn)}
            />
          </span>
        ))}
      </button>
      {open && (
        <div ref={list} {...stylex.props(ui.popup, styles.list)}>
          {prompts.map((prompt) => (
            <button
              key={prompt.key}
              type="button"
              aria-current={prompt.key === current ? "true" : undefined}
              onClick={() => go(prompt.key)}
              {...stylex.props(ui.menuItem, styles.item, prompt.key === current && styles.itemOn)}
            >
              <span {...stylex.props(styles.text)}>{prompt.text || "An image"}</span>
              <time dateTime={new Date(prompt.at).toISOString()} {...stylex.props(styles.time)}>
                {when(prompt.at)}
              </time>
            </button>
          ))}
        </div>
      )}
    </nav>
  );
}

const styles = stylex.create({
  // A strip at the thread's right edge, above what covers its foot; only the
  // rail and its list take the pointer, so the thread scrolls under the rest.
  place: {
    position: "absolute",
    top: 0,
    zIndex: 3,
    display: "flex",
    alignItems: "center",
    pointerEvents: "none",
  },
  rail: {
    display: "flex",
    flexDirection: "column",
    width: 22,
    minHeight: 24,
    padding: 0,
    paddingBlock: 4,
    borderWidth: 0,
    borderRadius: `calc(6px * ${tokens.round})`,
    backgroundColor: "transparent",
    cursor: "default",
    pointerEvents: "auto",
    outlineOffset: -2,
  },
  slot: {
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 0,
    minHeight: 0,
    paddingInlineEnd: 4,
  },
  dash: {
    width: 8,
    height: 2,
    maxHeight: "100%",
    borderRadius: 1,
    backgroundColor: tokens.lineStrong,
    transitionProperty: "width, background-color",
    transitionDuration: "120ms",
  },
  dashOn: { width: 13, backgroundColor: tokens.muted },
  edge: (bottom: number, gutter: number) => ({ bottom, right: gutter + 2 }),
  // Room for each dash, up to half the thread's height; past that they crowd.
  tall: (height: number) => ({ height: `min(${height}px, 50%)` }),
  list: {
    position: "absolute",
    top: "50%",
    right: "100%",
    width: 320,
    maxWidth: "calc(100vw - 64px)",
    maxHeight: "min(420px, 70vh)",
    transform: "translateY(-50%)",
    pointerEvents: "auto",
  },
  item: {
    width: "100%",
    gap: 12,
    borderWidth: 0,
    backgroundColor: { default: "transparent", ":hover": tokens.fillStrong },
    color: tokens.muted,
    fontFamily: tokens.ui,
    textAlign: "start",
    outlineOffset: -2,
  },
  itemOn: { color: tokens.text },
  text: {
    flex: "1",
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  time: {
    flexShrink: 0,
    color: tokens.faint,
    fontSize: 11,
    fontVariantNumeric: "tabular-nums",
  },
});
