// Med's live demo for the website: the real web app, answered from a
// recording of a real session instead of a server. The website's screenshot
// script records it (apps/med-site/scripts/screenshots/capture.ts).
//
// Reads replay the recorded answers. Event streams send what they recorded
// and stay open. Other writes succeed and change nothing. The clock starts at
// the time of the recording, so relative times read as they did then. The
// layout is the recorded one, and the theme follows the visitor's light or
// dark setting.
//
// `?scene=` picks the view, one for each window on the website: the review,
// the brief, a comment, the agent's session, the commit, or the notes vault.

interface Entry {
  method: string;
  /** Path and query. */
  url: string;
  /** A request body, when it was text. */
  body?: string;
  status: number;
  type: string;
  text: string;
  /** The text is base64, for images. */
  base64?: boolean;
}

interface Recording {
  /** The app's path when it was recorded. */
  path: string;
  recordedAt: number;
  /** The app's local settings: panes, workspaces, modes, and drafts. */
  storage: Record<string, string>;
  entries: Entry[];
}

const scene = new URLSearchParams(location.search).get("scene") ?? "review";
// The notes vault has a recording of its own.
const file = scene === "notes" ? "vault.json" : "recording.json";
const recording: Recording = await fetch(new URL(file, document.baseURI)).then((response) =>
  response.json(),
);

// The clock.
const RealDate = Date;
const offset = recording.recordedAt - RealDate.now();
class RecordedDate extends RealDate {
  constructor(...args: ConstructorParameters<DateConstructor> | []) {
    if (args.length) super(...(args as ConstructorParameters<DateConstructor>));
    else super(RealDate.now() + offset);
  }
  static override now() {
    return RealDate.now() + offset;
  }
}
globalThis.Date = RecordedDate as DateConstructor;

// The server. Later answers win: they hold the state at the end.
const key = (method: string, url: string, body?: string) =>
  `${method} ${url}${body === undefined ? "" : ` ${body}`}`;
const answers = new Map<string, Entry>();
for (const entry of recording.entries) {
  const path = entry.url.split("?")[0]!;
  answers.set(key(entry.method, entry.url, entry.body), entry);
  answers.set(key(entry.method, entry.url), entry);
  if (!answers.has(key(entry.method, path, "*"))) answers.set(key(entry.method, path, "*"), entry);
}

const encoder = new TextEncoder();
function respond(entry: Entry): Response {
  const headers = { "content-type": entry.type };
  if (entry.type.startsWith("text/event-stream")) {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(entry.text));
      },
    });
    return new Response(stream, { status: entry.status, headers });
  }
  const body = entry.base64
    ? Uint8Array.from(atob(entry.text), (character) => character.charCodeAt(0))
    : entry.text;
  return new Response(body, { status: entry.status, headers });
}

const realFetch = fetch.bind(globalThis);
globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const request = new Request(input, init);
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/")) return realFetch(input, init);
  const body = typeof init?.body === "string" ? init.body : undefined;
  const path = url.pathname + url.search;
  const entry =
    answers.get(key(request.method, path, body)) ??
    answers.get(key(request.method, path)) ??
    (request.method === "GET" ? undefined : answers.get(key(request.method, url.pathname, "*")));
  if (entry) return respond(entry);
  if (request.method === "GET")
    return Response.json({ error: "This part of Med is not in the demo." }, { status: 404 });
  return Response.json({ ok: true });
};

// The demo runs in a window on a web page. Its scrolling and focus stay
// inside it: a frame that scrolls an element into view, or focuses one, also
// scrolls the page around it.
type Align = "start" | "center" | "end" | "nearest";
const shift = (align: Align, low: number, high: number, min: number, max: number) => {
  if (align === "start") return low - min;
  if (align === "end") return high - max;
  if (align === "center") return (low + high - min - max) / 2;
  if (low < min) return low - min;
  if (high > max) return Math.min(high - max, low - min);
  return 0;
};
const scrolls = (overflow: string) => /auto|scroll|overlay/.test(overflow);
Element.prototype.scrollIntoView = function (options?: boolean | ScrollIntoViewOptions) {
  const settings: ScrollIntoViewOptions =
    typeof options === "object" ? options : { block: options === false ? "end" : "start" };
  const block = (settings.block ?? "start") as Align;
  const inline = (settings.inline ?? "nearest") as Align;
  for (
    let box: Element | null = this.parentElement ?? (this.getRootNode() as ShadowRoot).host ?? null;
    box;
    box = box.parentElement ?? (box.getRootNode() as ShadowRoot).host ?? null
  ) {
    const style = getComputedStyle(box);
    const vertical = scrolls(style.overflowY) && box.scrollHeight > box.clientHeight;
    const horizontal = scrolls(style.overflowX) && box.scrollWidth > box.clientWidth;
    if (!vertical && !horizontal) continue;
    const target = this.getBoundingClientRect();
    const frame = box.getBoundingClientRect();
    if (vertical) box.scrollTop += shift(block, target.top, target.bottom, frame.top, frame.bottom);
    if (horizontal)
      box.scrollLeft += shift(inline, target.left, target.right, frame.left, frame.right);
  }
};
// Focus moves only after the visitor has clicked in the demo, and never
// scrolls the page.
const focus = HTMLElement.prototype.focus;
HTMLElement.prototype.focus = function (options?: FocusOptions) {
  if (document.hasFocus()) focus.call(this, { ...options, preventScroll: true });
};
// In a window, the wheel scrolls the page until the visitor clicks in the
// demo, and again once the pointer leaves it.
if (parent !== window) {
  let engaged = false;
  addEventListener("pointerdown", () => (engaged = true), true);
  addEventListener("mouseout", (event: MouseEvent) => {
    if (!event.relatedTarget) engaged = false;
  });
  addEventListener(
    "wheel",
    (event: WheelEvent) => {
      if (engaged || event.ctrlKey) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const line = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? innerHeight : 1;
      parent.postMessage({ type: "med-demo", wheel: event.deltaY * line }, "*");
    },
    { capture: true, passive: false },
  );
}

const dark = matchMedia("(prefers-color-scheme: dark)");
const theme = () => (dark.matches ? "med-night" : "med-dawn");
try {
  for (const [name, value] of Object.entries(recording.storage)) localStorage.setItem(name, value);
  localStorage.setItem("med:theme:v1", theme());
} catch {
  // Without storage the demo opens with Med's defaults.
}
history.replaceState(null, "", recording.path);
await import("./main");
const { themeController } = await import("./themes");
dark.addEventListener("change", () => themeController.preview(theme()));

// Each scene sets up its view, then the demo tells the website it is ready.
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const all = <T extends Element>(selector: string) => [...document.querySelectorAll<T>(selector)];
const visible = (selector: string) =>
  all<HTMLElement>(selector).find((node) => node.checkVisibility());
const until = async (test: () => unknown) => {
  for (let waited = 0; waited < 15_000 && !test(); waited += 100) await pause(100);
};
/** Sets a toggle button, such as a pane, to shown or hidden. */
const toggle = (label: string, pressed: boolean) => {
  const button = visible(`button[aria-label='${label}']`);
  if (button && (button.getAttribute("aria-pressed") === "true") !== pressed) button.click();
};
const tab = (name: string) =>
  all<HTMLElement>("[role='tab']")
    .find((node) => node.textContent?.trim().startsWith(name))
    ?.click();
const scroller = (node: Element | null) => {
  for (let next = node?.parentElement; next; next = next.parentElement)
    if (scrolls(getComputedStyle(next).overflowY) && next.scrollHeight > next.clientHeight)
      return next;
};
/** Scrolls the Changes stream to its first comment. */
const toComment = async () => {
  await pause(300);
  const stream = scroller(visible("diffs-container") ?? null);
  for (let step = 0; step < 40 && !visible("[data-comment-card]"); step += 1) {
    stream?.scrollBy(0, 400);
    await pause(120);
  }
  visible("[data-comment-card]")?.scrollIntoView({ block: "center" });
};
/** The review, with only the parts that a scene names. */
const review = async (panes: { sidebar: boolean; session: boolean }, name: string) => {
  await until(() => visible("diffs-container"));
  toggle("Toggle sidebar", panes.sidebar);
  toggle("Toggle agent session", panes.session);
  tab(name);
};

const scenes: Record<string, () => Promise<void>> = {
  // All of Med: the diff at its first comment, the agent's session beside it.
  async review() {
    await review({ sidebar: true, session: true }, "Changes");
    await toComment();
  },
  // The agent's brief, with its cited diffs.
  async brief() {
    await review({ sidebar: false, session: false }, "Notes");
    await until(() => visible("diffs-container"));
  },
  async comment() {
    await review({ sidebar: false, session: false }, "Changes");
    await toComment();
  },
  async session() {
    await review({ sidebar: false, session: true }, "Changes");
    await toComment();
  },
  // The Commit tab with the files staged, and the message written: Med keeps
  // the draft that the recording typed.
  async commit() {
    await review({ sidebar: false, session: false }, "Commit");
    const commit = () =>
      all<HTMLButtonElement>("button").find(
        (button) => button.textContent?.includes("Commit…") && !button.disabled,
      );
    await until(commit);
    commit()?.click();
    await until(() => visible("textarea[aria-label='Commit message']"));
  },
  // A note in the vault beside its preview.
  async notes() {
    // The file tree renders in its own shadow root. A click selects the
    // note; a double click keeps it open.
    const note = () =>
      document
        .querySelector("file-tree-container")
        ?.shadowRoot?.querySelector<HTMLElement>("[data-item-path='Search filters.md']");
    await until(note);
    note()?.click();
    note()?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, composed: true }));
    await until(() => visible("button[aria-label='Toggle Markdown preview']"));
    toggle("Toggle Markdown preview", true);
  },
};
await scenes[scene]?.();
await pause(400);
document.documentElement.dataset.demo = "ready";
if (parent !== window) parent.postMessage({ type: "med-demo", state: "ready" }, "*");

// A module, so it can await at the top level.
export {};
