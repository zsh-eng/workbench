import {
  SPRINGS,
  settleTime,
  springDisplacement,
  type Spring,
} from "@workbench/elements/spring";

/**
 * Flies a copy of saved words from where they were into a mark: the words
 * shrink to a dot of the mark's colour along a short arc, and the mark
 * takes over as they land. The copy is decoration: it ignores taps and
 * is hidden from assistive technology. Returns a cancel.
 */
export function flyWords(
  from: { rect: DOMRect; text: string },
  target: HTMLElement,
  onArrive: () => void,
): () => void {
  let ghost: HTMLDivElement | null = null;
  let landing = 0;
  // The island settles its place in this frame; measure the mark after it.
  const frame = requestAnimationFrame(() => {
    const to = target.getBoundingClientRect();
    const box = from.rect;
    if (!to.width || !box.width) return onArrive();
    const height = Math.min(box.height, 56);
    ghost = document.createElement("div");
    ghost.setAttribute("aria-hidden", "true");
    ghost.textContent = from.text.slice(0, 160);
    Object.assign(ghost.style, {
      position: "fixed",
      left: `${box.left}px`,
      top: `${box.top + box.height - height}px`,
      width: `${box.width}px`,
      height: `${height}px`,
      zIndex: "60",
      pointerEvents: "none",
      overflow: "hidden",
      boxSizing: "border-box",
      padding: "6px 10px",
      borderRadius: "16px",
      border: "1px solid var(--border)",
      boxShadow: "0 8px 24px rgb(0 0 0 / 0.12)",
      background: "var(--popover)",
      color: "var(--popover-foreground)",
      fontSize: "15px",
      lineHeight: "1.45",
      whiteSpace: "nowrap",
      textOverflow: "ellipsis",
    } satisfies Partial<CSSStyleDeclaration>);
    document.body.appendChild(ghost);
    const dot = getComputedStyle(target).backgroundColor;
    const {
      backgroundColor: surface,
      color: ink,
      borderTopColor: edge,
    } = getComputedStyle(ghost);
    const dx = to.left + to.width / 2 - (box.left + box.width / 2);
    const dy = to.top + to.height / 2 - (box.top + box.height - height / 2);
    // Across and down on two springs, so the path bends; the down one is
    // quicker, and the words drop before they slide in.
    const across = SPRINGS.sheet;
    const down = SPRINGS.snappy;
    const seconds = settleTime(across, Math.hypot(dx, dy));
    const steps = Math.ceil(seconds * 60);
    const keyframes: Keyframe[] = [];
    for (let i = 0; i <= steps; i++) {
      const t = (i / steps) * seconds;
      const x = 1 - springDisplacement(across, t);
      const y = 1 - springDisplacement(down, t);
      // The words gather into a dot on the quicker spring.
      const size = Math.min(1, 1 - springDisplacement(down, t));
      const w = box.width + (to.width - box.width) * size;
      const h = height + (to.height - height) * size;
      keyframes.push({
        transform: `translate(${dx * x + (box.width - w) / 2}px, ${dy * y + (height - h) / 2}px)`,
        width: `${w}px`,
        height: `${h}px`,
        borderRadius: `${Math.min(16 + size * 12, h / 2)}px`,
        color: size > 0.35 ? "transparent" : ink,
        backgroundColor: size > 0.55 ? dot : surface,
        borderColor: size > 0.55 ? dot : edge,
      });
    }
    const flight = ghost.animate(keyframes, {
      duration: seconds * 1000,
      easing: "linear",
      fill: "forwards",
    });
    // The mark pops as the words reach it.
    landing = window.setTimeout(onArrive, seconds * 1000 * 0.78);
    void flight.finished.then(() => ghost?.remove()).catch(() => {});
  });
  return () => {
    cancelAnimationFrame(frame);
    window.clearTimeout(landing);
    ghost?.remove();
  };
}

/**
 * A pill that grows out of a control, says its word and folds back into
 * it, as the Dynamic Island does around the camera. It opens on a spring
 * with a little give and closes on a quicker one. The pill is decoration:
 * announce the word elsewhere. Returns a cancel.
 */
export function morphPill(
  source: HTMLElement,
  label: string,
  { hold = 900 }: { hold?: number } = {},
): () => void {
  const from = source.getBoundingClientRect();
  const pill = document.createElement("div");
  pill.setAttribute("aria-hidden", "true");
  const words = document.createElement("span");
  words.textContent = label;
  pill.appendChild(words);
  Object.assign(pill.style, {
    position: "fixed",
    zIndex: "60",
    pointerEvents: "none",
    boxSizing: "border-box",
    display: "grid",
    placeItems: "center",
    overflow: "hidden",
    whiteSpace: "nowrap",
    fontSize: "13px",
    fontWeight: "500",
    background: "var(--foreground)",
    color: "var(--background)",
    left: `${from.left}px`,
    top: `${from.top}px`,
    width: `${from.width}px`,
    height: `${from.height}px`,
    borderRadius: `${Math.min(from.width, from.height) / 2}px`,
  } satisfies Partial<CSSStyleDeclaration>);
  document.body.appendChild(pill);
  const width = words.offsetWidth + 30;
  const height = 34;
  const left = Math.min(
    Math.max(8, from.left + from.width / 2 - width / 2),
    innerWidth - width - 8,
  );
  const top = Math.max(8, from.top - height - 10);
  const shape = (p: number, q: number) => ({
    left: `${from.left + (left - from.left) * p}px`,
    top: `${from.top + (top - from.top) * q}px`,
    width: `${from.width + (width - from.width) * p}px`,
    height: `${from.height + (height - from.height) * q}px`,
    borderRadius: `${(from.height + (height - from.height) * q) / 2}px`,
  });
  const frames = (
    spring: Spring,
    there: boolean,
  ): { keyframes: Keyframe[]; duration: number } => {
    const seconds = settleTime(spring, Math.max(width, 60));
    const steps = Math.ceil(seconds * 60);
    const keyframes: Keyframe[] = [];
    for (let i = 0; i <= steps; i++) {
      const p = 1 - springDisplacement(spring, (i / steps) * seconds);
      const k = there ? p : 1 - p;
      keyframes.push(shape(k, Math.min(1, k * 1.15)));
    }
    return { keyframes, duration: seconds * 1000 };
  };
  const open = frames(SPRINGS.morph, true);
  const close = frames(SPRINGS.snappy, false);
  const animations: Animation[] = [];
  animations.push(
    pill.animate(open.keyframes, {
      duration: open.duration,
      easing: "linear",
      fill: "forwards",
    }),
    words.animate([{ opacity: 0, filter: "blur(3px)" }, { opacity: 1 }], {
      duration: 180,
      delay: open.duration * 0.35,
      easing: "ease-out",
      fill: "backwards",
    }),
  );
  const timer = window.setTimeout(() => {
    animations.push(
      words.animate([{ opacity: 1 }, { opacity: 0 }], {
        duration: 120,
        fill: "forwards",
      }),
      pill.animate(close.keyframes, {
        duration: close.duration,
        easing: "linear",
        fill: "forwards",
      }),
      pill.animate([{ opacity: 1 }, { opacity: 0 }], {
        duration: 120,
        delay: close.duration * 0.6,
        fill: "forwards",
      }),
    );
    void animations
      .at(-1)!
      .finished.then(() => pill.remove())
      .catch(() => {});
  }, open.duration + hold);
  return () => {
    window.clearTimeout(timer);
    for (const animation of animations) animation.cancel();
    pill.remove();
  };
}
