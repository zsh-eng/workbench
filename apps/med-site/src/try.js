// Prototypes in the docs: scripts/docs.ts puts a <figure class="try"
// data-try="name"> after the first paragraph of a section, and this script
// draws it. Each shows a part of Med at low fidelity, so that a reader can try
// what the section describes: Notes, the Commit tab, and a comment's trip to
// the agent. Keys work while a prototype has focus, and each key is also a
// button. Reset starts a prototype again.

const mac = /mac|iphone|ipad/i.test(
  navigator.userAgentData?.platform ?? navigator.platform,
);

/** Children as nodes: nested lists flatten, and null and false drop out. */
const nodes = (children) =>
  children
    .flat(Infinity)
    .filter((child) => child != null && child !== false)
    .map((child) => (child instanceof Node ? child : String(child)));

/** Replaces a node's children. */
const put = (node, ...children) => node.replaceChildren(...nodes(children));

/** An element: h("div", { class: "row", onclick }, ...children). */
function h(tag, props, ...children) {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(props ?? {})) {
    if (value == null || value === false) continue;
    if (name.startsWith("on")) node.addEventListener(name.slice(2), value);
    else if (name === "class") node.className = value;
    else node.setAttribute(name, value === true ? "" : String(value));
  }
  node.append(...nodes(children));
  return node;
}

const glyphs = {
  Mod: mac ? "⌘" : "Ctrl ",
  Shift: "⇧",
  Enter: "↵",
  Escape: "Esc",
  " ": "Space",
};
const keyLabel = (spec) =>
  spec
    .split("+")
    .map((part) => glyphs[part] ?? part)
    .join("");

/** Whether a key event is a key such as "j", "Shift+P", or "Mod+Enter". */
function matches(spec, event) {
  const parts = spec.split("+");
  const key = parts.pop();
  if (
    event.altKey ||
    parts.includes("Mod") !== (event.metaKey || event.ctrlKey)
  )
    return false;
  if (/^\p{L}$/u.test(key))
    return (
      event.key.toLowerCase() === key.toLowerCase() &&
      parts.includes("Shift") === event.shiftKey
    );
  return event.key === key;
}

const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;

/** Diff rows: [kind, line number, text], with kind "+", "-", or " ". */
const diffLines = (rows, extra = () => ({})) =>
  rows.map(([kind, number, text]) =>
    h(
      "div",
      { class: "line", "data-kind": kind, ...extra(number) },
      h("span", {}, number),
      h("span", {}, kind.trim()),
      h("span", {}, text),
    ),
  );

/** A path with its folder in a quieter colour. */
const pathView = (path) => {
  const cut = path.lastIndexOf("/") + 1;
  return [h("span", {}, path.slice(0, cut)), path.slice(cut)];
};

// The Commit tab: stage files, write the message, commit, and push.
function commitTab({ stage, say, focusStage }) {
  const branch = "search-filters";
  const files = [
    {
      path: "src/search/filters.ts",
      mark: "staged",
      diff: [
        [" ", 17, "}"],
        ["+", 18, "/** Labels for the active filters, in the bar's order. */"],
        ["+", 19, "export function describeFilters(filters: TrailFilters) {"],
        ["+", 20, "  const labels: string[] = [];"],
        ["+", 21, '  if (filters.loopOnly) labels.push("Loop");'],
      ],
    },
    {
      path: "src/search/query.ts",
      mark: "partly",
      diff: [
        ["-", 12, 'const terms = input.split(" ");'],
        ["+", 12, "const terms = input.trim().split(/\\s+/);"],
        [" ", 13, "for (const term of terms) {"],
        ["+", 14, '  if (term === "loop") filters.loopOnly = true;'],
      ],
      // What stays after a commit of the staged part.
      rest: [
        [" ", 13, "for (const term of terms) {"],
        ["+", 14, '  if (term === "loop") filters.loopOnly = true;'],
      ],
    },
    {
      path: "src/ui/FilterChips.tsx",
      mark: "none",
      untracked: true,
      diff: [
        ["+", 1, "export function FilterChips({ labels }: Props) {"],
        ["+", 2, "  if (!labels.length) return null;"],
        ["+", 3, '  return <ul className="chips">{labels.map(chip)}</ul>;'],
        ["+", 4, "}"],
      ],
    },
    {
      path: "src/ui/SearchBar.tsx",
      mark: "none",
      diff: [
        [" ", 31, "  <input value={query} onChange={search} />"],
        ["+", 32, "  <FilterChips labels={describeFilters(filters)} />"],
        [" ", 33, "</form>"],
      ],
    },
    {
      path: "tests/search.test.ts",
      mark: "none",
      diff: [
        ["+", 40, 'test("describes the active filters", () => {'],
        [
          "+",
          41,
          '  expect(describeFilters({ loopOnly: true })).toEqual(["Loop"]);',
        ],
        ["+", 42, "});"],
      ],
    },
  ];
  const marks = { staged: "●", partly: "◐", none: "○" };
  const names = {
    staged: "staged",
    partly: "partly staged",
    none: "not staged",
  };
  const hashes = ["3f2c9a1", "8b04d7e", "c61e2f0", "5ad9b38"];
  let at = 0;
  let filter = "";
  let mode = "list"; // or "compose", "ask"
  let commits = 0;
  let unpushed = 0;
  let upstream = false;

  const search = h("input", {
    type: "text",
    placeholder: "Filter files",
    "aria-label": "Filter files to commit",
    oninput: () => {
      filter = search.value.trim().toLowerCase();
      at = 0;
      draw();
    },
  });
  const message = h("textarea", {
    rows: 3,
    placeholder: "Commit message",
    "aria-label": "Commit message",
  });
  const head = h("div", { class: "tc-head" });
  const rows = h("div", { class: "tc-rows", role: "list" });
  const foot = h("div", { class: "tc-foot" });
  const diff = h("div", { class: "tc-diff" });
  stage.append(
    h(
      "div",
      { class: "tc" },
      h(
        "div",
        { class: "tc-list" },
        head,
        h("div", { class: "tc-filter" }, search, h("kbd", {}, "/")),
        rows,
        foot,
      ),
      diff,
    ),
  );

  const shown = () =>
    files.filter((file) => file.path.toLowerCase().includes(filter));
  const staged = () => files.filter((file) => file.mark !== "none");

  function draw() {
    const list = shown();
    at = Math.max(0, Math.min(at, list.length - 1));
    const all = list.length > 0 && list.every((file) => file.mark === "staged");
    put(
      head,
      h("span", {}, branch),
      list.length
        ? h(
            "button",
            { type: "button", onclick: stageAll },
            all ? "Unstage all" : "Stage all",
          )
        : null,
    );
    put(
      rows,
      ...list.map((file, index) =>
        h(
          "div",
          {
            class: "tc-row",
            role: "listitem",
            "aria-current": index === at ? "true" : null,
            onclick: () => {
              at = index;
              draw();
              focusStage();
            },
          },
          h(
            "button",
            {
              type: "button",
              class: "tc-mark",
              tabindex: "-1",
              "data-mark": file.mark,
              "aria-label": `${file.mark === "staged" ? "Unstage" : "Stage"} ${file.path}, ${names[file.mark]}`,
              onclick: (event) => {
                event.stopPropagation();
                at = index;
                toggle();
              },
            },
            marks[file.mark],
          ),
          h("span", { class: "path" }, pathView(file.path)),
          h("span", { class: "tag" }, file.untracked ? "U" : "M"),
        ),
      ),
    );
    if (!list.length)
      rows.append(
        h(
          "div",
          { class: "tc-empty" },
          files.length ? "No file matches." : "Nothing to commit.",
        ),
      );
    const ready = staged().length;
    if (mode === "ask")
      put(
        foot,
        h(
          "div",
          { class: "tc-ask" },
          `${branch} has no upstream. Push to origin and track it?`,
          h(
            "div",
            {},
            h(
              "button",
              { type: "button", class: "chip", onclick: cancelPush },
              "Cancel",
            ),
            h(
              "button",
              { type: "button", class: "act", onclick: push },
              "Push ",
              h("kbd", {}, "↵"),
            ),
          ),
        ),
      );
    else if (mode === "compose") {
      if (!foot.contains(message))
        put(
          foot,
          h(
            "div",
            { class: "tc-compose" },
            message,
            h(
              "div",
              {},
              h(
                "button",
                { type: "button", class: "chip", onclick: keepDraft },
                "Esc",
              ),
              h("button", { type: "button", class: "act", onclick: commit }),
            ),
          ),
        );
      put(
        foot.querySelector(".act"),
        `Commit ${plural(ready, "file")} `,
        h("kbd", {}, keyLabel("Mod+Enter")),
      );
    } else
      put(
        foot,
        h("span", { class: "count" }, `${ready} of ${files.length} staged`),
        h(
          "button",
          { type: "button", class: "chip", onclick: startPush },
          "Push",
        ),
        h(
          "button",
          { type: "button", class: "act", onclick: compose },
          "Commit…",
        ),
      );
    const file = list[at];
    put(
      diff,
      file
        ? [
            h(
              "div",
              { class: "path" },
              pathView(file.path),
              h("span", { class: "tag" }, ` · ${names[file.mark]}`),
            ),
            h("div", { class: "lines" }, diffLines(file.diff)),
          ]
        : h(
            "div",
            { class: "tc-empty" },
            files.length
              ? ""
              : `The working tree is clean. ${plural(commits, "commit")} on ${branch}.`,
          ),
    );
  }

  const move = (step) => {
    at += step;
    draw();
  };
  function toggle() {
    const file = shown()[at];
    if (!file) return;
    file.mark = file.mark === "staged" ? "none" : "staged";
    draw();
    say(`${file.mark === "staged" ? "Staged" : "Unstaged"} ${file.path}.`);
  }
  function stageAll() {
    const list = shown();
    if (!list.length) return;
    const unstage = list.every((file) => file.mark === "staged");
    for (const file of list) file.mark = unstage ? "none" : "staged";
    draw();
    say(`${unstage ? "Unstaged" : "Staged"} ${plural(list.length, "file")}.`);
  }
  function compose() {
    if (mode === "ask") return;
    mode = "compose";
    draw();
    message.focus();
  }
  function keepDraft() {
    mode = "list";
    draw();
    focusStage();
    if (message.value.trim()) say("The message stays as a draft.");
  }
  function commit() {
    const ready = staged();
    if (!ready.length) return say("Stage a file first.");
    if (!message.value.trim()) {
      message.focus();
      return say("Write a message first.");
    }
    const hash = hashes[commits % hashes.length];
    for (const file of ready) {
      if (file.mark === "partly") {
        file.mark = "none";
        file.diff = file.rest;
      } else files.splice(files.indexOf(file), 1);
    }
    commits += 1;
    unpushed += 1;
    message.value = "";
    mode = "list";
    draw();
    focusStage();
    say(`Committed ${plural(ready.length, "file")} as ${hash}.`);
  }
  function startPush() {
    if (!unpushed)
      return say(
        upstream
          ? `origin/${branch} is up to date.`
          : "Nothing to push. Commit first.",
      );
    if (upstream) return push();
    mode = "ask";
    draw();
  }
  function push() {
    const count = unpushed;
    unpushed = 0;
    upstream = true;
    mode = "list";
    draw();
    focusStage();
    say(`Pushed ${plural(count, "commit")} to origin/${branch}.`);
  }
  function cancelPush() {
    mode = "list";
    draw();
    focusStage();
    say("Nothing was pushed.");
  }

  draw();
  return {
    keys: [
      { specs: ["j", "ArrowDown"], label: "Next", run: () => move(1) },
      { specs: ["k", "ArrowUp"], label: "Previous", run: () => move(-1) },
      { specs: [" "], label: "Stage", run: toggle },
      { specs: ["a"], label: "All", run: stageAll },
      { specs: ["/"], label: "Filter", run: () => search.focus() },
      { specs: ["c", "Mod+Enter"], label: "Commit", run: compose },
      { specs: ["Shift+P"], label: "Push", run: startPush },
      {
        specs: ["Enter"],
        hidden: true,
        run: () =>
          shown()[at] && say(`Enter opens ${shown()[at].path} in a tab.`),
      },
    ],
    handle(event) {
      if (event.target === search) {
        if (event.key !== "Enter" && event.key !== "Escape") return false;
        if (event.key === "Escape") {
          search.value = filter = "";
          draw();
        }
        focusStage();
        return true;
      }
      if (event.target === message) {
        if (matches("Mod+Enter", event)) commit();
        else if (event.key === "Escape") keepDraft();
        else return false;
        return true;
      }
      if (mode === "ask" && (event.key === "Enter" || event.key === "Escape")) {
        (event.key === "Enter" ? push : cancelPush)();
        return true;
      }
      return false;
    },
  };
}

// A comment on lines, then Send to the agent, which replies.
function sendComments({ stage, say, focusStage, later }) {
  const agent = "Claude";
  const path = "src/ui/FilterChips.tsx";
  const suggestion = "Announce filter changes to screen readers.";
  const lines = [
    'import { describeFilters } from "../search/filters";',
    "",
    "export function FilterChips({ filters }: Props) {",
    "  const labels = describeFilters(filters);",
    "  if (!labels.length) return null;",
    "  return (",
    '    <ul className="chips">',
    "      {labels.map((label) => <li key={label}>{label}</li>)}",
    "    </ul>",
    "  );",
    "}",
  ];
  let anchor = 0;
  let end = 0;
  let dragging = false;
  let draft = null; // { from, to } while a comment is written
  const comments = []; // { from, to, text, sent }
  let attached = [];
  let working = false;
  const thread = [
    {
      who: "agent",
      parts: [
        "Added filter chips under the search bar ",
        h("span", { class: "cite" }, "FilterChips.tsx:1-11"),
        ". The review is in Med; I wait for your comments there.",
      ],
    },
  ];

  const range = ({ from, to }) => (from === to ? `R${from}` : `R${from}–${to}`);
  const selection = () =>
    anchor && { from: Math.min(anchor, end), to: Math.max(anchor, end) };

  const note = h("textarea", { rows: 2, "aria-label": "Comment" });
  const box = h("textarea", {
    rows: 2,
    placeholder: `Write to ${agent}…`,
    "aria-label": `Message to ${agent}`,
  });
  const bar = h("div", { class: "cm-bar" });
  const slots = [];
  const rows = lines.map((text, index) => {
    const number = index + 1;
    const select = (extend) => {
      if (!extend || !anchor) anchor = number;
      end = number;
      draw();
    };
    slots.push(h("div"));
    return h(
      "div",
      { class: "line cm-line", "data-kind": "+" },
      h(
        "button",
        {
          type: "button",
          "aria-label": `Line ${number}`,
          onpointerdown: (event) => {
            if (event.button) return;
            dragging = true;
            select(event.shiftKey);
          },
          onpointerenter: () => dragging && select(true),
          // A key press on the number, not a pointer.
          onclick: (event) => event.detail === 0 && select(event.shiftKey),
        },
        number,
      ),
      h("span", {}, "+"),
      h("span", {}, text),
    );
  });
  addEventListener("pointerup", () => (dragging = false));
  const diff = h(
    "div",
    { class: "cm-diff lines" },
    h(
      "div",
      { class: "path" },
      pathView(path),
      h("span", { class: "tag" }, " · new file"),
    ),
    rows.map((row, index) => [row, slots[index]]),
  );
  const state = h("span", { class: "cm-state" });
  const list = h("div", { class: "cm-thread", "aria-live": "polite" });
  const attachedView = h("span", { class: "cm-attached" });
  const session = h(
    "div",
    { class: "cm-session", "aria-label": `${agent} session` },
    h("header", {}, agent, state),
    list,
    h(
      "div",
      { class: "cm-compose" },
      box,
      h(
        "div",
        {},
        attachedView,
        h(
          "button",
          { type: "button", class: "act", onclick: send },
          "Send ",
          h("kbd", {}, keyLabel("Mod+Enter")),
        ),
      ),
    ),
  );
  stage.append(bar, h("div", { class: "cm" }, diff, session));

  function card(comment) {
    return h(
      "div",
      { class: "cm-card" },
      h(
        "header",
        {},
        h("strong", {}, "You"),
        h("span", {}, range(comment)),
        comment.sent ? h("span", {}, "· Sent") : null,
        h(
          "button",
          {
            type: "button",
            onclick: () => {
              comments.splice(comments.indexOf(comment), 1);
              attached = attached.filter((entry) => entry !== comment);
              draw();
            },
          },
          "Delete",
        ),
      ),
      comment.text,
    );
  }

  function draw() {
    const picked = selection();
    rows.forEach((row, index) =>
      row.toggleAttribute(
        "data-selected",
        !!picked && index + 1 >= picked.from && index + 1 <= picked.to,
      ),
    );
    slots.forEach((slot, index) => {
      const at = index + 1;
      const here = comments.filter((comment) => comment.to === at).map(card);
      if (draft?.to === at) {
        if (!slot.contains(note))
          put(
            slot,
            ...here,
            h(
              "div",
              { class: "cm-card" },
              h(
                "header",
                {},
                h("strong", {}, "You"),
                h("span", {}, range(draft)),
              ),
              note,
              h(
                "footer",
                {},
                h(
                  "button",
                  { type: "button", class: "chip", onclick: cancel },
                  "Cancel",
                ),
                h(
                  "button",
                  { type: "button", class: "act", onclick: save },
                  "Comment ",
                  h("kbd", {}, keyLabel("Mod+Enter")),
                ),
              ),
            ),
          );
      } else put(slot, ...here);
    });
    const unsent = comments.filter((comment) => !comment.sent).length;
    put(
      bar,
      h("strong", {}, "Search filters"),
      h(
        "button",
        { type: "button", class: "chip", onclick: openSend },
        h("span", {}, `Send to ${agent}`),
        h("span", { class: "count" }, unsent),
      ),
      h(
        "button",
        {
          type: "button",
          class: "chip",
          onclick: copy,
          disabled: !comments.length,
        },
        h("span", {}, "Copy comments"),
        h("span", { class: "count" }, comments.length),
      ),
    );
    state.dataset.state = working ? "working" : "waiting";
    state.textContent = working ? "Working" : "Waiting for you";
    attachedView.textContent = attached.length
      ? `${plural(attached.length, "comment")} attached`
      : "";
    put(
      list,
      ...thread.flatMap((item) =>
        item.who === "agent"
          ? [h("div", {}, item.parts)]
          : [
              h(
                "div",
                { class: "you" },
                item.text,
                item.comments.map((comment) =>
                  h(
                    "blockquote",
                    {},
                    h(
                      "span",
                      { class: "cite" },
                      `FilterChips.tsx ${range(comment)}`,
                    ),
                    " ",
                    comment.text,
                  ),
                ),
              ),
              h("div", { class: "delivery" }, item.delivery),
            ],
      ),
    );
    list.scrollTop = list.scrollHeight;
  }

  function start() {
    const picked = selection();
    if (!picked)
      return say("Select line numbers first: click one, or drag across them.");
    draft = picked;
    if (!note.value) note.value = suggestion;
    draw();
    note.focus();
    note.select();
  }
  function cancel() {
    draft = null;
    draw();
    focusStage();
  }
  function save() {
    const text = note.value.trim();
    if (!draft || !text) return;
    comments.push({ ...draft, text, sent: false });
    draft = null;
    note.value = "";
    anchor = end = 0;
    draw();
    focusStage();
    say(`Saved a comment on ${range(comments.at(-1))}.`);
  }
  function openSend() {
    attached = comments.filter((comment) => !comment.sent);
    draw();
    box.focus();
  }
  function send() {
    if (working)
      return say(`${agent} is working. Your message waits until it is done.`);
    const text = box.value.trim();
    if (!text && !attached.length)
      return say("Write a message, or add a comment first.");
    const item = {
      who: "you",
      text,
      comments: attached,
      delivery: "Waiting for the agent",
    };
    for (const comment of attached) comment.sent = true;
    thread.push(item);
    attached = [];
    box.value = "";
    draw();
    focusStage();
    later(() => {
      item.delivery = "Taken";
      working = true;
      draw();
    }, 700);
    later(() => {
      working = false;
      const asked = item.comments.find((comment) =>
        /aria|screen reader|announce/i.test(comment.text),
      );
      if (asked) {
        lines[6] = '    <ul className="chips" aria-live="polite">';
        rows[6].lastChild.textContent = lines[6];
        rows[6].removeAttribute("data-new");
        void rows[6].offsetWidth;
        rows[6].setAttribute("data-new", "");
      }
      thread.push({
        who: "agent",
        parts: asked
          ? [
              "Added ",
              h("code", {}, 'aria-live="polite"'),
              " to the chip list, so a screen reader reads each change ",
              h("span", { class: "cite" }, "FilterChips.tsx:7"),
              ". The next iteration is ready to review.",
            ]
          : [
              item.comments.length
                ? `Applied your ${plural(item.comments.length, "comment")}. `
                : "Done. ",
              "The next iteration is ready to review.",
            ],
      });
      draw();
      say(`${agent} replied.`);
    }, 2600);
  }
  async function copy() {
    const text = comments
      .map(
        (comment) =>
          `**File**: ${path}\n**Side**: new\n**Lines**: ${comment.from}–${comment.to}\n**Comment**: ${comment.text}`,
      )
      .join("\n\n---\n\n");
    try {
      await navigator.clipboard.writeText(text);
      say(`Copied ${plural(comments.length, "comment")} as Markdown.`);
    } catch {
      say("Copy is not available here.");
    }
  }

  draw();
  return {
    keys: [
      { specs: ["c"], label: "Comment on the selected lines", run: start },
      {
        specs: ["Mod+Enter"],
        label: "Save or send",
        run: () => (draft ? save() : send()),
      },
      {
        specs: ["Escape"],
        label: "Cancel",
        run: () => (draft ? cancel() : ((anchor = end = 0), draw())),
      },
    ],
    handle(event) {
      if (event.target !== note && event.target !== box) return false;
      if (matches("Mod+Enter", event)) (event.target === note ? save : send)();
      else if (event.key === "Escape")
        event.target === note ? cancel() : focusStage();
      else return false;
      return true;
    },
  };
}

// Notes: the agent's brief, an excerpt under each paragraph that cites lines,
// and a key for each iteration.
function notesTab({ stage, say }) {
  const files = {
    "src/search/query.ts": [
      [" ", 11, "export function parseQuery(input: string) {"],
      ["-", 12, 'const terms = input.split(" ");'],
      ["+", 12, "const terms = input.trim().split(/\\s+/);"],
      [" ", 13, "for (const term of terms) {"],
      ["+", 14, '  if (term === "loop") filters.loopOnly = true;'],
    ],
    "src/search/filters.ts": [
      [" ", 17, "}"],
      ["+", 18, "/** Labels for the active filters, in the bar's order. */"],
      ["+", 19, "export function describeFilters(filters: TrailFilters) {"],
      ["+", 20, "  const labels: string[] = [];"],
      ["+", 21, '  if (filters.loopOnly) labels.push("Loop");'],
    ],
    "src/ui/FilterChips.tsx": [
      [" ", 6, "  return ("],
      ["+", 7, '    <ul className="chips" aria-live="polite">'],
      [" ", 8, "      {labels.map(chip)}"],
    ],
    "tests/search.test.ts": [
      ["+", 40, 'test("describes the active filters", () => {'],
      [
        "+",
        41,
        '  expect(describeFilters({ loopOnly: true })).toEqual(["Loop"]);',
      ],
      ["+", 42, "});"],
    ],
  };
  const cite = (path, from, to) => ({ path, from, to });
  const iterations = [
    {
      when: "10:42",
      changed: ["src/search/query.ts", "src/search/filters.ts"],
      notes: [
        {
          text: [
            "The parser reads filters from the search text, so “loop” turns on the loop filter.",
          ],
          cite: cite("src/search/query.ts", 12, 14),
        },
      ],
    },
    {
      when: "11:18",
      changed: [
        "src/search/filters.ts",
        "src/ui/FilterChips.tsx",
        "tests/search.test.ts",
      ],
      notes: [
        { text: ["Search shows the active filters as chips under the bar."] },
        {
          text: [
            h("code", {}, "describeFilters"),
            " lists them in the bar's order.",
          ],
          cite: cite("src/search/filters.ts", 18, 21),
        },
        {
          text: ["The chips announce each change to screen readers."],
          cite: cite("src/ui/FilterChips.tsx", 7, 7),
        },
      ],
    },
  ];
  let shown = iterations.length - 1;
  let focus = -1;
  let view = "notes";
  let opened = null;

  const tabs = ["Notes", "Changes"].map((label) =>
    h(
      "button",
      {
        type: "button",
        role: "tab",
        onclick: () => {
          view = label.toLowerCase();
          draw();
        },
      },
      label,
    ),
  );
  const keys = h("span", {
    class: "nt-keys",
    role: "group",
    "aria-label": "Iterations",
  });
  const body = h("div", { class: "nt-body" });
  stage.append(
    h(
      "div",
      { class: "nt-head" },
      h("div", { role: "tablist", "aria-label": "Review" }, tabs),
      keys,
    ),
    body,
  );

  const label = ({ path, from, to }) =>
    `${path.slice(path.lastIndexOf("/") + 1)}:${from === to ? from : `${from}-${to}`}`;
  const inRange = (target) => (number) =>
    number >= target.from && number <= target.to ? { "data-cited": "" } : {};

  function open(target) {
    opened = target;
    view = "changes";
    draw();
    say(`Opened ${target.path} at line ${target.from} in Changes.`);
  }

  function draw() {
    const iteration = iterations[shown];
    tabs.forEach((tab) =>
      tab.setAttribute(
        "aria-selected",
        String(tab.textContent.toLowerCase() === view),
      ),
    );
    put(
      keys,
      ...iterations.map((entry, index) =>
        h(
          "button",
          {
            type: "button",
            "aria-pressed": String(index === shown),
            "aria-label": `Iteration ${index + 1}`,
            title: `Iteration ${index + 1} · ${entry.when}`,
            onclick: () => {
              shown = index;
              focus = -1;
              view = "notes";
              opened = null;
              draw();
              say(
                `Iteration ${index + 1}${index === iterations.length - 1 ? ", the latest" : ""}.`,
              );
            },
          },
          index + 1,
        ),
      ),
    );
    if (view === "changes") {
      const target = opened ?? cite(iteration.changed[0], 0, -1);
      put(
        body,
        h(
          "div",
          { class: "nt-file" },
          h("div", { class: "path" }, pathView(target.path)),
          h(
            "div",
            { class: "lines" },
            diffLines(files[target.path], inRange(target)),
          ),
        ),
      );
      return;
    }
    const cited = new Set(
      iteration.notes.flatMap((entry) => (entry.cite ? [entry.cite.path] : [])),
    );
    const missing = iteration.changed.filter((path) => !cited.has(path));
    let excerpt = -1;
    put(
      body,
      h(
        "div",
        { class: "nt-cover" },
        h("i", {
          style: `--part: ${(cited.size / iteration.changed.length) * 100}%`,
        }),
        `Cites ${cited.size} of ${plural(iteration.changed.length, "changed file")}`,
      ),
      iteration.notes.map((entry) => {
        if (!entry.cite) return h("p", {}, entry.text);
        excerpt += 1;
        const target = entry.cite;
        return [
          h(
            "p",
            {},
            entry.text,
            " ",
            h(
              "button",
              { type: "button", class: "cite", onclick: () => open(target) },
              label(target),
            ),
          ),
          h(
            "div",
            { class: "nt-excerpt", "data-focus": excerpt === focus },
            h(
              "button",
              { type: "button", class: "path", onclick: () => open(target) },
              pathView(target.path),
              h(
                "span",
                {},
                ` ${target.from === target.to ? target.from : `${target.from}–${target.to}`}`,
              ),
            ),
            h(
              "div",
              { class: "lines" },
              diffLines(
                files[target.path].filter(
                  ([, number]) => number >= target.from && number <= target.to,
                ),
              ),
            ),
          ),
        ];
      }),
      missing.length
        ? h(
            "div",
            { class: "nt-missing" },
            "Not in the notes",
            missing.map((path) => h("span", { class: "path" }, pathView(path))),
          )
        : null,
    );
    const focused = body.querySelector("[data-focus]");
    if (focused) {
      const top = focused.offsetTop - 12;
      if (
        top < body.scrollTop ||
        top + focused.offsetHeight + 24 > body.scrollTop + body.clientHeight
      )
        body.scrollTo({
          top,
          behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
            ? "auto"
            : "smooth",
        });
    }
  }

  function step(by) {
    if (view !== "notes") return say("The excerpts are on the Notes tab.");
    const count = iterations[shown].notes.filter((entry) => entry.cite).length;
    focus = Math.max(0, Math.min(count - 1, focus + by));
    draw();
    const target = iterations[shown].notes.filter((entry) => entry.cite)[focus];
    say(`Excerpt ${focus + 1} of ${count}: ${label(target.cite)}.`);
  }

  draw();
  return {
    keys: [
      { specs: ["]"], label: "Next excerpt", run: () => step(1) },
      { specs: ["["], label: "Previous", run: () => step(-1) },
      {
        specs: ["Enter"],
        label: "Open in Changes",
        run: () => {
          const target = iterations[shown].notes.filter((entry) => entry.cite)[
            focus
          ];
          if (view === "notes" && target) open(target.cite);
          else say("Step to an excerpt first with ].");
        },
      },
    ],
  };
}

const prototypes = {
  notes: { title: "Notes", create: notesTab },
  commit: { title: "Commit tab", create: commitTab },
  comment: { title: "Comment and send", create: sendComments },
};

for (const figure of document.querySelectorAll("figure.try[data-try]")) {
  const kind = prototypes[figure.dataset.try];
  if (!kind) continue;
  const status = h("p", { class: "try-status", role: "status" });
  const stage = h("div", {
    class: "try-stage",
    tabindex: "0",
    "aria-label": `${kind.title}, a prototype. The keys are below it.`,
  });
  const keyRow = h("div", {
    class: "try-keys",
    role: "group",
    "aria-label": "Keys",
  });
  const timers = new Set();
  let current;
  const api = {
    stage,
    say: (text) => (status.textContent = text),
    focusStage: () => stage.focus({ preventScroll: true }),
    later: (run, ms) => {
      const id = setTimeout(() => {
        timers.delete(id);
        run();
      }, ms);
      timers.add(id);
    },
  };

  const run = (key) => {
    if (key.node) {
      key.node.dataset.hit = "";
      clearTimeout(key.timer);
      key.timer = setTimeout(() => delete key.node.dataset.hit, 220);
    }
    key.run();
  };
  const start = () => {
    for (const id of timers) clearTimeout(id);
    timers.clear();
    put(stage);
    status.textContent = "";
    current = kind.create(api);
    put(
      keyRow,
      ...current.keys
        .filter((key) => !key.hidden)
        .map(
          (key) =>
            (key.node = h(
              "button",
              {
                type: "button",
                onclick: () => {
                  run(key);
                  if (
                    !figure.contains(document.activeElement) ||
                    keyRow.contains(document.activeElement)
                  )
                    api.focusStage();
                },
              },
              h("kbd", {}, keyLabel(key.specs[0])),
              key.label,
            )),
        ),
    );
  };

  const reset = h("button", { type: "button", class: "restart" });
  reset.innerHTML =
    '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8a4.5 4.5 0 1 0 1.32-3.18M3.5 2.75v2.5H6" /></svg>Reset';
  reset.addEventListener("click", () => {
    start();
    api.focusStage();
  });
  figure.setAttribute("aria-label", `Try it: ${kind.title}`);
  put(
    figure,
    h(
      "div",
      { class: "try-bar" },
      h("b", {}, "Try it"),
      h("span", { class: "try-title" }, kind.title),
      h(
        "span",
        { class: "try-hint" },
        h("span", { class: "pointer" }, "Click, then use the keys"),
        h("span", { class: "touch" }, "Tap the keys below"),
      ),
      reset,
    ),
    stage,
    keyRow,
    status,
  );
  figure.addEventListener("keydown", (event) => {
    if (event.isComposing || event.defaultPrevented) return;
    if (current.handle?.(event)) return event.preventDefault();
    if (event.target.matches("input, textarea")) return;
    if (
      event.target.closest("button") &&
      (event.key === "Enter" || event.key === " ")
    )
      return;
    const key = current.keys.find((entry) =>
      entry.specs.some((spec) => matches(spec, event)),
    );
    if (!key) return;
    event.preventDefault();
    run(key);
  });
  start();
}
