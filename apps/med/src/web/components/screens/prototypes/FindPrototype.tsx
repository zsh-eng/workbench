import * as stylex from "@stylexjs/stylex";
import { MultiFileDiff } from "@pierre/diffs/react";
import { defaultKeymap } from "@codemirror/commands";
import { SearchQuery, setSearchQuery } from "@codemirror/search";
import { EditorState } from "@codemirror/state";
import {
  Decoration,
  drawSelection,
  EditorView,
  highlightActiveLine,
  keymap,
  lineNumbers,
  MatchDecorator,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import { vim } from "@replit/codemirror-vim";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { codeColors, highlightRules } from "../../../code-colors";
import { searchRanges } from "../../../data/search-highlights";
import { HIGHLIGHTER } from "../../../pierre-theme";
import { tokens } from "../../../theme.stylex";
import { useTheme, type Theme } from "../../../themes";
import { diffSurfaceStyle } from "../../diff-surface";
import { FindBar, NO_FIND_OPTIONS, type FindCount } from "../../FindBar";
import { findInFile, findPanelTheme, jump, openFind } from "../../editor-find";
import { SessionSidebar } from "../../shell/SessionSidebar";
import { FILTERS_PATH, FILTERS_TS, FILTERS_TS_BEFORE, sidebarThreads } from "./fixtures";

// Prototype: one find bar for the diff and for files. ⌘F in the diff, ⌘F in
// a file, and Vim's / and ? there open the same bar, with Match case, Whole
// word, Regular expression, and a count of the matches. In a file it is
// CodeMirror's own search panel, drawn by FindBar (editor-find.tsx), so
// CodeMirror still finds and highlights; Vim's n and N go on from the bar's
// query. The app's diff and editor now have it; this screen shows both.

/** The diff's find: Med's highlights over Pierre's rows, as in the review. */
function DiffWithFind() {
  const { active } = useTheme();
  const [query, setQuery] = useState("filters");
  const [options, setOptions] = useState(NO_FIND_OPTIONS);
  const [index, setIndex] = useState(1);
  const [hosts] = useState(() => new Set<HTMLElement>());
  const [rendered, setRendered] = useState(0);
  const diffOptions = useMemo(
    () => ({
      theme: active.pierreTheme,
      themeType: active.appearance,
      preferredHighlighter: HIGHLIGHTER,
      diffStyle: "unified" as const,
      diffIndicators: "bars" as const,
      lineDiffType: "word-alt" as const,
      disableFileHeader: true,
      unsafeCSS: highlightRules(active, {
        match: "med-diff-find",
        current: "med-diff-find-current",
      }),
      onPostRender(node: HTMLElement, _instance: unknown, phase: string) {
        if (phase === "unmount") hosts.delete(node);
        else hosts.add(node);
        setRendered((count) => count + 1);
      },
    }),
    [active, hosts],
  );
  // Pierre's rows, read again after each render of the diff.
  const ranges = useMemo(() => {
    void rendered;
    const found: Range[] = [];
    for (const host of hosts)
      if (host.shadowRoot)
        found.push(
          ...searchRanges(host.shadowRoot.querySelectorAll("[data-line]"), query, options),
        );
    return found;
  }, [hosts, query, options, rendered]);
  const current = ranges.length ? Math.min(index, ranges.length - 1) : -1;
  useEffect(() => {
    if (typeof Highlight === "undefined") return;
    CSS.highlights.set("med-diff-find", new Highlight(...ranges));
    const hit = ranges[current];
    if (hit) {
      const highlight = new Highlight(hit);
      highlight.priority = 1;
      CSS.highlights.set("med-diff-find-current", highlight);
    } else CSS.highlights.delete("med-diff-find-current");
    return () => {
      CSS.highlights.delete("med-diff-find");
      CSS.highlights.delete("med-diff-find-current");
    };
  }, [ranges, current]);
  const go = (step: number) =>
    setIndex((value) => (ranges.length ? (value + step + ranges.length) % ranges.length : 0));
  const count: FindCount | null = query ? { current: current + 1, total: ranges.length } : null;
  return (
    <div {...stylex.props(styles.findArea)}>
      <FindBar
        query={query}
        onQuery={(value) => {
          setQuery(value);
          setIndex(0);
        }}
        options={options}
        onOptions={setOptions}
        count={count}
        onNext={() => go(1)}
        onPrevious={() => go(-1)}
        onClose={() => setQuery("")}
        placeholder="Find in diffs"
      />
      <div {...stylex.props(styles.scroll)}>
        <MultiFileDiff
          oldFile={{ name: FILTERS_PATH, contents: FILTERS_TS_BEFORE, cacheKey: "find-before" }}
          newFile={{ name: FILTERS_PATH, contents: FILTERS_TS, cacheKey: "find-after" }}
          options={diffOptions}
          style={diffSurfaceStyle as never}
        />
      </div>
    </div>
  );
}

/** A few token colors, so that the prototype's file reads as code. */
function tokenColors(theme: Theme) {
  const rule = (pattern: RegExp, color: string) => {
    const mark = Decoration.mark({ attributes: { style: `color: ${color}` } });
    const decorator = new MatchDecorator({ regexp: pattern, decoration: () => mark });
    return ViewPlugin.fromClass(
      class {
        decorations: DecorationSet;
        constructor(view: EditorView) {
          this.decorations = decorator.createDeco(view);
        }
        update(update: ViewUpdate) {
          this.decorations = decorator.updateDeco(update, this.decorations);
        }
      },
      { decorations: (plugin) => plugin.decorations },
    );
  };
  const { palette } = theme;
  return [
    rule(
      /\b(?:import|type|from|export|function|const|return|if|false|true|undefined)\b/g,
      palette.accent,
    ),
    rule(/"[^"\n]*"|`[^`\n]*`/g, palette.green),
    rule(/\/\*\*.*\*\/|\/\/.*$/gm, palette.faint),
    rule(/\b(?:Trail|TrailFilters|boolean|string)\b/g, palette.warning),
  ];
}

/** A file in CodeMirror with Vim, opened on Vim's / with a query typed. */
function FileWithFind() {
  const { active } = useTheme();
  const parent = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const code = codeColors(active);
    const view = new EditorView({
      parent: parent.current!,
      state: EditorState.create({
        doc: FILTERS_TS,
        extensions: [
          vim(),
          lineNumbers(),
          drawSelection(),
          highlightActiveLine(),
          findInFile(),
          keymap.of(defaultKeymap),
          tokenColors(active),
          EditorView.theme(
            {
              "&": {
                height: "100%",
                backgroundColor: active.palette.canvas,
                color: active.palette.text,
                fontSize: "12px",
              },
              ".cm-scroller": {
                fontFamily: '"Paper Mono", "SFMono-Regular", Consolas, monospace',
                lineHeight: "20px",
              },
              ".cm-content": { padding: "16px 0" },
              ".cm-gutters": {
                backgroundColor: active.palette.canvas,
                color: active.palette.muted,
                border: "none",
              },
              ".cm-activeLine": { backgroundColor: code.lineHighlight },
              ".cm-activeLineGutter": {
                backgroundColor: "transparent",
                color: active.palette.text,
              },
              ".cm-searchMatch": { backgroundColor: code.match },
              ".cm-searchMatch.cm-searchMatch-selected": {
                backgroundColor: code.matchCurrent,
                ...(code.matchText ? { color: code.matchText } : {}),
                textDecoration: `underline 2px ${code.matchBorder}`,
                textUnderlineOffset: "3px",
              },
              ...findPanelTheme,
              ".cm-fat-cursor": { background: active.palette.accent },
              "&.cm-focused": { outline: "none" },
            },
            { dark: active.appearance === "dark" },
          ),
        ],
      }),
    });
    // The screen: Vim's / with "label" typed, on its second match.
    view.dispatch({ selection: { anchor: view.state.doc.line(20).from } });
    openFind(view, "/");
    view.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: "label" })) });
    jump(view, false);
    const input = parent.current!.querySelector<HTMLInputElement>(".med-find-panel input");
    requestAnimationFrame(() => input?.focus());
    return () => view.destroy();
  }, [active]);
  return <div ref={parent} {...stylex.props(styles.editor)} />;
}

function Window({ children }: { children: ReactNode }) {
  const threads = useMemo(() => sidebarThreads(false), []);
  return (
    <div {...stylex.props(styles.window)}>
      <aside {...stylex.props(styles.sidebar)}>
        <SessionSidebar
          threads={threads}
          current="search"
          read={{
            isUnread: () => false,
            setUnread() {},
            isSubagentUnread: () => false,
            seeSubagent() {},
          }}
          loaded
          newThread={false}
          renaming={null}
          onOpen={() => {}}
          onNewThread={() => {}}
          onHide={() => {}}
          onSettings={() => {}}
          onArchive={() => {}}
          onDelete={() => {}}
          onPrefetch={() => {}}
          onRenaming={() => {}}
          onRename={() => {}}
          onPin={() => {}}
        />
      </aside>
      {children}
    </div>
  );
}

function Header({ title, detail }: { title: string; detail: string }) {
  return (
    <header {...stylex.props(styles.header)}>
      <span {...stylex.props(styles.title)}>{title}</span>
      <span {...stylex.props(styles.detail)}>{detail}</span>
    </header>
  );
}

/** ⌘F in the diff, beside Vim's / in the same file: one bar. */
export function FindEverywhere() {
  return (
    <Window>
      <section {...stylex.props(styles.pane)} aria-label="Changes">
        <Header title="Changes" detail="⌘F · src/search/filters.ts" />
        <DiffWithFind />
      </section>
      <section {...stylex.props(styles.pane)} aria-label="filters.ts">
        <Header title="filters.ts" detail="Vim · / to find, n and N for the next" />
        <div {...stylex.props(styles.findArea)}>
          <FileWithFind />
        </div>
      </section>
    </Window>
  );
}

const styles = stylex.create({
  window: {
    display: "flex",
    width: "100vw",
    height: "100vh",
    gap: 6,
    padding: 6,
    paddingInlineStart: 0,
    boxSizing: "border-box",
    backgroundColor: tokens.panel,
    color: tokens.text,
    fontFamily: tokens.ui,
    overflow: "hidden",
  },
  sidebar: { width: 260, flexShrink: 0, overflow: "hidden" },
  pane: {
    display: "flex",
    flexDirection: "column",
    flex: "1",
    minWidth: 0,
    overflow: "hidden",
    borderRadius: tokens.frame,
    backgroundColor: tokens.canvas,
    boxShadow: `0 0 0 1px ${tokens.line}`,
  },
  header: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    height: tokens.bar,
    flexShrink: 0,
    paddingInline: 14,
    boxShadow: `inset 0 -1px ${tokens.line}`,
  },
  title: { fontSize: 13, fontWeight: 600 },
  detail: { color: tokens.faint, fontSize: 12 },
  findArea: { position: "relative", flex: "1", minHeight: 0, display: "flex" },
  scroll: { flex: "1", overflow: "auto", paddingTop: 52 },
  editor: { flex: "1", minWidth: 0, height: "100%" },
});
