// Install tabs (WAI-ARIA tabs with automatic activation), copy buttons, the
// live windows, and the parts of the review on narrow screens.

const tabs = [...document.querySelectorAll('[role="tab"]')];

function select(tab, focus) {
  for (const other of tabs) {
    const selected = other === tab;
    other.setAttribute("aria-selected", String(selected));
    other.tabIndex = selected ? 0 : -1;
    document.getElementById(other.getAttribute("aria-controls")).hidden =
      !selected;
  }
  if (focus) tab.focus();
}

const keys = { ArrowLeft: -1, ArrowRight: 1 };
for (const tab of tabs) {
  tab.addEventListener("click", () => select(tab, false));
  tab.addEventListener("keydown", (event) => {
    const index = tabs.indexOf(tab);
    let next;
    if (event.key in keys) next = index + keys[event.key];
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = tabs.length - 1;
    else return;
    event.preventDefault();
    select(tabs[(next + tabs.length) % tabs.length], true);
  });
}

const status = document.getElementById("copy-status");

for (const button of document.querySelectorAll("[data-copy]")) {
  const label = button.querySelector(".copy-label");
  const idle = label.textContent;
  const source = document.getElementById(button.dataset.copy);
  let timer;
  button.addEventListener("click", async () => {
    clearTimeout(timer);
    try {
      await navigator.clipboard.writeText(source.textContent);
      label.textContent = "Copied";
      button.dataset.state = "done";
      status.textContent = button.dataset.done;
    } catch {
      // Select the text, so the reader can copy it with the keyboard.
      getSelection().selectAllChildren(source);
      status.textContent = "Copy is not available. The text is selected.";
    }
    timer = setTimeout(() => {
      label.textContent = idle;
      delete button.dataset.state;
      // An empty region lets the next copy announce again.
      status.textContent = "";
    }, 2000);
  });
}

// Wide screens run Med itself in every window: the web app, answered from a
// recorded review (apps/med/src/web/demo.ts), in the scene that the window
// names. Windows load after the page, as they come near the view, one at a
// time and when the browser is idle, and each shows over its screenshot when
// its scene is ready. A scene that plays starts when most of its window is in
// view, and a button under each window starts its scene again. The demo
// sends the wheel here until the visitor clicks in it, so the page scrolls.
const wide = matchMedia("(min-width: 960px)");
const saveData = navigator.connection?.saveData;
const screens = [...document.querySelectorAll("[data-demo]")];

if (wide.matches && !saveData && screens.length) {
  const frames = new Map();
  const queue = [];
  let current;

  const idle = (run) =>
    window.requestIdleCallback
      ? requestIdleCallback(run, { timeout: 2000 })
      : setTimeout(run, 200);
  // The next window is the one nearest the middle of the view.
  const distance = (screen) => {
    const box = screen.getBoundingClientRect();
    return Math.abs(box.top + box.height / 2 - innerHeight / 2);
  };
  const next = () => {
    if (current || !queue.length) return;
    queue.sort((a, b) => distance(a) - distance(b));
    const screen = queue.shift();
    // A scene that never gets ready keeps its screenshot.
    current = { screen, timer: setTimeout(() => done(screen), 20_000) };
    idle(() => open(screen));
  };
  const open = (screen, again = false) => {
    const image = screen.querySelector("img");
    const frame = document.createElement("iframe");
    frame.className = "live";
    // A window that starts again keeps its scene until the new one is ready.
    if (again) frame.dataset.next = "";
    frame.title = "Med, on a recorded review";
    frame.tabIndex = -1;
    // The screenshot's description stands in for the demo.
    frame.setAttribute("aria-hidden", "true");
    frame.style.width = `${image.getAttribute("width")}px`;
    frame.style.height = `${image.getAttribute("height")}px`;
    frame.src = screen.dataset.demo;
    screen.append(frame);
    frames.set(frame.contentWindow, screen);
  };
  const done = (screen) => {
    if (current?.screen !== screen) return;
    clearTimeout(current.timer);
    current = undefined;
    next();
  };

  // The newest frame, while a window starts again.
  const tell = (screen, message) =>
    screen
      .querySelector(".live:last-of-type")
      ?.contentWindow?.postMessage(
        { type: "med-demo", ...message },
        location.origin,
      );
  // A demo out of view stops its motion, which costs work on every frame.
  const seen = new IntersectionObserver((entries) => {
    for (const { target, isIntersecting } of entries)
      tell(target, { visible: isIntersecting });
  });
  // A scene plays once most of its window is in view, or most of the view
  // for a window taller than that.
  const most = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (
          entry.intersectionRatio < 0.6 &&
          entry.intersectionRect.height < innerHeight * 0.6
        )
          continue;
        most.unobserve(entry.target);
        tell(entry.target, { play: true });
      }
    },
    { threshold: [0, 0.2, 0.4, 0.6, 0.8, 1] },
  );

  // The hero's button is in its title bar; a feature's is under its window.
  const addRestart = (screen) => {
    const plays = /scene=(review|commit)\b/.test(screen.dataset.demo);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "restart";
    button.innerHTML = `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8a4.5 4.5 0 1 0 1.32-3.18M3.5 2.75v2.5H6" /></svg>${plays ? "Replay" : "Reset"}`;
    button.addEventListener("click", () => {
      if (screen.querySelector(".live[data-next]")) return;
      open(screen, true);
    });
    const bar = screen.closest(".window")?.querySelector(".titlebar");
    if (bar) bar.append(button);
    else screen.closest(".window").after(button);
  };

  addEventListener("message", (event) => {
    const screen = frames.get(event.source);
    if (!screen || event.data?.type !== "med-demo") return;
    if (event.data.state === "ready") {
      // The new scene fades in over the old one, which then goes.
      for (const frame of screen.querySelectorAll(".live")) {
        if (frame.contentWindow === event.source) delete frame.dataset.next;
        else {
          frames.delete(frame.contentWindow);
          setTimeout(() => frame.remove(), 300);
        }
      }
      if (screen.dataset.state !== "live") addRestart(screen);
      screen.dataset.state = "live";
      // Observing again tells the new scene whether it is in view.
      for (const observer of [seen, most]) {
        observer.unobserve(screen);
        observer.observe(screen);
      }
      done(screen);
    }
    if (typeof event.data.wheel === "number")
      scrollBy({ top: event.data.wheel, behavior: "instant" });
  });

  const fit = new ResizeObserver((entries) => {
    for (const { target } of entries) {
      const width = Number(target.querySelector("img").getAttribute("width"));
      target.style.setProperty("--scale", String(target.clientWidth / width));
    }
  });
  const near = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        near.unobserve(entry.target);
        queue.push(entry.target);
      }
      next();
    },
    { rootMargin: "100% 0px" },
  );
  const start = () =>
    screens.forEach((screen) => {
      fit.observe(screen);
      near.observe(screen);
    });
  if (document.readyState === "complete") start();
  else addEventListener("load", start, { once: true });
}

// Narrow screens show one part of the review at a time. While the window is in
// view, it moves to the next part every few seconds, until the visitor picks a
// part or swipes the window. With reduced motion it waits for the visitor.
const stops = document.querySelector(".stops");
const view = document.querySelector(".product .screen");

if (stops && view) {
  const parts = [...stops.querySelectorAll("button")];
  const calm = matchMedia("(prefers-reduced-motion: reduce)");
  let current = 0;
  let timer;
  let held = false;

  const show = (index) => {
    current = (index + parts.length) % parts.length;
    view.dataset.stop = String(current);
    parts.forEach((part, i) =>
      part.setAttribute("aria-pressed", String(i === current)),
    );
  };
  const hold = (index) => {
    held = true;
    clearInterval(timer);
    show(index);
  };

  parts.forEach((part, i) => part.addEventListener("click", () => hold(i)));

  // A swipe moves the window, not a copy of the image.
  view.addEventListener("dragstart", (event) => event.preventDefault());
  let swipe;
  view.addEventListener("pointerdown", (event) => {
    swipe = event.clientX;
  });
  view.addEventListener("pointercancel", () => {
    swipe = undefined;
  });
  view.addEventListener("pointerup", (event) => {
    if (swipe === undefined) return;
    const distance = event.clientX - swipe;
    swipe = undefined;
    if (Math.abs(distance) >= 40) hold(current + (distance < 0 ? 1 : -1));
  });

  new IntersectionObserver(
    ([entry]) => {
      clearInterval(timer);
      if (entry.isIntersecting && !held && !calm.matches && !wide.matches)
        timer = setInterval(() => show(current + 1), 4500);
    },
    { threshold: 0.6 },
  ).observe(view);

  stops.hidden = false;
}
