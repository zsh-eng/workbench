// What the budget adds to each page before Med's code runs. It changes no
// behaviour of Med: it observes long tasks, workers, and the slot of the
// workspace that an action shows, and, in the React pass, installs a minimal
// DevTools hook, which turns on the profiling renderer's timeline.

/** Runs in the page (addInitScript). */
export function instrument({ react }) {
  if (window.__perf) return;
  const perf = (window.__perf = {
    longTasks: [],
    workers: { made: 0, ended: 0 },
    commits: 0,
    marks: {},
  });
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) perf.longTasks.push([entry.startTime, entry.duration]);
    }).observe({ type: "longtask", buffered: true });
  } catch {
    /* No long task timing. */
  }
  const Base = window.Worker;
  window.Worker = class extends Base {
    constructor(...args) {
      super(...args);
      perf.workers.made++;
    }
    terminate() {
      perf.workers.ended++;
      return super.terminate();
    }
  };
  if (react)
    window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
      supportsFiber: true,
      renderers: new Map(),
      inject(renderer) {
        this.renderers.set(1, renderer);
        return 1;
      },
      onCommitFiberRoot() {
        perf.commits++;
      },
      onCommitFiberUnmount() {},
      onPostCommitFiberRoot() {},
      onScheduleFiberRoot() {},
      checkDCE() {},
    };

  // The slot of the workspace that an action shows, and its marks, in ms
  // from `start`: COMMIT (the DOM shows it), FRAME (the first animation
  // frame after it), PAINTED (a task after that frame), VISIBLE, SESSION (its
  // session thread shows, with nothing pending), and SHOWN (nothing in the
  // slot is pending).
  const slotOf = (id) => document.querySelector(`[data-workspace-slot*="${CSS.escape(id)}"]`);
  const visible = (slot) =>
    !!slot && slot.style.visibility !== "hidden" && !!slot.firstElementChild?.checkVisibility();
  perf.watch = (id, start) => {
    const marks = (perf.marks = {
      start,
      slotBefore: !!slotOf(id),
      slotsBefore: document.querySelectorAll("[data-workspace-slot]").length,
    });
    const mark = (name) => {
      if (marks[name] === undefined) marks[name] = performance.now() - marks.start;
    };
    perf.observer?.disconnect();
    const observer = (perf.observer = new MutationObserver(() => {
      if (marks.LIST === undefined && document.querySelector("[data-thread]")) mark("LIST");
      if (marks.COMMIT === undefined && visible(slotOf(id))) {
        mark("COMMIT");
        requestAnimationFrame(() => {
          mark("FRAME");
          const channel = new MessageChannel();
          channel.port1.onmessage = () => mark("PAINTED");
          channel.port2.postMessage(0);
        });
      }
    }));
    observer.observe(document, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["style", "data-showing"],
    });
    const began = performance.now();
    const tick = () => {
      const slot = slotOf(id);
      if (visible(slot)) {
        mark("VISIBLE");
        const session = slot.querySelector('[role="log"][aria-label="Session"]');
        const frame = session?.closest("[data-lead]") ?? session?.parentElement;
        if (
          session &&
          frame &&
          !frame.matches("[data-pending]") &&
          !frame.querySelector("[data-pending]")
        )
          mark("SESSION");
        if (!slot.querySelector("[data-pending]")) {
          mark("SHOWN");
          observer.disconnect();
          return;
        }
      }
      if (performance.now() - began < 15_000) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };
  // A keydown starts the watch that the budget armed, at the event's time.
  window.addEventListener(
    "keydown",
    (event) => {
      if (!perf.armed) return;
      const id = perf.armed;
      perf.armed = null;
      performance.mark("perf:keydown");
      perf.keydownEpoch = performance.timeOrigin + event.timeStamp;
      perf.watch(id, event.timeStamp);
    },
    true,
  );
  // A page that opens on /review/<id> watches that thread from its start.
  const opened = /^\/review\/([^/]+)/.exec(location.pathname)?.[1];
  if (opened) perf.watch(opened, 0);
}

/** Runs in the page: the state of the workspace slots. */
export function slotState() {
  const slots = [...document.querySelectorAll("[data-workspace-slot]")];
  return {
    slots: slots.length,
    pending: slots.filter((slot) => slot.querySelector("[data-pending]")).length,
    ready: [...document.querySelectorAll("[data-review-status]")].filter(
      (el) => el.dataset.reviewStatus !== "loading",
    ).length,
    loading: [...document.querySelectorAll("[data-review-status]")].filter(
      (el) => el.dataset.reviewStatus === "loading",
    ).length,
  };
}

/** Runs in the page: the threads in the sidebar's order (⌘1 is first). */
export function sidebarOrder() {
  return [...document.querySelectorAll("[data-thread]")]
    .filter((row) => row.checkVisibility())
    .map((row) => row.getAttribute("data-thread"));
}
