import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import type { LibraryItem, Topic } from "../../shared/schema";
import { computeLayout, neighbour, visibleBoxes, type Box, type Density, type GridLayout } from "../lib/layout";
import { coverOf } from "../lib/media";
import { EASE_OUT, reducedMotion, T_MID } from "../lib/motion";
import { Card } from "./Card";

const OVERSCAN = 700;

export interface CardGeometry {
  /** Rect of the full image at card scale; for a top-cropped card it extends below the card. */
  rect: DOMRect;
  /** Visible height of the media inside the card. */
  visibleHeight: number;
  kind: "media" | "text";
  src: string | null;
  radius: number;
}

export interface GridHandle {
  /** Scroll without animation so the post's card is fully in view. */
  reveal(postId: string): boolean;
  focus(postId: string): void;
  geometry(postId: string): CardGeometry | null;
}

interface GridProps {
  items: LibraryItem[];
  ids: Int32Array;
  density: Density;
  favourites: Record<string, string>;
  topicsOf: (itemIndex: number) => Topic[];
  search: string;
  resultsKey: string;
  activePostId: string | null;
  onActiveChange: (postId: string) => void;
  onOpen: (postId: string, card: HTMLElement) => void;
  onToggleFavourite: (postId: string) => void;
  /** Scroll anchor from history, applied on the first layout (reload, Back). */
  initialAnchor?: { postId: string; offset: number } | null;
  onAnchor?: (anchor: { postId: string; offset: number } | null) => void;
}

function sameIds(a: Int32Array | null, b: Int32Array) {
  if (!a || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function sameRange(a: number[], b: number[]) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function headerOffset() {
  return (document.querySelector(".topbar")?.getBoundingClientRect().height ?? 56) + 12;
}

export const Grid = forwardRef<GridHandle, GridProps>(function Grid(props, ref) {
  const { items, ids, density, favourites, topicsOf, search, activePostId, onActiveChange } = props;
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [range, setRange] = useState<number[]>([]);
  const focusPending = useRef(false);

  // Width drives the layout; height is ours.
  useLayoutEffect(() => {
    const el = containerRef.current!;
    setWidth(Math.floor(el.getBoundingClientRect().width));
    const observer = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const layout = useMemo<GridLayout | null>(
    () => (width > 0 ? computeLayout(items, ids, width, density) : null),
    [items, ids, width, density],
  );
  const boxOfPost = useMemo(() => {
    const map = new Map<string, number>();
    layout?.boxes.forEach((b, k) => map.set(items[b.item].postId, k));
    return map;
  }, [layout, items]);

  const layoutRef = useRef(layout);
  const boxOfPostRef = useRef(boxOfPost);
  layoutRef.current = layout;
  boxOfPostRef.current = boxOfPost;

  // ------------------------------------------------------------ viewport

  const gridTop = () => (containerRef.current?.getBoundingClientRect().top ?? 0) + window.scrollY;
  const anchor = useRef<{ postId: string; offset: number } | null>(null);
  const activeRef = useRef(activePostId);
  activeRef.current = activePostId;
  const onAnchorRef = useRef(props.onAnchor);
  onAnchorRef.current = props.onAnchor;

  const measure = useCallback(() => {
    const l = layoutRef.current;
    const el = containerRef.current;
    if (!l || !el) return;
    const top = el.getBoundingClientRect().top;
    const next = visibleBoxes(l, -top - OVERSCAN, -top + window.innerHeight + OVERSCAN);
    setRange((prev) => (sameRange(prev, next) ? prev : next));
    // Remember what the reader is looking at, so relayouts keep it in place.
    const viewTop = -top + headerOffset();
    const active = activeRef.current ? boxOfPostRef.current.get(activeRef.current) : undefined;
    const activeBox = active !== undefined ? l.boxes[active] : undefined;
    let pick: Box | undefined;
    if (activeBox && activeBox.y + activeBox.h > viewTop && activeBox.y < -top + window.innerHeight) pick = activeBox;
    else {
      for (const k of next) {
        const b = l.boxes[k];
        if (b.y + b.h > viewTop && (!pick || b.y < pick.y || (b.y === pick.y && b.x < pick.x))) pick = b;
      }
    }
    anchor.current = pick ? { postId: items[pick.item].postId, offset: pick.y + top } : null;
    onAnchorRef.current?.(anchor.current);
  }, [items]);

  useEffect(() => {
    let frame = 0;
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(() => ((frame = 0), measure()));
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [measure]);

  // ------------------------------------------------------------ relayout

  const previous = useRef<{ layout: GridLayout; ids: Int32Array; key: string; positions: Map<string, { x: number; y: number }> } | null>(null);

  useLayoutEffect(() => {
    if (!layout) return;
    const prev = previous.current;
    const sameResults = prev ? sameIds(prev.ids, ids) : false;
    let animate = false;
    const restore = !prev ? props.initialAnchor : null;
    if (restore) {
      const k = boxOfPost.get(restore.postId);
      if (k !== undefined) window.scrollTo({ top: Math.max(0, gridTop() + layout.boxes[k].y - restore.offset), behavior: "instant" });
    } else if (prev && sameResults && anchor.current) {
      // Same results, new geometry (width, density, refreshed data): keep the anchor still.
      const k = boxOfPost.get(anchor.current.postId);
      if (k !== undefined) {
        const target = gridTop() + layout.boxes[k].y - anchor.current.offset;
        if (Math.abs(target - window.scrollY) > 1) window.scrollTo({ top: target, behavior: "instant" });
      }
    } else if (prev && !sameResults) {
      const top = gridTop() - headerOffset() - 24;
      if (window.scrollY > top + 4) window.scrollTo({ top: Math.max(0, top), behavior: "instant" });
      else animate = !reducedMotion();
    }
    measure();
    const prevPositions = prev?.positions;
    previous.current = { layout, ids, key: props.resultsKey, positions: new Map() };

    if (animate && prevPositions) {
      // Animate only the small set of mounted cards; never the whole library.
      requestAnimationFrame(() => {
        const el = containerRef.current;
        if (!el) return;
        for (const card of el.querySelectorAll<HTMLElement>(".card")) {
          const post = card.dataset.post!;
          const k = boxOfPost.get(post);
          if (k === undefined) continue;
          const box = layout.boxes[k];
          const from = prevPositions.get(post);
          if (from && (from.x !== box.x || from.y !== box.y)) {
            card.animate(
              [{ transform: `translate3d(${from.x}px, ${from.y}px, 0)` }, { transform: `translate3d(${box.x}px, ${box.y}px, 0)` }],
              { duration: T_MID, easing: EASE_OUT },
            );
          } else if (!from) {
            card.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 180, easing: EASE_OUT });
          }
        }
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout]);

  // Record the positions of mounted cards for the next filter animation.
  useEffect(() => {
    const record = previous.current;
    if (!record || !layout) return;
    record.positions.clear();
    for (const k of range) {
      const b = layout.boxes[k];
      if (b) record.positions.set(items[b.item].postId, { x: b.x, y: b.y });
    }
  }, [range, layout, items]);

  // ------------------------------------------------------------ focus

  const scrollToBox = useCallback((k: number, align: "nearest" | "center" = "nearest") => {
    const l = layoutRef.current;
    if (!l) return;
    const b = l.boxes[k];
    const top = gridTop() + b.y;
    const bottom = top + b.h;
    const viewTop = window.scrollY + headerOffset();
    const viewBottom = window.scrollY + window.innerHeight - 16;
    let target: number | null = null;
    if (align === "center" && (top < viewTop || bottom > viewBottom)) {
      target = top - (window.innerHeight - b.h) / 2;
    } else if (top < viewTop) target = top - headerOffset();
    else if (bottom > viewBottom) target = Math.min(top - headerOffset(), bottom - window.innerHeight + 16);
    if (target !== null) window.scrollTo({ top: Math.max(0, target), behavior: "instant" });
  }, []);

  useEffect(() => {
    if (!focusPending.current || !activePostId) return;
    focusPending.current = false;
    const link = containerRef.current?.querySelector<HTMLElement>(`.card[data-post="${activePostId}"] .card-link`);
    link?.focus({ preventScroll: true });
  });

  const moveTo = (k: number) => {
    const l = layoutRef.current;
    if (!l || !l.boxes[k]) return;
    focusPending.current = true;
    scrollToBox(k);
    onActiveChange(items[l.boxes[k].item].postId);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const l = layoutRef.current;
    if (!l || !l.boxes.length) return;
    const current = activePostId ? boxOfPost.get(activePostId) : undefined;
    const from = current ?? range[0] ?? 0;
    const go = (k: number) => {
      event.preventDefault();
      moveTo(k);
    };
    switch (event.key) {
      case "ArrowRight":
        return go(neighbour(l, from, "right"));
      case "ArrowLeft":
        return go(neighbour(l, from, "left"));
      case "ArrowDown":
        return go(neighbour(l, from, "down"));
      case "ArrowUp":
        return go(neighbour(l, from, "up"));
      case "Home":
        return go(0);
      case "End":
        return go(l.boxes.length - 1);
      case "PageDown":
      case "PageUp": {
        const b = l.boxes[from];
        const targetY = b.y + (event.key === "PageDown" ? 1 : -1) * window.innerHeight * 0.8;
        let best = from;
        let distance = Infinity;
        l.boxes.forEach((c, k) => {
          if (c.x !== b.x) return;
          const d = Math.abs(c.y - targetY);
          if (d < distance) {
            best = k;
            distance = d;
          }
        });
        return go(best);
      }
      case " ": {
        if (!(event.target as HTMLElement).classList.contains("card-link")) return;
        event.preventDefault();
        const card = (event.target as HTMLElement).closest<HTMLElement>(".card");
        if (card) props.onOpen(card.dataset.post!, card);
        return;
      }
      case "f":
      case "F": {
        if (!(event.target as HTMLElement).classList.contains("card-link")) return;
        event.preventDefault();
        const post = (event.target as HTMLElement).closest<HTMLElement>(".card")?.dataset.post;
        if (post) props.onToggleFavourite(post);
        return;
      }
    }
  };

  useImperativeHandle(
    ref,
    () => ({
      reveal(postId) {
        const k = boxOfPostRef.current.get(postId);
        if (k === undefined) return false;
        scrollToBox(k, "center");
        measure();
        return true;
      },
      focus(postId) {
        const k = boxOfPostRef.current.get(postId);
        if (k === undefined) return;
        focusPending.current = true;
        onActiveChange(postId);
        const link = containerRef.current?.querySelector<HTMLElement>(`.card[data-post="${postId}"] .card-link`);
        if (link) {
          focusPending.current = false;
          link.focus({ preventScroll: true });
        }
      },
      geometry(postId) {
        const card = containerRef.current?.querySelector<HTMLElement>(`.card[data-post="${postId}"]`);
        const l = layoutRef.current;
        const k = boxOfPostRef.current.get(postId);
        if (!card || !l || k === undefined) return null;
        const box = l.boxes[k];
        const item = items[box.item];
        const media = card.querySelector<HTMLElement>(".card-media");
        if (!media) {
          const text = card.querySelector<HTMLElement>(".card-text") ?? card;
          const rect = text.getBoundingClientRect();
          return { rect, visibleHeight: rect.height, kind: "text", src: null, radius: 6 };
        }
        const r = media.getBoundingClientRect();
        if (r.bottom < 0 || r.top > window.innerHeight) return null;
        const aspect = coverOf(item)?.aspect ?? r.width / r.height;
        const img = media.querySelector("img");
        let rect = r;
        if (box.fit === "top") rect = new DOMRect(r.left, r.top, r.width, r.width / aspect);
        if (box.fit === "contain") {
          const h = r.width / aspect;
          rect = new DOMRect(r.left, r.top + (r.height - h) / 2, r.width, h);
        }
        return {
          rect,
          visibleHeight: Math.min(rect.height, r.height),
          kind: "media",
          src: img?.currentSrc || null,
          radius: 6,
        };
      },
    }),
    [items, measure, onActiveChange, scrollToBox],
  );

  // ------------------------------------------------------------ render

  const rendered = useMemo(() => {
    if (!layout) return [];
    // The range can still describe the previous layout for one render; drop stale indices.
    const set = new Set(range.filter((k) => k < layout.boxes.length));
    const active = activePostId ? boxOfPost.get(activePostId) : undefined;
    if (active !== undefined) set.add(active); // keep the focused card mounted
    return [...set].sort((a, b) => a - b);
  }, [range, layout, activePostId, boxOfPost]);

  const firstBox = layout?.boxes[rendered[0] ?? 0];
  const tabStop = activePostId && boxOfPost.has(activePostId) ? activePostId : firstBox ? items[firstBox.item].postId : null;

  return (
    <div
      ref={containerRef}
      className={`grid grid--${density}`}
      role="list"
      aria-label="Saved posts"
      style={{ height: layout?.height ?? 0 }}
      onKeyDown={onKeyDown}
    >
      {layout
        ? rendered.map((k) => {
            const box = layout.boxes[k];
            const item = items[box.item];
            return (
              <Card
                key={item.id}
                item={item}
                box={box}
                width={layout.metrics.colWidth}
                density={density}
                captioned={layout.metrics.captioned}
                favourite={favourites[item.postId] !== undefined}
                topics={topicsOf(box.item)}
                tabIndex={item.postId === tabStop ? 0 : -1}
                position={k + 1}
                setSize={layout.boxes.length}
                search={search}
                onOpen={props.onOpen}
                onFocusCard={onActiveChange}
                onToggleFavourite={props.onToggleFavourite}
              />
            );
          })
        : null}
    </div>
  );
});
