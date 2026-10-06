import { useDocumentTitle } from "./data/document-title";
import { DiffImages } from "./components/MediaView";
import { mediaType } from "../shared/media";
import { ActionTooltip, ToolButton } from "./components/ToolButton";
import * as stylex from "@stylexjs/stylex";
import {
  CodeView,
  useWorkerPool,
  type CodeViewHandle,
  type CodeViewItem,
  type CodeViewReactOptions,
  type DiffLineAnnotation,
  type FileDiffMetadata,
} from "@pierre/diffs/react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
} from "react";
import type { Comparison, Note, NoteInput } from "../shared/protocol";
import { useReviewController, type ReviewController } from "./data/controller";
import { tokens, ui } from "./theme.stylex";
import {
  ActionMenu,
  ChoiceSelect,
  CommandDialog,
  SegmentedControl,
  ShortcutKeys,
  type ReviewCommand,
} from "./components/Controls";
import { DiffStat } from "./components/DiffStat";
import { HistoryPanel } from "./components/HistoryPanel";
import { FileSidebar } from "./components/FileSidebar";
import { NoteCard, NoteComposer, type NoteTarget } from "./components/NoteCard";
import { Icon } from "./components/Icon";
import "./pierre-theme";
import { useTheme } from "./themes";
import { ThemePicker } from "./components/ThemePicker";
import { BranchTabs } from "./components/BranchTabs";
import type { BrowseSource } from "../shared/browse";
import { createBrowseApi, useBrowseFiles, type BrowseApi } from "./data/browse";
import { createFileWorkspace, sourceKey, useFileWorkspace } from "./data/file-workspace";
import { RepositoryFiles } from "./components/RepositoryFiles";
import { FilePicker } from "./components/FilePicker";
import { SymbolPicker } from "./components/SymbolPicker";
import { FullFileView, type BeginFileSymbolPreview } from "./components/FullFileView";
import { FileViewTabs } from "./components/FileViewTabs";
import { readBrowserToken } from "./data/auth";
import { SavedReviewHeader } from "./components/SavedReviewHeader";
import { ShortcutGuide } from "./components/ShortcutGuide";
import { ZenBar } from "./components/ZenBar";
import { platform } from "./data/keys";
import type { GuideContextId } from "./data/shortcut-guide";
import { ComparisonActions } from "./components/ComparisonActions";
import { createBlameLoader, type BlameLoader } from "./data/blame";

import { createEditorDrafts } from "./data/editor-drafts";
import { createFilePrefetch } from "./data/file-prefetch";
import { createRenderDiagnostics } from "./data/render-diagnostics";
import { findDefinitions } from "./data/definitions";
import type { SymbolSearch } from "../shared/symbols";

type Annotation = { note?: Note; draft?: NoteTarget };
type Selection = {
  id: string;
  range: {
    start: number;
    end: number;
    side?: "additions" | "deletions";
    endSide?: "additions" | "deletions";
  };
};
const emptyNotes: Note[] = [];
const commonCommands = [
  "open-file",
  "content-search",
  "open-branch",
  "open-local-file",
  "theme",
  "layout",
  "sidebar",
  "zen",
];
const commandRank = (id: string) => {
  const rank = commonCommands.indexOf(id);
  return rank < 0 ? commonCommands.length : rank;
};

/** Abbreviate object IDs; keep symbolic endpoints such as "worktree" whole. */
function shortRevision(revision: string) {
  return /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/.test(revision) ? revision.slice(0, 7) : revision;
}

function readPreference<T extends string>(key: string, fallback: T, values: readonly T[]): T {
  try {
    const value = localStorage.getItem(`med:${key}`);
    return values.includes(value as T) ? (value as T) : fallback;
  } catch {
    return fallback;
  }
}

export function App({
  controller,
  browseApi: providedBrowseApi,
  loadBlame: providedBlameLoader,
}: {
  controller: ReviewController;
  browseApi?: BrowseApi;
  loadBlame?: BlameLoader;
}) {
  const state = useReviewController(controller);
  const { active: activeTheme } = useTheme();
  const theme = activeTheme.appearance;
  const [themePickerOpen, setThemePickerOpen] = useState(false);
  const [sidebarVisible, setSidebarVisible] = useState(true);
  const [filesVisible, setFilesVisible] = useState(false);
  // Zen hides panels and toolbars without changing their saved visibility, so
  // leaving it restores the previous layout exactly.
  const [zen, setZen] = useState(() => readPreference("zen", "off", ["on", "off"]) === "on");
  useEffect(() => {
    try {
      localStorage.setItem("med:zen", zen ? "on" : "off");
    } catch {
      /* Storage can be unavailable. */
    }
  }, [zen]);
  const [filePickerOpen, setFilePickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState<string | undefined>();
  const fileSelection = useRef<(() => string) | null>(null);
  const onSelectionReaderReady = useCallback((read: (() => string) | null) => {
    fileSelection.current = read;
  }, []);
  const [pickerMode, setPickerMode] = useState<"files" | "content">("files");
  const [pickerResume, setPickerResume] = useState(false);
  const [commandsOpen, setCommandsOpen] = useState(false);
  const [symbolPickerOpen, setSymbolPickerOpen] = useState(false);
  const [beginFilePreview, setBeginFilePreview] = useState<BeginFileSymbolPreview>();
  const onSymbolPreviewReady = useCallback(
    (begin: BeginFileSymbolPreview | null) => setBeginFilePreview(() => begin ?? undefined),
    [],
  );
  const [symbolMode, setSymbolMode] = useState<"file" | "project">("file");
  const [vimEnabled, setVimEnabled] = useState(
    () => readPreference("vim", "on", ["on", "off"]) === "on",
  );
  useEffect(() => {
    try {
      localStorage.setItem("med:vim", vimEnabled ? "on" : "off");
    } catch {
      /* Storage can be unavailable. */
    }
  }, [vimEnabled]);
  const [helpOpen, setHelpOpen] = useState(false);
  const fileNavigation = useRef<((key: string, control?: boolean) => void) | null>(null);
  const onNavigationReady = useCallback(
    (command: ((key: string, control?: boolean) => void) | null) => {
      fileNavigation.current = command;
    },
    [],
  );
  const [blameEnabled, setBlameEnabled] = useState(false);
  const [branchPickerOpen, setBranchPickerOpen] = useState(false);
  const workerPool = useWorkerPool();
  const [diagnostics] = useState(createRenderDiagnostics);
  const [rawBrowseApi] = useState(
    () =>
      providedBrowseApi ?? createBrowseApi(globalThis.fetch.bind(globalThis), readBrowserToken()),
  );
  const [prefetch] = useState(() =>
    createFilePrefetch(
      rawBrowseApi,
      workerPool ? (file) => workerPool.primeFileHighlightCache(file) : undefined,
    ),
  );
  const browseApi = prefetch.api;
  useEffect(() => () => prefetch.dispose(), [prefetch]);
  const [fileWorkspace] = useState(() => createFileWorkspace(browseApi));
  const [editorDrafts] = useState(createEditorDrafts);
  useSyncExternalStore(editorDrafts.subscribe, editorDrafts.getSnapshot);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (editorDrafts.hasDirty()) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [editorDrafts]);

  const [loadBlame] = useState(
    () =>
      providedBlameLoader ??
      createBlameLoader(globalThis.fetch.bind(globalThis), readBrowserToken()),
  );
  const fileState = useFileWorkspace(fileWorkspace);
  const branchHead = state.branches.find((branch) => branch.name === state.activeBranch)?.head;
  const browseSource = useMemo<BrowseSource | null>(() => {
    const repository = state.session?.repository;
    if (!repository || repository.git === false) return null;
    if (state.historyRef)
      return branchHead ? { kind: "commit", repo: repository.path, oid: branchHead } : null;
    return { kind: "worktree", repo: repository.path };
  }, [state.session?.repository, state.historyRef, branchHead]);
  const workspaceKey = state.session
    ? JSON.stringify([
        state.activeRepositoryId,
        state.activeBranch ? "branch" : "worktree",
        state.activeBranch ?? state.session.repository.path,
      ])
    : "";
  const sourceLabel =
    browseSource?.kind === "commit"
      ? `Commit ${browseSource.oid.slice(0, 7)} · ${state.activeBranch ?? "snapshot"}`
      : `Working files · ${state.activeBranch ?? "detached worktree"}`;
  const pendingSavedChanges = useRef<string | null>(null);
  useEffect(() => {
    fileWorkspace.configure(workspaceKey, browseSource, sourceLabel);
    if (
      pendingSavedChanges.current &&
      state.savedView &&
      state.status === "ready" &&
      state.savedTargetId === pendingSavedChanges.current
    ) {
      fileWorkspace.select("changes");
      pendingSavedChanges.current = null;
    }
  }, [
    fileWorkspace,
    workspaceKey,
    browseSource,
    sourceLabel,
    state.savedView,
    state.savedTargetId,
    state.status,
  ]);
  useEffect(() => () => fileWorkspace.dispose(), [fileWorkspace]);
  const repositoryFiles = useBrowseFiles(
    browseSource,
    true,
    browseSource?.kind === "worktree" ? state.sourceRevision : 0,
    { api: browseApi },
  );
  useEffect(() => {
    prefetch.invalidate();
    fileWorkspace.invalidate(rawBrowseApi.read);
  }, [fileWorkspace, prefetch, rawBrowseApi, state.sourceRevision]);
  const prefetchFile = useCallback(
    (path: string) => {
      if (browseSource)
        prefetch.prefetch(
          browseSource,
          path,
          workerPool ? (file) => workerPool.primeFileHighlightCache(file) : undefined,
        );
    },
    [browseSource, prefetch, workerPool],
  );
  const activeFile = fileState.tabs.find((tab) => tab.id === fileState.active);
  useDocumentTitle(
    state.savedReview?.title ??
      (activeFile
        ? `${activeFile.path.split("/").at(-1)} — med`
        : state.session
          ? `${state.session.repository.name} · ${state.activeBranch ?? "Working changes"} — med`
          : "med"),
  );
  const definitionScope = JSON.stringify([
    fileState.file?.source,
    fileState.file?.path,
    fileState.file?.identity,
    state.sourceRevision,
  ]);
  const [definitionState, setDefinitionState] = useState<{
    scope: string;
    result: SymbolSearch;
  } | null>(null);
  const definitions = definitionState?.scope === definitionScope ? definitionState.result : null;
  const setDefinitions = useCallback(
    (result: SymbolSearch | null) =>
      setDefinitionState(result ? { scope: definitionScope, result } : null),
    [definitionScope],
  );
  const definitionRequest = useRef<AbortController | null>(null);
  useEffect(() => {
    return () => definitionRequest.current?.abort();
  }, [fileState.file, state.sourceRevision]);
  const goToDefinition = useCallback(
    (name: string) => {
      const file = fileState.file;
      if (!file || file.kind !== "text" || !name) return;
      definitionRequest.current?.abort();
      const request = new AbortController();
      definitionRequest.current = request;
      void findDefinitions(browseApi, file, name, request.signal)
        .then((result) => {
          if (request.signal.aborted || fileWorkspace.getSnapshot().file !== file) return;
          const target = result.matches[0];
          const source = result.resultSource ?? result.source;
          if (target && result.matches.length === 1 && !result.truncated && !result.unavailable) {
            if (
              target.path === file.path &&
              sourceKey(source) === sourceKey(file.source) &&
              beginFilePreview
            ) {
              const preview = beginFilePreview();
              preview.preview(target.line, target.column, target.name, false);
              preview.finish(true);
            } else
              fileWorkspace.open(
                target.path,
                true,
                target.line,
                source,
                source.kind === "commit" ? `Commit ${source.oid.slice(0, 8)}` : sourceLabel,
                target.column,
              );
          } else setDefinitions(result);
        })
        .catch((error: unknown) => {
          if (!request.signal.aborted && fileWorkspace.getSnapshot().file === file)
            setDefinitions({
              source: file.source,
              query: name,
              engine: "ctags",
              matches: [],
              truncated: false,
              unavailable: error instanceof Error ? error.message : "Cannot find definition.",
            });
        });
    },
    [browseApi, fileState.file, beginFilePreview, fileWorkspace, sourceLabel, setDefinitions],
  );
  const openSymbols = useCallback((mode: "file" | "project") => {
    setSymbolMode(mode);
    setSymbolPickerOpen(true);
    setCommandsOpen(false);
  }, []);
  const openFilePicker = useCallback(() => {
    setPickerMode("files");
    setPickerQuery(undefined);
    setPickerResume(false);
    setFilePickerOpen(true);
  }, []);
  const openContentSearch = useCallback(() => {
    const selected = fileSelection.current?.() || window.getSelection()?.toString() || "";
    setPickerQuery(selected || undefined);
    setPickerMode("content");
    setPickerResume(false);
    setFilePickerOpen(true);
  }, []);
  const resumeFilePicker = useCallback(() => {
    setPickerQuery(undefined);
    setPickerResume(true);
    setFilePickerOpen(true);
  }, []);
  const showFiles = useCallback(() => {
    setZen(false);
    setFilesVisible(true);
    if (window.innerWidth < 1100) setSidebarVisible(false);
  }, []);
  // Asking for a panel in zen mode leaves zen and shows that panel.
  const toggleFilesSidebar = useCallback(() => {
    if (filesVisible && !zen) setFilesVisible(false);
    else showFiles();
  }, [filesVisible, showFiles, zen]);
  const toggleReviewSidebar = useCallback(() => {
    if (zen) {
      setZen(false);
      setSidebarVisible(true);
      return;
    }
    setSidebarVisible((visible) => {
      if (!visible && window.innerWidth < 1100) setFilesVisible(false);
      return !visible;
    });
  }, [zen]);
  const zenToggle = useRef<HTMLButtonElement>(null);
  const toggleZen = useCallback(() => setZen((value) => !value), []);
  // Keep keyboard focus when the control that held it leaves with the chrome.
  const previousZen = useRef(zen);
  useLayoutEffect(() => {
    if (previousZen.current === zen) return;
    previousZen.current = zen;
    const focused = document.activeElement;
    // Hidden chrome stays mounted, so check visibility rather than connection.
    if (focused instanceof HTMLElement && focused !== document.body && focused.checkVisibility())
      return;
    // The zen control keeps focus in both directions; a file keeps reading focus.
    if (zen)
      (
        document.querySelector<HTMLElement>('[data-file-pane="main"]') ??
        document.querySelector<HTMLElement>('[data-zen-bar] [aria-label="Exit zen mode"]')
      )?.focus();
    else zenToggle.current?.focus();
  }, [zen]);
  const [mode, setMode] = useState<"split" | "unified">(() =>
    readPreference("mode", "split", ["split", "unified"]),
  );
  const [wrap, setWrap] = useState(false);
  const [showNotes, setShowNotes] = useState(true);
  const [findOpen, setFindOpen] = useState(false);
  const [find, setFind] = useState("");
  const [findIndex, setFindIndex] = useState(0);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [draft, setDraft] = useState<NoteTarget | null>(null);
  const draftRef = useRef(draft);
  useLayoutEffect(() => {
    draftRef.current = draft;
  }, [draft]);
  const [pendingDraft, setPendingDraft] = useState<{
    target: NoteTarget;
    reviewId: string | undefined;
    note: NoteInput;
    existingIds: Set<string>;
    error?: string;
  } | null>(null);
  const clearLineSelection = useCallback(() => {
    setSelection(null);
    setDraft(null);
    setPendingDraft(null);
  }, []);
  useEffect(() => {
    const pointerdown = (event: PointerEvent) => {
      // Gutter drags finish before moving a composer. Changing its height during
      // the drag would move the line under the pointer. Slotted comments and the
      // selection toolbar also keep their current selection while being used.
      if (
        event
          .composedPath()
          .some(
            (node) =>
              node instanceof Element &&
              node.matches(
                "[data-column-number], [data-utility-button], [data-comment-card], [data-line-selection-controls]",
              ),
          )
      )
        return;
      clearLineSelection();
    };
    window.addEventListener("pointerdown", pointerdown, true);
    return () => window.removeEventListener("pointerdown", pointerdown, true);
  }, [clearLineSelection]);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [sidebarWidth, setSidebarWidth] = useState(300);
  const [contextError, setContextError] = useState<string | null>(null);
  const [frameMs, setFrameMs] = useState<number | null>(null);
  const [baseRef, setBaseRef] = useState("main");
  const [headRef, setHeadRef] = useState("HEAD");
  const [rangeOpen, setRangeOpen] = useState(false);
  const viewer = useRef<CodeViewHandle<Annotation, undefined>>(null);
  const reviewScroll = useRef(new Map<string, number>());
  const reviewScope = JSON.stringify([state.activeRepositoryId, workspaceKey, state.comparison]);
  const previousRepositories = useRef(new Set<string>());
  useEffect(() => {
    const current = new Set(state.repositories.map((repository) => repository.id));
    for (const id of previousRepositories.current) {
      if (current.has(id)) continue;
      fileWorkspace.forgetRepository(id);
      for (const scope of reviewScroll.current.keys())
        if (JSON.parse(scope)[0] === id) reviewScroll.current.delete(scope);
    }
    previousRepositories.current = current;
  }, [fileWorkspace, state.repositories]);
  const restoringScroll = useRef(true);
  const reviewId = state.review?.id;
  const explicitReveal = useRef(false);
  useEffect(() => {
    if (fileState.active !== "changes") return;
    if (explicitReveal.current) {
      explicitReveal.current = false;
      restoringScroll.current = false;
      return;
    }
    if (!reviewId) return;
    restoringScroll.current = true;
    const position = reviewScroll.current.get(reviewScope) ?? 0;
    const frame = requestAnimationFrame(() => {
      viewer.current?.scrollTo({ type: "position", position });
      restoringScroll.current = false;
    });
    return () => {
      cancelAnimationFrame(frame);
      restoringScroll.current = true;
    };
  }, [fileState.active, reviewScope, reviewId]);
  const metadataRows = useRef(new Map<string, HTMLDivElement>());
  const filterRef = useRef<HTMLInputElement>(null);
  const findRef = useRef<HTMLInputElement>(null);
  const renderStart = useRef({ id: "", at: 0, measured: true, generation: 0 });
  useEffect(() => {
    let previousMetrics = controller.getSnapshot().metrics;
    return controller.subscribe(() => {
      const snapshot = controller.getSnapshot();
      const id = snapshot.review?.id ?? "";
      if (renderStart.current.id !== id) {
        setSelection(null);
        setDraft(null);
        setContextError(null);
      }
      if (snapshot.status === "loading") {
        renderStart.current = {
          id,
          at: 0,
          measured: true,
          generation: renderStart.current.generation + 1,
        };
        setFrameMs(null);
      } else if (snapshot.metrics !== previousMetrics) {
        renderStart.current = {
          id,
          at: performance.now(),
          measured: false,
          generation: renderStart.current.generation + 1,
        };
        setFrameMs(null);
      }
      previousMetrics = snapshot.metrics;
    });
  }, [controller]);
  const files = state.visibleFiles;
  const fileInfoById = useMemo(() => new Map(files.map((file) => [file.id, file.info])), [files]);
  const notes = state.notes?.notes ?? emptyNotes;
  const submitted = pendingDraft;
  // The controller publishes the saved note before its save promise completes.
  // Replace that draft in the same render so the diff never reserves two cards.
  const draftSaved =
    submitted?.target === draft &&
    submitted.reviewId === state.review?.id &&
    notes.some(
      (note) =>
        !submitted.existingIds.has(note.id) &&
        !note.parentId &&
        note.path === submitted.note.path &&
        note.side === submitted.note.side &&
        note.line === submitted.note.line &&
        (note.endLine ?? note.line) === (submitted.note.endLine ?? submitted.note.line) &&
        note.text === submitted.note.text,
    );
  const visibleDraft = draftSaved ? null : draft;
  const selectedFile = files.find((file) => file.id === state.selectedFileId);

  useEffect(() => {
    void controller.initialize();
    return () => controller.dispose();
  }, [controller]);
  useEffect(() => {
    try {
      localStorage.setItem("med:mode", mode);
    } catch {
      /* Preferences can be unavailable in private storage. */
    }
  }, [mode]);
  const reveal = useCallback(
    (id: string) => {
      explicitReveal.current = fileWorkspace.getSnapshot().active !== "changes";
      fileWorkspace.select("changes");
      controller.revealFile(id);
      setCollapsed((current) => {
        if (!current.has(id)) return current;
        const next = new Set(current);
        next.delete(id);
        return next;
      });
      requestAnimationFrame(() => {
        const row = metadataRows.current.get(id);
        if (row) row.scrollIntoView({ block: "nearest" });
        else viewer.current?.scrollTo({ type: "item", id, align: "start" });
      });
    },
    [controller, fileWorkspace],
  );
  useEffect(() => {
    if (!state.selectedFileId) return;
    const row = metadataRows.current.get(state.selectedFileId);
    if (row) row.scrollIntoView({ block: "nearest" });
    else viewer.current?.scrollTo({ type: "item", id: state.selectedFileId, align: "nearest" });
  }, [state.selectedFileId]);

  // Pierre treats a matching version as an instruction to keep the old item.
  // Use a monotonic revision: numeric hashes can collide and retain old portals.
  const itemKey = JSON.stringify([
    state.review?.id,
    state.notes?.revision,
    showNotes,
    visibleDraft,
    pendingDraft?.error,
    [...collapsed],
  ]);
  const [itemVersion, setItemVersion] = useState({ key: itemKey, files, notes, value: 0 });
  let currentVersion = itemVersion.value;
  if (itemVersion.key !== itemKey || itemVersion.files !== files || itemVersion.notes !== notes) {
    currentVersion++;
    setItemVersion({ key: itemKey, files, notes, value: currentVersion });
  }
  const items = useMemo<CodeViewItem<Annotation>[]>(() => {
    return files.flatMap((file) => {
      if (!file.metadata || mediaType(file.path)?.kind === "image") return [];
      const annotations: DiffLineAnnotation<Annotation>[] = showNotes
        ? notes
            .filter(
              (note) =>
                note.path === file.path &&
                !note.parentId &&
                note.resolution !== "orphaned" &&
                note.resolution !== "stale",
            )
            .map((note) => ({
              side: note.side === "old" ? "deletions" : "additions",
              lineNumber: note.line,
              metadata: { note },
            }))
        : [];
      if (visibleDraft?.path === file.path)
        annotations.push({
          side: visibleDraft.side === "old" ? "deletions" : "additions",
          lineNumber: visibleDraft.line,
          metadata: { draft: visibleDraft },
        });
      return [
        {
          id: file.id,
          type: "diff" as const,
          fileDiff: file.metadata,
          version: currentVersion,
          collapsed: collapsed.has(file.id),
          annotations,
        },
      ];
    });
  }, [files, notes, showNotes, visibleDraft, collapsed, currentVersion]);

  useEffect(() => {
    diagnostics.record("comparison", {
      review: state.review?.id,
      status: state.status,
      version: currentVersion,
      mode,
      wrap,
      theme: activeTheme.id,
      fileCount: items.length,
      files: items.slice(0, 50).map((item) => ({
        id: item.id,
        name: item.type === "diff" ? item.fileDiff.name : item.file.name,
      })),
    });
  }, [
    diagnostics,
    state.review?.id,
    state.status,
    currentVersion,
    mode,
    wrap,
    activeTheme.id,
    items,
  ]);

  const options = useMemo<CodeViewReactOptions<Annotation, undefined>>(
    () => ({
      theme: activeTheme.pierreTheme,
      themeType: theme,
      diffStyle: mode,
      overflow: wrap ? "wrap" : "scroll",
      diffIndicators: "bars",
      lineDiffType: "word-alt",
      stickyHeaders: true,
      enableLineSelection: true,
      // Keep hover and gutter dragging active immediately after keyboard scrolling.
      pointerEventsOnScroll: true,
      enableGutterUtility: true,
      unsafeCSS: `[data-utility-button]::before { inset: 0; }
        [data-separator-content] { font-size: 11.5px; letter-spacing: 0.01em; }`,
      onLineEnter(_line, context) {
        context.element?.shadowRoot
          ?.querySelector("[data-utility-button]")
          ?.setAttribute("aria-label", "Add note to line");
      },
      onLineSelectionEnd(range, context) {
        if (!draft || context.type !== "diff") return;
        if (!range || (range.endSide && range.side !== range.endSide)) {
          setDraft(null);
          return;
        }
        const target: NoteTarget = {
          path: context.item.fileDiff.name,
          side: range.side === "deletions" ? "old" : "new",
          line: Math.min(range.start, range.end),
          endLine: Math.max(range.start, range.end),
        };
        if (
          target.path !== draft.path ||
          target.side !== draft.side ||
          target.line !== draft.line ||
          target.endLine !== (draft.endLine ?? draft.line)
        ) {
          setPendingDraft(null);
          setDraft(target);
        }
      },
      onGutterUtilityClick(range, context) {
        if (context.type !== "diff") return;
        if (range.endSide && range.side !== range.endSide) {
          setContextError("Select lines on one side to add a note.");
          return;
        }
        setShowNotes(true);
        setDraft({
          path: context.item.fileDiff.name,
          side: range.side === "deletions" ? "old" : "new",
          line: Math.min(range.start, range.end),
          endLine: Math.max(range.start, range.end),
        });
      },
      hunkSeparators: "line-info",
      layout: { gap: 0, paddingTop: 0, paddingBottom: 0 },
      loadDiffFiles: async (metadata: FileDiffMetadata) => {
        try {
          const expectedReview = reviewId;
          if (controller.getSnapshot().review?.id !== expectedReview)
            throw new Error("The comparison changed.");
          diagnostics.record("context-request", { review: expectedReview, path: metadata.name });
          const source = await controller.loadSources(metadata.name);
          if (source.reviewId !== expectedReview) throw new Error("The comparison changed.");
          diagnostics.record("context-ready", { review: source.reviewId, path: metadata.name });
          setContextError(null);
          return {
            oldFile:
              metadata.type === "rename-pure"
                ? null
                : {
                    name: metadata.prevName ?? metadata.name,
                    contents: source.old,
                    cacheKey: `${source.reviewId}:${source.path}:old`,
                  },
            newFile: {
              name: metadata.name,
              contents: source.new,
              cacheKey: `${source.reviewId}:${source.path}:new`,
            },
          };
        } catch (error) {
          if (controller.getSnapshot().review?.id === reviewId)
            setContextError(error instanceof Error ? error.message : "Could not load file context");
          throw error;
        }
      },
      onPostRender: (node, instance, phase) => {
        node.shadowRoot
          ?.querySelector("[data-utility-button]")
          ?.setAttribute("aria-label", "Add note to line");
        const rendered = "fileDiff" in instance ? instance.fileDiff : undefined;
        if (phase !== "unmount")
          diagnostics.rendered(
            node,
            {
              review: reviewId,
              phase,
              mode,
              wrap,
              path: rendered?.name,
              cacheKey: rendered?.cacheKey,
              hunks: rendered?.hunks.length,
            },
            instance,
          );
        if (phase === "unmount" || renderStart.current.measured) return;
        renderStart.current.measured = true;
        const generation = renderStart.current.generation;
        const start = renderStart.current.at;
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            if (renderStart.current.generation === generation)
              setFrameMs(performance.now() - start);
          }),
        );
      },
    }),
    [controller, theme, activeTheme.pierreTheme, mode, wrap, reviewId, diagnostics, draft],
  );

  const hits = useMemo(() => {
    if (!find) return [];
    const query = find.toLowerCase();
    const result: { id: string; side: "additions" | "deletions"; line: number }[] = [];
    for (const file of files) {
      const metadata = file.metadata;
      if (!metadata) continue;
      for (const hunk of metadata.hunks) {
        let found = false;
        for (const side of ["additions", "deletions"] as const) {
          const source = side === "additions" ? metadata.additionLines : metadata.deletionLines;
          const index = side === "additions" ? hunk.additionLineIndex : hunk.deletionLineIndex;
          const count = side === "additions" ? hunk.additionCount : hunk.deletionCount;
          const start = side === "additions" ? hunk.additionStart : hunk.deletionStart;
          for (let offset = 0; offset < count; offset++)
            if (source[index + offset]?.toLowerCase().includes(query)) {
              result.push({ id: file.id, side, line: start + offset });
              found = true;
              break;
            }
          if (found) break;
        }
      }
    }
    return result;
  }, [files, find]);
  const jumpHit = useCallback(
    (index: number) => {
      if (!hits.length) return;
      const next = (index + hits.length) % hits.length;
      setFindIndex(next);
      const hit = hits[next];
      controller.revealFile(hit.id);
      setSelection({ id: hit.id, range: { start: hit.line, end: hit.line, side: hit.side } });
      viewer.current?.scrollTo({
        type: "line",
        id: hit.id,
        lineNumber: hit.line,
        side: hit.side,
        align: "center",
      });
    },
    [controller, hits],
  );
  const startNote = useCallback(() => {
    if (!selection) return;
    const file = files.find((entry) => entry.id === selection.id);
    if (!file) return;
    if (selection.range.endSide && selection.range.side !== selection.range.endSide) {
      setContextError("Select lines on one side to add a note.");
      return;
    }
    setShowNotes(true);
    setDraft({
      path: file.path,
      side: selection.range.side === "deletions" ? "old" : "new",
      line: Math.min(selection.range.start, selection.range.end),
      endLine: Math.max(selection.range.start, selection.range.end),
    });
  }, [selection, files]);
  const navigateFile = useCallback(
    (delta: number) => {
      const index = files.findIndex((file) => file.id === state.selectedFileId);
      const next = files[Math.max(0, Math.min(files.length - 1, index + delta))];
      if (next) reveal(next.id);
    },
    [files, state.selectedFileId, reveal],
  );
  const navigateHunk = useCallback(
    (delta: number) => {
      const targets = files.flatMap(
        (file) =>
          file.metadata?.hunks.map((hunk) => ({
            id: file.id,
            side: hunk.additionCount > 0 ? ("additions" as const) : ("deletions" as const),
            line: hunk.additionCount > 0 ? hunk.additionStart : hunk.deletionStart,
          })) ?? [],
      );
      const current = targets.findIndex(
        (target) =>
          target.id === (selection?.id ?? state.selectedFileId) &&
          (!selection || target.line >= selection.range.start),
      );
      const target = targets[Math.max(0, Math.min(targets.length - 1, current + delta))];
      if (target) {
        controller.revealFile(target.id);
        setSelection({
          id: target.id,
          range: { start: target.line, end: target.line, side: target.side },
        });
        viewer.current?.scrollTo({
          type: "line",
          id: target.id,
          side: target.side,
          lineNumber: target.line,
          align: "start",
        });
      }
    },
    [files, selection, state.selectedFileId, controller],
  );
  const openFind = useCallback(() => {
    setFindOpen(true);
    requestAnimationFrame(() => findRef.current?.focus());
  }, []);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (document.querySelector("[data-standalone-files]")) return;
      const editing = event
        .composedPath()
        .some(
          (node) =>
            node instanceof HTMLElement &&
            (["INPUT", "TEXTAREA", "SELECT"].includes(node.tagName) || node.isContentEditable),
        );
      if (event.isComposing || event.defaultPrevented) return;
      const modal =
        themePickerOpen ||
        symbolPickerOpen ||
        filePickerOpen ||
        commandsOpen ||
        helpOpen ||
        rangeOpen ||
        branchPickerOpen;
      if (
        event.key === "?" &&
        !editing &&
        !modal &&
        !(
          event.target instanceof Element &&
          event.target.closest('[data-file-pane="main"][tabindex="0"]')
        ) &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey
      ) {
        event.preventDefault();
        event.stopPropagation();
        setHelpOpen(true);
        return;
      }
      const optionKey = event.code || `Key${event.key.toUpperCase()}`;
      const fromEditor =
        (optionKey === "KeyW" || optionKey === "KeyZ") &&
        event
          .composedPath()
          .some((node) => node instanceof HTMLElement && node.classList.contains("cm-content"));
      if (
        event.altKey &&
        !event.metaKey &&
        !event.ctrlKey &&
        (!editing || fromEditor) &&
        !modal &&
        !document.querySelector('[role="dialog"]')
      ) {
        const key = optionKey;
        if (["KeyW", "KeyO", "KeyP", "KeyB", "KeyR", "KeyZ"].includes(key)) {
          event.preventDefault();
          event.stopPropagation();
          if (event.repeat) return;
          if (key === "KeyW") {
            if (event.shiftKey) fileWorkspace.closeAll();
            else if (activeFile) fileWorkspace.close(activeFile.id);
          } else if (key === "KeyO" && event.shiftKey) fileWorkspace.closeOthers();
          else if (key === "KeyP" && activeFile) fileWorkspace.pin(activeFile.id);
          else if (key === "KeyB" && activeFile && fileState.file?.kind === "text")
            setBlameEnabled((value) => !value);
          else if (key === "KeyR" && browseSource) resumeFilePicker();
          else if (key === "KeyZ" && !event.shiftKey) toggleZen();
          return;
        }
      }
      if (event.altKey) return;
      // On macOS, Command runs Med shortcuts. Leave unshifted Control+B/F/O in
      // the editor to Vim (page up/down, jump back) instead of Med's sidebar,
      // find, and symbols.
      if (
        platform === "mac" &&
        event.ctrlKey &&
        !event.metaKey &&
        !event.shiftKey &&
        ["b", "f", "o"].includes(event.key.toLowerCase()) &&
        event
          .composedPath()
          .some((node) => node instanceof HTMLElement && node.classList.contains("cm-content"))
      )
        return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "b") {
        if (event.shiftKey && !browseSource) return;
        event.preventDefault();
        event.stopPropagation();
        if (event.repeat) return;
        if (event.shiftKey) toggleFilesSidebar();
        else toggleReviewSidebar();
        return;
      }
      if (themePickerOpen || filePickerOpen || symbolPickerOpen || helpOpen || rangeOpen) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "o") {
        if (event.shiftKey ? !browseSource : !activeFile || fileState.file?.kind !== "text") return;
        event.preventDefault();
        event.stopPropagation();
        if (!event.repeat) openSymbols(event.shiftKey ? "project" : "file");
        return;
      }
      if (
        (event.metaKey || event.ctrlKey) &&
        event.shiftKey &&
        event.key.toLowerCase() === "f" &&
        browseSource
      ) {
        event.preventDefault();
        event.stopPropagation();
        setCommandsOpen(false);
        openContentSearch();
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        if (event.shiftKey && !browseSource) return;
        event.preventDefault();
        event.stopPropagation();
        if (event.repeat) return;
        if (event.shiftKey) {
          setCommandsOpen(false);
          openFilePicker();
        } else setCommandsOpen((open) => !open);
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f") {
        if (commandsOpen || branchPickerOpen) return;
        if (fileState.active !== "changes") {
          if (fileState.file?.kind === "text") {
            event.preventDefault();
            event.stopPropagation();
            fileNavigation.current?.("/");
          }
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        openFind();
        return;
      }
      if (
        editing ||
        modal ||
        Boolean(document.querySelector('[role="dialog"]')) ||
        fileState.active !== "changes" ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey
      )
        return;
      if (event.key === "/") {
        event.preventDefault();
        event.stopPropagation();
        openFind();
      } else if (event.key === "]") {
        event.preventDefault();
        event.stopPropagation();
        navigateHunk(1);
      } else if (event.key === "[") {
        event.preventDefault();
        event.stopPropagation();
        navigateHunk(-1);
      } else if (event.key === "n" && find) {
        event.preventDefault();
        event.stopPropagation();
        jumpHit(findIndex + 1);
      } else if (event.key === "N" && find) {
        event.preventDefault();
        event.stopPropagation();
        jumpHit(findIndex - 1);
      } else if (event.key === "c" && selection) {
        // Without this, the key that opens the composer is typed into it.
        event.preventDefault();
        event.stopPropagation();
        startNote();
      } else if (event.key === "Escape") {
        setFindOpen(false);
        setDraft(null);
        setSelection(null);
      }
    };
    window.addEventListener("keydown", keydown, true);
    return () => window.removeEventListener("keydown", keydown, true);
  }, [
    symbolPickerOpen,
    openSymbols,
    branchPickerOpen,
    themePickerOpen,
    filePickerOpen,
    fileState.active,
    commandsOpen,
    openFind,
    navigateHunk,
    find,
    findIndex,
    jumpHit,
    selection,
    startNote,
    toggleReviewSidebar,
    toggleFilesSidebar,
    toggleZen,
    browseSource,
    openFilePicker,
    openContentSearch,
    resumeFilePicker,
    helpOpen,
    rangeOpen,
    activeFile,
    fileState.file?.kind,
    fileWorkspace,
  ]);

  const gitAvailable = state.session?.repository.git !== false;
  const workingAvailable = gitAvailable && !state.historyRef;
  const openWorkingFile = (path: string, pinned = true, background = false) =>
    fileWorkspace.open(path, { pinned, background });
  const openVersion = (path: string, side: "old" | "new") => {
    const review = state.review;
    if (!review) return;
    const file = state.files.find((item) => item.path === path);
    const oid = side === "old" ? review.base : review.head;
    const name = side === "old" ? (file?.info.previousPath ?? path) : path;
    if (/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/.test(oid))
      fileWorkspace.open(
        name,
        true,
        undefined,
        { kind: "commit", repo: review.repo, oid },
        `${side === "old" ? "Before" : "After"} · ${oid.slice(0, 7)}`,
      );
  };
  const activeSourceMatches =
    activeFile &&
    activeFile.source.repo === state.review?.repo &&
    (activeFile.source.kind === "worktree" ||
      activeFile.source.oid === state.review.base ||
      activeFile.source.oid === state.review.head);
  const activeDiffFile = activeSourceMatches
    ? state.files.find(
        (file) => file.path === activeFile?.path || file.info.previousPath === activeFile?.path,
      )
    : undefined;
  const loadFileChanges = useCallback(
    async (file: import("../shared/local-file").FileRead, signal: AbortSignal) => {
      if (!browseApi.changes || (file.source.kind !== "commit" && file.source.kind !== "worktree"))
        return { identity: file.identity, label: "", ranges: [] };
      return browseApi.changes(
        file.source,
        file.path,
        file.identity,
        file.source.repo === state.review?.repo ? state.review.id : undefined,
        signal,
        state.savedView &&
          state.savedReview &&
          state.savedTargetId &&
          file.source.repo === state.review?.repo
          ? { id: state.savedReview.id, target: state.savedTargetId }
          : undefined,
      );
    },
    [browseApi, state.review, state.savedView, state.savedReview, state.savedTargetId],
  );
  const runFileNavigation = (keys: string, control = false) => {
    if (keys !== "/" && keys !== "?") setVimEnabled(true);
    // Run after the palette releases its focus trap.
    requestAnimationFrame(() => {
      for (const key of keys) fileNavigation.current?.(key, control);
    });
  };
  const activeEditing =
    !!activeFile &&
    !!editorDrafts.get(JSON.stringify([activeFile.source, activeFile.path]))?.editing;
  const fileMotions: [string, string, string, boolean?][] = [
    ["definition", "Go to definition", "gd"],
    ["jump-back", "Previous jump line in file", "''"],
    ["jump-back-exact", "Previous jump position in file", "``"],
    ["mark-set", "Set local mark (then a–z)", "m"],
    ["mark-line", "Go to local mark line (then a–z)", "'"],
    ["mark-position", "Go to local mark position (then a–z)", "`"],
    ["visual-character", "Select characters in file", "v"],
    ["visual-line", "Select whole lines in file", "V"],
    ["visual-yank", "Copy Vim selection", "y"],
    ["visual-other-end", "Move other end of Vim selection", "o"],
    ["left", "Move left in file", "h"],
    ["down", "Move down in file", "j"],
    ["up", "Move up in file", "k"],
    ["right", "Move right in file", "l"],
    ["word-next", "Next word in file", "w"],
    ["word-back", "Previous word in file", "b"],
    ["word-end", "End of word in file", "e"],
    ["line-start", "Start of file line", "0"],
    ["line-text", "First non-space character in file line", "^"],
    ["line-end", "End of file line", "$"],
    [
      "line-end-a",
      activeEditing ? "Append at line end (Insert mode)" : "End of file line, without inserting",
      "A",
    ],
    ["paragraph-back", "Previous paragraph in file", "{"],
    ["paragraph-next", "Next paragraph in file", "}"],
    ["file-start", "Start of file", "gg"],
    ["file-end", "End of file", "G"],
    ["line-jump", "Go to line in file", ":"],
    ["page-down", "Half page down in file", "d", true],
    ["page-up", "Half page up in file", "u", true],
    ["center", "Center file cursor", "zz"],
    ["cursor-top", "Place current file line at top", "zt"],
    ["cursor-bottom", "Place current file line at bottom", "zb"],
    ["char-forward", "Find character forward in line", "f"],
    ["char-back", "Find character backward in line", "F"],
    ["till-forward", "Move before character forward in line", "t"],
    ["till-back", "Move after character backward in line", "T"],
    ["char-repeat", "Repeat character search", ";"],
    ["char-reverse", "Reverse character search", ","],
    ["search-next", "Next file search match", "n"],
    ["search-back", "Previous file search match", "N"],
    ["search-word", "Search file for word at cursor", "*"],
    ["search-word-back", "Search file backward for word at cursor", "#"],
  ];
  const commands: ReviewCommand[] = [
    {
      id: "render-diagnostics",
      label: "Download render diagnostics",
      run: () => diagnostics.download(),
    },
    {
      id: "find-file-text",
      managesFocus: true,
      label: "Find text in current file",
      shortcut: "⌘ F",
      disabled: !activeFile || fileState.file?.kind !== "text",
      run: () => runFileNavigation("/"),
    },
    {
      id: "find-file-backward",
      managesFocus: true,
      label: "Search current file backward",
      shortcut: "?",
      disabled: !activeFile || fileState.file?.kind !== "text",
      run: () => runFileNavigation("?"),
    },
    ...fileMotions.map(([id, label, keys, control]) => ({
      id: `vim-${id}`,
      managesFocus: true,
      label,
      shortcut: control ? `Ctrl ${keys.toUpperCase()}` : keys,
      disabled: !activeFile || fileState.file?.kind !== "text",
      run: () => runFileNavigation(keys, control),
    })),
    {
      id: "file-symbols",
      managesFocus: true,
      label: "Search symbols in current file",
      shortcut: "⌘ O",
      disabled: !activeFile || fileState.file?.kind !== "text",
      run: () => openSymbols("file"),
    },
    {
      id: "project-symbols",
      managesFocus: true,
      label: "Search symbols in project commits",
      shortcut: "⌘ ⇧ O",
      disabled: !browseSource,
      run: () => openSymbols("project"),
    },
    {
      id: "vim",
      label: vimEnabled ? "Disable Vim navigation in files" : "Enable Vim navigation in files",
      run: () => setVimEnabled((value) => !value),
    },
    {
      id: "open-branch",
      managesFocus: true,
      label: "Open branch or worktree",
      disabled: !gitAvailable,
      run: () => setBranchPickerOpen(true),
    },
    {
      id: "wrap",
      label: wrap ? "Disable line wrapping in diffs" : "Wrap lines in diffs",
      run: () => setWrap((value) => !value),
    },
    {
      id: "show-notes",
      label: showNotes ? "Hide review notes" : "Show review notes",
      run: () => setShowNotes((value) => !value),
    },
    {
      id: "refresh-file",
      label: "Refresh current file",
      disabled: !activeFile,
      run: () => void fileWorkspace.refresh(),
    },
    {
      id: "file-before",
      label: "Open before version of current file",
      disabled:
        !activeDiffFile || !/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/.test(state.review?.base ?? ""),
      run: () => activeDiffFile && openVersion(activeDiffFile.path, "old"),
    },
    {
      id: "file-after",
      label: "Open after version of current file",
      disabled:
        !activeDiffFile || !/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/.test(state.review?.head ?? ""),
      run: () => activeDiffFile && openVersion(activeDiffFile.path, "new"),
    },
    {
      id: "next-match",
      label: "Next diff search match",
      shortcut: "n",
      disabled: !find || !!activeFile,
      run: () => jumpHit(findIndex + 1),
    },
    {
      id: "previous-match",
      label: "Previous diff search match",
      shortcut: "N",
      disabled: !find || !!activeFile,
      run: () => jumpHit(findIndex - 1),
    },
    {
      id: "commands",
      managesFocus: true,
      label: "Open command palette",
      shortcut: "⌘ K",
      run: () => setCommandsOpen(true),
    },
    {
      id: "help",
      managesFocus: true,
      label: "Show keyboard shortcuts",
      shortcut: "?",
      run: () => setHelpOpen(true),
    },
    {
      id: "close-file",
      label: "Close current file",
      shortcut: "⌥ W",
      disabled: !activeFile,
      run: () => activeFile && fileWorkspace.close(activeFile.id),
    },
    {
      id: "close-files",
      label: "Close all files in this workspace",
      shortcut: "⌥ ⇧ W",
      disabled: !fileState.tabs.length,
      run: fileWorkspace.closeAll,
    },
    {
      id: "close-others",
      label: "Close other files in this workspace",
      shortcut: "⌥ ⇧ O",
      disabled: !activeFile || fileState.tabs.length < 2,
      run: fileWorkspace.closeOthers,
    },
    {
      id: "pin-file",
      label: "Keep current preview tab open",
      shortcut: "⌥ P",
      disabled: !activeFile || activeFile.pinned,
      run: () => activeFile && fileWorkspace.pin(activeFile.id),
    },
    {
      id: "changes",
      label: "Return to Changes",
      run: () => fileWorkspace.select("changes"),
    },
    {
      id: "blame",
      label: blameEnabled ? "Hide Git blame" : "Show Git blame in the gutter",
      shortcut: "⌥ B",
      disabled: !activeFile || fileState.file?.kind !== "text",
      run: () => setBlameEnabled((value) => !value),
    },
    {
      id: "content-search",
      managesFocus: true,
      label: "Search workspace file contents",
      shortcut: "⌘ ⇧ F",
      disabled: !browseSource,
      run: openContentSearch,
    },
    {
      id: "resume-picker",
      managesFocus: true,
      label: "Resume last file search",
      shortcut: "⌥ R",
      disabled: !browseSource,
      run: resumeFilePicker,
    },
    ...(browseSource
      ? [
          {
            id: "open-file",
            managesFocus: true,
            label: "Find file in this workspace",
            shortcut: "⌘⇧K",
            run: openFilePicker,
          },
          {
            id: "browse-files",
            label: filesVisible && !zen ? "Hide files sidebar" : "Show files sidebar",
            shortcut: "⌘⇧B",
            run: toggleFilesSidebar,
          },
          ...(selectedFile
            ? [
                {
                  id: "open-working-file",
                  label: "Open working file",
                  run: () => openWorkingFile(selectedFile.path),
                },
              ]
            : []),
        ]
      : []),
    { id: "next-file", label: "Go to next changed file", shortcut: "", run: () => navigateFile(1) },
    { id: "previous-file", label: "Go to previous changed file", run: () => navigateFile(-1) },
    { id: "next-hunk", label: "Go to next hunk", shortcut: "]", run: () => navigateHunk(1) },
    {
      id: "previous-hunk",
      label: "Go to previous hunk",
      shortcut: "[",
      run: () => navigateHunk(-1),
    },
    {
      id: "find",
      label: "Find in diff contents",
      shortcut: "⌘ F",
      run: () => {
        fileWorkspace.select("changes");
        openFind();
      },
    },
    {
      id: "filter",
      label: "Filter changed files",
      run: () => {
        setSidebarVisible(true);
        requestAnimationFrame(() => filterRef.current?.focus());
      },
    },
    {
      id: "layout",
      label: `Use ${mode === "split" ? "unified" : "split"} diff layout`,
      run: () => setMode(mode === "split" ? "unified" : "split"),
    },
    {
      id: "theme",
      managesFocus: true,
      label: "Change color theme",
      run: () => setThemePickerOpen(true),
    },
    {
      id: "refresh",
      label: "Refresh current review and history",
      run: () => void controller.refresh(),
    },
    ...(gitAvailable
      ? [
          ...(workingAvailable
            ? [
                {
                  id: "working",
                  label: "Review working changes",
                  run: () => void controller.selectComparison({ kind: "working" as const }),
                },
              ]
            : []),
          {
            id: "range",
            label: "Compare branches or revisions",
            run: () => setRangeOpen(true),
          },
        ]
      : []),
    {
      id: "sidebar",
      label: sidebarVisible && !zen ? "Hide sidebar" : "Show sidebar",
      shortcut: "⌘ B",
      run: toggleReviewSidebar,
    },
    {
      id: "zen",
      label: zen ? "Leave zen mode" : "Enter zen mode",
      shortcut: "⌥ Z",
      run: toggleZen,
    },
    {
      id: "open-local-file",
      managesFocus: true,
      label: "Open standalone file",
      run: () => window.dispatchEvent(new Event("med-open-file")),
    },
    {
      id: "note",
      label: "Add note to selected lines",
      shortcut: "c",
      run: startNote,
    },
  ];
  const guideContext: GuideContextId =
    activeFile && fileState.file?.kind === "text" ? (activeEditing ? "editor" : "file") : "review";
  const comparisonValue = state.comparison.kind;
  const comparisonChoices = [
    ...(workingAvailable
      ? [
          {
            value: "working",
            label: "Working changes",
            description: "HEAD to working files, including untracked",
          },
          { value: "staged", label: "Staged changes", description: "HEAD to the index" },
          {
            value: "unstaged",
            label: "Unstaged changes",
            description: "Index to working files",
          },
        ]
      : []),
    ...(!["working", "staged", "unstaged"].includes(comparisonValue)
      ? [
          {
            value: comparisonValue,
            label:
              state.comparison.kind === "commit"
                ? state.comparison.commit.slice(0, 7)
                : state.comparison.kind === "patch"
                  ? "Patch review"
                  : state.comparison.kind === "files"
                    ? "File comparison"
                    : "Revision range",
            description:
              state.comparison.kind === "commit"
                ? "This commit against its first parent"
                : state.comparison.kind === "range"
                  ? state.comparison.mergeBase
                    ? "Changes since the common ancestor"
                    : "Between two revisions"
                  : undefined,
          },
        ]
      : []),
  ];
  const fileLinkOpened = useRef(false);
  const fileLinkSelecting = useRef(false);
  const [fileLinkError, setFileLinkError] = useState("");
  useEffect(() => {
    if (
      location.pathname !== "/file" ||
      fileLinkOpened.current ||
      !state.session ||
      !browseSource ||
      !fileState.source
    )
      return;
    const params = new URLSearchParams(location.search);
    const repo = params.get("repo"),
      path = params.get("path");
    if (!repo || !path) return;
    if (browseSource.kind !== "worktree" || browseSource.repo !== repo) {
      if (fileLinkSelecting.current) return;
      const repository = state.repositories.find((item) =>
        item.worktrees.some((worktree) => worktree.path === repo),
      );
      if (!repository) {
        fileLinkOpened.current = true;
        // The URL can only be resolved after the host catalogue arrives.
        // oxlint-disable-next-line react/set-state-in-effect
        setFileLinkError("Register this worktree before opening its file link.");
        return;
      }
      fileLinkSelecting.current = true;
      void controller
        .selectWorktree(repo, repository.id)
        .catch((error) => setFileLinkError(String(error)));
      return;
    }
    if (sourceKey(fileState.source) !== sourceKey(browseSource)) return;
    fileLinkOpened.current = true;
    fileWorkspace.open(path, true, undefined, browseSource, "Working files");
  }, [
    state.session,
    state.repositories,
    browseSource,
    fileState.source,
    fileWorkspace,
    controller,
  ]);
  const actionRepo = state.review?.repo ?? state.session?.repository.path;
  const actionBranch = state.savedView
    ? (state.savedReview?.targets.find((target) => target.id === state.savedTargetId)?.branch ?? "")
    : (state.activeBranch ?? "");
  const actionHead =
    state.savedView || state.comparison.kind === "commit" || state.comparison.kind === "range"
      ? (state.review?.head ?? "")
      : (state.branches.find((branch) => branch.name === state.activeBranch)?.head ??
        state.session?.repository.head ??
        "");
  const added = state.review?.files.reduce((sum, file) => sum + file.additions, 0) ?? 0;
  const deleted = state.review?.files.reduce((sum, file) => sum + file.deletions, 0) ?? 0;
  const skipped = files.filter((file) => !file.metadata || mediaType(file.path)?.kind === "image");
  const orphaned = notes.filter(
    (note) =>
      !note.parentId &&
      (note.resolution === "orphaned" ||
        note.resolution === "stale" ||
        !files.some((file) => file.path === note.path && file.metadata)),
  );
  const loadedCommit =
    state.review?.comparison.kind === "commit" ? state.review.comparison.commit : "";

  const renderMetadataRows = () => (
    <div {...stylex.props(styles.skipped)}>
      {skipped.map((file) => (
        <div
          key={file.id}
          {...stylex.props(mediaType(file.path)?.kind !== "image" && styles.skippedRow)}
          data-metadata-file={file.path}
          ref={(node) => {
            if (node) metadataRows.current.set(file.id, node);
            else metadataRows.current.delete(file.id);
          }}
        >
          {mediaType(file.path)?.kind === "image" && state.review ? (
            <DiffImages
              path={file.path}
              previousPath={file.info.previousPath}
              status={file.info.status}
              reviewId={state.review.id}
              saved={
                state.savedView && state.savedReview && state.savedTargetId
                  ? { id: state.savedReview.id, target: state.savedTargetId }
                  : undefined
              }
              collapsed={collapsed.has(file.id)}
              onToggle={() =>
                setCollapsed((current) => {
                  const next = new Set(current);
                  if (next.has(file.id)) next.delete(file.id);
                  else next.add(file.id);
                  return next;
                })
              }
              onOpen={() => openWorkingFile(file.path)}
            />
          ) : (
            <>
              <Icon name="file" size={13} />
              <button
                role="link"
                {...stylex.props(styles.fileLink)}
                onPointerEnter={() => prefetchFile(file.path)}
                onFocus={() => prefetchFile(file.path)}
                onClick={(event) =>
                  openWorkingFile(file.path, true, event.metaKey || event.ctrlKey)
                }
              >
                {file.path}
              </button>
              <span {...stylex.props(ui.grow)} />
              <span {...stylex.props(ui.muted)}>
                {file.info.binary
                  ? "Binary file"
                  : file.info.tooLarge
                    ? "File exceeds preview limit"
                    : "Metadata-only change"}
              </span>
            </>
          )}
        </div>
      ))}
    </div>
  );

  const sidebarToggle = (
    <ToolButton
      label={sidebarVisible ? "Hide sidebar" : "Show sidebar"}
      shortcut="⌘ B"
      icon="panelLeft"
      aria-label="Toggle sidebar"
      aria-pressed={sidebarVisible}
      onClick={toggleReviewSidebar}
    />
  );
  const topTrailing = (
    <>
      <button
        type="button"
        aria-label="Open command palette"
        {...stylex.props(styles.commandBar)}
        onClick={() => setCommandsOpen(true)}
      >
        <Icon name="search" size={14} />
        <span {...stylex.props(styles.commandBarText)}>Search commands</span>
        <ShortcutKeys value="⌘ K" />
      </button>
      <ToolButton
        ref={zenToggle}
        label="Zen mode"
        shortcut="⌥ Z"
        icon="focus"
        aria-label="Enter zen mode"
        onClick={toggleZen}
      />
      {browseSource && (
        <ToolButton
          label={filesVisible ? "Hide files" : "Show files"}
          shortcut="⌘ ⇧ B"
          icon="panelRight"
          aria-label="Toggle files sidebar"
          aria-pressed={filesVisible}
          onClick={toggleFilesSidebar}
        />
      )}
    </>
  );
  const fileTabs = (quiet: boolean) =>
    !!browseSource && (
      <FileViewTabs
        quiet={quiet}
        tabs={fileState.tabs.map((tab) => ({
          ...tab,
          sourcePath: tab.source.repo,
          dirty: !!editorDrafts.get(JSON.stringify([tab.source, tab.path]))?.dirty,
        }))}
        active={fileState.active}
        changesCount={state.review ? state.files.length : undefined}
        onSelect={fileWorkspace.select}
        onClose={fileWorkspace.close}
        onPin={fileWorkspace.pin}
      />
    );
  const unsavedCount = fileState.tabs.filter(
    (tab) => editorDrafts.get(JSON.stringify([tab.source, tab.path]))?.dirty,
  ).length;
  const branchTabs = gitAvailable && (
    <BranchTabs
      leading={sidebarToggle}
      trailing={topTrailing}
      repositories={state.repositories}
      activeRepositoryId={state.activeRepositoryId}
      activeBranch={state.activeBranch}
      repo={state.session?.repository.path}
      error={state.branchesError}
      onBranch={(name, repositoryId) => void controller.selectBranch(name, repositoryId)}
      onWorktree={(path, repositoryId) => void controller.selectWorktree(path, repositoryId)}
      onAddRepository={controller.addRepository}
      onRemoveRepository={controller.removeRepository}
      onRefresh={controller.refreshRepositories}
      pickerOpen={branchPickerOpen}
      onPickerOpenChange={setBranchPickerOpen}
    />
  );
  if (!state.session && !state.repositories.length && state.status === "idle" && !state.error)
    return (
      <div {...stylex.props(styles.app)}>
        {branchTabs}
        <div {...stylex.props(styles.emptyRepositories)}>
          <span {...stylex.props(styles.emptyMark)}>
            <Icon name="branch" size={20} />
          </span>
          <h1 {...stylex.props(styles.emptyTitle)}>Add a repository to start</h1>
          <p {...stylex.props(styles.emptyDescription)}>
            Med reads Git history and working files. It never switches branches or runs code.
          </p>
          <button
            {...stylex.props(ui.button, ui.primary, ui.pressable, styles.emptyAction)}
            onClick={() => setBranchPickerOpen(true)}
          >
            Choose repositories
          </button>
        </div>
      </div>
    );

  return (
    <div
      {...stylex.props(styles.app)}
      data-theme={activeTheme.id}
      data-sidebar-visible={sidebarVisible}
      data-selected-branch={state.activeBranch ?? ""}
      data-selected-repository={state.activeRepositoryId ?? ""}
      data-selected-commit={loadedCommit}
      data-review-id={state.review?.id ?? ""}
      data-review-status={state.status}
      data-file-count={state.files.length}
      data-active-file={activeFile?.path ?? ""}
    >
      {state.savedReview && (
        <SavedReviewHeader
          controller={controller}
          state={state}
          browsing={fileState.active !== "changes"}
          browsingSourceLabel={activeFile?.sourceLabel ?? sourceLabel}
          onReturn={() => {
            pendingSavedChanges.current = state.savedTargetId;
            fileWorkspace.select("changes");
            void controller.returnToSavedReview();
          }}
          onTarget={(id) => {
            pendingSavedChanges.current = id;
            fileWorkspace.select("changes");
            void controller.selectSavedTarget(id);
          }}
        />
      )}
      {zen && (
        <ZenBar
          repository={state.session?.repository.name}
          branch={state.session ? (state.activeBranch ?? "detached") : undefined}
          context={
            fileState.active === "changes"
              ? comparisonChoices.find((choice) => choice.value === comparisonValue)?.label
              : undefined
          }
          tabs={fileTabs(true)}
          unsaved={unsavedCount}
          loading={state.status === "loading"}
          onCommands={() => setCommandsOpen(true)}
          onExit={toggleZen}
        />
      )}
      {/* Branch tabs stay mounted in zen mode so the branch picker still opens. */}
      <div hidden={zen} {...stylex.props(styles.topbarSlot, zen && styles.hiddenSurface)}>
        {branchTabs || (
          <header {...stylex.props(styles.plainTopbar)}>
            {sidebarToggle}
            <span {...stylex.props(ui.grow)} />
            {topTrailing}
          </header>
        )}
      </div>
      <ThemePicker open={themePickerOpen} onOpenChange={setThemePickerOpen} />
      {definitions && (
        <SymbolPicker
          open
          mode="project"
          definitionResult={definitions}
          source={definitions.source}
          sourceLabel={sourceLabel}
          api={browseApi}
          onOpenChange={(open) => {
            if (!open) setDefinitions(null);
          }}
          onOpen={(path, line, source, column) =>
            fileWorkspace.open(
              path,
              true,
              line,
              source,
              source.kind === "commit" ? `Commit ${source.oid.slice(0, 8)}` : sourceLabel,
              column,
            )
          }
        />
      )}
      <SymbolPicker
        sidebarWidth={sidebarVisible ? sidebarWidth : 316}
        beginFilePreview={beginFilePreview}
        open={symbolPickerOpen}
        onOpenChange={setSymbolPickerOpen}
        mode={symbolMode}
        onModeChange={setSymbolMode}
        source={symbolMode === "file" ? (activeFile?.source ?? null) : browseSource}
        path={activeFile?.path}
        identity={fileState.file?.kind === "text" ? fileState.file.identity : undefined}
        currentFile={fileState.file}
        sourceRevision={state.sourceRevision}
        sourceLabel={symbolMode === "file" ? (activeFile?.sourceLabel ?? sourceLabel) : sourceLabel}
        api={browseApi}
        onOpen={(path, line, source, column) =>
          fileWorkspace.open(
            path,
            false,
            line,
            source,
            source.kind === "commit" ? `Commit ${source.oid.slice(0, 8)}` : sourceLabel,
            column,
          )
        }
      />
      <FilePicker
        repositories={state.repositories}
        open={filePickerOpen && !!browseSource}
        onOpenChange={setFilePickerOpen}
        entries={repositoryFiles.entries}
        loading={repositoryFiles.loading}
        error={repositoryFiles.error}
        sourceLabel={sourceLabel}
        source={browseSource}
        api={browseApi}
        sourceRevision={state.sourceRevision}
        openPaths={fileState.tabs
          .filter((tab) => browseSource && sourceKey(tab.source) === sourceKey(browseSource))
          .map((tab) => tab.path)}
        recentPaths={fileState.recentPaths}
        initialMode={pickerMode}
        initialQuery={pickerQuery}
        resume={pickerResume}
        onOpen={(path, line, source) =>
          fileWorkspace.open(
            path,
            false,
            line,
            source,
            source?.kind === "commit"
              ? `Commit ${source.oid.slice(0, 8)}`
              : (source?.repo ?? sourceLabel),
          )
        }
      />
      <div
        {...stylex.props(styles.workspace, zen && styles.zenWorkspace)}
        id="review-workspace"
        role="tabpanel"
        aria-label={`${state.activeBranch ?? "Workspace"} review`}
      >
        {sidebarVisible && !zen && (
          <aside
            id="review-sidebar"
            className={stylex.props(styles.sidebar).className}
            style={{ width: sidebarWidth }}
          >
            {gitAvailable && (
              <HistoryPanel
                key={JSON.stringify([state.session?.repository.path, state.activeBranch])}
                commits={state.history}
                selected={state.comparison.kind === "commit" ? state.comparison.commit : undefined}
                selectedRange={
                  state.comparison.kind === "range" && state.comparison.includeBase
                    ? state.comparison
                    : undefined
                }
                working={state.comparison.kind === "working"}
                workingAvailable={workingAvailable}
                loading={state.historyLoading}
                hasMore={state.historyHasMore}
                error={state.historyError}
                onSelect={(commit) => {
                  fileWorkspace.select("changes");
                  void controller.selectComparison({ kind: "commit", commit });
                }}
                onSelectRange={(base, head) => {
                  fileWorkspace.select("changes");
                  void controller.selectComparison({
                    kind: "range",
                    base,
                    head,
                    includeBase: true,
                  });
                }}
                onLoadMore={() => void controller.loadMoreHistory()}
                onWorking={() => {
                  fileWorkspace.select("changes");
                  void controller.selectComparison({ kind: "working" });
                }}
              />
            )}
            <FileSidebar
              files={files}
              total={state.files.length}
              selected={state.selectedFileId}
              filter={state.filter}
              onFilter={(value) => controller.setFilter(value)}
              onSelect={reveal}
              onPrefetch={prefetchFile}
              onOpen={
                browseSource
                  ? (id, background) => {
                      const file = files.find((item) => item.id === id);
                      if (file) openWorkingFile(file.path, true, background);
                    }
                  : undefined
              }
              filterRef={filterRef}
            />
          </aside>
        )}
        {sidebarVisible && !zen && (
          <div
            role="separator"
            aria-label="Resize sidebar"
            aria-orientation="vertical"
            aria-valuenow={sidebarWidth}
            aria-valuemin={220}
            aria-valuemax={520}
            tabIndex={0}
            {...stylex.props(styles.divider, stylex.defaultMarker())}
            onKeyDown={(event) => {
              if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                event.preventDefault();
                setSidebarWidth((width) =>
                  Math.max(220, Math.min(520, width + (event.key === "ArrowLeft" ? -16 : 16))),
                );
              }
            }}
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={(event) => {
              if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
              const left =
                event.currentTarget.previousElementSibling?.getBoundingClientRect().left ?? 0;
              setSidebarWidth(Math.max(220, Math.min(520, event.clientX - left)));
            }}
          >
            <span {...stylex.props(styles.dividerLine)} />
          </div>
        )}
        <main
          {...stylex.props(styles.main, !sidebarVisible && styles.mainFlush)}
          aria-label="Continuous review"
        >
          {fileLinkError && (
            <div role="alert" {...stylex.props(styles.notice, styles.error)}>
              {fileLinkError}
            </div>
          )}
          {!zen && fileTabs(false)}
          <div
            id="file-view-panel"
            role="tabpanel"
            aria-label={activeFile ? `File ${activeFile.path}` : "Changes"}
            {...stylex.props(styles.reviewSurface)}
          >
            <div
              {...stylex.props(
                styles.reviewSurface,
                fileState.active !== "changes" && styles.hiddenSurface,
              )}
              aria-hidden={fileState.active !== "changes"}
            >
              <div {...stylex.props(styles.toolbar, zen && styles.hiddenSurface)} hidden={zen}>
                <ChoiceSelect
                  label="Comparison"
                  value={comparisonValue}
                  choices={comparisonChoices}
                  onChange={(value) => {
                    if (["working", "staged", "unstaged"].includes(value))
                      void controller.selectComparison({ kind: value } as Comparison);
                  }}
                />
                {actionRepo &&
                  state.status === "ready" &&
                  state.session?.repository.git !== false && (
                    <ComparisonActions
                      key={`${actionRepo}:${actionHead}:${actionBranch}`}
                      repo={actionRepo}
                      head={actionHead}
                      sourceBranch={actionBranch}
                      comparison={state.comparison}
                      onCompare={(base, head) => {
                        fileWorkspace.select("changes");
                        void controller.selectComparison({
                          kind: "range",
                          base,
                          head,
                          mergeBase: true,
                        });
                      }}
                    />
                  )}
                {state.review && (
                  <span
                    {...stylex.props(styles.compareLabel)}
                    title={`${state.review.base} → ${state.review.head}`}
                  >
                    <span {...stylex.props(styles.revision)}>
                      {shortRevision(state.review.base)}
                    </span>
                    <Icon name="arrowUp" size={11} style={{ transform: "rotate(90deg)" }} />
                    <span {...stylex.props(styles.revision)}>
                      {shortRevision(state.review.head)}
                    </span>
                  </span>
                )}
                {state.review && (
                  <span
                    {...stylex.props(styles.reviewTotals)}
                    role="group"
                    aria-label={`Comparison total: ${added} lines added, ${deleted} lines deleted`}
                    title="Total lines changed in this comparison"
                  >
                    <span {...stylex.props(ui.added)}>+{added.toLocaleString()}</span>
                    <span {...stylex.props(ui.removed)}>−{deleted.toLocaleString()}</span>
                    <DiffStat additions={added} deletions={deleted} />
                  </span>
                )}
                <span {...stylex.props(ui.grow)} />
                <SegmentedControl<"split" | "unified">
                  label="Diff layout"
                  value={mode}
                  onChange={setMode}
                  options={[
                    { value: "split", label: "Split", icon: "split" },
                    { value: "unified", label: "Unified", icon: "unified" },
                  ]}
                />
                <span {...stylex.props(styles.toolbarDivider)} />
                <ToolButton
                  label="Wrap lines"
                  icon="wrap"
                  active={wrap}
                  aria-pressed={wrap}
                  onClick={() => setWrap(!wrap)}
                />
                <ActionTooltip label={showNotes ? "Hide comments" : "Show comments"}>
                  <button
                    {...stylex.props(
                      ui.button,
                      ui.pressable,
                      styles.notesButton,
                      showNotes && ui.active,
                    )}
                    aria-label="Toggle notes"
                    aria-pressed={showNotes}
                    onClick={() => setShowNotes(!showNotes)}
                  >
                    <Icon name="note" size={15} />
                    {notes.length > 0 && (
                      <span {...stylex.props(styles.notesCount)}>{notes.length}</span>
                    )}
                  </button>
                </ActionTooltip>
                <ActionMenu
                  sections={[
                    selectedFile && browseSource
                      ? [
                          {
                            label:
                              browseSource.kind === "worktree"
                                ? "Open working file"
                                : "Open snapshot file",
                            onClick: () => openWorkingFile(selectedFile.path),
                          },
                          { label: "Reveal in Files", onClick: showFiles },
                        ]
                      : [],
                    [
                      { label: "Find in diffs", shortcut: "⌘ F", onClick: openFind },
                      ...(gitAvailable
                        ? [{ label: "Compare revisions…", onClick: () => setRangeOpen(!rangeOpen) }]
                        : []),
                    ],
                    [
                      {
                        label: "Show review notes",
                        checked: showNotes,
                        onClick: () => setShowNotes(!showNotes),
                      },
                      { label: "Wrap long lines", checked: wrap, onClick: () => setWrap(!wrap) },
                    ],
                    [
                      { label: "Zen mode", shortcut: "⌥ Z", onClick: toggleZen },
                      { label: "Refresh review", onClick: () => void controller.refresh() },
                    ],
                  ]}
                />
                <ToolButton
                  label="Refresh review"
                  icon="refresh"
                  busy={state.status === "loading"}
                  disabled={state.status === "loading"}
                  onClick={() => void controller.refresh()}
                />
                {state.status === "loading" && (
                  <span role="presentation" {...stylex.props(styles.loadingTrack)}>
                    <span {...stylex.props(styles.loadingBar)} />
                  </span>
                )}
              </div>
              {rangeOpen && (
                <form
                  {...stylex.props(styles.rangeBar)}
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (baseRef && headRef) {
                      void controller.selectComparison({
                        kind: "range",
                        base: baseRef,
                        head: headRef,
                      });
                      setRangeOpen(false);
                    }
                  }}
                >
                  <Icon name="compare" size={14} />
                  <span>Compare</span>
                  <input
                    aria-label="Base revision"
                    value={baseRef}
                    onChange={(event) => setBaseRef(event.target.value)}
                    {...stylex.props(ui.input, styles.revisionInput)}
                  />
                  <Icon name="arrowUp" size={12} style={{ transform: "rotate(90deg)" }} />
                  <input
                    aria-label="Head revision"
                    value={headRef}
                    onChange={(event) => setHeadRef(event.target.value)}
                    {...stylex.props(ui.input, styles.revisionInput)}
                  />
                  <button type="submit" {...stylex.props(ui.button, ui.primary, ui.pressable)}>
                    Review
                  </button>
                  <button
                    type="button"
                    {...stylex.props(ui.button, ui.iconButton)}
                    aria-label="Close revision comparison"
                    onClick={() => setRangeOpen(false)}
                  >
                    <Icon name="close" size={13} />
                  </button>
                </form>
              )}
              {state.error && (
                <div role="alert" {...stylex.props(styles.notice, styles.error)}>
                  <span>{state.error}</span>
                  <button {...stylex.props(ui.button)} onClick={() => void controller.refresh()}>
                    Retry
                  </button>
                </div>
              )}
              {state.notesError && (
                <div role="alert" {...stylex.props(styles.notice, styles.error)}>
                  Notes: {state.notesError}
                </div>
              )}
              {orphaned.length > 0 && showNotes && (
                <details {...stylex.props(styles.orphanPanel)}>
                  <summary>
                    {orphaned.length} preserved {orphaned.length === 1 ? "note" : "notes"} outside
                    this diff
                  </summary>
                  {orphaned.map((note) => (
                    <NoteCard
                      key={note.id}
                      note={note}
                      replies={notes.filter((reply) => reply.parentId === note.id)}
                      onMutate={(mutation) => controller.mutateNote(mutation)}
                    />
                  ))}
                </details>
              )}
              {contextError && (
                <div role="alert" {...stylex.props(styles.notice, styles.error)}>
                  <span>{contextError}</span>
                  <button {...stylex.props(ui.button)} onClick={() => setContextError(null)}>
                    Dismiss
                  </button>
                </div>
              )}
              {state.review?.warnings.map((warning) => (
                <div key={warning} {...stylex.props(styles.notice)}>
                  {warning}
                </div>
              ))}
              <div {...stylex.props(styles.stream)}>
                {findOpen && (
                  <div {...stylex.props(styles.findWidget)}>
                    <Icon name="search" size={14} />
                    <input
                      ref={findRef}
                      value={find}
                      onChange={(event) => {
                        setFind(event.target.value);
                        setFindIndex(0);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          jumpHit(event.shiftKey ? findIndex - 1 : findIndex + 1);
                        }
                        if (event.key === "Escape") {
                          event.stopPropagation();
                          setFindOpen(false);
                        }
                      }}
                      aria-label="Find in diff contents"
                      placeholder="Find in changed hunks"
                      {...stylex.props(styles.findInput)}
                    />
                    <span
                      {...stylex.props(
                        styles.findCount,
                        !!find && !hits.length && styles.findEmpty,
                      )}
                    >
                      {find
                        ? hits.length
                          ? `${Math.min(findIndex + 1, hits.length)} / ${hits.length} hunks`
                          : "No matches"
                        : ""}
                    </span>
                    <button
                      {...stylex.props(ui.button, ui.iconButton, styles.findButton)}
                      aria-label="Previous match"
                      disabled={!hits.length}
                      onClick={() => jumpHit(findIndex - 1)}
                    >
                      <Icon name="arrowUp" size={14} />
                    </button>
                    <button
                      {...stylex.props(ui.button, ui.iconButton, styles.findButton)}
                      aria-label="Next match"
                      disabled={!hits.length}
                      onClick={() => jumpHit(findIndex + 1)}
                    >
                      <Icon name="arrowDown" size={14} />
                    </button>
                    <button
                      {...stylex.props(ui.button, ui.iconButton, styles.findButton)}
                      aria-label="Close find"
                      onClick={() => setFindOpen(false)}
                    >
                      <Icon name="close" size={14} />
                    </button>
                  </div>
                )}
                {selection && (
                  <div
                    data-line-selection-controls
                    role="toolbar"
                    aria-label="Line selection"
                    {...stylex.props(styles.selectionbar)}
                  >
                    <span {...stylex.props(styles.selectionRange)}>
                      L{selection.range.start}
                      {selection.range.end !== selection.range.start
                        ? `–${selection.range.end}`
                        : ""}
                    </span>
                    <span {...stylex.props(styles.selectionLabel)}>selected</span>
                    <button
                      {...stylex.props(ui.button, ui.primary, ui.pressable, styles.selectionAction)}
                      aria-label="Add note"
                      onClick={startNote}
                    >
                      <Icon name="note" size={14} />
                      Add note
                      <kbd {...stylex.props(styles.selectionKey)}>c</kbd>
                    </button>
                    <button
                      {...stylex.props(ui.button, ui.iconButton, styles.selectionClose)}
                      aria-label="Clear line selection"
                      onClick={clearLineSelection}
                    >
                      <Icon name="close" size={14} />
                    </button>
                  </div>
                )}
                {items.length > 0 ? (
                  <CodeView
                    key={`${reviewScope}:${state.review?.id}`}
                    ref={viewer}
                    onScroll={(position) => {
                      if (fileState.active === "changes" && !restoringScroll.current) {
                        reviewScroll.current.delete(reviewScope);
                        reviewScroll.current.set(reviewScope, position);
                        while (reviewScroll.current.size > 256)
                          reviewScroll.current.delete(reviewScroll.current.keys().next().value!);
                      }
                    }}
                    items={items}
                    selectedLines={selection}
                    onSelectedLinesChange={setSelection}
                    options={options}
                    className={stylex.props(styles.codeView).className}
                    style={
                      {
                        "--diffs-font-family": tokens.code,
                        "--diffs-font-size": "12px",
                        "--diffs-line-height": "20px",
                        "--diffs-header-font-family": tokens.ui,
                        "--diffs-bg-context-override": tokens.canvas,
                        "--diffs-bg-context-gutter-override": tokens.canvas,
                        "--diffs-bg-separator-override": `color-mix(in srgb, ${tokens.canvas} 96.5%, ${tokens.text})`,
                        "--diffs-bg-buffer-override": `color-mix(in srgb, ${tokens.canvas} 98%, ${tokens.text})`,
                        "--diffs-fg-number-override": tokens.faint,
                        "--diffs-addition-color-override": tokens.green,
                        "--diffs-deletion-color-override": tokens.red,
                      } as CSSProperties
                    }
                    renderCustomHeader={(item) => {
                      const path = item.type === "diff" ? item.fileDiff.name : item.file.name;
                      const info = fileInfoById.get(item.id);
                      const slash = path.lastIndexOf("/") + 1;
                      const isCollapsed = collapsed.has(item.id);
                      const renamedFrom =
                        item.type === "diff" &&
                        item.fileDiff.prevName &&
                        item.fileDiff.prevName !== path
                          ? item.fileDiff.prevName
                          : null;
                      const status = !info
                        ? null
                        : info.untracked
                          ? { label: "Untracked", tone: styles.statusAdded }
                          : info.status.startsWith("A")
                            ? { label: "Added", tone: styles.statusAdded }
                            : info.status.startsWith("D")
                              ? { label: "Deleted", tone: styles.statusDeleted }
                              : renamedFrom
                                ? { label: "Renamed", tone: styles.statusRenamed }
                                : null;
                      return (
                        <div {...stylex.props(styles.diffHeader)}>
                          <button
                            {...stylex.props(styles.headerToggle)}
                            aria-label={`${isCollapsed ? "Expand" : "Collapse"} ${path}`}
                            aria-expanded={!isCollapsed}
                            onClick={() =>
                              setCollapsed((current) => {
                                const next = new Set(current);
                                if (next.has(item.id)) next.delete(item.id);
                                else next.add(item.id);
                                return next;
                              })
                            }
                          />
                          <span
                            {...stylex.props(styles.headerChevron, isCollapsed && styles.collapsed)}
                          >
                            <Icon name="chevron" size={14} />
                          </span>
                          {renamedFrom && (
                            <span {...stylex.props(styles.renamedFrom)} title={renamedFrom}>
                              {renamedFrom} →
                            </span>
                          )}
                          <button
                            role="link"
                            aria-label={path}
                            {...stylex.props(styles.fileLink)}
                            onPointerEnter={() => prefetchFile(path)}
                            onFocus={() => prefetchFile(path)}
                            onClick={(event) =>
                              openWorkingFile(path, true, event.metaKey || event.ctrlKey)
                            }
                            title={`Open full file · ${path}`}
                          >
                            <span {...stylex.props(styles.fileDirectory)}>
                              {path.slice(0, slash)}
                            </span>
                            <span {...stylex.props(styles.fileName)}>{path.slice(slash)}</span>
                          </button>
                          {status && (
                            <span {...stylex.props(styles.statusBadge, status.tone)}>
                              {status.label}
                            </span>
                          )}
                          <span {...stylex.props(ui.grow)} />
                          {info && (
                            <span {...stylex.props(styles.headerStats)}>
                              <span {...stylex.props(ui.added)}>+{info.additions}</span>
                              <span {...stylex.props(ui.removed)}>−{info.deletions}</span>
                              <DiffStat additions={info.additions} deletions={info.deletions} />
                            </span>
                          )}
                        </div>
                      );
                    }}
                    renderAnnotation={(annotation) =>
                      annotation.metadata?.draft ? (
                        <NoteComposer
                          key={JSON.stringify(annotation.metadata.draft)}
                          target={annotation.metadata.draft}
                          initialText={
                            pendingDraft?.target === annotation.metadata.draft
                              ? pendingDraft.note.text
                              : undefined
                          }
                          initialError={
                            pendingDraft?.target === annotation.metadata.draft
                              ? pendingDraft.error
                              : undefined
                          }
                          onSave={async (note) => {
                            const submission = {
                              target: annotation.metadata!.draft!,
                              reviewId: state.review?.id,
                              note,
                              existingIds: new Set(notes.map((entry) => entry.id)),
                            };
                            setPendingDraft(submission);
                            try {
                              await controller.mutateNote({ type: "add", note });
                            } catch (error) {
                              setPendingDraft((current) =>
                                current === submission
                                  ? {
                                      ...submission,
                                      error:
                                        error instanceof Error
                                          ? error.message
                                          : "Could not save comment",
                                    }
                                  : current,
                              );
                              throw error;
                            }
                          }}
                          onCancel={() => {
                            const target = annotation.metadata!.draft!;
                            if (draftRef.current === target) {
                              setDraft(null);
                              setSelection(null);
                            }
                            setPendingDraft((current) =>
                              current?.target === target ? null : current,
                            );
                          }}
                        />
                      ) : annotation.metadata?.note ? (
                        <NoteCard
                          note={annotation.metadata.note}
                          replies={notes.filter(
                            (note) => note.parentId === annotation.metadata?.note?.id,
                          )}
                          onMutate={(mutation) => controller.mutateNote(mutation)}
                        />
                      ) : null
                    }
                    renderCodeViewFooter={() =>
                      skipped.length ? (
                        renderMetadataRows()
                      ) : (
                        <div {...stylex.props(styles.streamEnd)}>
                          <span {...stylex.props(styles.streamRule)} />
                          End of review · {files.length} {files.length === 1 ? "file" : "files"}
                          <span {...stylex.props(styles.streamRule)} />
                        </div>
                      )
                    }
                  />
                ) : skipped.length && state.status !== "loading" && !state.error ? (
                  <div style={{ overflow: "auto", height: "100%" }}>{renderMetadataRows()}</div>
                ) : state.status !== "loading" && !state.error ? (
                  <div {...stylex.props(styles.emptyState)}>
                    <span {...stylex.props(styles.emptyMark, !skipped.length && styles.emptyDone)}>
                      <Icon name={skipped.length ? "file" : "check"} size={20} />
                    </span>
                    <h1 {...stylex.props(styles.emptyTitle)}>
                      {state.filter
                        ? "No matching diffs"
                        : skipped.length
                          ? "No text diff to display"
                          : "All caught up"}
                    </h1>
                    {skipped.length ? (
                      renderMetadataRows()
                    ) : (
                      <p {...stylex.props(styles.emptyDescription)}>
                        {state.comparison.kind === "working"
                          ? "Working tree clean."
                          : "No changed text files."}
                      </p>
                    )}
                  </div>
                ) : null}
              </div>
            </div>
            {activeFile && (
              <FullFileView
                editor={
                  activeFile.source.kind === "worktree" && browseApi.write
                    ? {
                        drafts: editorDrafts,
                        key: JSON.stringify([activeFile.source, activeFile.path]),
                        write: async (file, text) => {
                          if (file.source.kind !== "worktree") throw new Error("Read-only source");
                          const saved = await browseApi.write!(
                            file.source,
                            file.path,
                            file.identity,
                            text,
                          );
                          fileWorkspace.acceptWrite(saved);
                          return saved;
                        },
                        autoEdit:
                          location.pathname === "/file" &&
                          new URLSearchParams(location.search).get("edit") === "1" &&
                          new URLSearchParams(location.search).get("path") === activeFile.path,
                      }
                    : undefined
                }
                file={fileState.file}
                path={activeFile.path}
                loading={fileState.loading}
                error={fileState.error}
                stale={fileState.stale}
                loadBlame={loadBlame}
                loadChanges={browseApi.changes ? loadFileChanges : undefined}
                blameEnabled={blameEnabled}
                onBlameEnabledChange={setBlameEnabled}
                sourceLabel={activeFile.sourceLabel}
                line={activeFile.line}
                column={activeFile.column}
                vimEnabled={vimEnabled}
                onNavigationReady={onNavigationReady}
                onSelectionReaderReady={onSelectionReaderReady}
                onDefinition={goToDefinition}
                onSymbolPreviewReady={onSymbolPreviewReady}
                onRefresh={() => void fileWorkspace.refresh()}
                onClose={() => fileWorkspace.close(activeFile.id)}
                onOpenFile={(path, line) =>
                  fileWorkspace.open(path, true, line, activeFile.source, activeFile.sourceLabel)
                }
                onOpenBefore={
                  activeDiffFile && /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/.test(state.review?.base ?? "")
                    ? () => openVersion(activeDiffFile.path, "old")
                    : undefined
                }
                onOpenAfter={
                  activeDiffFile && /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/.test(state.review?.head ?? "")
                    ? () => openVersion(activeDiffFile.path, "new")
                    : undefined
                }
              />
            )}
          </div>
        </main>
        {browseSource && (
          <aside
            {...stylex.props(styles.filesSidebar, (!filesVisible || zen) && styles.hiddenSurface)}
            aria-label="Workspace files"
            hidden={!filesVisible || zen}
          >
            <RepositoryFiles
              key={JSON.stringify([sourceKey(browseSource), repositoryFiles.ignored])}
              {...repositoryFiles}
              sourceLabel={sourceLabel}
              selectedPath={activeFile?.path ?? selectedFile?.path ?? null}
              onPrefetch={prefetchFile}
              onPreview={(path) => openWorkingFile(path, false)}
              onPin={(path) => openWorkingFile(path, true)}
              onIgnoredChange={repositoryFiles.setIgnored}
              onRefresh={repositoryFiles.refresh}
              onClose={() => setFilesVisible(false)}
            />
          </aside>
        )}
      </div>
      <footer {...stylex.props(styles.statusbar, zen && styles.hiddenSurface)} hidden={zen}>
        <span {...stylex.props(styles.statusItem)}>
          <span
            key={state.sourceRevision}
            data-connection={state.connection}
            {...stylex.props(
              styles.statusDot,
              state.connection === "reconnecting" && styles.statusWaiting,
              state.connection !== "connected" &&
                state.connection !== "reconnecting" &&
                styles.statusIdle,
            )}
          />
          {activeFile
            ? editorDrafts.get(JSON.stringify([activeFile.source, activeFile.path]))?.editing
              ? "Editing file · Vim"
              : fileState.file?.media
                ? fileState.file.kind === "video"
                  ? "Video"
                  : "Image"
                : vimEnabled
                  ? "Read-only file · Vim"
                  : "Read-only file"
            : state.comparison.kind === "patch"
              ? "Patch review"
              : state.comparison.kind === "files"
                ? "File comparison"
                : state.comparison.kind === "commit" || state.comparison.kind === "range"
                  ? "Commit review"
                  : state.connection === "connected"
                    ? "Live review"
                    : state.connection === "reconnecting"
                      ? "Reconnecting…"
                      : "Connecting…"}
        </span>
        {activeFile ? (
          <span>
            {fileState.file
              ? `${fileState.file.size.toLocaleString()} bytes`
              : activeFile.sourceLabel}
          </span>
        ) : (
          <span {...stylex.props(styles.statusItem)}>
            <span>
              {state.files.length} {state.files.length === 1 ? "file" : "files"}
            </span>
            <span {...stylex.props(ui.added)}>+{added.toLocaleString()}</span>
            <span {...stylex.props(ui.removed)}>−{deleted.toLocaleString()}</span>
          </span>
        )}
        <span {...stylex.props(ui.grow)} />
        <span {...stylex.props(styles.selectedPath)}>{activeFile?.path ?? selectedFile?.path}</span>
        {!activeFile && state.metrics && (
          <span
            title="Request includes transfer; parse runs in a worker; frame measures React update to a frame after Pierre rendered."
            {...stylex.props(styles.performance)}
          >
            {Math.round(state.metrics.requestMs)} ms request · {Math.round(state.metrics.parseMs)}{" "}
            ms parse{frameMs !== null ? ` · ${Math.round(frameMs)} ms frame` : ""} ·{" "}
            {state.metrics.cacheHit
              ? "client cache"
              : state.review?.metrics.cacheHit
                ? "server cache"
                : "fresh"}
          </span>
        )}
        <ActionTooltip label="Shortcuts and commands" shortcut="?">
          <button
            {...stylex.props(ui.button, styles.helpButton)}
            onClick={() => setHelpOpen(true)}
            aria-label="Shortcuts and commands"
          >
            <kbd>?</kbd>
          </button>
        </ActionTooltip>
      </footer>
      <CommandDialog
        open={commandsOpen}
        onOpenChange={setCommandsOpen}
        commands={[...commands].sort((a, b) => commandRank(a.id) - commandRank(b.id))}
      />
      <ShortcutGuide
        open={helpOpen}
        onOpenChange={setHelpOpen}
        context={guideContext}
        commands={commands}
      />
    </div>
  );
}

const rise = stylex.keyframes({
  from: { opacity: 0, transform: "translate(-50%, 6px) scale(0.98)" },
  to: { opacity: 1, transform: "translate(-50%, 0) scale(1)" },
});
const appear = stylex.keyframes({ from: { opacity: 0 }, to: { opacity: 1 } });
const sweep = stylex.keyframes({
  from: { transform: "translateX(-100%)" },
  to: { transform: "translateX(320%)" },
});
// One ring per revision event: it confirms that a live update arrived.
const ping = stylex.keyframes({
  from: { boxShadow: `0 0 0 0 color-mix(in srgb, ${tokens.green} 55%, transparent)` },
  to: { boxShadow: `0 0 0 6px color-mix(in srgb, ${tokens.green} 0%, transparent)` },
});
const reduced = "@media (prefers-reduced-motion: reduce)";
const headerBackground = `color-mix(in srgb, ${tokens.canvas} 96%, ${tokens.text})`;

const styles = stylex.create({
  app: {
    position: "fixed",
    inset: 0,
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    color: tokens.text,
    backgroundColor: tokens.panel,
    fontFamily: tokens.ui,
    fontSize: 12,
    isolation: "isolate",
    WebkitFontSmoothing: "antialiased",
  },
  plainTopbar: {
    display: "flex",
    alignItems: "center",
    gap: 4,
    height: 40,
    minHeight: 40,
    paddingInline: 8,
    backgroundColor: tokens.panel,
  },
  commandBar: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    width: "clamp(160px, 22vw, 280px)",
    height: 28,
    marginInlineEnd: 4,
    paddingInlineStart: 9,
    paddingInlineEnd: 5,
    borderWidth: 0,
    borderRadius: 7,
    backgroundColor: { default: tokens.fill, ":hover": tokens.fillStrong },
    boxShadow: `inset 0 0 0 1px ${tokens.line}`,
    color: { default: tokens.faint, ":hover": tokens.muted },
    fontFamily: tokens.ui,
    fontSize: 12,
    cursor: "pointer",
    outline: { default: "none", ":focus-visible": `2px solid ${tokens.accentLine}` },
  },
  commandBarText: {
    flex: "1",
    textAlign: "start",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  emptyRepositories: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    flex: "1",
    marginInline: 6,
    marginBottom: 6,
    borderRadius: 10,
    backgroundColor: tokens.canvas,
    boxShadow: `0 0 0 1px ${tokens.line}`,
    color: tokens.muted,
    fontFamily: tokens.ui,
  },
  emptyAction: { marginTop: 14, paddingInline: 12 },
  // The frame holds both sidebars; the review sits on one inset card.
  workspace: { display: "flex", flex: "1", minHeight: 0, paddingInline: 6 },
  zenWorkspace: { paddingBottom: 6 },
  topbarSlot: { display: "contents" },
  sidebar: {
    display: "flex",
    flexDirection: "column",
    flexShrink: 0,
    backgroundColor: tokens.panel,
    minWidth: 180,
    maxWidth: "45vw",
  },
  divider: {
    position: "relative",
    display: "flex",
    justifyContent: "center",
    width: 6,
    minWidth: 6,
    cursor: "col-resize",
    zIndex: 2,
    outline: "none",
    touchAction: "none",
  },
  // Show the handle only after a short hover so passing the pointer across
  // the gap does not flash it, as in VS Code's sashes.
  dividerLine: {
    width: 2,
    height: "100%",
    borderRadius: 1,
    backgroundColor: tokens.accentLine,
    opacity: {
      default: 0,
      [stylex.when.ancestor(":hover")]: 1,
      [stylex.when.ancestor(":focus-visible")]: 1,
      [stylex.when.ancestor(":active")]: 1,
    },
    transitionProperty: "opacity",
    transitionDuration: "120ms",
    transitionDelay: {
      default: "0ms",
      [stylex.when.ancestor(":hover")]: "250ms",
      [stylex.when.ancestor(":active")]: "0ms",
    },
  },
  main: {
    position: "relative",
    minWidth: 0,
    flex: "1",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    backgroundColor: tokens.canvas,
    borderRadius: 10,
    boxShadow: `0 0 0 1px ${tokens.line}, 0 1px 3px #0000000f`,
  },
  mainFlush: {},
  reviewSurface: {
    position: "relative",
    display: "flex",
    flexDirection: "column",
    flex: "1",
    minHeight: 0,
    minWidth: 0,
  },
  hiddenSurface: { display: "none" },
  filesSidebar: {
    width: 280,
    maxWidth: "42vw",
    minWidth: 200,
    flexShrink: 0,
    display: "flex",
    marginInlineStart: 6,
    backgroundColor: tokens.panel,
  },
  toolbar: {
    position: "relative",
    display: "flex",
    alignItems: "center",
    gap: 4,
    flexShrink: 0,
    height: 40,
    minHeight: 40,
    paddingInlineStart: 8,
    paddingInlineEnd: 8,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: tokens.line,
  },
  compareLabel: {
    display: { default: "inline-flex", "@media (max-width: 1100px)": "none" },
    alignItems: "center",
    gap: 4,
    marginInlineStart: 6,
    color: tokens.faint,
    flexShrink: 0,
  },
  revision: {
    paddingInline: 5,
    borderRadius: 4,
    backgroundColor: tokens.fill,
    color: tokens.muted,
    fontFamily: tokens.code,
    fontSize: 10.5,
    lineHeight: "18px",
  },
  reviewTotals: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    marginInlineStart: 8,
    fontFamily: tokens.code,
    fontSize: 11,
    whiteSpace: "nowrap",
    flexShrink: 0,
  },
  toolbarDivider: {
    width: 1,
    height: 16,
    marginInline: 4,
    backgroundColor: tokens.line,
  },
  notesButton: { gap: 5, minWidth: 28, paddingInline: 6 },
  notesCount: { fontFamily: tokens.code, fontSize: 10.5, fontVariantNumeric: "tabular-nums" },
  // Only loads that last long enough to notice show progress.
  loadingTrack: {
    position: "absolute",
    insetInline: 0,
    bottom: -1,
    height: 2,
    overflow: "hidden",
    pointerEvents: "none",
    opacity: 0,
    animationName: appear,
    animationDuration: "200ms",
    animationDelay: "300ms",
    animationFillMode: "forwards",
  },
  loadingBar: {
    display: "block",
    width: "30%",
    height: "100%",
    borderRadius: 1,
    backgroundImage: `linear-gradient(90deg, transparent, ${tokens.accent}, transparent)`,
    animationName: { default: sweep, [reduced]: "none" },
    animationDuration: "1100ms",
    animationTimingFunction: tokens.easeInOut,
    animationIterationCount: "infinite",
  },
  rangeBar: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexShrink: 0,
    minHeight: 44,
    paddingInline: 12,
    color: tokens.muted,
    backgroundColor: tokens.fill,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: tokens.line,
  },
  revisionInput: { maxWidth: 220, fontFamily: tokens.code, fontSize: 11.5 },
  // Find floats over the stream so opening it never moves the code.
  stream: {
    position: "relative",
    display: "flex",
    flexDirection: "column",
    flex: "1",
    minHeight: 0,
  },
  findWidget: {
    position: "absolute",
    top: 8,
    right: 16,
    zIndex: 20,
    display: "flex",
    alignItems: "center",
    gap: 2,
    height: 36,
    boxSizing: "border-box",
    paddingInlineStart: 10,
    paddingInlineEnd: 4,
    borderRadius: 9,
    backgroundColor: tokens.raised,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: tokens.lineStrong,
    boxShadow: tokens.shadow,
    color: tokens.faint,
  },
  findInput: {
    width: 220,
    height: 28,
    marginInlineStart: 6,
    borderWidth: 0,
    outline: "none",
    backgroundColor: "transparent",
    color: tokens.text,
    fontFamily: tokens.ui,
    fontSize: 12.5,
    "::placeholder": { color: tokens.faint },
  },
  findCount: {
    whiteSpace: "nowrap",
    fontFamily: tokens.code,
    fontSize: 10.5,
    minWidth: 76,
    paddingInlineEnd: 4,
    textAlign: "end",
    color: tokens.muted,
    fontVariantNumeric: "tabular-nums",
  },
  findEmpty: { color: tokens.red },
  findButton: { width: 26, minWidth: 26, minHeight: 26, height: 26 },
  notice: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    flexShrink: 0,
    paddingInline: 14,
    minHeight: 34,
    fontSize: 12,
    color: tokens.warning,
    backgroundColor: `color-mix(in srgb, ${tokens.warning} 8%, transparent)`,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: tokens.line,
  },
  error: {
    color: tokens.red,
    backgroundColor: `color-mix(in srgb, ${tokens.red} 8%, transparent)`,
  },
  orphanPanel: {
    flexShrink: 0,
    padding: 12,
    color: tokens.warning,
    backgroundColor: `color-mix(in srgb, ${tokens.warning} 6%, transparent)`,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: tokens.line,
    fontSize: 12,
    maxHeight: 260,
    overflowY: "auto",
  },
  // A contextual action pill: it rises into view and never shifts the code.
  selectionbar: {
    position: "absolute",
    bottom: 18,
    left: "50%",
    zIndex: 20,
    display: "flex",
    alignItems: "center",
    gap: 6,
    height: 40,
    boxSizing: "border-box",
    paddingInlineStart: 14,
    paddingInlineEnd: 5,
    borderRadius: 11,
    backgroundColor: tokens.raised,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: tokens.lineStrong,
    boxShadow: tokens.shadow,
    transform: "translate(-50%, 0)",
    animationName: { default: rise, [reduced]: "none" },
    animationDuration: "180ms",
    animationTimingFunction: tokens.easeOut,
    whiteSpace: "nowrap",
  },
  selectionRange: {
    color: tokens.accent,
    fontFamily: tokens.code,
    fontSize: 11.5,
    fontVariantNumeric: "tabular-nums",
  },
  selectionLabel: { color: tokens.muted, fontSize: 12, marginInlineEnd: 6 },
  selectionAction: { height: 30, minHeight: 30, paddingInlineStart: 9, paddingInlineEnd: 6 },
  selectionKey: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minWidth: 16,
    height: 16,
    marginInlineStart: 2,
    borderRadius: 4,
    backgroundColor: `color-mix(in srgb, ${tokens.canvas} 18%, transparent)`,
    fontFamily: tokens.ui,
    fontSize: 10,
    fontWeight: 500,
  },
  selectionClose: { width: 30, minWidth: 30, height: 30, minHeight: 30 },
  codeView: { flex: "1", minHeight: 0, height: "100%", overflow: "auto", scrollbarWidth: "thin" },
  diffHeader: {
    position: "relative",
    pointerEvents: "none",
    display: "flex",
    alignItems: "center",
    gap: 8,
    paddingBlock: 0,
    paddingInlineStart: 8,
    paddingInlineEnd: 14,
    backgroundColor: headerBackground,
    boxShadow: `inset 0 -1px 0 ${tokens.line}, inset 0 1px 0 ${tokens.line}`,
    color: tokens.text,
    fontFamily: tokens.ui,
    fontSize: 12.5,
    minHeight: 36,
  },
  headerToggle: {
    position: "absolute",
    inset: 0,
    borderWidth: 0,
    backgroundColor: { default: "transparent", ":hover": tokens.fill },
    cursor: "pointer",
    pointerEvents: "auto",
    outline: { default: "none", ":focus-visible": `2px solid ${tokens.accentLine}` },
    outlineOffset: -2,
  },
  headerChevron: {
    position: "relative",
    display: "inline-flex",
    color: tokens.faint,
    transitionProperty: "transform",
    transitionDuration: { default: "150ms", [reduced]: "0ms" },
    transitionTimingFunction: tokens.easeOut,
  },
  collapsed: { transform: "rotate(-90deg)" },
  renamedFrom: {
    position: "relative",
    maxWidth: "30%",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    color: tokens.faint,
    textDecoration: "line-through",
    textDecorationColor: tokens.lineStrong,
  },
  fileLink: {
    display: "inline-flex",
    maxWidth: "75%",
    position: "relative",
    pointerEvents: "auto",
    minWidth: 0,
    borderWidth: 0,
    backgroundColor: "transparent",
    color: tokens.text,
    fontFamily: tokens.ui,
    fontSize: 12.5,
    cursor: "pointer",
    textAlign: "left",
    padding: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    textDecoration: { default: "none", ":hover": "underline" },
    textDecorationColor: tokens.lineStrong,
    textUnderlineOffset: 3,
  },
  fileDirectory: {
    color: tokens.muted,
    minWidth: 0,
    flexShrink: 1,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  fileName: {
    fontWeight: 550,
    flexShrink: 0,
    maxWidth: "100%",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  statusBadge: {
    position: "relative",
    flexShrink: 0,
    paddingInline: 6,
    borderRadius: 4,
    fontSize: 10.5,
    fontWeight: 500,
    lineHeight: "17px",
  },
  statusAdded: {
    color: tokens.green,
    backgroundColor: `color-mix(in srgb, ${tokens.green} 13%, transparent)`,
  },
  statusDeleted: {
    color: tokens.red,
    backgroundColor: `color-mix(in srgb, ${tokens.red} 13%, transparent)`,
  },
  statusRenamed: { color: tokens.accent, backgroundColor: tokens.accentSoft },
  headerStats: {
    position: "relative",
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    fontFamily: tokens.code,
    fontSize: 11,
  },
  skipped: { paddingBlock: 6, paddingInline: 14, backgroundColor: tokens.canvas },
  skippedRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    minHeight: 36,
    fontSize: 12.5,
    color: tokens.muted,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: tokens.line,
  },
  streamEnd: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    paddingBlock: 28,
    paddingInline: 24,
    color: tokens.faint,
    fontSize: 11.5,
    whiteSpace: "nowrap",
  },
  streamRule: { flex: "1", height: 1, backgroundColor: tokens.line },
  emptyState: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    flex: "1",
    minHeight: 180,
    color: tokens.faint,
    padding: 30,
  },
  emptyMark: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 44,
    height: 44,
    marginBottom: 10,
    borderRadius: 12,
    color: tokens.muted,
    backgroundColor: tokens.fill,
    boxShadow: `inset 0 0 0 1px ${tokens.line}`,
  },
  emptyDone: {
    color: tokens.green,
    backgroundColor: `color-mix(in srgb, ${tokens.green} 10%, transparent)`,
    boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${tokens.green} 22%, transparent)`,
  },
  emptyTitle: { fontSize: 15, fontWeight: 550, color: tokens.text, margin: 0 },
  emptyDescription: {
    fontSize: 12.5,
    lineHeight: 1.6,
    color: tokens.muted,
    maxWidth: 380,
    textAlign: "center",
    whiteSpace: "pre-wrap",
    marginBlock: 4,
  },
  statusbar: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    flexShrink: 0,
    paddingInline: 14,
    height: 28,
    minHeight: 28,
    backgroundColor: tokens.panel,
    color: tokens.faint,
    fontSize: 11,
  },
  statusItem: { display: "inline-flex", alignItems: "center", gap: 7, whiteSpace: "nowrap" },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: "50%",
    backgroundColor: tokens.green,
    animationName: { default: ping, [reduced]: "none" },
    animationDuration: "900ms",
    animationTimingFunction: tokens.easeOut,
  },
  statusWaiting: { backgroundColor: tokens.warning, animationName: "none" },
  statusIdle: { backgroundColor: tokens.faint, animationName: "none" },
  selectedPath: {
    maxWidth: 280,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    color: tokens.faint,
    display: { default: "inline", "@media (max-width: 1000px)": "none" },
  },
  performance: {
    color: tokens.faint,
    fontFamily: tokens.code,
    fontSize: 10,
    whiteSpace: "nowrap",
    fontVariantNumeric: "tabular-nums",
    opacity: 0.8,
    display: { default: "inline", "@media (max-width: 900px)": "none" },
  },
  helpButton: {
    minHeight: 20,
    height: 20,
    paddingInline: 6,
    fontSize: 10.5,
    color: tokens.faint,
    boxShadow: `inset 0 0 0 1px ${tokens.line}`,
    borderRadius: 5,
  },
});
