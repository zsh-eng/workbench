import {
  closeSearchPanel,
  getSearchQuery,
  openSearchPanel,
  search,
  SearchQuery,
  setSearchQuery,
} from "@codemirror/search";
import { EditorView, keymap } from "@codemirror/view";
import { Vim, type CodeMirror } from "@replit/codemirror-vim";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { FindBar, type FindCount, type FindOptions } from "./FindBar";

// Find in a file: ⌘F, and Vim's / and ?, open the find bar that the diff
// has (FindBar). It is CodeMirror's own search panel, drawn by FindBar, so
// CodeMirror keeps the query, finds, and highlights; Vim's n and N go on from
// the bar's query, and * and # find the word under the cursor.

/** How the bar last opened, by ⌘F or by Vim's / or ?, and where the cursor was. */
interface Opened {
  mark?: "/" | "?";
  origin: number;
}

const openedBy = new WeakMap<EditorView, Opened>();
const openedOf = (view: EditorView) => {
  let opened = openedBy.get(view);
  if (!opened) openedBy.set(view, (opened = { origin: view.state.selection.main.head }));
  return opened;
};

/** Where the matches are: the one at the cursor, of how many. */
function countOf(view: EditorView): FindCount | null {
  const query = getSearchQuery(view.state);
  if (!query.search) return null;
  if (!query.valid) return { error: "Not a valid pattern" };
  const { from, to } = view.state.selection.main;
  let total = 0;
  let current = 0;
  const cursor = query.getCursor(view.state);
  for (let next = cursor.next(); !next.done && total < 1000; next = cursor.next()) {
    total++;
    // The cursor on a match's start, as Vim leaves it, or the match selected.
    if (next.value.from === from && (next.value.to === to || from === to)) current = total;
  }
  return { current, total };
}

/**
 * Moves the cursor to the start of the next match, or the previous one, and
 * wraps around. A cursor, not a selection: a selection would put Vim in
 * Visual mode, where n and N are Vim's own.
 */
export function jump(view: EditorView, back: boolean, from = view.state.selection.main.head) {
  const query = getSearchQuery(view.state);
  if (!query.search || !query.valid) return;
  const starts: number[] = [];
  const cursor = query.getCursor(view.state);
  for (let next = cursor.next(); !next.done && starts.length < 1000; next = cursor.next())
    starts.push(next.value.from);
  const target = back
    ? ([...starts].reverse().find((start) => start < from) ?? starts.at(-1))
    : (starts.find((start) => start > from) ?? starts[0]);
  if (target !== undefined)
    view.dispatch({
      selection: { anchor: target },
      effects: EditorView.scrollIntoView(target, { y: "center" }),
    });
}

/** The bar as CodeMirror's search panel. */
function findPanel(view: EditorView) {
  const dom = document.createElement("div");
  dom.className = "med-find-panel";
  const root = createRoot(dom);
  const opened = openedOf(view);
  const render = () => {
    const query = getSearchQuery(view.state);
    const set = (change: Partial<FindOptions> & { search?: string }) =>
      view.dispatch({
        effects: setSearchQuery.of(
          new SearchQuery({
            search: query.search,
            caseSensitive: query.caseSensitive,
            wholeWord: query.wholeWord,
            regexp: query.regexp,
            ...change,
          }),
        ),
      });
    const back = opened.mark === "?";
    const close = () => {
      closeSearchPanel(view);
      view.focus();
    };
    root.render(
      <FindBar
        query={query.search}
        // As you type, the cursor goes to the first match from where the
        // search started, as Vim's incsearch does.
        onQuery={(search) => {
          set({ search });
          jump(view, back, back ? opened.origin + 1 : opened.origin - 1);
        }}
        options={{
          caseSensitive: query.caseSensitive,
          wholeWord: query.wholeWord,
          regexp: query.regexp,
        }}
        onOptions={(options) => set(options)}
        count={countOf(view)}
        onNext={() => jump(view, back)}
        onPrevious={() => jump(view, !back)}
        // In Vim, Enter goes to the match and back to the file.
        onSubmit={
          opened.mark
            ? () => {
                jump(view, back, back ? opened.origin + 1 : opened.origin - 1);
                close();
              }
            : undefined
        }
        onClose={() => {
          // Vim's Escape leaves the cursor where the search started.
          if (opened.mark)
            view.dispatch({
              selection: { anchor: Math.min(opened.origin, view.state.doc.length) },
            });
          close();
        }}
        placeholder="Find in file"
        mark={opened.mark}
      />,
    );
  };
  return {
    dom,
    top: true,
    // CodeMirror focuses the field as the panel mounts, so the bar renders
    // at once; the query shows selected, to type over.
    mount: () => {
      flushSync(render);
      dom.querySelector("input")?.select();
    },
    update: render,
    destroy: () => setTimeout(() => root.unmount()),
  };
}

/** Opens the bar: by ⌘F, or by Vim's / or ? with an empty query, as Vim's prompt starts. */
export function openFind(view: EditorView, mark?: "/" | "?") {
  const opened = openedOf(view);
  opened.mark = mark;
  opened.origin = view.state.selection.main.head;
  closeSearchPanel(view);
  if (mark) {
    const query = getSearchQuery(view.state);
    view.dispatch({
      effects: setSearchQuery.of(
        new SearchQuery({
          search: "",
          caseSensitive: query.caseSensitive,
          wholeWord: query.wholeWord,
          regexp: query.regexp,
        }),
      ),
    });
  }
  openSearchPanel(view);
}

/** The word under the cursor, found whole, forward (*) or back (#), as in Vim. */
function findWord(view: EditorView, back: boolean) {
  const word = view.state.wordAt(view.state.selection.main.head);
  if (!word) return;
  const opened = openedOf(view);
  opened.mark = back ? "?" : "/";
  view.dispatch({
    effects: setSearchQuery.of(
      new SearchQuery({
        search: view.state.sliceDoc(word.from, word.to),
        caseSensitive: true,
        wholeWord: true,
      }),
    ),
  });
  jump(view, back, back ? word.from : word.to - 1);
}

const viewOf = (cm: CodeMirror) => cm.cm6 as EditorView;
let mapped = false;
/** Vim's / and ? open the bar, and n, N, *, and # go on from its query. Vim's
 * keys are global, so they are mapped once. */
function mapVim() {
  if (mapped) return;
  mapped = true;
  Vim.defineAction("medFindForward", (cm) => openFind(viewOf(cm), "/"));
  Vim.defineAction("medFindBack", (cm) => openFind(viewOf(cm), "?"));
  Vim.defineAction("medFindNext", (cm) => {
    const view = viewOf(cm);
    jump(view, openedBy.get(view)?.mark === "?");
  });
  Vim.defineAction("medFindPrevious", (cm) => {
    const view = viewOf(cm);
    jump(view, openedBy.get(view)?.mark !== "?");
  });
  Vim.defineAction("medFindWord", (cm) => findWord(viewOf(cm), false));
  Vim.defineAction("medFindWordBack", (cm) => findWord(viewOf(cm), true));
  for (const [keys, action] of [
    ["/", "medFindForward"],
    ["?", "medFindBack"],
    ["n", "medFindNext"],
    ["N", "medFindPrevious"],
    ["*", "medFindWord"],
    ["#", "medFindWordBack"],
  ] as const)
    Vim.mapCommand(keys, "action", action, {}, { context: "normal" });
}

/** The find bar for an editor: CodeMirror's search with FindBar as its panel,
 * ⌘F to open it, and Vim's search keys. Put it before the search keymap. */
export function findInFile() {
  mapVim();
  return [
    search({ top: true, createPanel: findPanel }),
    keymap.of([{ key: "Mod-f", run: (view) => (openFind(view), true) }]),
  ];
}

/** The editor theme's part for the bar: it floats at the top right, over the
 * code, as in the diff. */
export const findPanelTheme = {
  ".cm-panels": { backgroundColor: "transparent", border: "none" },
  ".cm-panels-top": { borderBottom: "none", height: 0, overflow: "visible" },
};
