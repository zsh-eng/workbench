import * as stylex from "@stylexjs/stylex";
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { tokens } from "../../theme.stylex";

/** A request of the thread: where the reader is, and where they can go. */
export interface ThreadPlace {
  key: string;
  /** The request's first line. */
  text: string;
  go(): void;
}

/** The pill stays this long after the reader stops scrolling. */
const REST_MS = 1000;

/**
 * The place pill: while the reader scrolls a thread, a pill at the top names
 * the request that they are in, the last one whose message has left the
 * view's top, and its place among the thread's requests. It fades a second
 * after the scrolling stops. A click lists the requests, and a choice goes to
 * that one. It is the face of { and }, which step through the same requests.
 *
 * It shows for the reader's own place only: not at the thread's end, which
 * the view follows, and not before the first request has left the view.
 */
export function PlacePill({
  scroller,
  places,
  at,
}: {
  scroller: RefObject<HTMLElement | null>;
  /** Every request of the thread, oldest first. */
  places: readonly ThreadPlace[];
  /** The request that the view is in now, as a place in `places`; -1 for
   * none. Read at each scroll. */
  at(): number;
}) {
  const [shown, setShown] = useState(-1);
  const [visible, setVisible] = useState(false);
  const [open, setOpen] = useState(false);
  const pill = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  // What keeps the pill on screen after the scrolling stops.
  const held = useRef({ open: false, pointer: false, focus: false });
  const latest = useRef(at);
  useLayoutEffect(() => {
    latest.current = at;
    held.current.open = open;
  });

  const rest = () => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const { open, pointer, focus } = held.current;
      if (open || pointer || focus) rest();
      else setVisible(false);
    }, REST_MS);
  };
  const restRef = useRef(rest);
  useLayoutEffect(() => {
    restRef.current = rest;
  });

  useEffect(() => {
    const node = scroller.current;
    if (!node) return;
    const onScroll = () => {
      const index = latest.current();
      if (index < 0) {
        // The first request is in view again, or the view is at the end.
        if (!held.current.open) setVisible(false);
        return;
      }
      setShown(index);
      setVisible(true);
      restRef.current();
    };
    node.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      node.removeEventListener("scroll", onScroll);
      clearTimeout(timer.current);
    };
  }, [scroller]);

  // The open list closes at a press outside it, and at Escape.
  useEffect(() => {
    if (!open) return;
    const pointerdown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (pill.current?.contains(target) || menu.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", pointerdown, true);
    return () => document.removeEventListener("pointerdown", pointerdown, true);
  }, [open]);
  useLayoutEffect(() => {
    if (!open) return;
    menu.current
      ?.querySelector<HTMLElement>('[aria-current="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [open]);

  const place = places[shown];
  if (!place) return null;
  const close = () => {
    setOpen(false);
    restRef.current();
  };
  return (
    <>
      <button
        ref={pill}
        type="button"
        data-place-pill=""
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Request ${shown + 1} of ${places.length}: ${place.text}. Show the thread's requests`}
        aria-hidden={!visible && !open ? true : undefined}
        tabIndex={visible || open ? 0 : -1}
        onClick={() => (open ? close() : setOpen(true))}
        onPointerEnter={() => (held.current.pointer = true)}
        onPointerLeave={() => (held.current.pointer = false)}
        onFocus={() => (held.current.focus = true)}
        onBlur={() => (held.current.focus = false)}
        onKeyDown={(event) => {
          if (event.key === "Escape" && open) {
            event.stopPropagation();
            close();
          } else if (event.key === "ArrowDown" && open) {
            event.preventDefault();
            menu.current?.querySelector<HTMLElement>('[aria-current="true"]')?.focus();
          }
        }}
        {...stylex.props(styles.pill, !visible && !open && styles.faded)}
      >
        <span {...stylex.props(styles.count)}>
          {shown + 1} of {places.length}
        </span>
        <span {...stylex.props(styles.text)}>{place.text}</span>
      </button>
      {open && (
        <div
          ref={menu}
          role="menu"
          tabIndex={-1}
          aria-label="The thread's requests"
          data-place-list=""
          onKeyDown={(event) => {
            const items = [...(menu.current?.querySelectorAll<HTMLElement>("button") ?? [])];
            const from = items.indexOf(document.activeElement as HTMLElement);
            if (event.key === "Escape") {
              event.stopPropagation();
              close();
              pill.current?.focus();
            } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              const next = from + (event.key === "ArrowDown" ? 1 : -1);
              items[Math.max(0, Math.min(items.length - 1, next))]?.focus();
            }
          }}
          {...stylex.props(styles.list)}
        >
          {places.map((entry, index) => (
            <button
              key={entry.key}
              type="button"
              role="menuitem"
              aria-current={index === shown ? "true" : undefined}
              onClick={() => {
                close();
                entry.go();
              }}
              {...stylex.props(styles.item, index === shown && styles.itemCurrent)}
            >
              <span {...stylex.props(styles.number)}>{index + 1}</span>
              <span {...stylex.props(styles.text)}>{entry.text}</span>
            </button>
          ))}
        </div>
      )}
    </>
  );
}

const reduced = "@media (prefers-reduced-motion: reduce)";

const styles = stylex.create({
  // Over the thread's top, in its middle: the Latest button's look, which is
  // at the thread's foot.
  pill: {
    position: "absolute",
    top: 10,
    insetInline: 0,
    marginInline: "auto",
    zIndex: 2,
    display: "flex",
    alignItems: "center",
    gap: 8,
    width: "fit-content",
    maxWidth: "min(460px, calc(100% - 32px))",
    height: 28,
    boxSizing: "border-box",
    paddingInline: 12,
    borderWidth: 0,
    borderRadius: 999,
    backgroundColor: tokens.raised,
    boxShadow: `${tokens.shadow}, inset 0 0 0 1px ${tokens.line}`,
    color: tokens.text,
    fontFamily: tokens.ui,
    fontSize: 12,
    cursor: "default",
    opacity: 1,
    outline: { default: "none", ":focus-visible": `2px solid ${tokens.accentLine}` },
  },
  // It shows at once, and fades out.
  faded: {
    opacity: 0,
    pointerEvents: "none",
    transitionProperty: "opacity",
    transitionDuration: { default: "300ms", [reduced]: "0ms" },
    transitionTimingFunction: tokens.easeOut,
  },
  count: { flex: "none", color: tokens.muted, fontVariantNumeric: "tabular-nums" },
  text: { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  list: {
    position: "absolute",
    top: 44,
    insetInline: 0,
    marginInline: "auto",
    zIndex: 3,
    display: "flex",
    flexDirection: "column",
    boxSizing: "border-box",
    width: "min(420px, calc(100% - 32px))",
    maxHeight: "min(60%, 420px)",
    overflowY: "auto",
    padding: 6,
    borderRadius: `calc(12px * ${tokens.round})`,
    backgroundColor: tokens.raised,
    boxShadow: `${tokens.shadow}, inset 0 0 0 1px ${tokens.line}`,
    fontFamily: tokens.ui,
  },
  item: {
    flex: "none",
    display: "flex",
    alignItems: "center",
    gap: 10,
    minHeight: 32,
    paddingInline: 10,
    borderWidth: 0,
    borderRadius: `calc(7px * ${tokens.round})`,
    backgroundColor: {
      default: "transparent",
      ":hover": tokens.fill,
      ":focus-visible": tokens.fill,
    },
    color: tokens.text,
    fontFamily: tokens.ui,
    fontSize: 13,
    textAlign: "start",
    cursor: "default",
    outline: "none",
  },
  itemCurrent: {
    backgroundColor: {
      default: tokens.fill,
      ":hover": tokens.fillStrong,
      ":focus-visible": tokens.fillStrong,
    },
  },
  number: {
    flex: "none",
    minWidth: 14,
    color: tokens.muted,
    fontVariantNumeric: "tabular-nums",
    textAlign: "end",
  },
});
