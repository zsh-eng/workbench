import type { MarkdownModel, PreviewPosition } from "./model";

/** Map fractional source lines to rendered positions, then retarget one animation. */
export function connectPreviewScroll(pane: HTMLElement, model: MarkdownModel) {
  let anchors: { line: number; top: number }[] = [];
  let dirty = true;
  let frame = 0;
  let target = pane.scrollTop;
  let animatedTop = target;
  let previousTime = 0;
  let headingTarget: Element | null = null;
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  const cancel = () => {
    cancelAnimationFrame(frame);
    frame = 0;
    previousTime = 0;
  };
  const animate = (time: number) => {
    const delta = Math.min(64, previousTime ? time - previousTime : 1000 / 60);
    previousTime = time;
    const remaining = target - animatedTop;
    if (Math.abs(remaining) <= 1 || reducedMotion.matches) {
      pane.scrollTop = target;
      frame = 0;
      previousTime = 0;
      return;
    }
    // Frame-rate independent easing. New input changes the target, not the clock.
    animatedTop += remaining * (1 - Math.exp(-delta / 45));
    pane.scrollTop = animatedTop;
    frame = requestAnimationFrame(animate);
  };
  const move = (top: number) => {
    target = Math.max(0, Math.min(top, pane.scrollHeight - pane.clientHeight));
    if (reducedMotion.matches) {
      cancel();
      pane.scrollTop = target;
    } else if (!frame) {
      animatedTop = pane.scrollTop;
      frame = requestAnimationFrame(animate);
    }
  };
  const rebuild = () => {
    const origin = pane.getBoundingClientRect().top - pane.scrollTop;
    const blocks = [...pane.querySelectorAll<HTMLElement>("[data-block-line]")];
    anchors = blocks.map((block) => ({
      line: Number(block.dataset.blockLine),
      top: block.getBoundingClientRect().top - origin,
    }));
    const last = blocks.at(-1);
    if (last)
      anchors.push({
        line: Number(last.dataset.blockEnd) + 1,
        top: last.getBoundingClientRect().bottom - origin,
      });
    dirty = false;
  };
  const follow = ({ line, reason }: PreviewPosition) => {
    headingTarget = null;
    if (dirty) rebuild();
    if (!anchors.length) return;
    let low = 0,
      high = anchors.length - 1;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (anchors[middle].line <= line) low = middle;
      else high = middle - 1;
    }
    const start = anchors[low],
      end = anchors[Math.min(low + 1, anchors.length - 1)];
    const ratio = Math.max(
      0,
      Math.min(1, (line - start.line) / Math.max(1, end.line - start.line)),
    );
    const y = start.top + (end.top - start.top) * ratio;
    pane.dataset.followLine = String(line);
    const visible = y - pane.scrollTop;
    if (reason === "scroll" || visible < 48 || visible > pane.clientHeight * 0.8)
      move(y - (reason === "scroll" ? 40 : pane.clientHeight * 0.3));
  };
  const headingTop = (element: Element) =>
    pane.scrollTop + element.getBoundingClientRect().top - pane.getBoundingClientRect().top - 40;
  const stopForInput = () => {
    headingTarget = null;
    cancel();
  };
  const resize = new ResizeObserver(() => {
    dirty = true;
    // Lazy images and diagrams may change height after a contents jump.
    if (headingTarget?.isConnected) move(headingTop(headingTarget));
  });
  resize.observe(pane);
  const article = pane.querySelector("article");
  if (article) resize.observe(article);
  for (const event of ["wheel", "touchstart", "pointerdown", "keydown"])
    pane.addEventListener(event, stopForInput, { passive: true });
  const unsubscribe = model.subscribePosition(follow);
  follow(model.getPosition());
  return {
    reveal(element: Element) {
      // Never use scrollIntoView: it also scrolls the enclosing app/browser page.
      cancel();
      headingTarget = element;
      move(headingTop(element));
    },
    dispose() {
      cancel();
      resize.disconnect();
      unsubscribe();
      for (const event of ["wheel", "touchstart", "pointerdown", "keydown"])
        pane.removeEventListener(event, stopForInput);
    },
  };
}
