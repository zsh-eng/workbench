import {
  useCallback,
  useId,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ClipboardEvent,
  type RefObject,
} from "react";
import type { CodeViewHandle } from "@pierre/diffs/react";
import VimSearchWorker from "./vim-search.worker?worker";
import { createVisualSelection } from "./visual-selection";
import { createActiveSearchHighlight } from "./active-search-highlight";
import { MAX_VIM_MATCHES, VimNavigation, type VisualMode } from "./vim-navigation";

type SearchResult = { identity: string; message: string; query: string; wholeWord: boolean };
type SearchSession = {
  line: number;
  column: number;
  desired: number;
  scrollTop: number;
  query: string;
  direction: 1 | -1;
  matches: number[];
  result: SearchResult;
};
export type FileNavigationCommand = (key: string, control?: boolean) => void;
/** Imperative cursor painting keeps movement out of React and Pierre tokenization. */
export function useFileVim({
  text,
  identity,
  enabled,
  viewer,
  line,
  column,
  onNavigationReady,
  onDefinition,
  onPosition,
}: {
  text: string;
  identity: string;
  enabled: boolean;
  viewer: RefObject<CodeViewHandle<undefined, undefined> | null>;
  line?: number;
  column?: number;
  onNavigationReady?: (command: FileNavigationCommand | null) => void;
  onDefinition?: (name: string) => void;
  onPosition?: (line: number, reason: "cursor") => void;
}) {
  const positionListener = useRef(onPosition);
  useLayoutEffect(() => {
    positionListener.current = onPosition;
  }, [onPosition]);
  const lastPosition = useRef(-1);
  const model = useMemo(() => new VimNavigation(text, identity), [text, identity]);
  const commandFile = useMemo(() => ({ identity: model.identity }), [model]);
  const visualName = `med-visual-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const visualPainter = useMemo(() => createVisualSelection(visualName), [visualName]);
  const activeSearchName = `${visualName}-search-current`;
  const activeSearch = useMemo(
    () => createActiveSearchHighlight(activeSearchName),
    [activeSearchName],
  );
  const [visualState, setVisualState] = useState<{
    model: VimNavigation;
    mode: VisualMode | null;
  } | null>(null);
  const lastVisual = useRef<typeof visualState>(null);
  const visualMode = enabled && visualState?.model === model ? visualState.mode : null;
  const [copyState, setCopyState] = useState<{
    file: typeof commandFile;
    message: string;
    error: boolean;
  } | null>(null);
  const latestModel = useRef(model);
  const copyRequest = useRef(0);
  const cancelCopies = useCallback(() => {
    ++copyRequest.current;
  }, []);
  useLayoutEffect(() => {
    latestModel.current = model;
    ++copyRequest.current;
    if (!enabled) model.clearVisual();
    return () => {
      cancelCopies();
      visualPainter.dispose();
    };
  }, [model, enabled, visualPainter, cancelCopies]);
  const pane = useRef<HTMLDivElement>(null);
  const caret = useRef<HTMLSpanElement>(null);
  const host = useRef<HTMLElement | null>(null);
  const active = useRef(false);
  const paintPending = useRef(false);
  const currentPaint = useRef<() => void>(() => {});
  const worker = useRef<Worker | null>(null);
  const request = useRef(0);
  const restoreFocus = useRef(false);
  const restoreAlignment = useRef<"center" | "nearest">("nearest");
  const commandScroll = useRef(0);
  const restoreScroll = useRef<number | null>(null);
  const session = useRef<SearchSession | null>(null);
  const [highlightsVisible, setHighlightsVisible] = useState(true);
  const showSearch = useRef(true);
  useLayoutEffect(() => {
    showSearch.current = highlightsVisible;
    currentPaint.current();
    return () => activeSearch.dispose();
  }, [highlightsVisible, activeSearch, model]);
  const [searchState, setSearch] = useState<{
    identity: string;
    direction: 1 | -1;
    query: string;
  } | null>(null);
  const search = searchState?.identity === model.identity ? searchState : null;
  const [commandState, setCommandState] = useState<{
    file: typeof commandFile;
    value: string;
    error: string;
  } | null>(null);
  const commandLine = commandState?.file === commandFile ? commandState : null;
  const [result, setResult] = useState<SearchResult>({
    identity: "",
    message: "",
    query: "",
    wholeWord: false,
  });
  const message = result.identity === identity ? result.message : "";
  const highlightQuery = highlightsVisible && result.identity === identity ? result.query : "";
  const paint = useCallback(
    (align?: "start" | "center" | "end" | "nearest") => {
      const element = caret.current,
        container = pane.current;
      if (!element || !container) return;
      const mode = enabled ? (model.visual?.mode ?? null) : null;
      container.dataset.vimMode = mode ?? "normal";
      if (lastVisual.current?.model !== model || lastVisual.current.mode !== mode) {
        lastVisual.current = { model, mode };
        setVisualState(lastVisual.current);
      }
      visualPainter.update(host.current, model, enabled);
      activeSearch.update(host.current, model, showSearch.current);
      if (lastPosition.current !== model.line) {
        lastPosition.current = model.line;
        positionListener.current?.(model.line + 1, "cursor");
      }
      container.dataset.vimLine = String(model.line + 1);
      container.dataset.vimColumn = String(model.column + 1);
      if (!align && !active.current) {
        element.hidden = true;
        return;
      }
      const instance = viewer.current?.getInstance();
      const mounted = host.current?.shadowRoot?.querySelector<HTMLElement>(
        `[data-line="${model.line + 1}"]`,
      );
      const visibleBounds = instance?.getContainerElement()?.getBoundingClientRect();
      const lineBounds = mounted?.getBoundingClientRect();
      const needsScroll =
        !lineBounds ||
        !visibleBounds ||
        lineBounds.top < visibleBounds.top ||
        lineBounds.bottom > visibleBounds.bottom;
      if (align && instance && (align !== "nearest" || needsScroll)) {
        const lineHeight = lineBounds?.height || 20;
        const edgeSpace = Math.min(
          4 * lineHeight,
          Math.max(0, ((visibleBounds?.height ?? container.clientHeight) - lineHeight) / 2),
        );
        instance.scrollTo({
          type: "line",
          id: identity,
          lineNumber: model.line + 1,
          align,
          offset: align === "start" || align === "end" ? edgeSpace : 0,
          behavior: "instant",
        });
        // Let Pierre coalesce pending navigation before its next render. Initial
        // file positioning still uses a synchronous flush in FullFileView.
        element.hidden = true;
        // An already-aligned or clamped scroll can leave the DOM unchanged.
        // Repaint even when Pierre has no new rows to report.
        if (align !== "nearest") requestAnimationFrame(() => currentPaint.current());
        return;
      }
      container.dataset.vimLine = String(model.line + 1);
      container.dataset.vimColumn = String(model.column + 1);
      const row = host.current?.shadowRoot?.querySelector<HTMLElement>(
        `[data-line="${model.line + 1}"]`,
      );
      if (!active.current || !row) {
        element.hidden = true;
        return;
      }
      const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
      const range = document.createRange();
      let offset = 0,
        first: Text | null = null,
        last: Text | null = null;
      const end = model.column + Math.max(1, model.characterLength);
      const emptyLine = model.characterLength === 0;
      while (walker.nextNode()) {
        const node = walker.currentNode as Text;
        if (!first && offset + node.length > model.column) {
          first = node;
          range.setStart(node, model.column - offset);
        }
        if (first && offset + node.length >= end) {
          last = node;
          range.setEnd(node, end - offset);
          break;
        }
        offset += node.length;
      }
      const characterBounds = first && last && !emptyLine;
      const cursorBounds = () => {
        if (characterBounds) return range.getBoundingClientRect();
        const bounds = row.getBoundingClientRect();
        // Empty rows share the longest line's width. Scroll to their start,
        // not the far edge of that row; the caret itself still occupies 1ch.
        return new DOMRect(bounds.left, bounds.top, 0, bounds.height);
      };
      let bounds = cursorBounds();
      // Pierre owns a horizontal scroller inside the shadow root. Keep the actual
      // character visible, rather than scrolling the full (potentially wide) row.
      if (align) {
        for (let parent = row.parentElement; parent; parent = parent.parentElement) {
          if (
            parent.scrollWidth <= parent.clientWidth ||
            !/auto|scroll/.test(getComputedStyle(parent).overflowX)
          )
            continue;
          const rect = parent.getBoundingClientRect();
          if (bounds.right > rect.right - 12) parent.scrollLeft += bounds.right - rect.right + 12;
          else if (bounds.left < rect.left + 50) parent.scrollLeft -= rect.left + 50 - bounds.left;
          bounds = cursorBounds();
          break;
        }
      }
      const box = container.getBoundingClientRect();
      const viewport = instance?.getContainerElement()?.getBoundingClientRect() ?? box;
      if (bounds.bottom <= viewport.top || bounds.top >= viewport.bottom) {
        element.hidden = true;
        return;
      }
      // Animate cursor moves only. Scrolling and initial placement stay exact.
      const left = `${bounds.left - box.left}px`;
      const top = `${bounds.top - box.top}px`;
      if (align || element.style.left !== left || element.style.top !== top)
        element.dataset.animate = String(!!align && !element.hidden);
      element.style.font = getComputedStyle(row).font;
      element.style.left = left;
      element.style.top = top;
      element.style.width = characterBounds ? `${Math.max(2, bounds.width)}px` : "1ch";
      element.style.height = `${bounds.height || 20}px`;
      element.dataset.vimLine = String(model.line + 1);
      element.dataset.vimColumn = String(model.column + 1);
      element.hidden = false;
    },
    [identity, model, viewer, enabled, visualPainter, activeSearch],
  );
  useLayoutEffect(() => {
    currentPaint.current = paint;
  }, [paint]);
  const runSearch = useCallback(
    (query: string, direction: 1 | -1, wholeWord = false, origin?: SearchSession) => {
      if (!query) return;
      setHighlightsVisible(true);
      setResult({ identity, query, wholeWord, message: "" });
      const jumpOrigin = origin ?? { line: model.line, column: model.column };
      const id = ++request.current;
      if (!worker.current) {
        worker.current = new VimSearchWorker();
        worker.current.postMessage({ text, id: -1, query: "", wholeWord: false });
      }
      worker.current.onmessage = (event: MessageEvent<{ id: number; matches: Uint32Array }>) => {
        if (event.data.id !== request.current) return;
        // Every incremental query starts at the position where / or ? opened.
        // Refining the query must not advance from the previous preview match.
        if (origin) model.jump(origin.line, origin.column);
        model.setSearch(query, direction);
        model.setMatches(event.data.matches);
        // Incremental previews do not replace the jump-back location. An
        // accepted search may complete after its input has already closed.
        if (!origin || session.current !== origin) model.rememberJump(jumpOrigin);
        setResult({
          identity,
          query,
          wholeWord,
          message: model.matches.length
            ? `${model.matches.length === MAX_VIM_MATCHES ? "First " : ""}${model.matches.length.toLocaleString()} matches · ${query}`
            : `No matches · ${query}`,
        });
        paint("nearest");
      };
      worker.current.postMessage({ id, query, wholeWord });
    },
    [identity, model, paint, text],
  );
  const beginSearch = useCallback(
    (direction: 1 | -1) => {
      setCommandState(null);
      ++request.current;
      session.current = {
        line: model.line,
        column: model.column,
        desired: model.desired,
        scrollTop: viewer.current?.getInstance()?.getScrollTop() ?? 0,
        query: model.query,
        direction: model.direction,
        matches: model.matches,
        result,
      };
      setSearch({ identity: model.identity, direction, query: "" });
    },
    [model, result, viewer],
  );
  const restoreSearchOrigin = () => {
    const origin = session.current;
    if (!origin) return;
    model.restoreSearch(origin);
    setResult(origin.result);
    viewer.current
      ?.getInstance()
      ?.scrollTo({ type: "position", position: origin.scrollTop, behavior: "instant" });
    paint();
  };
  const beginLineCommand = useCallback(() => {
    ++request.current;
    session.current = null;
    setSearch(null);
    commandScroll.current = viewer.current?.getInstance()?.getScrollTop() ?? 0;
    setCommandState({ file: commandFile, value: "", error: "" });
  }, [commandFile, viewer]);
  const copySelection = useCallback(async () => {
    const range = model.visualRange;
    if (!range) return;
    const selection = model.visual;
    const id = ++copyRequest.current;
    try {
      await navigator.clipboard.writeText(model.selectedText());
      if (latestModel.current !== model || id !== copyRequest.current) return;
      const current = model.visualRange;
      if (
        selection === model.visual &&
        current?.start === range.start &&
        current.end === range.end
      ) {
        model.clearVisual();
        model.jumpOffset(range.start);
        paint("nearest");
      }
      setCopyState({ file: commandFile, message: "Copied selection", error: false });
    } catch {
      if (latestModel.current === model && id === copyRequest.current)
        setCopyState({
          file: commandFile,
          message: "Could not copy. Selection kept; use ⌘C / Ctrl+C or retry y.",
          error: true,
        });
    }
  }, [model, paint, commandFile]);
  const onCopy = (event: ClipboardEvent<HTMLDivElement>) => {
    if (!enabled || !model.visual || !event.clipboardData) return;
    cancelCopies();
    event.clipboardData.setData("text/plain", model.selectedText());
    event.preventDefault();
    setCopyState({ file: commandFile, message: "Copied selection", error: false });
  };
  const command = useCallback<FileNavigationCommand>(
    (key, control = false) => {
      active.current = true;
      pane.current?.focus({ preventScroll: true });
      if (key === "Escape") {
        ++request.current;
        setHighlightsVisible(false);
      } else if (key === "n" || key === "N") setHighlightsVisible(true);
      const result = model.key(
        key,
        control,
        Math.max(1, Math.floor((pane.current?.clientHeight ?? 400) / 40)),
      );
      if (result.search) {
        if (result.wordSearch) runSearch(result.wordSearch, result.search, true);
        else beginSearch(result.search);
      }
      if (result.lineCommand) beginLineCommand();
      if (result.definition !== undefined) onDefinition?.(result.definition);
      if (result.handled && !result.copy) {
        cancelCopies();
        setCopyState(null);
      }
      if (result.copy) void copySelection();
      if (result.handled) paint(result.align ?? "nearest");
    },
    [
      model,
      paint,
      runSearch,
      beginSearch,
      beginLineCommand,
      copySelection,
      cancelCopies,
      onDefinition,
    ],
  );
  useLayoutEffect(() => {
    active.current = enabled && document.activeElement === pane.current;
    paint();
  }, [enabled, paint]);
  useLayoutEffect(() => {
    if (search || commandLine || !restoreFocus.current) return;
    restoreFocus.current = false;
    pane.current?.focus({ preventScroll: true });
    active.current = enabled;
    if (restoreScroll.current !== null) {
      viewer.current
        ?.getInstance()
        ?.scrollTo({ type: "position", position: restoreScroll.current, behavior: "instant" });
      restoreScroll.current = null;
      paint();
    } else paint(restoreAlignment.current);
    restoreAlignment.current = "nearest";
  }, [search, commandLine, enabled, paint, viewer]);
  useEffect(() => {
    onNavigationReady?.(command);
    return () => onNavigationReady?.(null);
  }, [command, onNavigationReady]);
  const stopSearchWorker = useCallback(() => {
    ++request.current;
    worker.current?.terminate();
    worker.current = null;
  }, []);
  useLayoutEffect(() => {
    session.current = null;
    return stopSearchWorker;
  }, [model, stopSearchWorker]);
  useLayoutEffect(() => {
    cancelCopies();
    model.clearVisual();
    model.jump((line ?? 1) - 1, (column ?? 1) - 1);
    paint();
  }, [model, line, column, paint, cancelCopies]);
  useEffect(() => {
    const element = pane.current;
    if (!element) return;
    const onScroll = () => {
      if (caret.current) caret.current.dataset.animate = "false";
      paint();
    };
    element.addEventListener("scroll", onScroll, true);
    const observer = new ResizeObserver(onScroll);
    observer.observe(element);
    return () => {
      element.removeEventListener("scroll", onScroll, true);
      observer.disconnect();
    };
  }, [paint]);
  const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.defaultPrevented || event.metaKey || event.altKey || event.nativeEvent.isComposing)
      return;
    if (
      (event.target as HTMLElement).closest("input,textarea,button,select,[contenteditable=true]")
    )
      return;
    if (event.key === "Escape") {
      ++request.current;
      setHighlightsVisible(false);
      model.key("Escape");
      cancelCopies();
      setCopyState(null);
      paint();
      event.preventDefault();
      return;
    }
    if (!enabled) return;
    if (event.key === "n" || event.key === "N") setHighlightsVisible(true);
    // Probe command recognition without changing state twice.
    const result = model.key(
      event.key,
      event.ctrlKey,
      Math.max(1, Math.floor((pane.current?.clientHeight ?? 400) / 40)),
    );
    if (!result.handled) return;
    event.preventDefault();
    active.current = true;
    if (result.search) {
      if (result.wordSearch) runSearch(result.wordSearch, result.search, true);
      else beginSearch(result.search);
    }
    if (result.lineCommand) beginLineCommand();
    if (result.definition !== undefined) onDefinition?.(result.definition);
    if (result.copy) void copySelection();
    else {
      cancelCopies();
      setCopyState(null);
    }
    paint(result.align ?? "nearest");
  };
  const position = useMemo(
    () => ({
      capture() {
        cancelCopies();
        model.clearVisual();
        paint();
        return {
          line: model.line,
          column: model.column,
          desired: model.desired,
          query: model.query,
          direction: model.direction,
          matches: model.matches,
        };
      },
      restore(
        saved: Pick<
          SearchSession,
          "line" | "column" | "desired" | "query" | "direction" | "matches"
        >,
      ) {
        model.restoreSearch(saved);
        paint();
      },
      jump(line: number, column = 1) {
        cancelCopies();
        model.clearVisual();
        model.jump(line - 1, column - 1);
        paint("center");
      },
      accept(origin: { line: number; column: number }) {
        model.rememberJump(origin);
      },
    }),
    [model, paint, cancelCopies],
  );
  return {
    activeSearchName,
    visualName,
    visualMode,
    onCopy,
    copyMessage: copyState?.file === commandFile ? copyState.message : "",
    copyError: copyState?.file === commandFile && copyState.error,
    position,
    pane,
    caret,
    search,
    commandLine,
    updateCommandLine(value: string) {
      setCommandState({ file: commandFile, value, error: "" });
    },
    submitCommandLine() {
      if (!commandLine) return;
      const outcome = model.goToLine(commandLine.value);
      if (outcome === "invalid") {
        setCommandState({ ...commandLine, error: "Enter a positive whole line number." });
        return;
      }
      if (outcome === "moved") restoreAlignment.current = "center";
      else restoreScroll.current = commandScroll.current;
      restoreFocus.current = true;
      setCommandState(null);
    },
    cancelCommandLine() {
      restoreScroll.current = commandScroll.current;
      restoreFocus.current = true;
      setCommandState(null);
    },
    updateSearch(query: string) {
      if (!search) return;
      setSearch({ identity: model.identity, direction: search.direction, query });
      if (query) runSearch(query, search.direction, false, session.current ?? undefined);
      else {
        ++request.current;
        setHighlightsVisible(false);
        restoreSearchOrigin();
      }
    },
    message,
    highlightQuery,
    highlightOptions: {
      caseSensitive: /\p{Lu}/u.test(highlightQuery),
      wholeWord: result.identity === identity && result.wholeWord,
    },
    keyDown,
    onFocus() {
      active.current = enabled;
      paint();
    },
    onBlur() {
      active.current = false;
      paint();
    },
    onPostRender(node: HTMLElement, phase: string) {
      host.current = phase === "unmount" ? null : node;
      if (!paintPending.current) {
        paintPending.current = true;
        queueMicrotask(() => {
          paintPending.current = false;
          currentPaint.current();
        });
      }
    },
    submitSearch() {
      if (session.current) model.rememberJump(session.current);
      if (search) {
        const query = search.query || session.current?.query || "";
        // Accept a completed preview without advancing to the following match.
        if (!search.query || result.query !== query || !result.message)
          runSearch(query, search.direction, false, session.current ?? undefined);
      }
      session.current = null;
      restoreFocus.current = true;
      setSearch(null);
    },
    cancelSearch() {
      ++request.current;
      setHighlightsVisible(false);
      restoreScroll.current = session.current?.scrollTop ?? null;
      restoreSearchOrigin();
      session.current = null;
      restoreFocus.current = true;
      setSearch(null);
    },
    onClick(event: React.MouseEvent<HTMLDivElement>) {
      if (!enabled) return;
      const row = event.nativeEvent
        .composedPath()
        .find(
          (node): node is HTMLElement =>
            node instanceof HTMLElement && node.hasAttribute("data-line"),
        );
      if (!row) return;
      const shadow = host.current?.shadowRoot;
      const position = document.caretPositionFromPoint(event.clientX, event.clientY, {
        shadowRoots: shadow ? [shadow] : [],
      });
      let column = 0;
      if (position && row.contains(position.offsetNode)) {
        const range = document.createRange();
        range.selectNodeContents(row);
        range.setEnd(position.offsetNode, position.offset);
        column = range.toString().length;
      }
      cancelCopies();
      model.clearVisual();
      model.jump(Number(row.dataset.line) - 1, column);
      active.current = true;
      pane.current?.focus({ preventScroll: true });
      paint();
    },
  };
}
