import { ToolButton } from "./ToolButton";
import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
} from "react";
import { EditorState, StateEffect, StateField, Transaction } from "@codemirror/state";
import {
  EditorView,
  Decoration,
  drawSelection,
  keymap,
  lineNumbers,
  gutter,
  GutterMarker,
  highlightActiveLine,
  type DecorationSet,
} from "@codemirror/view";
import {
  defaultKeymap,
  history,
  isolateHistory,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands";
import { searchKeymap } from "@codemirror/search";
import { vim, Vim, getCM } from "@replit/codemirror-vim";
import { getFiletypeFromFileName, resolveTheme } from "@pierre/diffs";
import { useTheme } from "../themes";
import { codeColors } from "../code-colors";
import type { EditorDraft, EditorDrafts } from "../data/editor-drafts";
import type { FileWrite } from "../../shared/local-file";
import type { FullFileViewProps } from "./FullFileView";
import { isBrowseFile } from "../../shared/local-file";
import { createChangeGutter } from "../data/change-gutter";
import { createBlameGutter } from "../data/blame-gutter";
import { BlameTooltips } from "./BlameTooltips";
import type { MarkdownModel } from "../markdown/model";
import SyntaxWorker from "../highlighting/editor.worker?worker";
import "./FileEditor.css";

class AttributionCell extends GutterMarker {
  constructor(readonly line: number) {
    super();
  }
  eq(other: AttributionCell) {
    return this.line === other.line;
  }
  toDOM() {
    const cell = document.createElement("span");
    cell.dataset.columnNumber = String(this.line);
    return cell;
  }
}
const setColors = StateEffect.define<DecorationSet>();
const colors = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, transaction) {
    value = value.map(transaction.changes);
    for (const effect of transaction.effects) if (effect.is(setColors)) value = effect.value;
    return value;
  },
  provide: (field) => EditorView.decorations.from(field),
});
const actions = new WeakMap<
  object,
  {
    save: () => void;
    close: () => void;
    saveAndClose: () => void;
    definition: () => void;
    scroll: (y: "start" | "end") => void;
  }
>();
Vim.defineAction("medDefinition", (cm) => actions.get(cm)?.definition());
Vim.mapCommand("gd", "action", "medDefinition", {}, { context: "normal" });
for (const [keys, y] of [
  ["zt", "start"],
  ["zb", "end"],
] as const) {
  Vim.defineAction(`med-${keys}`, (cm) => actions.get(cm)?.scroll(y));
  for (const context of ["normal", "visual"] as const)
    Vim.mapCommand(keys, "action", `med-${keys}`, {}, { context });
}
Vim.defineEx("write", "w", (cm) => actions.get(cm)?.save());
Vim.defineEx("quit", "q", (cm) => actions.get(cm)?.close());
Vim.defineEx("wq", undefined, (cm) => actions.get(cm)?.saveAndClose());

export default function FileEditor({
  draft,
  drafts,
  write,
  onClose,
  previewControl,
  onDocumentChange,
  onSourcePosition,
  markdownNavigation,
  context,
}: {
  draft: EditorDraft;
  drafts: EditorDrafts;
  write: FileWrite;
  onClose(): void;
  previewControl?: ReactNode;
  onDocumentChange?(text: string): void;
  onSourcePosition?(line: number, reason: "cursor" | "scroll"): void;
  markdownNavigation?: MarkdownModel;
  context: FullFileViewProps;
}) {
  const { active } = useTheme();
  const body = useRef<HTMLDivElement>(null);
  const discardOnUnmount = useRef(false);
  const restoreFocus = useRef(true);
  const view = useRef<EditorView | null>(null);
  const jumpPulse = useRef<Animation | null>(null);
  const [mode, setMode] = useState("NORMAL");
  const [confirm, setConfirm] = useState(false);
  const [syntaxError, setSyntaxError] = useState("");
  const [clipboardError, setClipboardError] = useState("");
  const latest = useRef({ write, onClose, onDocumentChange, onSourcePosition, context });
  useLayoutEffect(() => {
    latest.current = { write, onClose, onDocumentChange, onSourcePosition, context };
  });
  const { loadChanges, stale, onNavigationReady, onSymbolPreviewReady, onSelectionReaderReady } =
    context;
  const changes = useMemo(() => createChangeGutter(), []);
  const [localBlame, setLocalBlame] = useState(false);
  const [blameNotice, setBlameNotice] = useState("");
  const blameOpen = context.blameEnabled ?? localBlame;
  const attribution = useMemo(
    () =>
      createBlameGutter(
        isBrowseFile(draft.file) ? draft.file : null,
        context.loadBlame,
        !draft.dirty && !stale,
        setBlameNotice,
      ),
    [draft.file, draft.dirty, context.loadBlame, stale],
  );
  const cells = useSyncExternalStore(attribution.subscribe, attribution.getSnapshot);
  const paintGutters = useRef(() => {});
  useLayoutEffect(() => {
    paintGutters.current = () => {
      if (!view.current) return;
      changes.update(view.current.dom, "render");
      attribution.update(view.current.dom, "render");
    };
    attribution.setVisible(blameOpen);
    paintGutters.current();
  }, [attribution, changes, blameOpen]);
  useLayoutEffect(() => () => attribution.dispose(), [attribution]);
  useLayoutEffect(() => {
    changes.set(undefined);
    if (!loadChanges || draft.dirty || stale) return;
    const abort = new AbortController();
    void loadChanges(draft.file, abort.signal)
      .then((result) => {
        if (!abort.signal.aborted && result.identity === draft.file.identity) changes.set(result);
      })
      .catch(() => {});
    return () => abort.abort();
  }, [changes, loadChanges, stale, draft.file, draft.dirty]);
  useLayoutEffect(() => {
    onSelectionReaderReady?.(() => {
      const state = view.current?.state;
      return state
        ? state.selection.ranges.map(({ from, to }) => state.sliceDoc(from, to)).join("\n")
        : "";
    });
    onNavigationReady?.((key, control) => {
      const editor = view.current;
      if (!editor) return;
      editor.focus();
      Vim.handleKey(getCM(editor)!, control ? `<C-${key}>` : key, "user");
    });
    onSymbolPreviewReady?.(() => {
      const editor = view.current!;
      const selection = editor.state.selection;
      const scroll = editor.scrollDOM.scrollTop;
      const line = editor.state.doc.lineAt(selection.main.head);
      return {
        origin: { line: line.number, column: selection.main.head - line.from + 1 },
        preview(number, column) {
          const target = editor.state.doc.line(
            Math.max(1, Math.min(number, editor.state.doc.lines)),
          );
          const pos = Math.min(target.to, target.from + Math.max(0, (column ?? 1) - 1));
          editor.dispatch({
            selection: { anchor: pos },
            effects: EditorView.scrollIntoView(pos, { y: "nearest" }),
          });
        },
        finish(accept) {
          if (!accept) {
            editor.dispatch({ selection });
            editor.scrollDOM.scrollTop = scroll;
          }
        },
      };
    });
    return () => {
      onSelectionReaderReady?.(null);
      onNavigationReady?.(null);
      onSymbolPreviewReady?.(null);
    };
  }, [onNavigationReady, onSymbolPreviewReady, onSelectionReaderReady]);
  useLayoutEffect(
    () =>
      markdownNavigation?.subscribeNavigation((line) => {
        const editor = view.current;
        if (!editor) return;
        const target = editor.state.doc.line(
          Math.max(1, Math.min(line, editor.state.doc.lines)),
        ).from;
        editor.dispatch({
          selection: { anchor: target },
          // Centering a final line can propagate the remaining scroll to ancestors.
          effects: EditorView.scrollIntoView(target, { y: "nearest" }),
        });
        editor.focus();
        jumpPulse.current?.cancel();
        editor.requestMeasure({
          read: () => editor.dom.querySelector<HTMLElement>(".cm-activeLine"),
          write: (row) => {
            if (!row || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
            jumpPulse.current = row.animate(
              [
                {
                  backgroundColor: "color-mix(in srgb, var(--edit-accent) 24%, var(--edit-bg))",
                  boxShadow: "inset 2px 0 var(--edit-accent)",
                },
                { backgroundColor: "var(--edit-hover)", boxShadow: "inset 2px 0 transparent" },
              ],
              { duration: 650, easing: "cubic-bezier(0.16, 1, 0.3, 1)" },
            );
          },
        });
        latest.current.onSourcePosition?.(line, "cursor");
      }),
    [markdownNavigation],
  );
  const save = async () => {
    if (draft.saving || !draft.dirty || !draft.state) return;
    const text = draft.state.sliceDoc();
    drafts.update(draft, { saving: true, error: null });
    drafts.notify();
    try {
      const result = await latest.current.write(draft.file, text);
      drafts.update(draft, {
        file: result,
        savedText: text,
        dirty: draft.state.sliceDoc() !== text,
      });
    } catch (error) {
      drafts.update(draft, { error: error instanceof Error ? error.message : String(error) });
    } finally {
      drafts.update(draft, { saving: false });
      drafts.notify();
    }
  };
  const callbacks = useRef({ save, close: () => {} });
  const close = () => {
    if (draft.saving) return;
    if (draft.dirty) {
      setConfirm(true);
      return;
    }
    drafts.update(draft, { editing: false });
    drafts.notify();
    latest.current.onClose();
  };
  useLayoutEffect(() => {
    callbacks.current = { save, close };
  });
  useLayoutEffect(() => {
    if (!body.current) return;
    const worker = new SyntaxWorker();
    let sequence = 0,
      stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let theme: Awaited<ReturnType<typeof resolveTheme>> | undefined;
    const schedule = (immediate = false) => {
      clearTimeout(timer);
      const id = ++sequence;
      timer = setTimeout(
        () => {
          if (!theme || stopped || !view.current) return;
          worker.postMessage({
            id,
            text: view.current.state.doc.toString(),
            language: getFiletypeFromFileName(draft.file.path),
            theme,
          });
        },
        immediate ? 0 : 100,
      );
    };
    let cursorMotionAt = 0;
    let firstInsert = false,
      joinChange = false;
    const code = codeColors(active);
    const extensions = [
      EditorState.transactionFilter.of((transaction) => {
        if (
          !transaction.docChanged ||
          !transaction.isUserEvent("input") ||
          !view.current ||
          !getCM(view.current)?.state.vim?.insertMode
        )
          return transaction;
        const separate = firstInsert && !joinChange;
        firstInsert = false;
        return {
          changes: transaction.changes,
          selection: transaction.selection,
          effects: transaction.effects,
          scrollIntoView: transaction.scrollIntoView,
          annotations: [
            Transaction.userEvent.of("input.type.compose"),
            Transaction.time.of(transaction.annotation(Transaction.time) ?? Date.now()),
            ...(separate ? [isolateHistory.of("before")] : []),
          ],
        };
      }),
      vim(),
      history(),
      colors,
      gutter({
        class: "med-editor-attribution",
        lineMarker: (view, line) => new AttributionCell(view.state.doc.lineAt(line.from).number),
      }),
      lineNumbers(),
      drawSelection(),
      highlightActiveLine(),
      EditorState.lineSeparator.of(draft.savedText.includes("\r\n") ? "\r\n" : "\n"),
      EditorView.contentAttributes.of({
        "aria-label": `Edit ${draft.file.path}`,
        spellcheck: "false",
      }),
      keymap.of([
        {
          key: "Mod-s",
          run: () => {
            void callbacks.current.save();
            return true;
          },
        },
        ...defaultKeymap,
        ...historyKeymap,
        ...searchKeymap,
        indentWithTab,
      ]),
      EditorView.updateListener.of((update) => {
        drafts.update(draft, { state: update.state });
        update.view.requestMeasure({
          key: paintGutters,
          read: () => null,
          write: () => paintGutters.current(),
        });
        if (update.selectionSet || update.docChanged) {
          cursorMotionAt = performance.now();
          latest.current.onSourcePosition?.(
            update.state.doc.lineAt(update.state.selection.main.head).number,
            "cursor",
          );
        }
        if (update.docChanged) {
          const dirty = update.state.sliceDoc() !== draft.savedText;
          if (dirty !== draft.dirty) {
            drafts.update(draft, { dirty });
            drafts.notify();
          }
          schedule();
          latest.current.onDocumentChange?.(update.state.sliceDoc());
        }
      }),
      EditorView.theme(
        {
          "&": {
            backgroundColor: active.palette.canvas,
            color: active.palette.text,
            fontSize: "12px",
          },
          ".cm-scroller": {
            fontFamily: '"Geist Mono", "SFMono-Regular", Consolas, monospace',
            lineHeight: "20px",
            overflow: "auto",
          },
          ".cm-content": { padding: "16px 0 16px" },
          ".cm-gutters": {
            backgroundColor: active.palette.canvas,
            color: active.palette.muted,
            border: "none",
          },
          // The selection layer sits beneath text. An opaque active row would
          // hide it, so the theme's line color is made translucent.
          ".cm-activeLine": { backgroundColor: code.lineHighlight },
          ".cm-activeLineGutter": { backgroundColor: "transparent", color: active.palette.text },
          ".cm-cursor, .cm-dropCursor": { borderLeftColor: active.palette.text },
          // The base theme's focused rule is this specific, as in One Dark.
          "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection":
            { backgroundColor: code.selection },
          ".cm-searchMatch": { backgroundColor: code.match },
          ".cm-searchMatch.cm-searchMatch-selected": {
            backgroundColor: code.matchCurrent,
            ...(code.matchText ? { color: code.matchText } : {}),
            textDecoration: `underline 2px ${code.matchBorder}`,
            textUnderlineOffset: "3px",
          },
          ".cm-panels": { backgroundColor: active.palette.panel, color: active.palette.text },
          "&.cm-focused": { outline: "none" },
        },
        { dark: active.appearance === "dark" },
      ),
    ];
    const state = draft.state
      ? draft.state.update({ effects: StateEffect.reconfigure.of(extensions) }).state
      : EditorState.create({ doc: draft.savedText, extensions });
    const editor = new EditorView({ state, parent: body.current });
    view.current = editor;
    editor.requestMeasure({ read: () => null, write: () => paintGutters.current() });
    drafts.update(draft, { state: editor.state });
    const cm = getCM(editor)!;
    actions.set(cm, {
      scroll: (y) => {
        const line = editor.state.doc.lineAt(editor.state.selection.main.head);
        const margin = Math.min(
          4 * editor.defaultLineHeight,
          Math.max(0, (editor.scrollDOM.clientHeight - editor.defaultLineHeight) / 2),
        );
        editor.dispatch({
          effects: EditorView.scrollIntoView(y === "start" ? line.from : line.to, {
            y,
            yMargin: margin,
          }),
        });
      },
      definition: () => {
        const word = editor.state.wordAt(editor.state.selection.main.head);
        if (word) latest.current.context.onDefinition?.(editor.state.sliceDoc(word.from, word.to));
      },
      save: () => {
        void callbacks.current.save();
      },
      close: () => callbacks.current.close(),
      saveAndClose: () => {
        void callbacks.current.save().then(() => {
          if (!draft.dirty && !draft.error) callbacks.current.close();
        });
      },
    });
    // Vim signals before executing the operator. Observe its completed yank in
    // the same input task; register 0 changes even when yanking identical text.
    cm.on("vim-command-done", () => {
      const before = Vim.getRegisterController().registers["0"];
      queueMicrotask(() => {
        const yank = Vim.getRegisterController().registers["0"];
        if (stopped || !yank || yank === before) return;
        void navigator.clipboard.writeText(yank.toString()).then(
          () => {
            if (!stopped) setClipboardError("");
          },
          () => {
            if (!stopped)
              setClipboardError(
                "Cannot copy to the clipboard. The text is still in the Vim register.",
              );
          },
        );
      });
    });
    // Reattaching a document starts a new Vim Normal-mode session.
    // oxlint-disable-next-line react/set-state-in-effect
    setMode("NORMAL");
    cm.on("vim-mode-change", (event: { mode: string }) => {
      if (event.mode === "insert") {
        firstInsert = true;
        joinChange = !!cm.curOp?.lastChange;
      }
      setMode(event.mode.toUpperCase());
    });
    if (draft.line) {
      const line = editor.state.doc.line(Math.max(1, Math.min(draft.line, editor.state.doc.lines)));
      const position = Math.min(line.to, line.from + Math.max(0, (draft.column ?? 1) - 1));
      editor.dispatch({
        selection: { anchor: position },
        effects: EditorView.scrollIntoView(position, { y: "center" }),
      });
      drafts.update(draft, { line: undefined });
    } else editor.scrollDOM.scrollTop = draft.scrollTop;
    const manualScroll = () => {
      cursorMotionAt = 0;
    };
    let scrollMotionTimer: ReturnType<typeof setTimeout>;
    const followScroll = () => {
      // CodeMirror rebases cursor-layer coordinates while scrolling. Interpolating
      // those corrections makes the cursor lag behind its character.
      editor.dom.dataset.scrolling = "true";
      clearTimeout(scrollMotionTimer);
      scrollMotionTimer = setTimeout(() => delete editor.dom.dataset.scrolling, 100);
      // CodeMirror scrolls after moving the cursor. Keep that cursor as the anchor;
      // wheel, touch and scrollbar input instead follow the viewport.
      if (performance.now() - cursorMotionAt < 200) return;
      const height = editor.scrollDOM.getBoundingClientRect().top - editor.documentTop;
      const block = editor.lineBlockAtHeight(height);
      const fraction = Math.max(0, Math.min(1, (height - block.top) / Math.max(1, block.height)));
      latest.current.onSourcePosition?.(
        editor.state.doc.lineAt(block.from).number + fraction,
        "scroll",
      );
    };
    editor.scrollDOM.addEventListener("scroll", followScroll, { passive: true });
    for (const event of ["wheel", "touchstart", "pointerdown"])
      editor.scrollDOM.addEventListener(event, manualScroll, { passive: true });
    latest.current.onSourcePosition?.(
      editor.state.doc.lineAt(editor.state.selection.main.head).number,
      "cursor",
    );
    if (restoreFocus.current && !document.activeElement?.closest('[role="dialog"]')) editor.focus();
    if (draft.insertOnOpen) {
      Vim.handleKey(cm, "i", "user");
      drafts.update(draft, { insertOnOpen: false });
    }
    worker.onmessage = ({
      data,
    }: MessageEvent<{ id: number; styles: string[]; ranges: Uint32Array; error?: string }>) => {
      if (stopped || data.id !== sequence) return;
      if (data.error) {
        setSyntaxError("Syntax colors unavailable; editing and saving still work.");
        return;
      }
      const marks = data.styles.map((style) => Decoration.mark({ attributes: { style } }));
      const ranges = [];
      for (let i = 0; i < data.ranges.length; i += 3) {
        const [from, to, style] = data.ranges.subarray(i, i + 3);
        if (to <= editor.state.doc.length && from < to) ranges.push(marks[style].range(from, to));
      }
      editor.dispatch({ effects: setColors.of(Decoration.set(ranges, true)) });
      setSyntaxError("");
    };
    worker.onerror = () =>
      setSyntaxError("Syntax colors unavailable; editing and saving still work.");
    void resolveTheme(active.pierreTheme)
      .then((result) => {
        if (!stopped) {
          theme = result;
          schedule(true);
        }
      })
      .catch(() => setSyntaxError("Syntax colors unavailable; editing and saving still work."));
    return () => {
      jumpPulse.current?.cancel();
      restoreFocus.current = editor.hasFocus;
      stopped = true;
      clearTimeout(timer);
      clearTimeout(scrollMotionTimer);
      worker.terminate();
      actions.delete(cm);
      drafts.update(draft, {
        state: discardOnUnmount.current ? undefined : editor.state,
        scrollTop: editor.scrollDOM.scrollTop,
      });
      view.current = null;
      editor.scrollDOM.removeEventListener("scroll", followScroll);
      for (const event of ["wheel", "touchstart", "pointerdown"])
        editor.scrollDOM.removeEventListener(event, manualScroll);
      editor.destroy();
    };
  }, [draft, drafts, active]);

  return (
    <section
      className="med-editor"
      aria-label="File editor"
      data-blame={blameOpen}
      style={
        {
          "--edit-bg": active.palette.canvas,
          "--edit-fg": active.palette.text,
          "--edit-muted": active.palette.muted,
          "--edit-border": active.palette.border,
          "--edit-accent": active.palette.accent,
          "--edit-hover": active.palette.hover,
          "--edit-green": active.palette.green,
          "--edit-red": active.palette.red,
          "--edit-working": active.appearance === "dark" ? "#7db4ff" : "#245ea8",
        } as CSSProperties
      }
    >
      <header className="med-editor-header">
        <span
          className="med-save-dot"
          data-dirty={draft.dirty}
          role="img"
          aria-label={draft.dirty ? "Unsaved changes" : "Saved"}
          title={draft.dirty ? "Unsaved changes" : "Saved"}
          style={{ color: draft.dirty ? active.palette.warning : active.palette.muted }}
        />
        <span className="med-editor-path" title={draft.file.path}>
          {draft.file.path}
        </span>
        <span className="med-editor-mode" aria-live="polite">
          {mode}
        </span>
        {previewControl}
        <ToolButton
          label="Save"
          icon="save"
          shortcut="⌘ S"
          onClick={() => void save()}
          disabled={!draft.dirty || draft.saving}
        />
        {context.loadBlame && (
          <ToolButton
            label={draft.dirty ? "Blame updates after saving" : "Toggle Git blame"}
            aria-label="Toggle Git blame"
            icon="history"
            active={blameOpen}
            aria-pressed={blameOpen}
            onClick={() => {
              setLocalBlame(!blameOpen);
              context.onBlameEnabledChange?.(!blameOpen);
            }}
          />
        )}
        {context.onOpenBefore && <button onClick={context.onOpenBefore}>Open before</button>}
        {context.onOpenAfter && <button onClick={context.onOpenAfter}>Open after</button>}
        {context.refreshAvailable !== false && (
          <ToolButton
            label="Refresh file"
            icon="refresh"
            onClick={context.onRefresh}
            disabled={draft.dirty || draft.saving}
          />
        )}
        <ToolButton
          label="Close file"
          shortcut=":q"
          icon="close"
          onClick={close}
          disabled={draft.saving}
        />
      </header>
      {draft.error && (
        <div role="alert" className="med-editor-message">
          {draft.error}
        </div>
      )}
      {clipboardError && (
        <div role="alert" className="med-editor-message">
          {clipboardError}
        </div>
      )}
      {syntaxError && (
        <div role="status" className="med-editor-message">
          {syntaxError}
        </div>
      )}
      {confirm && (
        <div className="med-editor-message">
          Your draft has unsaved changes.{" "}
          <button onClick={() => setConfirm(false)}>Keep editing</button>{" "}
          <button
            onClick={() => {
              discardOnUnmount.current = true;
              drafts.update(draft, { state: undefined, dirty: false, editing: false, error: null });
              drafts.notify();
              latest.current.onClose();
            }}
          >
            Discard draft
          </button>
        </div>
      )}
      {blameOpen && blameNotice && <div className="med-editor-message">{blameNotice}</div>}
      <div ref={body} className="med-editor-body" />
      <BlameTooltips cells={cells} />
    </section>
  );
}
