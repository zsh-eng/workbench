import { useDocumentTitle } from "./data/document-title";
import { DiffImages } from "./components/MediaView";
import { mediaType } from "../shared/media";
import { ToolButton, tooltip } from "./components/ToolButton";
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
  lazy,
  memo,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ComponentProps,
  type ReactNode,
} from "react";
import {
  changesBase,
  type Comparison,
  type Note,
  type NoteInput,
  type PullRequestThread,
  type SourceResponse,
} from "../shared/protocol";
import {
  changesCommits,
  hasReview,
  useReviewController,
  type ReviewController,
} from "./data/controller";
import { tokens, ui } from "./theme.stylex";
import { relativeTime, useMinuteClock } from "./data/relative-time";
import {
  ActionMenu,
  ChoiceLabel,
  ChoiceSelect,
  CommandDialog,
  SegmentedControl,
  type MenuAction,
  type ReviewCommand,
} from "./components/Controls";
import { DiffStat } from "./components/DiffStat";
import { ChangeTotals } from "./components/ChangeTotals";
import { FileSidebar } from "./components/FileSidebar";
import { GeneratedGroup, type GeneratedRow } from "./components/GeneratedGroup";
import { generatedIndex, splitGenerated, useProvenance } from "./data/generated";
import { DependencyCard } from "./components/DependencyCard";
import {
  setDependencyLookups,
  useDependencyInfo,
  useDependencyLookups,
  useGeneratedSummaries,
  useManifestChanges,
} from "./data/dependencies";
import { GENERATED_LABELS } from "../shared/generated";
import { NoteCard, NoteComposer, sameTarget, type NoteTarget } from "./components/NoteCard";
import { Icon, type IconName } from "./components/Icon";
import "./pierre-theme";
import { hydratePartialDiff } from "@pierre/diffs";
import { useTheme } from "./themes";
import { ThemePicker } from "./components/ThemePicker";
import { BranchStrip, BranchSwitch, useBranchTabs } from "./components/BranchTabs";
import {
  InTitleBand,
  useDisposeOnClose,
  useWindowDrafts,
  useShell,
  useTabCommands,
  useThread,
  useThreadReader,
  useThreadState,
  useWorkspace,
  useWorkspaceEntry,
  useWorkspaceShown,
} from "./components/Workspaces";
import { whenFree, whenIdle } from "./data/idle";
import type { BranchEntry } from "./components/BranchPicker";
import { visibleElement } from "./data/palette-focus";
import { setFilePreviewShown, useFilePreviewShown } from "./data/picker-preferences";
import { BranchPicker } from "./components/BranchPicker";
import type { BrowseSource } from "../shared/browse";
import {
  agentName,
  handoffTargets,
  threadCheckout,
  type AgentSession,
  type SavedReviewTarget,
} from "../shared/saved-review";
import { createBrowseApi, useBrowseFiles, useVaults, type BrowseApi } from "./data/browse";
import { useMentionSources } from "./data/mentions";
import { isBrowseFile, type FileRead } from "../shared/local-file";
import { createFileWorkspace, sourceKey, useFileWorkspace } from "./data/file-workspace";
import { RepositoryFiles } from "./components/RepositoryFiles";
import { PaneTree, paneHandle, usePaneTree, type PaneSpec } from "./components/PaneTree";
import type { PaneNode, Side } from "./data/pane-tree";
import { FilePicker } from "./components/FilePicker";
import { SEARCH_OPEN_EVENT, SearchView, type SearchOpen } from "./components/SearchView";
import { subscribeFileOpens, takeFileOpen, takeSearchOpen } from "./data/file-opens";
import { subscribeSubagentOpens, takeSubagentOpen } from "./data/tabs";
import { useTurnRecap } from "./data/turn-recap";
import { SymbolPicker } from "./components/SymbolPicker";
import {
  FullFileView,
  preloadFileEditor,
  type BeginFileSymbolPreview,
} from "./components/FullFileView";
import { preloadable } from "./components/preloadable";
import { FileViewTabs } from "./components/FileViewTabs";
import { checkoutNameFor } from "./data/checkout-names";
import { readBrowserToken } from "./data/auth";
import { createApi } from "./data/api";
import { createCommitApi, type CommitApi } from "./data/commit";
import {
  PullRequestThreadCard,
  AgentReplyContext,
  CodexFindingCard,
  GuideNoteCard,
  PullRequestPanel,
  type AgentReplyTarget,
  type FindingPlacement,
  useCodexReviews,
  usePullRequestComments,
} from "./components/PullRequestComments";
import { placeThreads } from "./data/pull-request";
import { createPathValue, hoveredPath, usePathValue, type PathValue } from "./data/hovered-path";
import { PathLabel } from "./components/PathLabel";
import type { CodexFinding, CodexReviewRun } from "../shared/codex-review";
import {
  PullRequestTitle,
  SavedReviewHeader,
  type SavedReviewActions,
} from "./components/SavedReviewHeader";
import {
  comparisonLabel,
  type ComparisonLabel,
  ConnectionNotice,
  useQuietMenu,
  useRowFit,
  useSlotFits,
} from "./components/QuietChrome";
import { setChromeMode, useQuietChrome } from "./data/chrome";
import { ShortcutGuide } from "./components/ShortcutGuide";
import { ZenContext, ZenExit, ZenHint } from "./components/ZenExit";
import { platform } from "./data/keys";
import type { GuideContextId } from "./data/shortcut-guide";
import {
  ComparisonActions,
  useGitTargets,
  type ComparisonActionsHandle,
} from "./components/ComparisonActions";
import {
  createBlameLoader,
  createCommitLoader,
  type BlameLoader,
  type CommitLoader,
} from "./data/blame";

import { createEditorDrafts } from "./data/editor-drafts";
import { createFilePrefetch } from "./data/file-prefetch";
import { createRenderDiagnostics } from "./data/render-diagnostics";
import { findDefinitions } from "./data/definitions";
import type { SymbolSearch } from "../shared/symbols";
import { clipboardBrief, joinNotes, matchReviewFile, parseBriefHref } from "./data/brief";
import { questionExcerpt, useQuestion } from "./data/questions";
import { questionComment } from "../shared/questions";
import { foundThreadId } from "../shared/found-sessions";
import type { BriefLocation } from "./components/BriefView";
import { SaveReviewDialog } from "./components/SaveReviewDialog";
import { GuideRail } from "./components/guide/GuideRail";
import { ChangesRail, RangeCommits } from "./components/ChangesRail";
import { LayerMenu, StackRail, type StackMode } from "./components/StackRail";
import {
  layerProgress,
  layerRange,
  nextUnreviewed,
  rangeOf,
  setLayerViewed,
  subscribeLayers,
  takeLayer,
  stackOf,
  useLayerViewed,
  type LayerProgress,
} from "./data/stack";
import { GuideOverview } from "./components/guide/GuideOverview";
import { CommitHeader, GuideFooter, SegmentHeader } from "./components/guide/GuideHeader";
import { resolveGuide, type GuideNote, type GuideScope, type GuideSection } from "./data/guide";
import { useViewed, viewKey } from "./data/viewed";
import type { ParsedReviewFile } from "../shared/review";
import type { SavedCommit } from "../shared/review-guide";
import { requestServerRestart } from "./components/UpdateNotice";
import type { PathActions } from "./components/PathMenu";
import { diffSurfaceStyle, EXPANSION_LINES } from "./components/diff-surface";
import { highlightRules } from "./code-colors";
import { createDiffFindHighlights } from "./data/diff-find-highlights";
import { openIn, useAgentInbox } from "./data/agent-inbox";
import type { ComposerAttachment } from "./components/session/SessionComposer";
import type { SessionPins, SessionStarter } from "./components/session/SessionPanel";
import { useAgentPresets } from "./data/owned-session";
import { useFoundCommands } from "./data/found-threads";
import { createFileIndex } from "./data/file-refs";
import type { FileRefs } from "./components/FileRefs";

// The brief loads its Markdown worker and excerpt renderer only when shown.
const BriefView = lazy(() => import("./components/BriefView"));
// Memoized: the tab stays mounted once shown, and the review around it
// renders again for unrelated state, such as an open palette.
const CommitView = preloadable<ComponentProps<typeof import("./components/CommitView").default>>(
  () =>
    import("./components/CommitView").then((module) => ({
      default: memo(module.default),
    })),
);
// The editor and the Commit tab load while the window is free, so the first
// file or Commit tab opens at once rather than after React's 300 ms hold.
let panesPreloaded = false;
function preloadPanes() {
  if (panesPreloaded) return;
  panesPreloaded = true;
  preloadFileEditor();
  CommitView.preload();
}
const SessionPanel = lazy(() =>
  import("./components/session/SessionPanel").then((module) => ({
    default: module.SessionPanel,
  })),
);
const SessionStart = lazy(() =>
  import("./components/session/SessionPanel").then((module) => ({
    default: module.SessionStart,
  })),
);
const FoundSessionPane = lazy(() =>
  import("./components/session/FoundSession").then((module) => ({
    default: module.FoundSessionPane,
  })),
);
// The Question pane loads with the first question.
const QuestionPane = lazy(() => import("./components/QuestionPane"));
const NO_SESSIONS: AgentSession[] = [];
const NO_COMMITS: SavedCommit[] = [];
const NO_FILES: ParsedReviewFile[] = [];
const NO_SECTIONS: GuideSection[] = [];
const NO_PROGRESS: LayerProgress[] = [];
// Pierre's view renders its file headers and comments again whenever it renders.
const ReviewCodeView = memo(CodeView) as typeof CodeView;

/** A file's two sides for Pierre, from its full text. The cache keys name
 * the review's version, so a read ahead and an expansion share highlighting. */
function loadedDiffFiles(metadata: FileDiffMetadata, source: SourceResponse) {
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
}

/** A note's card sits below the last line of its range, as on GitHub, when
 * one hunk shows the whole range; otherwise below its first line. */
function noteLine(
  metadata: FileDiffMetadata | null,
  note: { side: "old" | "new"; line: number; endLine?: number },
) {
  const end = note.endLine ?? note.line;
  const whole = metadata?.hunks.some((hunk) => {
    const start = note.side === "old" ? hunk.deletionStart : hunk.additionStart;
    const count = note.side === "old" ? hunk.deletionCount : hunk.additionCount;
    return note.line >= start && end < start + count;
  });
  return whole ? end : note.line;
}

/** Whether a hunk shows the line that a note's card sits below. */
function shownLine(
  metadata: FileDiffMetadata | null,
  note: { side: "old" | "new"; line: number; endLine?: number },
) {
  const line = noteLine(metadata, note);
  return !!metadata?.hunks.some((hunk) => {
    const start = note.side === "old" ? hunk.deletionStart : hunk.additionStart;
    const count = note.side === "old" ? hunk.deletionCount : hunk.additionCount;
    return line >= start && line < start + count;
  });
}

/** A guide note on lines, not on its whole file. */
const onLines = (note: GuideNote): note is GuideNote & { line: number } => note.line !== undefined;

type Annotation = {
  note?: Note;
  draft?: NoteTarget;
  thread?: PullRequestThread;
  finding?: { finding: CodexFinding; run: CodexReviewRun };
  guide?: GuideNote;
};
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

/**
 * The status bar's path: the file row under the pointer, else the file that
 * shows, or on the Commit tab the file that its list is on. It renders alone,
 * so a pointer over the lists does not render the review again.
 */
function StatusPath({ shown, commit }: { shown: string | undefined; commit: PathValue | null }) {
  const hovered = usePathValue(hoveredPath);
  const focused = usePathValue(commit ?? hoveredPath);
  const path = hovered ?? (commit ? focused : shown);
  return (
    <span {...stylex.props(styles.selectedPath)}>
      {path && <PathLabel path={path} quiet={false} />}
    </span>
  );
}

function readPreference<T extends string>(key: string, fallback: T, values: readonly T[]): T {
  try {
    const value = localStorage.getItem(`med:${key}`);
    return values.includes(value as T) ? (value as T) : fallback;
  } catch {
    return fallback;
  }
}

/** Where each pane opens beside the review, and its share of the room. */
const PANE_PLACES: Record<string, { near?: string; side: Side; share: number }> = {
  session: { near: "review", side: "left", share: 0.5 },
  changed: { near: "review", side: "left", share: 0.24 },
  files: { near: "review", side: "right", share: 0.26 },
  // At the right of the row, with room from the thread and the review alike,
  // so that an answer has room to read.
  question: { side: "right", share: 0.3 },
};

/** The narrowest review pane that shows a split diff, in pixels. */
const SPLIT_MIN_WIDTH = 760;
/** Below this width, the line selection bar leaves out its label and keys. */
const SELECTION_BAR_FULL_WIDTH = 420;
/** The Question pane's width to aim for, in pixels; a narrow row gives it more. */
const QUESTION_WIDTH = 320;

export function App({
  controller,
  browseApi: providedBrowseApi,
  loadBlame: providedBlameLoader,
  loadCommit: providedCommitLoader,
  onOpenReview: providedOpenReview,
  commitApi: providedCommitApi,
  sessionFetch,
}: {
  controller: ReviewController;
  /** Reads agent session streams; tests pass a fake host. */
  sessionFetch?: typeof fetch;
  /** The Commit tab's Git writes for a checkout; tests pass a fake repository. */
  commitApi?: (repo: string) => CommitApi;
  browseApi?: BrowseApi;
  loadBlame?: BlameLoader;
  loadCommit?: CommitLoader;
  /** Show a newly saved review. */
  onOpenReview?(id: string): void;
}) {
  const state = useReviewController(controller);
  // Inside a workspace host, the host owns the controller and the address.
  const workspace = useWorkspace();
  const workspaceId = workspace?.id;
  const shown = useWorkspaceShown();
  // While the thread's agent works, its changes are expected: the drift bar waits.
  const agentWorking = useThreadState(state.savedReview?.id) === "working";
  const onOpenReview =
    providedOpenReview ??
    ((id: string) =>
      workspace
        ? workspace.open({ kind: "review", reviewId: id })
        : location.assign(`/review/${encodeURIComponent(id)}`));
  // Several workspaces can be mounted; their landmarks need distinct ids.
  const idPrefix = workspace ? `${workspace.id}-` : "";
  const gitAvailable = state.session?.repository.git !== false;
  // Staging and commits need a live checkout, not a branch snapshot.
  const commitRepo = gitAvailable && !state.historyRef ? state.session?.repository.path : undefined;
  const commitApi = useMemo(
    () =>
      commitRepo
        ? (providedCommitApi?.(commitRepo) ??
          createCommitApi(
            createApi(globalThis.fetch.bind(globalThis), readBrowserToken()),
            commitRepo,
          ))
        : null,
    [commitRepo, providedCommitApi],
  );
  const { active: activeTheme } = useTheme();
  const theme = activeTheme.appearance;
  const [themePickerOpen, setThemePickerOpen] = useState(false);
  const shell = useShell();
  // The workspace's panes: the review, its thread, the file trees, and the
  // preview, tiled as the reader leaves them. Each workspace keeps its own.
  const entry = useWorkspaceEntry();
  // A session that Med found: a thread on this checkout, without a review.
  const found = entry?.kind === "repository" ? entry.found : undefined;
  const layoutKey = found
    ? `found:${found.agent}:${found.id}`
    : entry?.kind === "review"
      ? `review:${entry.reviewId}`
      : entry?.kind === "repository"
        ? `repository:${entry.path ?? "default"}`
        : entry?.kind === "pull"
          ? `pull:${entry.url}`
          : undefined;
  const threadLayout = entry?.kind === "review" || entry?.kind === "pull" || !!found;
  const foundCommands = useFoundCommands(sessionFetch);
  const tabCommands = useTabCommands();
  // A tab closes with "Close tab"; "Close workspace" is for the others.
  const isTab = tabCommands.some((command) => command.id === "close-tab" && !command.disabled);
  const initialPanes = useCallback(
    (): PaneNode =>
      threadLayout
        ? {
            axis: "row",
            children: [{ id: "session" }, { id: "review" }],
            sizes: [0.5, 0.5],
          }
        : {
            axis: "row",
            children: [{ id: "changed" }, { id: "review" }],
            sizes: [0.24, 0.76],
          },
    [threadLayout],
  );
  const panes = usePaneTree({ key: layoutKey, initial: initialPanes });
  const filesVisible = panes.isOpen("files");
  const sessionVisible = panes.isOpen("session");
  const changedVisible = panes.isOpen("changed");
  // Markdown files now read rendered or show their source in the file view
  // (FullFileView), so a saved layout's Preview pane has nothing to show.
  const retiredPreview = panes.isOpen("preview");
  const closeRetired = panes.close;
  useEffect(() => {
    if (retiredPreview) closeRetired("preview");
  }, [retiredPreview, closeRetired]);
  // Zen hides every bar. The sidebars keep their own state in and out of zen.
  const [zen, setZenState] = useState(() => readPreference("zen", "off", ["on", "off"]) === "on");
  // Quiet chrome: one row for the review pane, its rare actions in ⋯ and ⌘K.
  const quiet = useQuietChrome();
  const comparisonActions = useRef<ComparisonActionsHandle>(null);
  const comparisonTrigger = useRef<HTMLButtonElement>(null);
  // The comparison's place in the review's row; empty while it is in ⋯.
  const comparisonSlot = useRef<HTMLSpanElement>(null);
  // The base branch menu opens below the comparison, or below ⋯ while the
  // comparison is in ⋯.
  const compareAnchor = useCallback(
    () =>
      comparisonTrigger.current ??
      comparisonSlot.current?.parentElement?.querySelector<HTMLElement>(
        '[aria-label="More actions"]',
      ) ??
      null,
    [],
  );
  // With quiet chrome, the Commit tab's Stage all goes in the review's row.
  // In a narrow row it goes back to the Commit view's own header, so that
  // the tabs keep their labels.
  const [stageSlot, setStageSlot] = useState<HTMLElement | null>(null);
  const stageFits = useSlotFits(stageSlot, 72);
  const savedActions = useRef<SavedReviewActions>(null);
  // The base branch menu opens below the comparison once the select closes.
  const openCompare = useCallback(
    () => requestAnimationFrame(() => comparisonActions.current?.openCompare()),
    [],
  );
  const openPush = useCallback(() => comparisonActions.current?.openPush(), []);
  const clearComments = useCallback(() => savedActions.current?.clearComments(), []);
  const filePreviewShown = useFilePreviewShown();
  const focusBeforeZen = useRef<Element | null>(null);
  const setZen = useCallback((next: boolean | ((value: boolean) => boolean)) => {
    focusBeforeZen.current = document.activeElement;
    setZenState(next);
  }, []);
  const rightVisible = filesVisible;
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
  // The open editor's preview stays in a ref, and state holds only a count.
  // A callback from an older render keeps that render's values alive, so an
  // editor's function kept in state kept every closed editor in memory.
  const filePreview = useRef<BeginFileSymbolPreview | null>(null);
  const [filePreviewKey, setFilePreviewKey] = useState<number | null>(null);
  const onSymbolPreviewReady = useCallback((begin: BeginFileSymbolPreview | null) => {
    filePreview.current = begin;
    setFilePreviewKey((key) => (begin ? (key ?? 0) + 1 : null));
  }, []);
  const beginFilePreview = useMemo<BeginFileSymbolPreview | undefined>(
    () => (filePreviewKey === null ? undefined : () => filePreview.current!()),
    [filePreviewKey],
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
  const [lineBlame, setLineBlame] = useState(
    () => readPreference("line-blame", "on", ["on", "off"]) === "on",
  );
  useEffect(() => {
    try {
      localStorage.setItem("med:line-blame", lineBlame ? "on" : "off");
    } catch {
      /* Storage can be unavailable. */
    }
  }, [lineBlame]);
  const [helpOpen, setHelpOpen] = useState(false);
  const fileNavigation = useRef<((key: string, control?: boolean) => void) | null>(null);
  const onNavigationReady = useCallback(
    (command: ((key: string, control?: boolean) => void) | null) => {
      fileNavigation.current = command;
    },
    [],
  );
  // The blame gutter opens for one file tab; another tab starts without it.
  const [blameTab, setBlameTab] = useState<string | null>(null);
  const [branchPickerOpen, setBranchPickerOpen] = useState(false);
  const [branchPickerNew, setBranchPickerNew] = useState(false);
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
  useDisposeOnClose(prefetch.dispose);
  // An unsaved draft outlasts its workspace and a reload: it waits in the
  // window and in the browser's storage, under this workspace.
  const windowDrafts = useWindowDrafts();
  const [editorDrafts] = useState(() =>
    createEditorDrafts(windowDrafts ?? undefined, workspace?.id),
  );
  useDisposeOnClose(editorDrafts.park);
  // In the window's shell, open files outlast a restart. A tab with an
  // unsaved draft keeps its place in a full row.
  const [fileWorkspace] = useState(() =>
    createFileWorkspace(browseApi, {
      persist: !!workspace,
      held: (tab) => !!editorDrafts.get(JSON.stringify([tab.source, tab.path]))?.dirty,
    }),
  );
  useSyncExternalStore(editorDrafts.subscribe, editorDrafts.getSnapshot);
  // In the window's shell, the window warns only for a draft that storage
  // did not take.
  useEffect(() => {
    if (windowDrafts) return;
    const warn = (event: BeforeUnloadEvent) => {
      if (editorDrafts.hasDirty()) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [editorDrafts, windowDrafts]);

  const [loadBlame] = useState(
    () =>
      providedBlameLoader ??
      createBlameLoader(globalThis.fetch.bind(globalThis), readBrowserToken()),
  );
  const [loadCommit] = useState(
    () =>
      providedCommitLoader ??
      createCommitLoader(globalThis.fetch.bind(globalThis), readBrowserToken()),
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
  // An iteration chosen in the brief: its comparison loads, then the brief shows.
  const pendingIteration = useRef<string | null>(null);
  const pendingTab = useRef<"review" | "changes" | null>(null);
  useEffect(() => {
    // The Notes and the Guide belong to the saved review, so they stay in front
    // while another iteration's comparison, or a commit of the guide, loads.
    fileWorkspace.configure(
      workspaceKey,
      browseSource,
      sourceLabel,
      state.savedReview ? ["brief", "guide"] : [],
    );
    if (
      pendingSavedChanges.current &&
      state.savedView &&
      state.status === "ready" &&
      state.savedTargetId === pendingSavedChanges.current
    ) {
      fileWorkspace.select("changes");
      pendingSavedChanges.current = null;
    }
    if (
      pendingIteration.current &&
      state.savedView &&
      state.status === "ready" &&
      state.savedTargetId === pendingIteration.current
    ) {
      fileWorkspace.select("brief");
      pendingIteration.current = null;
    }
    // The Review or Changes tab, chosen while another checkout's diff loads:
    // that checkout's own tab choice does not replace it.
    if (
      pendingTab.current &&
      state.status === "ready" &&
      (pendingTab.current === "review" ? state.savedView : !state.savedView && !state.inReview)
    ) {
      fileWorkspace.select("changes");
      pendingTab.current = null;
    }
  }, [
    fileWorkspace,
    workspaceKey,
    browseSource,
    sourceLabel,
    state.savedView,
    state.inReview,
    state.savedReview,
    state.savedTargetId,
    state.status,
  ]);
  // A file that another workspace's search opens here, or an old search
  // link's query, once the workspace reads its files.
  const filesReady = !!fileState.source;
  // Changes when ⌘⇧F asks for the Search tab's query field.
  const [searchFocus, setSearchFocus] = useState(0);
  useEffect(() => {
    if (!workspaceId || !filesReady) return;
    const take = () => {
      const request = takeFileOpen(workspaceId);
      if (request) fileWorkspace.open(request.path, request.line, request.source, request.label);
      const query = takeSearchOpen(workspaceId);
      if (query !== undefined) {
        fileWorkspace.openSearch(query);
        setSearchFocus((count) => count + 1);
      }
    };
    take();
    return subscribeFileOpens(take);
  }, [workspaceId, filesReady, fileWorkspace]);
  // A subagent that the sidebar opens shows in the Session pane.
  const [openAgent, setOpenAgent] = useState<{ id: string; nonce: number }>();
  useDisposeOnClose(fileWorkspace.dispose);
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
  // Registered vaults: Find file reaches their files, and their tabs name their folders.
  const vaultTab = fileState.tabs.some((tab) => tab.source.kind === "vault");
  // Each @ in a message to the agent lists the vaults' notes again.
  const [mentionRound, setMentionRound] = useState(0);
  const wantMentions = useCallback(() => setMentionRound((round) => round + 1), []);
  const vaults = useVaults(browseApi, filePickerOpen || vaultTab || mentionRound > 0);
  const readThreads = useThreadReader();
  const ownThread = state.savedReview?.id;
  const otherThreads = useCallback(
    () => readThreads().filter((thread) => thread.id !== ownThread),
    [readThreads, ownThread],
  );
  // File references in the session link to the checkout's files, which the
  // workspace lists anyway; they open at their lines.
  const fileIndex = useMemo(
    () =>
      browseSource && repositoryFiles.entries.length
        ? createFileIndex(browseSource.repo, repositoryFiles.entries, !repositoryFiles.truncated)
        : null,
    [browseSource, repositoryFiles.entries, repositoryFiles.truncated],
  );
  // A file that a side pane opens shows in the review, also from a zoomed pane.
  const { show: revealPane } = panes;
  const fileRefs = useMemo<FileRefs>(
    () => ({
      index: fileIndex,
      // A tab like any other: closing it goes back to the tab before it.
      open: (ref, background) => {
        fileWorkspace.open(ref.path, ref.line, undefined, undefined, undefined, {
          background,
          endLine: ref.endLine ?? ref.line,
        });
        if (!background) revealPane("review");
      },
    }),
    [fileIndex, fileWorkspace, revealPane],
  );
  // Notes show the cited lines of files that the change does not touch.
  const readCheckoutFile = useCallback(
    async (path: string) => {
      if (!browseSource) throw new Error("No checkout");
      const file = await browseApi.read(browseSource, path);
      if (file.kind !== "text" || file.text === undefined) throw new Error(`${path} is not text`);
      return file.text;
    },
    [browseApi, browseSource],
  );
  const openFromPane = useCallback(
    (path: string, line?: number) => {
      fileWorkspace.open(path, line);
      revealPane("review");
    },
    [fileWorkspace, revealPane],
  );
  const checkoutFiles = useMemo(
    () =>
      browseSource?.kind === "worktree"
        ? { root: browseSource.repo, entries: repositoryFiles.entries }
        : undefined,
    [browseSource, repositoryFiles.entries],
  );
  const mentionSources = useMentionSources(
    browseApi,
    checkoutFiles,
    otherThreads,
    vaults,
    mentionRound,
  );
  const vaultRoots = useMemo(
    () => new Map(vaults.map((vault) => [vault.id, vault.path])),
    [vaults],
  );
  if (blameTab !== null && blameTab !== activeFile?.id) setBlameTab(null);
  const blameEnabled = !!activeFile && blameTab === activeFile.id;
  const toggleBlame = useCallback(
    () => setBlameTab(blameEnabled || !activeFile ? null : activeFile.id),
    [blameEnabled, activeFile],
  );
  // The thread in the window's list: its state, and the name that the reader
  // gave it, which shows in place of the agent's title.
  const thread = useThread(state.savedReview?.id);
  const threadName = thread?.agentTitle !== undefined ? thread.title : undefined;
  useDocumentTitle(
    threadName ??
      state.savedReview?.title ??
      (activeFile
        ? (activeFile.path.split("/").at(-1) ?? activeFile.path)
        : state.session
          ? `${state.session.repository.name} · ${state.activeBranch ?? "Working changes"}`
          : "Med"),
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
      if (!file || !isBrowseFile(file) || file.kind !== "text" || !name) return;
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
  // ⌘⇧F opens or shows the Search tab, which searches this checkout.
  const sessionRepository = state.session?.repository;
  const searchRepository = useMemo(() => {
    if (!sessionRepository) return undefined;
    const path = sessionRepository.path;
    const registered =
      state.repositories.find((repository) => repository.id === state.activeRepositoryId) ??
      state.repositories.find(
        (repository) =>
          repository.path === path || repository.worktrees.some((tree) => tree.path === path),
      );
    return registered
      ? { id: registered.id, name: registered.name, path: registered.path }
      : { id: path, name: sessionRepository.name, path };
  }, [sessionRepository, state.repositories, state.activeRepositoryId]);
  const openSearch = useCallback(() => {
    if (!browseSource || !searchRepository) return openContentSearch();
    // Selected text becomes the query, as in VS Code; else the tab keeps its own.
    const selected =
      fileWorkspace.getSnapshot().active === "search"
        ? ""
        : (fileSelection.current?.() || window.getSelection()?.toString() || "")
            .split("\n")[0]!
            .trim()
            .slice(0, 200);
    fileWorkspace.openSearch(selected || undefined);
    setSearchFocus((count) => count + 1);
  }, [browseSource, searchRepository, openContentSearch, fileWorkspace]);
  // A match in this repository opens in a file tab here; the Search tab stays.
  const openSearchMatch = useCallback(
    (match: SearchOpen) => {
      if (searchRepository && match.repository.path !== searchRepository.path) {
        window.dispatchEvent(new CustomEvent<SearchOpen>(SEARCH_OPEN_EVENT, { detail: match }));
        return;
      }
      fileWorkspace.open(
        match.path,
        match.line,
        match.source,
        match.source.kind === "commit" ? `Commit ${match.source.oid.slice(0, 8)}` : sourceLabel,
      );
    },
    [searchRepository, fileWorkspace, sourceLabel],
  );
  const leaveSearch = useCallback(
    () => fileWorkspace.select(fileWorkspace.previous()),
    [fileWorkspace],
  );
  const resumeFilePicker = useCallback(() => {
    setPickerQuery(undefined);
    setPickerResume(true);
    setFilePickerOpen(true);
  }, []);
  const { close: closePane, show: showInTree, toggle: toggleInTree } = panes;
  const showPane = useCallback(
    (id: string, options: { quiet?: boolean } = {}) =>
      showInTree(id, { ...PANE_PLACES[id], ...options }),
    [showInTree],
  );
  const togglePane = useCallback((id: string) => toggleInTree(id, PANE_PLACES[id]), [toggleInTree]);
  const showFiles = useCallback(() => showPane("files"), [showPane]);
  const toggleFilesSidebar = useCallback(() => {
    if (rightVisible) closePane("files");
    else showFiles();
  }, [rightVisible, showFiles, closePane]);
  const toggleSession = useCallback(() => togglePane("session"), [togglePane]);
  useEffect(() => {
    if (!workspaceId) return;
    const take = () => {
      const id = takeSubagentOpen(workspaceId);
      if (!id) return;
      showPane("session");
      setOpenAgent({ id, nonce: Date.now() });
    };
    take();
    return subscribeSubagentOpens(take);
  }, [workspaceId, showPane]);
  // ⌘B shows or hides the window's thread list; alone, the changed files.
  const toggleChanged = useCallback(() => togglePane("changed"), [togglePane]);
  const toggleReviewSidebar = shell?.toggleSidebar ?? toggleChanged;
  const zenToggle = useRef<HTMLButtonElement>(null);
  const toggleZen = useCallback(() => setZen((value) => !value), [setZen]);
  // Keep keyboard focus when the control that held it leaves with the chrome.
  const previousZen = useRef(zen);
  useLayoutEffect(() => {
    if (previousZen.current === zen) return;
    previousZen.current = zen;
    // Move focus only when the control that held it has gone with the chrome.
    const before = focusBeforeZen.current;
    if (!(before instanceof HTMLElement) || before === document.body) return;
    if (before.isConnected && before.checkVisibility()) return;
    // The zen controls keep focus in both directions; a file keeps reading focus.
    if (zen)
      (visibleElement('[data-file-pane="main"]') ?? visibleElement("[data-zen-exit]"))?.focus();
    else zenToggle.current?.focus();
  }, [zen]);
  const [preferredMode, setMode] = useState<"split" | "unified">(() =>
    readPreference("mode", "split", ["split", "unified"]),
  );
  // Split diffs need room for two columns; a narrow review pane shows them
  // unified until it has room again.
  const [mainElement, setMainElement] = useState<HTMLElement | null>(null);
  const [roomy, setRoomy] = useState(true);
  // The Commit tab's file, for the status bar.
  const [commitPath] = useState(createPathValue);
  const [compactSelection, setCompactSelection] = useState(false);
  useLayoutEffect(() => {
    if (!mainElement) return;
    const measure = () => {
      // A hidden workspace has no width; it keeps its layout for its return.
      const width = mainElement.clientWidth;
      if (!width) return;
      setRoomy(width >= SPLIT_MIN_WIDTH);
      setCompactSelection(width < SELECTION_BAR_FULL_WIDTH);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(mainElement);
    return () => observer.disconnect();
  }, [mainElement]);
  const mode = preferredMode === "split" && !roomy ? "unified" : preferredMode;
  const [wrap, setWrap] = useState(false);
  const [showNotes, setShowNotes] = useState(true);
  const [findOpen, setFindOpen] = useState(false);
  const [find, setFind] = useState("");
  const [findIndex, setFindIndex] = useState(0);
  const findHighlights = useMemo(
    () => createDiffFindHighlights("med-diff-find", "med-diff-find-current"),
    [],
  );
  useEffect(() => () => findHighlights.dispose(), [findHighlights]);
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
  const [contextError, setContextError] = useState<string | null>(null);
  const [frameMs, setFrameMs] = useState<number | null>(null);
  const [baseRef, setBaseRef] = useState("main");
  const [headRef, setHeadRef] = useState("HEAD");
  const [rangeOpen, setRangeOpen] = useState(false);
  const viewer = useRef<CodeViewHandle<Annotation, undefined>>(null);
  const reviewScroll = useRef(new Map<string, number>());
  // A saved target's diff shows before its checkout's Git state, and stays
  // mounted when that state arrives.
  const shownTarget = state.savedView
    ? state.savedReview?.targets.find((target) => target.id === state.savedTargetId)
    : undefined;
  const scopeRepository = shownTarget ? shownTarget.repositoryId : state.activeRepositoryId;
  const scopeWorkspace = shownTarget ? shownTarget.id : workspaceKey;
  const reviewScope = JSON.stringify([scopeRepository, scopeWorkspace, state.comparison]);
  // The Guide's part on screen: the Overview, a segment, or a commit. Each
  // segment keeps its own place in the stream.
  const [guideScope, setGuideScope] = useState<GuideScope>({
    kind: "overview",
  });
  const streamScope =
    fileState.active === "guide" && guideScope.kind !== "overview"
      ? JSON.stringify([scopeRepository, scopeWorkspace, state.comparison, guideScope])
      : reviewScope;
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
    if (fileState.active !== "changes" && fileState.active !== "guide") return;
    if (explicitReveal.current) {
      explicitReveal.current = false;
      restoringScroll.current = false;
      return;
    }
    if (!reviewId) return;
    restoringScroll.current = true;
    const position = reviewScroll.current.get(streamScope) ?? 0;
    const frame = requestAnimationFrame(() => {
      viewer.current?.scrollTo({ type: "position", position });
      restoringScroll.current = false;
    });
    return () => {
      cancelAnimationFrame(frame);
      restoringScroll.current = true;
    };
  }, [fileState.active, streamScope, reviewId]);
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
  // Files that a tool writes fold at the end of the stream (docs/GENERATED.md).
  const generatedFiles = useMemo(() => generatedIndex(state.files), [state.files]);
  // The comparison whose group is open: another comparison starts folded.
  const [generatedOpenScope, setGeneratedOpenScope] = useState<string | null>(null);
  const generatedOpen = generatedOpenScope === reviewScope;
  const generatedOpenRef = useRef(generatedOpen);
  /** The generated files that the open group folded once; a later one folds too. */
  const generatedFolded = useRef(new Set<string>());
  useLayoutEffect(() => {
    generatedOpenRef.current = generatedOpen;
    if (!generatedOpen) {
      generatedFolded.current.clear();
      return;
    }
    // A generated file that joins the open group, such as a bun.lock in live
    // Changes after `bun install`, shows folded to its header.
    const joined = [...generatedFiles.marks.keys()].filter(
      (id) => !generatedFolded.current.has(id),
    );
    if (!joined.length) return;
    for (const id of joined) generatedFolded.current.add(id);
    setCollapsed((current) => {
      const next = new Set(current);
      for (const id of joined) next.add(id);
      return next;
    });
  }, [generatedOpen, generatedFiles]);
  /** Opens the group, each file folded to its header but `show`. */
  const openGenerated = useCallback(
    (show?: string) => {
      if (generatedOpenRef.current) return;
      generatedOpenRef.current = true;
      setGeneratedOpenScope(reviewScope);
      for (const id of generatedFiles.marks.keys()) generatedFolded.current.add(id);
      setCollapsed((current) => {
        const next = new Set(current);
        for (const id of generatedFiles.marks.keys()) if (id !== show) next.add(id);
        return next;
      });
    },
    [generatedFiles, reviewScope],
  );
  // A guide segment shows files that a path filter can hide, so headers read every file.
  const fileInfoById = useMemo(
    () => new Map(state.files.map((file) => [file.id, file.info])),
    [state.files],
  );
  const notes = state.notes?.notes ?? emptyNotes;
  const agentSessions = state.savedReview?.sessions ?? NO_SESSIONS;
  const agentInbox = useAgentInbox(
    agentSessions.length && state.savedReview ? state.savedReview.id : null,
    sessionFetch,
  );
  const [agentAttachments, setAgentAttachments] = useState<ComposerAttachment[]>([]);
  // Once the review is idle, the session pane prepares hidden, so it opens at
  // once: its thread streams, and its newest replies render ahead.
  const [sessionReady, setSessionReady] = useState(false);
  const hasSessions = agentSessions.length > 0;
  // A thread without an agent opens as a branch does: its changed files and
  // the review. The reader starts an agent from the session toggle.
  const adoptPanes = panes.adopt;
  useEffect(() => {
    if (threadLayout && state.savedReview && !hasSessions)
      adoptPanes({
        axis: "row",
        children: [{ id: "changed" }, { id: "review" }],
        sizes: [0.24, 0.76],
      });
  }, [threadLayout, state.savedReview, hasSessions, adoptPanes]);
  useEffect(() => {
    if (sessionReady || !hasSessions) return;
    return whenIdle(() => setSessionReady(true));
  }, [sessionReady, hasSessions]);
  useEffect(() => (panesPreloaded ? undefined : whenFree(preloadPanes)), []);
  // The agents that Med can start in a saved review's repository, or in a
  // pull request's worktree from the branch picker.
  const agentPresets = useAgentPresets(!!state.savedReview || branchPickerOpen, sessionFetch);
  const sessionStarter = useMemo<SessionStarter>(
    () => ({
      agents: agentPresets,
      start: async (preset) => {
        await controller.startSession(preset);
        showPane("session");
      },
    }),
    [agentPresets, controller, showPane],
  );
  // Continue in Med: a fork of a Claude session that a terminal runs. The
  // thread follows the fork; the terminal keeps its session.
  const continueInMed = useCallback(
    async (sessionId: string) => {
      await controller.startSession("claude", { fork: sessionId });
      showPane("session");
    },
    [controller, showPane],
  );
  // The lead session: the latest one. Its agent names the reply controls.
  const leadSession = agentSessions.at(-1);
  const replyAgent = leadSession && agentName(leadSession);
  const leadIcon: IconName = !leadSession
    ? "agent"
    : leadSession.agent === "acp"
      ? "agent"
      : leadSession.agent;
  const agentReply = useMemo<AgentReplyTarget | null>(
    () =>
      replyAgent
        ? {
            agent: replyAgent,
            add: (attachment) => {
              setAgentAttachments((list) => [
                ...list.filter(
                  (entry) => entry.label !== attachment.label || entry.text !== attachment.text,
                ),
                { id: crypto.randomUUID(), ...attachment },
              ]);
              showPane("session");
            },
          }
        : null,
    [replyAgent, showPane],
  );
  const savedTarget = state.savedReview?.targets.find(
    (target) => target.id === state.savedTargetId,
  );
  const pullRequest = usePullRequestComments(
    useCallback((refresh: boolean) => controller.loadPullRequestComments(refresh), [controller]),
    state.savedReview?.pullRequestUrl
      ? `${state.savedReview.id} ${state.savedReview.pullRequestUrl}`
      : null,
  );
  // GitHub thread lines refer to the pull request's head commit. Threads show
  // in the diff only when it shows that commit and the line (data/pull-request.ts).
  const pullRequestThreads = useMemo(
    () =>
      placeThreads(
        pullRequest.data,
        files,
        state.savedView
          ? { kind: "review", target: savedTarget }
          : { kind: "changes", review: state.review },
      ),
    [pullRequest.data, state.savedView, savedTarget, state.review, files],
  );
  const codexReviews = useCodexReviews(
    useCallback(() => controller.loadCodexReviews(), [controller]),
    state.savedReview?.id ?? null,
  );
  // Codex finding lines refer to the commit that Codex reviewed, as GitHub
  // thread lines refer to the pull request's head.
  const codexFindings = useMemo(() => {
    const byPath = new Map<string, { finding: CodexFinding; run: CodexReviewRun }[]>();
    const inline = new Set<string>();
    const reasons = new Map<string, string>();
    for (const run of codexReviews.runs ?? []) {
      const head = run.commit
        ? `Lines refer to ${run.commit.slice(0, 7)}, the commit that Codex reviewed.`
        : "Codex did not record the commit it reviewed, so they are listed here.";
      if (!run.commit) reasons.set(run.id, head);
      else if (!state.savedView || !savedTarget)
        reasons.set(run.id, `${head} Return to the saved review to see them in the diff.`);
      else if (
        savedTarget.repo !== run.repo ||
        savedTarget.captured ||
        savedTarget.head !== run.commit
      )
        reasons.set(
          run.id,
          `${head} This comparison shows ${savedTarget.repo !== run.repo ? "another checkout" : savedTarget.captured ? "captured working changes" : savedTarget.head.slice(0, 7)}, so they are listed here.`,
        );
      else
        for (const finding of run.findings) {
          const metadata = files.find((file) => file.path === finding.path)?.metadata;
          const shown = metadata?.hunks.some(
            (hunk) =>
              finding.endLine >= hunk.additionStart &&
              finding.endLine < hunk.additionStart + hunk.additionCount,
          );
          if (!shown) continue;
          inline.add(finding.id);
          byPath.set(finding.path, [...(byPath.get(finding.path) ?? []), { finding, run }]);
        }
    }
    return {
      byPath,
      placement: { inline, reasons } satisfies FindingPlacement,
    };
  }, [codexReviews.runs, state.savedView, savedTarget, files]);
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

  const managed = !workspace;
  useEffect(() => {
    if (!managed) return;
    void controller.initialize();
    return () => controller.dispose();
  }, [controller, managed]);
  useEffect(() => {
    try {
      localStorage.setItem("med:mode", preferredMode);
    } catch {
      /* Preferences can be unavailable in private storage. */
    }
  }, [preferredMode]);
  // A file of the Guide's shown segment opens in place; others open in Changes.
  const streamFilesRef = useRef<ParsedReviewFile[]>(NO_FILES);
  const showInStream = useCallback(
    (id: string) => {
      const active = fileWorkspace.getSnapshot().active;
      if (active === "guide" && streamFilesRef.current.some((file) => file.id === id)) return;
      explicitReveal.current = active !== "changes";
      fileWorkspace.select("changes");
    },
    [fileWorkspace],
  );
  const reveal = useCallback(
    (id: string) => {
      showInStream(id);
      if (generatedFiles.marks.has(id)) openGenerated(id);
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
    [controller, showInStream, generatedFiles, openGenerated],
  );
  // The file whose line a jump is about to show. Selecting that file must not
  // scroll to the file as well, or the file scroll replaces the line scroll.
  const lineJump = useRef<{ id: string; serial: number } | null>(null);
  const revealLine = useCallback(
    (id: string, start: number, end: number, side: "additions" | "deletions") => {
      const serial = (lineJump.current?.serial ?? 0) + 1;
      lineJump.current = { id, serial };
      showInStream(id);
      if (generatedFiles.marks.has(id)) openGenerated(id);
      controller.revealFile(id);
      setCollapsed((current) => {
        if (!current.has(id)) return current;
        const next = new Set(current);
        next.delete(id);
        return next;
      });
      setSelection({ id, range: { start, end, side } });
      const scroll = () =>
        viewer.current?.scrollTo({
          type: "line",
          id,
          lineNumber: start,
          side,
          align: "center",
        });
      scroll();
      // Changes becomes visible, or a collapsed file opens, in this frame;
      // the rows around the line are measured in the next. Scroll again then.
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          if (lineJump.current?.serial !== serial) return;
          lineJump.current = null;
          scroll();
        }),
      );
    },
    [controller, showInStream, generatedFiles, openGenerated],
  );

  // A brief explains a saved review. Paste one with Command-V; its links open
  // the cited lines in Changes.
  // An agent's review can have iterations, each with its comparisons and
  // brief. The brief follows the shown comparison's iteration; choosing an
  // iteration in the brief shows its comparison too.
  const iterations = state.savedReview?.iterations ?? [];
  const [briefIteration, setBriefIteration] = useState<number | null>(null);
  const [briefTarget, setBriefTarget] = useState(state.savedTargetId);
  if (briefTarget !== state.savedTargetId) {
    setBriefTarget(state.savedTargetId);
    setBriefIteration(null);
  }
  const shownIteration =
    briefIteration ??
    iterations.find((entry) => state.savedTargetId && entry.targetIds.includes(state.savedTargetId))
      ?.number ??
    iterations.at(-1)?.number;
  // An iteration without a brief keeps the one before it, unless the reader
  // started its notes anew.
  const briefSource = shownIteration
    ? iterations.findLast((entry) => entry.number <= shownIteration && (entry.brief || entry.fresh))
    : undefined;
  // The Notes belong to the Review's version, also while Changes show.
  const savedBrief = shownIteration ? briefSource?.brief : state.savedReview?.brief;
  // The Notes are the brief and the agent replies pinned to the shown iteration.
  const savedPins = shownIteration
    ? iterations.find((entry) => entry.number === shownIteration)?.pins
    : state.savedReview?.pins;
  const hasNotes =
    !!savedBrief ||
    !!savedPins?.length ||
    (briefSource?.fresh === true && briefSource.number === shownIteration);
  // Comments on passages of the shown brief and pins.
  const allBriefComments = state.savedReview?.briefComments;
  const briefComments = useMemo(
    () =>
      (allBriefComments ?? []).filter((comment) =>
        comment.section === "brief"
          ? comment.iteration === briefSource?.number
          : !!savedPins?.some((pin) => pin.id === comment.section),
      ),
    [allBriefComments, briefSource?.number, savedPins],
  );
  const notesText = useMemo(
    () =>
      joinNotes([
        ...(savedBrief ? [savedBrief.text] : []),
        ...(savedPins ?? []).map((pin) => pin.text),
      ]).text,
    [savedBrief, savedPins],
  );
  // The Guide: the agent's segments over the saved comparison, and the range's
  // commits, to review one part at a time. An iteration without a guide keeps
  // the one before it, as the brief does.
  // A stack's or a set's part has its own Guide, which a version without
  // one keeps from the one before (docs/STACKS.md).
  const guidePart = state.savedReview?.parts ? savedTarget?.part : undefined;
  const guideSource = shownIteration
    ? iterations.findLast(
        (entry) =>
          entry.number <= shownIteration && (guidePart ? entry.guides?.[guidePart] : entry.guide),
      )
    : undefined;
  const savedGuide = !state.savedReview
    ? undefined
    : shownIteration
      ? guidePart
        ? guideSource?.guides?.[guidePart]
        : guideSource?.guide
      : state.savedReview.guide;
  const guideTarget = savedTarget;
  const guideCommits = guideTarget?.commits ?? NO_COMMITS;
  const hasGuide = !!state.savedReview && (!!savedGuide || guideCommits.length >= 2);
  // Segments refer to the saved comparison's files. They stay while a commit
  // of the range shows in their place.
  const [guideFiles, setGuideFiles] = useState<{
    target: string | null;
    files: ParsedReviewFile[];
    root?: string;
  }>({ target: null, files: NO_FILES });
  if (
    state.savedView &&
    state.status === "ready" &&
    state.review &&
    state.savedTargetId &&
    (guideFiles.target !== state.savedTargetId || guideFiles.files !== state.files)
  )
    setGuideFiles({
      target: state.savedTargetId,
      files: state.files,
      root: state.review.repo,
    });
  const shownGuideFiles = guideFiles.target === state.savedTargetId ? guideFiles.files : NO_FILES;
  const resolvedGuide = useMemo(
    () => (savedGuide ? resolveGuide(savedGuide, shownGuideFiles, guideFiles.root) : null),
    [savedGuide, shownGuideFiles, guideFiles.root],
  );
  const guideSections = resolvedGuide?.sections ?? NO_SECTIONS;
  const [guideReview, setGuideReview] = useState(state.savedReview?.id);
  if (guideReview !== state.savedReview?.id) {
    setGuideReview(state.savedReview?.id);
    setGuideScope({ kind: "overview" });
  }
  const guideSection =
    guideScope.kind === "segment"
      ? guideSections.find((section) => section.key === guideScope.key)
      : undefined;
  const commitIndex =
    guideScope.kind === "commit"
      ? guideCommits.findIndex((commit) => commit.id === guideScope.id)
      : -1;
  const guideCommit = commitIndex >= 0 ? guideCommits[commitIndex] : undefined;
  const guideTab = hasGuide && fileState.active === "guide";
  // A segment shows the saved comparison; a commit shows that commit.
  const guideDiff =
    guideTab &&
    ((!!guideSection && state.savedView) ||
      (!!guideCommit &&
        state.comparison.kind === "commit" &&
        state.comparison.commit === guideCommit.id));
  const guideOverview = guideTab && !guideDiff;
  // The tab row is Review · Changes · Commit. Review is what the agent handed
  // off: a saved version, with its Guide. Changes are the checkout's live
  // diff. The pane's "changes" view shows either diff, and "guide" is Review's.
  const reviewAvailable = !!state.savedReview && hasReview(state.savedReview);
  const reviewShown =
    reviewAvailable &&
    (fileState.active === "guide" || (fileState.active === "changes" && state.inReview));
  const shownTab = reviewShown
    ? "review"
    : fileState.active === "guide"
      ? "changes"
      : fileState.active;
  // The diff stream shows in Review and Changes, and in the Guide for a segment or commit.
  const streamShown = fileState.active === "changes" || guideDiff;
  // A thread's Review and Changes list their files beside the diff, and
  // Review its commits, unless the Changed files pane shows them.
  const changesRail =
    fileState.active === "changes" &&
    !!state.savedReview &&
    !zen &&
    !changedVisible &&
    gitAvailable;
  // "auto" shows the rail in a pane with room for it; the reader's choice holds
  // in any width.
  const [railChoice, setRailChoice] = useState(() =>
    readPreference("changes-rail", "auto", ["auto", "open", "closed"]),
  );
  useEffect(() => {
    try {
      localStorage.setItem("med:changes-rail", railChoice);
    } catch {
      /* Storage can be unavailable. */
    }
  }, [railChoice]);
  const railShown = changesRail && (railChoice === "open" || (railChoice === "auto" && roomy));
  const toggleRail = useCallback(() => setRailChoice(railShown ? "closed" : "open"), [railShown]);
  // A stack's or a set's layers (docs/STACKS.md): the Review shows one layer,
  // the whole stack, or a range of layers, from one checkout.
  const stack = useMemo(
    () => stackOf(state.savedReview, state.savedTargetId),
    [state.savedReview, state.savedTargetId],
  );
  const layerIndex = stack
    ? stack.layers.findIndex((layer) => layer.target.id === state.savedTargetId)
    : -1;
  const shownLayer = layerIndex >= 0 ? stack?.layers[layerIndex] : undefined;
  const layerSpan =
    stack && reviewShown && !state.savedView ? rangeOf(stack.layers, state.comparison) : null;
  const stackMode: StackMode = !layerSpan
    ? { kind: "layer" }
    : layerSpan.from === 0 && layerSpan.to === stack!.layers.length - 1
      ? { kind: "whole" }
      : { kind: "range", ...layerSpan };
  const layerViewed = useLayerViewed(stack ? (state.savedReview?.id ?? null) : null);
  const layerStates = useMemo(
    () =>
      stack
        ? stack.layers.map((layer) => {
            const counts = layerViewed[layer.target.id];
            return layerProgress(counts?.viewed ?? 0, layer.files ?? counts?.files, layer.comments);
          })
        : NO_PROGRESS,
    [stack, layerViewed],
  );
  const nextLayer = stack ? nextUnreviewed(stack.layers, layerStates) : -1;
  const showLayer = useCallback(
    (index: number) => {
      const layer = stack?.layers[index];
      if (!layer) return;
      if (state.savedView && layer.target.id === state.savedTargetId) return;
      // The Guide stays on its tab; anywhere else, the layer's diff shows.
      if (fileState.active !== "guide") {
        pendingSavedChanges.current = layer.target.id;
        pendingIteration.current = null;
        fileWorkspace.select("changes");
      }
      void controller.selectSavedTarget(layer.target.id);
    },
    [stack, state.savedView, state.savedTargetId, fileState.active, fileWorkspace, controller],
  );
  const showLayers = useCallback(
    (from: number, to: number) => {
      if (!stack) return;
      if (from === to) return showLayer(from);
      fileWorkspace.select("changes");
      void controller.selectComparison(layerRange(stack.layers, from, to), true);
    },
    [stack, showLayer, fileWorkspace, controller],
  );
  // ⌥↑ and ⌥↓ go up and down the stack, from the shown layer.
  const stepLayer = useCallback(
    (by: 1 | -1) => {
      if (!stack || !reviewShown || layerIndex < 0) return false;
      const next = Math.max(0, Math.min(stack.layers.length - 1, layerIndex + by));
      if (next !== layerIndex || !state.savedView) showLayer(next);
      return true;
    },
    [stack, reviewShown, layerIndex, state.savedView, showLayer],
  );
  const showNextUnreviewed = useCallback(() => {
    if (nextLayer >= 0) showLayer(nextLayer);
  }, [nextLayer, showLayer]);
  // Outside the Guide, whose order the agent chose, generated files come
  // last, and only while their group is open.
  const fileGroups = useMemo(() => splitGenerated(files, generatedFiles), [files, generatedFiles]);
  const groupGenerated = !guideDiff && fileGroups.generated.length > 0;
  const streamFiles = useMemo(() => {
    if (groupGenerated)
      return generatedOpen ? [...fileGroups.primary, ...fileGroups.generated] : fileGroups.primary;
    if (!guideDiff || !guideSection) return files;
    const byId = new Map(state.files.map((file) => [file.id, file]));
    return guideSection.fileIds.flatMap((id) => byId.get(id) ?? []);
  }, [guideDiff, guideSection, files, state.files, groupGenerated, generatedOpen, fileGroups]);
  useLayoutEffect(() => {
    streamFilesRef.current = guideDiff ? streamFiles : NO_FILES;
  });
  // Collapse all while any file is open; expand all once every file is closed.
  const allCollapsed =
    streamFiles.length > 0 && streamFiles.every((file) => collapsed.has(file.id));
  const toggleAllFiles = useCallback(
    () => setCollapsed(allCollapsed ? new Set() : new Set(streamFiles.map((file) => file.id))),
    [allCollapsed, streamFiles],
  );
  // Viewed marks, by file ID, for the shown comparison and for the guide's files.
  const viewed = useViewed(state.savedReview?.id ?? null);
  const markedIds = useCallback(
    (list: readonly ParsedReviewFile[]) => {
      const ids = new Set<string>();
      for (const file of list) if (viewed.marks.has(viewKey(file))) ids.add(file.id);
      // A generated file is viewed with the file whose change made it.
      if (generatedFiles.sources.size) {
        const byId = new Map(state.files.map((file) => [file.id, file]));
        for (const file of list) {
          const source = byId.get(generatedFiles.sources.get(file.id) ?? "");
          if (source && viewed.marks.has(viewKey(source))) ids.add(file.id);
        }
      }
      return ids;
    },
    [viewed.marks, generatedFiles, state.files],
  );
  const viewedIds = useMemo(() => markedIds(state.files), [markedIds, state.files]);
  // The sidebar draws a stack's progress from each layer's viewed count.
  const shownLayerTarget = state.savedView && shownLayer ? shownLayer.target.id : null;
  const viewedReview = state.savedReview?.id;
  useEffect(() => {
    if (!shownLayerTarget || !viewedReview || state.status !== "ready") return;
    setLayerViewed(viewedReview, shownLayerTarget, viewedIds.size, state.files.length);
  }, [shownLayerTarget, viewedReview, state.status, viewedIds, state.files.length]);
  // A layer that the sidebar picked shows once the thread's review is read.
  const stackReady = !!stack && !!viewedReview;
  useEffect(() => {
    if (!stackReady || !viewedReview) return;
    const take = () => {
      const part = takeLayer(viewedReview);
      if (!part) return;
      const index = stack?.layers.findIndex((layer) => layer.id === part) ?? -1;
      if (index >= 0) showLayer(index);
    };
    take();
    return subscribeLayers(take);
  }, [stackReady, viewedReview, stack, showLayer]);
  const guideViewedIds = useMemo(
    () => (shownGuideFiles === state.files ? viewedIds : markedIds(shownGuideFiles)),
    [markedIds, shownGuideFiles, state.files, viewedIds],
  );
  const setFilesViewed = useCallback(
    (ids: readonly string[], value: boolean) => {
      const byId = new Map([...shownGuideFiles, ...state.files].map((file) => [file.id, file]));
      const keys = ids.flatMap((id) => {
        const file = byId.get(id);
        return file ? [viewKey(file)] : [];
      });
      viewed.set(keys, value);
      // A viewed file folds away, as on GitHub; marking it unviewed opens it again.
      setCollapsed((current) => {
        const next = new Set(current);
        for (const id of ids) {
          if (value) next.add(id);
          else next.delete(id);
        }
        return next;
      });
    },
    [shownGuideFiles, state.files, viewed],
  );
  const guideFilesById = useMemo(
    () => new Map(shownGuideFiles.map((file) => [file.id, file])),
    [shownGuideFiles],
  );
  const guideMeta = useMemo(() => {
    if (!guideTarget) return "";
    let additions = 0;
    let deletions = 0;
    for (const file of shownGuideFiles) {
      additions += file.info.additions;
      deletions += file.info.deletions;
    }
    return [
      guideTarget.branch ?? guideTarget.repo.split("/").at(-1),
      guideTarget.captured
        ? guideTarget.label
        : `${shortRevision(guideTarget.base)} → ${shortRevision(guideTarget.head)}`,
      ...(shownGuideFiles.length
        ? [
            `+${additions.toLocaleString()} −${deletions.toLocaleString()}`,
            `${shownGuideFiles.length} ${shownGuideFiles.length === 1 ? "file" : "files"}`,
          ]
        : []),
    ].join(" · ");
  }, [guideTarget, shownGuideFiles]);
  const canMarkViewed = !!state.savedReview;
  const guideAt = savedGuide?.updatedAt ?? state.savedReview?.createdAt ?? "";
  const guideAgent = useMemo(
    () => ({
      name: replyAgent ?? "Guide",
      mark: replyAgent ? leadIcon : ("guide" as const),
      named: !!replyAgent,
      at: guideAt,
    }),
    [replyAgent, leadIcon, guideAt],
  );
  // Reply to an agent's comment with your own note on the same lines.
  const replyToGuideNote = useCallback((note: GuideNote) => {
    if (!onLines(note)) return;
    setShowNotes(true);
    setSelection(null);
    const target: NoteTarget = {
      path: note.path,
      side: note.side,
      line: note.line,
      ...(note.endLine ? { endLine: note.endLine } : {}),
    };
    // A box that is open on these lines stays as it is.
    setDraft((current) => (sameTarget(current, target) ? current : target));
  }, []);
  // A file to show once its segment's stream mounts.
  const [pendingGuideFile, setPendingGuideFile] = useState<string | null>(null);
  const openGuide = useCallback(
    (scope: GuideScope, fileId?: string) => {
      const snapshot = controller.getSnapshot();
      setGuideScope(scope);
      setSelection(null);
      fileWorkspace.select("guide");
      setPendingGuideFile(fileId ?? null);
      if (scope.kind === "commit") {
        if (snapshot.comparison.kind !== "commit" || snapshot.comparison.commit !== scope.id)
          void controller.selectComparison({ kind: "commit", commit: scope.id }, true);
        return;
      }
      if (!snapshot.savedView) void controller.showReview();
      // A segment's viewed files start folded.
      const section =
        scope.kind === "segment" ? guideSections.find((entry) => entry.key === scope.key) : null;
      if (section)
        setCollapsed((current) => {
          const next = new Set(current);
          for (const id of section.fileIds)
            if (guideViewedIds.has(id) && id !== fileId) next.add(id);
            else if (id === fileId) next.delete(id);
          return next;
        });
    },
    [controller, fileWorkspace, guideSections, guideViewedIds],
  );
  // j and k step through the segments, or through the commits once one shows.
  const stepGuide = useCallback(
    (delta: number) => {
      const commits = guideScope.kind === "commit" || !guideSections.length;
      const order: GuideScope[] = commits
        ? guideCommits.map((commit) => ({ kind: "commit", id: commit.id }))
        : [
            { kind: "overview" },
            ...guideSections.map((section) => ({
              kind: "segment" as const,
              key: section.key,
            })),
          ];
      if (commits && guideScope.kind !== "commit" && delta > 0 && order[0]) {
        openGuide(order[0]);
        return;
      }
      const index = order.findIndex(
        (scope) => JSON.stringify(scope) === JSON.stringify(guideScope),
      );
      const next = order[Math.max(0, Math.min(order.length - 1, index + delta))];
      if (next && index + delta >= 0) openGuide(next);
      else if (commits && delta < 0) openGuide({ kind: "overview" });
    },
    [guideScope, guideSections, guideCommits, openGuide],
  );
  // v: the file whose header is at the top of the stream, or the first one
  // below the segment's header. Marking it viewed folds it and shows the next.
  const streamRef = useRef<HTMLDivElement>(null);
  const toggleTopFileViewed = useCallback(() => {
    const host = streamRef.current;
    if (!host) return;
    const top = host.getBoundingClientRect().top;
    let current: string | undefined;
    for (const header of host.querySelectorAll<HTMLElement>("[data-stream-file]"))
      if (header.getBoundingClientRect().top <= top + 4) current = header.dataset.streamFile;
    current ??= streamFiles[0]?.id;
    if (!current) return;
    const value = !viewedIds.has(current);
    setFilesViewed([current], value);
    if (!value) return;
    const next = streamFiles[streamFiles.findIndex((file) => file.id === current) + 1];
    requestAnimationFrame(() =>
      viewer.current?.scrollTo({
        type: "item",
        id: next?.id ?? current,
        align: "start",
      }),
    );
  }, [streamFiles, viewedIds, setFilesViewed]);
  // A file chosen in the rail shows once its segment's stream has mounted.
  useEffect(() => {
    const id = pendingGuideFile;
    if (!id || !guideDiff || !streamFiles.some((file) => file.id === id)) return;
    const frame = requestAnimationFrame(() => {
      setPendingGuideFile(null);
      viewer.current?.scrollTo({ type: "item", id, align: "start" });
    });
    return () => cancelAnimationFrame(frame);
  }, [pendingGuideFile, guideDiff, streamFiles]);
  const [noteReveal, setNoteReveal] = useState<{
    key: string;
    nonce: number;
  }>();
  const showIteration = (number: number) => {
    setBriefIteration(number);
    const first = iterations.find((entry) => entry.number === number)?.targetIds[0];
    if (!first || first === state.savedTargetId) return;
    pendingIteration.current = first;
    pendingSavedChanges.current = null;
    void controller.selectSavedTarget(first);
  };
  // A pinned reply shows in the Notes of its iteration.
  const showPin = (pinId: string) => {
    const owner = iterations.find((entry) => entry.pins?.some((pin) => pin.id === pinId));
    if (owner && owner.number !== shownIteration) showIteration(owner.number);
    fileWorkspace.select("brief");
    setNoteReveal({ key: pinId, nonce: Date.now() });
  };
  // Keep the brief mounted once shown, so its scroll position survives tab changes.
  const [briefMounted, setBriefMounted] = useState(false);
  if (fileState.active === "brief" && !briefMounted) setBriefMounted(true);
  // The Commit tab also stays mounted once shown, with its message and place.
  const [commitMounted, setCommitMounted] = useState(false);
  if (fileState.active === "commit" && commitApi && !commitMounted) setCommitMounted(true);
  // A closed file gives the screen back only to a tab that the row still shows.
  useLayoutEffect(
    () =>
      fileWorkspace.setAvailable((id) =>
        id === "guide"
          ? hasGuide
          : id === "brief"
            ? hasNotes
            : id === "commit"
              ? !!commitApi
              : true,
      ),
    [fileWorkspace, hasGuide, hasNotes, commitApi],
  );
  // The tab row in order, for Alt+number and ⌘⇧[ / ⌘⇧]; empty when the row is hidden.
  // Keys read the store at event time, so a quick second key sees the first one's tab.
  const tabRow = useCallback(() => {
    if (!browseSource && !hasNotes && !reviewAvailable)
      return { order: [] as string[], active: "" };
    const { tabs, active, search } = fileWorkspace.getSnapshot();
    const inReview =
      reviewAvailable &&
      (active === "guide" || (active === "changes" && controller.getSnapshot().inReview));
    return {
      order: [
        ...(reviewAvailable ? ["review"] : []),
        ...(hasNotes ? ["brief"] : []),
        "changes",
        ...(commitApi ? ["commit"] : []),
        ...(search !== undefined ? ["search"] : []),
        ...tabs.map((tab) => tab.id),
      ],
      active: inReview ? "review" : active === "guide" ? "changes" : active,
    };
  }, [browseSource, hasNotes, reviewAvailable, commitApi, fileWorkspace, controller]);
  /** Shows a tab of the row: Review (its Guide, or its saved diff), Changes
   * (the checkout's live diff), Notes, Commit, or a file. */
  const selectTab = useCallback(
    (id: string) => {
      pendingTab.current = null;
      if (id === "review") {
        if (hasGuide) openGuide(guideScope);
        else {
          fileWorkspace.select("changes");
          if (!controller.getSnapshot().savedView) {
            pendingTab.current = "review";
            void controller.showReview();
          }
        }
        return;
      }
      if (id === "changes") {
        fileWorkspace.select("changes");
        if (controller.getSnapshot().inReview) {
          pendingTab.current = "changes";
          void controller.showChanges();
        }
        return;
      }
      fileWorkspace.select(id);
    },
    [hasGuide, openGuide, guideScope, fileWorkspace, controller],
  );
  /** q: open the Commit tab, or go back to the tab that showed before it,
   * by the rule that a closed tab follows. */
  const toggleCommit = useCallback(() => {
    fileWorkspace.select(
      fileWorkspace.getSnapshot().active === "commit" ? fileWorkspace.previous() : "commit",
    );
  }, [fileWorkspace]);
  const [pendingBrief, setPendingBrief] = useState<string | null>(null);
  // Undo puts back the brief text that a change replaced; null removes the brief.
  const [toast, setToast] = useState<{
    id: number;
    text: string;
    restore?: string | null;
  } | null>(null);
  const showToast = useCallback(
    (text: string, restore?: string | null) =>
      setToast((current) => ({ id: (current?.id ?? 0) + 1, text, restore })),
    [],
  );
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), toast.restore === undefined ? 4000 : 8000);
    return () => clearTimeout(timer);
  }, [toast]);
  const pathActions = useMemo<PathActions>(
    () => ({
      reveal: (target: { repo: string; path: string }) =>
        controller.revealPath(target.repo, target.path),
      notify: (text: string) => showToast(text),
    }),
    [controller, showToast],
  );
  useEffect(() => {
    if (!hasNotes && fileState.active === "brief") fileWorkspace.select("changes");
  }, [hasNotes, fileState.active, fileWorkspace]);
  useEffect(() => {
    if (!hasGuide && fileState.active === "guide") fileWorkspace.select("changes");
  }, [hasGuide, fileState.active, fileWorkspace]);
  // A thread opens on its Review once the agent has handed one off: on its
  // Guide, or on its brief in Notes, or on its diff. Before a hand-off, it
  // opens on its Changes. A hand-off that arrives later adds the Review tab
  // and does not move the reader. Tab choices stay until the next open.
  const reviewOpened = useRef<string | null>(null);
  useEffect(() => {
    if (state.status !== "ready" || !state.savedReview) return;
    if (reviewOpened.current === state.savedReview.id) return;
    reviewOpened.current = state.savedReview.id;
    // The controller opens a thread with a hand-off on its Review's diff.
    if (reviewAvailable)
      fileWorkspace.select(hasGuide ? "guide" : savedBrief ? "brief" : "changes");
    else if (fileState.active === "guide" || fileState.active === "brief")
      fileWorkspace.select("changes");
  }, [
    reviewAvailable,
    hasGuide,
    savedBrief,
    state.savedReview,
    state.status,
    fileState.active,
    fileWorkspace,
  ]);
  useEffect(() => {
    if (fileState.active === "commit" && !commitApi) fileWorkspace.select("changes");
  }, [commitApi, fileState.active, fileWorkspace]);
  const canSaveReview =
    gitAvailable &&
    !!state.session &&
    !state.savedReview &&
    state.status === "ready" &&
    state.comparison.kind !== "files" &&
    state.comparison.kind !== "patch";
  const setBrief = useCallback(
    async (text: string | null, message: string, undo?: string | null) => {
      try {
        await controller.setSavedBrief(text);
      } catch (error) {
        showToast(error instanceof Error ? error.message : "The brief could not be saved.");
        return false;
      }
      // A pasted brief shows in Notes.
      fileWorkspace.select(text ? "brief" : "changes");
      showToast(message, undo);
      return true;
    },
    [controller, fileWorkspace, showToast],
  );
  const attachBrief = useCallback(
    (text: string) => {
      const saved = controller.getSnapshot().savedReview;
      if (!saved) {
        if (canSaveReview) setPendingBrief(text);
        return;
      }
      const previous = saved.brief?.text ?? null;
      void setBrief(text, previous ? "Brief replaced." : "Brief attached.", previous);
    },
    [controller, canSaveReview, setBrief],
  );
  const pasteBrief = useCallback(() => {
    navigator.clipboard.readText().then(
      (text) => (text.trim() ? attachBrief(text) : showToast("The clipboard has no text.")),
      () => showToast("Allow clipboard access, or press ⌘V."),
    );
  }, [attachBrief, showToast]);
  const copyNotes = useCallback(
    (text: string) => {
      if (text)
        navigator.clipboard.writeText(text).then(
          () => showToast("Copied."),
          () => showToast("Copying needs clipboard access."),
        );
    },
    [showToast],
  );
  const removeBrief = useCallback(() => {
    const text = controller.getSnapshot().savedReview?.brief?.text;
    if (text) void setBrief(null, "Brief removed.", text);
  }, [controller, setBrief]);
  const unpin = useCallback(
    (id: string) =>
      controller.pinToReview({ remove: id }).then(
        () => showToast("Unpinned from Notes."),
        (error: unknown) =>
          showToast(error instanceof Error ? error.message : "The pin could not be removed."),
      ),
    [controller, showToast],
  );
  // New notes: a new iteration of the current comparisons, which later pins go to.
  // A refresh does the same for a review whose checkout changed after its capture.
  const [refreshing, setRefreshing] = useState(false);
  const startNotes = useCallback(
    (refresh = false) => {
      if (refresh) setRefreshing(true);
      controller
        .startNotes()
        .then(
          (iteration) => {
            const first = iteration?.targetIds[0];
            if (!iteration || !first) return;
            setBriefIteration(iteration.number);
            pendingIteration.current = first;
            pendingSavedChanges.current = null;
            void controller.selectSavedTarget(first);
            showToast(
              refresh
                ? `Refreshed the Review as version ${iteration.number}.`
                : `Started the notes of version ${iteration.number}.`,
            );
          },
          (error: unknown) =>
            showToast(
              error instanceof Error
                ? error.message
                : refresh
                  ? "The review could not refresh."
                  : "New notes could not start.",
            ),
        )
        .finally(() => setRefreshing(false));
    },
    [controller, showToast],
  );
  const [dismissedDrift, setDismissedDrift] = useState<string | null>(null);
  // Delete the notes on screen: the shown iteration's, and a brief that it
  // shows from an earlier iteration.
  const deleteNotes = useCallback(
    () =>
      controller
        .deleteNotes(
          shownIteration === undefined
            ? {}
            : {
                iteration: shownIteration,
                ...(briefSource && briefSource.number !== shownIteration
                  ? { briefFrom: briefSource.number }
                  : {}),
              },
        )
        .then(
          () => {
            setBriefIteration(null);
            showToast("Notes deleted.");
          },
          (error: unknown) =>
            showToast(error instanceof Error ? error.message : "The notes could not be deleted."),
        ),
    [controller, shownIteration, briefSource, showToast],
  );
  // Pin to review on the agent's replies. A pin goes to the latest iteration.
  const showPinRef = useRef(showPin);
  useEffect(() => {
    showPinRef.current = showPin;
  });
  const savedForPins = state.savedReview;
  const sessionPins = useMemo<SessionPins | undefined>(() => {
    if (!savedForPins) return undefined;
    const pinned = new Map<string, string>();
    for (const pin of [
      ...(savedForPins.pins ?? []),
      ...(savedForPins.iterations ?? []).flatMap((entry) => entry.pins ?? []),
    ])
      if (pin.source?.itemId) pinned.set(`${pin.source.sessionId}/${pin.source.itemId}`, pin.id);
    return {
      pinned,
      pin: (source, text) =>
        controller.pinToReview({ add: { text, source } }).then(
          () => showToast("Pinned to the review's Notes."),
          (error: unknown) =>
            showToast(error instanceof Error ? error.message : "The reply could not be pinned."),
        ),
      show: (pinId) => showPinRef.current(pinId),
    };
  }, [savedForPins, controller, showToast]);
  useEffect(() => {
    const paste = (event: ClipboardEvent) => {
      if (event.defaultPrevented) return;
      const editing = event
        .composedPath()
        .some(
          (node) =>
            node instanceof HTMLElement &&
            (node.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(node.tagName)),
        );
      if (editing || visibleElement('[role="dialog"]')) return;
      if (!controller.getSnapshot().savedReview && !canSaveReview) return;
      const text = clipboardBrief(event.clipboardData);
      if (!text) return;
      event.preventDefault();
      attachBrief(text);
    };
    window.addEventListener("paste", paste);
    return () => window.removeEventListener("paste", paste);
  }, [controller, canSaveReview, attachBrief]);
  const openBriefLocation = useCallback(
    (location: BriefLocation) => {
      const snapshot = controller.getSnapshot();
      if (!snapshot.visibleFiles.some((file) => file.id === location.fileId))
        controller.setFilter("");
      if (location.start === undefined) {
        reveal(location.fileId);
        return;
      }
      revealLine(
        location.fileId,
        location.start,
        location.end ?? location.start,
        location.side === "old" ? "deletions" : "additions",
      );
    },
    [controller, reveal, revealLine],
  );
  useEffect(() => {
    if (!state.selectedFileId || lineJump.current?.id === state.selectedFileId) return;
    const row = metadataRows.current.get(state.selectedFileId);
    if (row) row.scrollIntoView({ block: "nearest" });
    else
      viewer.current?.scrollTo({
        type: "item",
        id: state.selectedFileId,
        align: "nearest",
      });
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
    pullRequest.threadsRevision,
    [...pullRequestThreads.placement.inline],
    codexReviews.revision,
    [...codexFindings.placement.inline],
    savedGuide?.updatedAt ?? null,
    state.savedView,
  ]);
  const [itemVersion, setItemVersion] = useState({
    key: itemKey,
    files: streamFiles,
    notes,
    value: 0,
  });
  let currentVersion = itemVersion.value;
  if (
    itemVersion.key !== itemKey ||
    itemVersion.files !== streamFiles ||
    itemVersion.notes !== notes
  ) {
    currentVersion++;
    setItemVersion({
      key: itemKey,
      files: streamFiles,
      notes,
      value: currentVersion,
    });
  }
  // The guide's comments refer to the saved comparison's lines. One on a line
  // that no hunk shows goes to its segment's header instead.
  const guideNotesByFile = state.savedView ? resolvedGuide?.notesByFile : undefined;
  const items = useMemo<CodeViewItem<Annotation>[]>(() => {
    return streamFiles.flatMap((file) => {
      if (!file.metadata || mediaType(file.path)?.kind === "image") return [];
      // GitHub threads come first: they are the review so far.
      const annotations: DiffLineAnnotation<Annotation>[] = showNotes
        ? [
            ...(pullRequestThreads.byPath.get(file.path) ?? []).map(
              (thread): DiffLineAnnotation<Annotation> => ({
                side: thread.side === "old" ? "deletions" : "additions",
                lineNumber: thread.line!,
                metadata: { thread },
              }),
            ),
            ...(codexFindings.byPath.get(file.path) ?? []).map(
              (finding): DiffLineAnnotation<Annotation> => ({
                side: "additions",
                lineNumber: finding.finding.endLine,
                metadata: { finding },
              }),
            ),
            ...notes
              .filter(
                (note) =>
                  note.path === file.path &&
                  !note.parentId &&
                  note.resolution !== "orphaned" &&
                  note.resolution !== "stale",
              )
              .map((note): DiffLineAnnotation<Annotation> => ({
                side: note.side === "old" ? "deletions" : "additions",
                lineNumber: noteLine(file.metadata, note),
                metadata: { note },
              })),
            ...(guideNotesByFile?.get(file.id) ?? [])
              .filter(onLines)
              .filter((note) => shownLine(file.metadata, note))
              .map((note): DiffLineAnnotation<Annotation> => ({
                side: note.side === "old" ? "deletions" : "additions",
                lineNumber: noteLine(file.metadata, note),
                metadata: { guide: note },
              })),
          ]
        : [];
      if (visibleDraft?.path === file.path)
        annotations.push({
          side: visibleDraft.side === "old" ? "deletions" : "additions",
          lineNumber: noteLine(file.metadata, visibleDraft),
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
  }, [
    streamFiles,
    notes,
    showNotes,
    visibleDraft,
    collapsed,
    currentVersion,
    pullRequestThreads,
    codexFindings,
    guideNotesByFile,
  ]);

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
        [data-separator-content] { font-size: 11.5px; letter-spacing: 0.01em; }
        ${highlightRules(activeTheme, { match: "med-diff-find", current: "med-diff-find-current" })}`,
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
      expansionLineCount: EXPANSION_LINES,
      layout: { gap: 0, paddingTop: 0, paddingBottom: 0 },
      loadDiffFiles: async (metadata: FileDiffMetadata) => {
        try {
          const expectedReview = reviewId;
          if (controller.getSnapshot().review?.id !== expectedReview)
            throw new Error("The comparison changed.");
          diagnostics.record("context-request", {
            review: expectedReview,
            path: metadata.name,
          });
          const source = await controller.loadSources(metadata.name);
          if (source.reviewId !== expectedReview) throw new Error("The comparison changed.");
          diagnostics.record("context-ready", {
            review: source.reviewId,
            path: metadata.name,
          });
          setContextError(null);
          return loadedDiffFiles(metadata, source);
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
        findHighlights.rendered(node, phase === "unmount" ? undefined : rendered?.name);
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
    [controller, theme, activeTheme, mode, wrap, reviewId, diagnostics, draft, findHighlights],
  );

  const hits = useMemo(() => {
    if (!find) return [];
    const query = find.toLowerCase();
    const result: {
      id: string;
      side: "additions" | "deletions";
      line: number;
    }[] = [];
    for (const file of streamFiles) {
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
  }, [streamFiles, find]);
  useEffect(() => {
    const hit = findOpen ? hits[findIndex] : undefined;
    const path = hit && streamFiles.find((file) => file.id === hit.id)?.path;
    findHighlights.set(
      findOpen ? find : "",
      hit && path ? { path, side: hit.side, line: hit.line } : null,
    );
  }, [findHighlights, findOpen, find, hits, findIndex, streamFiles]);
  const jumpHit = useCallback(
    (index: number) => {
      if (!hits.length) return;
      const next = (index + hits.length) % hits.length;
      setFindIndex(next);
      const hit = hits[next];
      revealLine(hit.id, hit.line, hit.line, hit.side);
    },
    [hits, revealLine],
  );
  const startNote = useCallback(() => {
    if (!selection) return;
    const file = streamFiles.find((entry) => entry.id === selection.id);
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
  }, [selection, streamFiles]);
  // Ask about these lines: the thread's lead agent answers in the Question
  // pane, and its thread gets nothing (data/questions.ts).
  const question = useQuestion(sessionFetch);
  const askThread =
    state.savedReview?.id ?? (found ? foundThreadId(found.agent, found.id) : undefined);
  const askLead = found ?? leadSession;
  const askAgent =
    askLead &&
    (askLead.agent === "claude" ||
      askLead.agent === "codex" ||
      (askLead.agent === "acp" && askLead.name === "Codex"))
      ? agentName(askLead)
      : undefined;
  const askBlocked = !askLead
    ? "This thread has no agent to ask"
    : !askAgent
      ? "Ask works in Claude Code and Codex threads"
      : question.busy
        ? "Wait for the answer, or stop it"
        : undefined;
  const canAsk = !!askThread && !askBlocked;
  const { open: openQuestion, discard: discardQuestion, fail: failQuestion } = question;
  // The layout before the Question pane opened; Close gives it back.
  const questionLayout = useRef<PaneNode | null>(null);
  const { root: paneRoot, isOpen: paneOpen, closeTo: closePaneTo } = panes;
  const startAsk = useCallback(() => {
    if (!selection || !askThread || !askAgent) return;
    const file = streamFiles.find((entry) => entry.id === selection.id);
    if (!file) return;
    if (selection.range.endSide && selection.range.side !== selection.range.endSide) {
      setContextError("Select lines on one side to ask about them.");
      return;
    }
    const side = selection.range.side === "deletions" ? "old" : "new";
    const line = Math.min(selection.range.start, selection.range.end);
    const endLine = Math.max(selection.range.start, selection.range.end);
    const opened = openQuestion({
      thread: askThread,
      agent: askAgent,
      reviewId: controller.getSnapshot().review?.id,
      note: { path: file.path, side, line, endLine },
      excerpt: questionExcerpt(file.path, file.metadata, side, line, endLine),
    });
    if (!opened) return;
    if (!paneOpen("question")) questionLayout.current = paneRoot;
    // A narrow row gives the question a larger share, so the answer stays readable.
    const place = PANE_PLACES.question!;
    const row = mainElement?.closest("[data-pane-tree]")?.clientWidth ?? 0;
    const share = row ? Math.min(0.5, Math.max(place.share, QUESTION_WIDTH / row)) : place.share;
    showInTree("question", { ...place, share });
  }, [
    selection,
    askThread,
    askAgent,
    streamFiles,
    openQuestion,
    controller,
    showInTree,
    paneOpen,
    paneRoot,
    mainElement,
  ]);
  const closeQuestion = useCallback(() => {
    discardQuestion();
    closePaneTo("question", questionLayout.current);
    questionLayout.current = null;
  }, [discardQuestion, closePaneTo]);
  /** Saves the question and its answer as a comment on the lines, through
   * the review's comments, and closes the question. */
  const questionView = question.view;
  const keepQuestion = useCallback(async () => {
    const view = questionView;
    if (!view?.asked || !view.state?.answer.trim()) return;
    if (controller.getSnapshot().review?.id !== view.target.reviewId) {
      failQuestion(
        "The review shows other changes now. Show these lines again to keep the answer.",
      );
      return;
    }
    try {
      await controller.mutateNote({
        type: "add",
        note: {
          ...view.target.note,
          text: questionComment(view.asked, view.target.agent, view.state.answer),
        },
      });
    } catch (error) {
      failQuestion(error instanceof Error ? error.message : "Could not save the comment.");
      return;
    }
    setShowNotes(true);
    closeQuestion();
  }, [questionView, controller, failQuestion, closeQuestion]);
  // A layout kept from before a reload names a question that is gone.
  const questionShown = panes.isOpen("question");
  useEffect(() => {
    if (questionShown && !questionView) closePane("question");
  }, [questionShown, questionView, closePane]);
  const navigateFile = useCallback(
    (delta: number) => {
      const index = streamFiles.findIndex((file) => file.id === state.selectedFileId);
      const next = streamFiles[Math.max(0, Math.min(streamFiles.length - 1, index + delta))];
      if (next) reveal(next.id);
    },
    [streamFiles, state.selectedFileId, reveal],
  );
  const navigateHunk = useCallback(
    (delta: number) => {
      const targets = streamFiles.flatMap(
        (file) =>
          file.metadata?.hunks.map((hunk) => ({
            id: file.id,
            side: hunk.additionCount > 0 ? ("additions" as const) : ("deletions" as const),
            line: hunk.additionCount > 0 ? hunk.additionStart : hunk.deletionStart,
            count: hunk.additionCount > 0 ? hunk.additionCount : hunk.deletionCount,
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
        // The whole hunk sits in the middle of the view; a hunk taller than the
        // view starts at its top instead.
        viewer.current?.scrollTo({
          type: "range",
          id: target.id,
          range: {
            start: target.line,
            end: target.line + Math.max(0, target.count - 1),
            side: target.side,
          },
          align: "center",
        });
      }
    },
    [streamFiles, selection, state.selectedFileId, controller],
  );
  const openFind = useCallback(() => {
    setFindOpen(true);
    requestAnimationFrame(() => findRef.current?.focus());
  }, []);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      // The ⌃Tab switcher takes the keys: a letter with Control held searches.
      if (document.querySelector("[data-standalone-files], [data-workspace-switcher]") || !shown())
        return;
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
      if (
        event.key === "q" &&
        commitApi &&
        !editing &&
        !modal &&
        !visibleElement('[role="dialog"]') &&
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
        toggleCommit();
        return;
      }
      const optionKey = event.code || `Key${event.key.toUpperCase()}`;
      // These Alt keys also work from the editor and the Search tab's query,
      // so ⌥W, ⌥Z, and ⌥1–9 do not type there.
      const fromEditor =
        (["KeyW", "KeyZ"].includes(optionKey) || /^Digit[1-9]$/.test(optionKey)) &&
        event
          .composedPath()
          .some(
            (node) =>
              node instanceof HTMLElement &&
              (node.classList.contains("cm-content") || node.hasAttribute("data-tab-keys")),
          );
      if (
        event.altKey &&
        !event.metaKey &&
        !event.ctrlKey &&
        (!editing || fromEditor) &&
        !modal &&
        !visibleElement('[role="dialog"]')
      ) {
        const key = optionKey;
        // Alt+1–8 show that tab; Alt+9 shows the last, as in browsers.
        const row = tabRow();
        if (/^Digit[1-9]$/.test(key) && !event.shiftKey && row.order.length) {
          event.preventDefault();
          event.stopPropagation();
          const place = Number(key.slice(5));
          const id = place === 9 ? row.order.at(-1) : row.order[place - 1];
          if (id && id !== row.active) selectTab(id);
          return;
        }
        // ⌥↑ and ⌥↓ go up and down a stack, unless a sidebar row has the focus:
        // there they move the tab.
        if (
          (key === "ArrowUp" || key === "ArrowDown") &&
          !event.shiftKey &&
          !(event.target instanceof Element && event.target.closest("[data-sidebar-row]")) &&
          stepLayer(key === "ArrowUp" ? 1 : -1)
        ) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        if (["KeyW", "KeyO", "KeyB", "KeyR", "KeyZ"].includes(key)) {
          event.preventDefault();
          event.stopPropagation();
          if (event.repeat) return;
          if (key === "KeyW") {
            if (event.shiftKey) fileWorkspace.closeAll();
            else if (activeFile) fileWorkspace.close(activeFile.id);
            else if (fileState.active === "search") fileWorkspace.close("search");
          } else if (key === "KeyO" && event.shiftKey) fileWorkspace.closeOthers();
          else if (key === "KeyB" && activeFile && fileState.file?.kind === "text") toggleBlame();
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
        // ⌘⇧B shows the agent session; the files sidebar has only its button.
        if (event.shiftKey && !state.savedReview) return;
        event.preventDefault();
        event.stopPropagation();
        if (event.repeat) return;
        if (event.shiftKey) toggleSession();
        else toggleReviewSidebar();
        return;
      }
      // ⌘⌃= gives every pane the same room, as Ghostty balances its splits.
      if (
        event.ctrlKey &&
        (event.metaKey || event.altKey) &&
        !event.shiftKey &&
        (event.code === "Equal" || event.key === "=") &&
        panes.open.length > 1
      ) {
        event.preventDefault();
        event.stopPropagation();
        if (!event.repeat) panes.balance();
        return;
      }
      if (themePickerOpen || filePickerOpen || symbolPickerOpen || helpOpen || rangeOpen) return;
      // ⌘⇧[ and ⌘⇧] show the previous and next tab, also from the editor. A
      // browser tab keeps these keys; the installed app receives them.
      const bracket =
        event.code || (event.key === "{" ? "BracketLeft" : event.key === "}" ? "BracketRight" : "");
      if (
        (event.metaKey || event.ctrlKey) &&
        event.shiftKey &&
        (bracket === "BracketLeft" || bracket === "BracketRight")
      ) {
        const inEditor = event
          .composedPath()
          .some(
            (node) =>
              node instanceof HTMLElement &&
              (node.classList.contains("cm-content") || node.hasAttribute("data-tab-keys")),
          );
        const { order, active } = tabRow();
        if (
          order.length < 2 ||
          modal ||
          visibleElement('[role="dialog"]') ||
          (editing && !inEditor)
        )
          return;
        event.preventDefault();
        event.stopPropagation();
        const step = bracket === "BracketRight" ? 1 : -1;
        const index = Math.max(0, order.indexOf(active));
        selectTab(order[(index + step + order.length) % order.length]!);
        return;
      }
      // ⌘O and ⌘⇧O open the symbol picker wherever there is a checkout, so the
      // browser never opens its own file dialog; with no file open, ⌘O's
      // picker says so and offers the project.
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "o") {
        if (!browseSource) return;
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
        openSearch();
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
      // G for Git: branches and worktrees, beside ⌘⇧K for files.
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === "g") {
        if (!gitAvailable) return;
        event.preventDefault();
        event.stopPropagation();
        if (event.repeat) return;
        setCommandsOpen(false);
        setBranchPickerNew(false);
        setBranchPickerOpen((open) => !open);
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f") {
        if (commandsOpen || branchPickerOpen) return;
        if (!streamShown) {
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
      // In a file, / starts Vim's search also when the file does not have
      // focus, such as after a click on its tab. The side panes keep the key.
      if (
        event.key === "/" &&
        !editing &&
        !modal &&
        !visibleElement('[role="dialog"]') &&
        fileState.active !== "changes" &&
        fileState.file?.kind === "text" &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        !event
          .composedPath()
          .some(
            (node) =>
              node instanceof HTMLElement &&
              (node.matches('[data-file-pane="main"][tabindex="0"]') ||
                node.hasAttribute("data-pane")),
          )
      ) {
        event.preventDefault();
        event.stopPropagation();
        fileNavigation.current?.("/");
        return;
      }
      if (
        editing ||
        modal ||
        Boolean(visibleElement('[role="dialog"]')) ||
        (!streamShown && !guideTab) ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey
      )
        return;
      // The Guide: j and k step through its parts; v marks the file at the top
      // of the stream as viewed; Shift+V marks the part and moves on.
      if (guideTab && (event.key === "j" || event.key === "k")) {
        event.preventDefault();
        event.stopPropagation();
        stepGuide(event.key === "j" ? 1 : -1);
        return;
      }
      if (guideDiff && (event.key === "v" || event.key === "V")) {
        event.preventDefault();
        event.stopPropagation();
        if (event.key === "V") {
          setFilesViewed(
            streamFiles.map((file) => file.id),
            true,
          );
          stepGuide(1);
        } else toggleTopFileViewed();
        return;
      }
      if (!streamShown) return;
      if (event.key === "/") {
        event.preventDefault();
        event.stopPropagation();
        openFind();
      } else if (event.key === "]" || event.key === "[") {
        // Focus in the session thread gives these keys to its messages.
        const inThread = event
          .composedPath()
          .some((node) => node instanceof HTMLElement && node.hasAttribute("data-message-keys"));
        if (inThread) return;
        event.preventDefault();
        event.stopPropagation();
        navigateHunk(event.key === "]" ? 1 : -1);
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
      } else if (event.key === "a" && selection && askThread) {
        event.preventDefault();
        event.stopPropagation();
        if (canAsk) startAsk();
      } else if (event.key === "Escape") {
        // In the Question pane, Escape stops the answer and keeps the lines.
        const inQuestion = event
          .composedPath()
          .some((node) => node instanceof HTMLElement && node.dataset.pane === "question");
        if (inQuestion) return;
        setFindOpen(false);
        setDraft(null);
        setSelection(null);
      }
    };
    window.addEventListener("keydown", keydown, true);
    return () => window.removeEventListener("keydown", keydown, true);
  }, [
    panes,
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
    askThread,
    canAsk,
    startAsk,
    toggleReviewSidebar,
    toggleSession,
    state.savedReview,
    toggleZen,
    browseSource,
    openFilePicker,
    openSearch,
    resumeFilePicker,
    helpOpen,
    rangeOpen,
    activeFile,
    fileState.file?.kind,
    fileWorkspace,
    gitAvailable,
    toggleBlame,
    commitApi,
    toggleCommit,
    tabRow,
    selectTab,
    streamShown,
    guideTab,
    guideDiff,
    stepGuide,
    setFilesViewed,
    streamFiles,
    toggleTopFileViewed,
    shown,
    stepLayer,
  ]);

  const selectBranch = useCallback(
    (name: string, repositoryId: string) => void controller.selectBranch(name, repositoryId),
    [controller],
  );
  const selectWorktree = useCallback(
    (path: string, repositoryId: string) => void controller.selectWorktree(path, repositoryId),
    [controller],
  );
  const selectWorking = useCallback(() => {
    fileWorkspace.select("changes");
    void controller.selectComparison({ kind: "working" });
  }, [controller, fileWorkspace]);
  const branches = useBranchTabs({
    repositories: state.repositories,
    activeRepositoryId: state.activeRepositoryId,
    activeBranch: state.activeBranch,
    repo: state.session?.repository.path,
    error: state.branchesError,
    onBranch: selectBranch,
    onWorktree: selectWorktree,
  });
  const openBranchPicker = (newWorkspace: boolean) => {
    setBranchPickerNew(newWorkspace);
    setBranchPickerOpen(true);
  };
  // Plain ↵ opens a branch here, or shows the workspace that already has it;
  // ⌘↵ opens it in a new workspace.
  const openBranch = (entry: BranchEntry, newWorkspace: boolean) => {
    if (!workspace) return branches.open(entry);
    const repository = state.repositories.find((item) => item.id === entry.repositoryId);
    const target = {
      kind: "repository" as const,
      repositoryId: entry.repositoryId,
      path: entry.path ?? repository?.path,
      branch: entry.branch,
      title: entry.label,
      repository: repository?.name,
    };
    const existing = workspace.match(target);
    if (existing && existing !== workspace.id) workspace.activate(existing);
    else if (!existing && newWorkspace) workspace.open(target);
    else if (!existing) entry.run();
  };
  // In a thread, ⌘⇧G picks the checkout that the thread shows: ↵ moves the
  // thread there, and its Changes follow. A branch that no checkout has opens
  // in a new workspace, as Med never switches branches.
  const threadPicker = !!state.savedReview && !!workspace && gitAvailable;
  const moveThreadTo = (entry: BranchEntry) => {
    if (!entry.path) return openBranch(entry, true);
    fileWorkspace.select("changes");
    if (entry.path === threadCheckout(state.savedReview!)?.repo) return;
    controller
      .moveThread({
        repositoryId: entry.repositoryId,
        repo: entry.path,
        branch: entry.branch ?? null,
      })
      .then(
        () => showToast(`This thread shows ${entry.label} now.`),
        (error: unknown) => showToast(error instanceof Error ? error.message : String(error)),
      );
  };
  // The workspace list names each workspace and shows its changed-file count.
  const reportTo = workspace?.update;
  const reportTitle =
    threadName ?? state.savedReview?.title ?? branches.current?.label ?? state.activeBranch;
  const reportPath = state.session?.repository.path;
  // A linked worktree, so closing the workspace can remove it.
  const reportWorktree = state.session?.worktrees.find((entry) => entry.path === reportPath)?.linked
    ? reportPath
    : undefined;
  const reportRepository = state.session?.repository.name;
  const reportReady = state.status === "ready";
  const reportCount = state.files.length;
  // Compared as text, so a reloaded review with the same sessions reports nothing.
  const reportSessions = state.savedReview?.sessions?.length
    ? JSON.stringify(state.savedReview.sessions)
    : undefined;
  // With every repository removed, the workspace opens the host's default.
  const reportEmpty =
    !state.session && !state.repositories.length && state.status === "idle" && !state.error;
  useEffect(() => {
    if (!reportTo || !workspaceId) return;
    if (reportEmpty)
      return reportTo(workspaceId, {
        path: undefined,
        repositoryId: undefined,
        branch: undefined,
        detail: undefined,
        worktree: undefined,
      });
    reportTo(workspaceId, {
      ...(reportTitle ? { title: reportTitle } : {}),
      ...(reportSessions ? { sessions: JSON.parse(reportSessions) } : {}),
      ...(reportReady ? { detail: reportCount ? String(reportCount) : undefined } : {}),
      ...(reportPath
        ? {
            worktree: reportWorktree,
            path: reportPath,
            repository: reportRepository,
            repositoryId: state.activeRepositoryId ?? undefined,
            branch: state.activeBranch ?? undefined,
          }
        : {}),
    });
  }, [
    reportTo,
    workspaceId,
    reportEmpty,
    reportTitle,
    reportSessions,
    reportReady,
    reportCount,
    reportPath,
    reportWorktree,
    reportRepository,
    state.activeRepositoryId,
    state.activeBranch,
  ]);
  const workingAvailable = gitAvailable && !state.historyRef;
  /** Opens a file of this checkout; `background` keeps the tab on screen. */
  const openWorkingFile = useCallback(
    (path: string, background = false) =>
      fileWorkspace.open(path, undefined, undefined, undefined, undefined, { background }),
    [fileWorkspace],
  );
  const hideFilesSidebar = useCallback(() => closePane("files"), [closePane]);
  const openChangedFile = useCallback(
    (id: string, background?: boolean) => {
      const file = files.find((item) => item.id === id);
      if (file) openWorkingFile(file.path, background);
    },
    [files, openWorkingFile],
  );
  const openVersion = useCallback(
    (path: string, side: "old" | "new") => {
      const review = state.review;
      if (!review) return;
      const file = state.files.find((item) => item.path === path);
      const oid = side === "old" ? review.base : review.head;
      const name = side === "old" ? (file?.info.previousPath ?? path) : path;
      if (/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/.test(oid))
        fileWorkspace.open(
          name,
          undefined,
          { kind: "commit", repo: review.repo, oid },
          `${side === "old" ? "Before" : "After"} · ${oid.slice(0, 7)}`,
        );
    },
    [state.review, state.files, fileWorkspace],
  );
  const activeSourceMatches =
    activeFile &&
    activeFile.source.kind !== "vault" &&
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
  // The open file's props stay the same between unrelated renders, so the
  // memoized viewer and editor skip them.
  const activeFileId = activeFile?.id;
  const activeSource = activeFile?.source;
  const activePath = activeFile?.path;
  const activeSourceLabel = activeFile?.sourceLabel;
  const fileEditor = useMemo(
    () =>
      activePath !== undefined &&
      ((activeSource?.kind === "worktree" && browseApi.write) ||
        (activeSource?.kind === "vault" && browseApi.writeVault))
        ? {
            drafts: editorDrafts,
            key: JSON.stringify([activeSource, activePath]),
            write: async (file: FileRead, text: string) => {
              const saved =
                file.source.kind === "worktree"
                  ? await browseApi.write!(file.source, file.path, file.identity, text)
                  : file.source.kind === "local" && "vault" in file && file.vault
                    ? await browseApi.writeVault!(file, text)
                    : undefined;
              if (!saved) throw new Error("Read-only source");
              fileWorkspace.acceptWrite(saved);
              return saved;
            },
            autoEdit:
              location.pathname === "/file" &&
              new URLSearchParams(location.search).get("edit") === "1" &&
              new URLSearchParams(location.search).get("path") === activePath,
          }
        : undefined,
    [activeSource, activePath, browseApi, editorDrafts, fileWorkspace],
  );
  // The main file shows a Markdown file rendered.
  const [fileReading, setFileReading] = useState(false);
  const setFileBlame = useCallback(
    (open: boolean) => setBlameTab(open && activeFileId ? activeFileId : null),
    [activeFileId],
  );
  const refreshFile = useCallback(() => void fileWorkspace.refresh(), [fileWorkspace]);
  const closeActiveFile = useCallback(() => {
    if (activeFileId) fileWorkspace.close(activeFileId);
  }, [activeFileId, fileWorkspace]);
  const openLinkedFile = useCallback(
    (path: string, line?: number) =>
      fileWorkspace.open(path, line, activeSource, activeSourceLabel),
    [activeSource, activeSourceLabel, fileWorkspace],
  );
  // A vault file's wiki and Markdown links resolve in its vault, as in the vault's workspace.
  const activeVault = activeSource?.kind === "vault" ? activeSource.id : undefined;
  useEffect(() => {
    if (!activeVault || activePath === undefined || !browseApi.followVaultLink) return;
    let live = true;
    const follow = (event: Event) => {
      // Hidden workspaces stay mounted; only the window's own workspace follows.
      if (document.querySelector("[data-standalone-files]") || !shown()) return;
      const link = (event as CustomEvent<{ href: string; syntax: string }>).detail;
      browseApi.followVaultLink!(activeVault, activePath, link).then(
        (target) => {
          if (live)
            fileWorkspace.open(
              target.path,
              target.line,
              { kind: "vault", id: activeVault },
              activeSourceLabel,
            );
        },
        (error: unknown) => {
          if (live) showToast(error instanceof Error ? error.message : "Cannot follow this link.");
        },
      );
    };
    window.addEventListener("med-vault-navigate", follow);
    return () => {
      live = false;
      window.removeEventListener("med-vault-navigate", follow);
    };
  }, [activeVault, activePath, activeSourceLabel, browseApi, fileWorkspace, showToast, shown]);
  // A primitive copy, so the callbacks below do not depend on a mutable file object.
  const activeDiffPath = activeDiffFile ? `${activeDiffFile.path}` : undefined;
  const openBeforeVersion = useCallback(() => {
    if (activeDiffPath) openVersion(activeDiffPath, "old");
  }, [activeDiffPath, openVersion]);
  const openAfterVersion = useCallback(() => {
    if (activeDiffPath) openVersion(activeDiffPath, "new");
  }, [activeDiffPath, openVersion]);
  const openBefore =
    activeDiffPath && /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/.test(state.review?.base ?? "")
      ? openBeforeVersion
      : undefined;
  const openAfter =
    activeDiffPath && /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/.test(state.review?.head ?? "")
      ? openAfterVersion
      : undefined;
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
  /** Shows the whole diff of the Review's version, not one of its commits. */
  const showReviewDiff = () => {
    pendingSavedChanges.current = state.savedTargetId;
    fileWorkspace.select("changes");
    void controller.showReview();
  };
  // The commits beside the diff, in the rail or the Changed files pane: the
  // Review's range, and in Changes the same list, or else the branch's own
  // commits. A commit opens in the tab that lists it, and one that showed
  // before shows again from the cache.
  const liveCommits = !reviewShown ? changesCommits(state) : undefined;
  const rangeCommits = {
    commits:
      fileState.active !== "changes"
        ? NO_COMMITS
        : reviewShown
          ? guideCommits
          : (liveCommits?.commits ?? NO_COMMITS),
    moreCommits: reviewShown ? guideTarget?.moreCommits : liveCommits?.more,
    commit: state.comparison.kind === "commit" ? state.comparison.commit : null,
    whole: reviewShown ? state.savedView : state.comparison.kind !== "commit",
    wholeLabel: reviewShown ? "Whole range" : "All changes",
    onCommit: (commit: string) =>
      void controller.selectComparison({ kind: "commit", commit }, reviewShown),
    onWhole: reviewShown ? showReviewDiff : () => void controller.showAllChanges(),
  };
  const actionRepo = state.review?.repo ?? state.session?.repository.path;
  const actionBranch = state.savedView
    ? (state.savedReview?.targets.find((target) => target.id === state.savedTargetId)?.branch ?? "")
    : (state.activeBranch ?? "");
  // The checkout's branch head, as Med last read it.
  const liveHead = branchHead ?? state.session?.repository.head ?? "";
  const actionHead =
    state.savedView || state.comparison.kind === "commit" || state.comparison.kind === "range"
      ? (state.review?.head ?? "")
      : liveHead;
  // The base branch menu and Push (ComparisonActions), with or without their buttons.
  // A base branch that is gone leaves Branch changes with an error; the base
  // menu stays, to choose another.
  const comparisonActionsShown =
    !!actionRepo &&
    (state.status === "ready" ||
      (state.status === "error" &&
        state.comparison.kind === "working" &&
        !!state.comparison.base)) &&
    state.session?.repository.git !== false;
  const pushable = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/.test(actionHead);
  const gitTargets = useGitTargets(comparisonActionsShown ? actionRepo : undefined, actionHead);
  // Why Push… cannot open yet: its dialog needs a commit and the remotes.
  const pushBlocked = !pushable
    ? "No commit to push"
    : gitTargets.error
      ? `Cannot read the remotes. ${gitTargets.error}`
      : !gitTargets.targets
        ? "Reading the remotes…"
        : undefined;
  const compareAgainst = () => {
    fileWorkspace.select("changes");
    // The menu opens below the comparison, once the Changes tab shows it.
    openCompare();
  };
  // Changes on a branch other than the base start at the base: the branch's
  // commits and its uncommitted changes. A thread keeps the base that the
  // reader chose for its checkout.
  const ownCheckout = state.savedReview ? threadCheckout(state.savedReview) : undefined;
  const onOwnCheckout = !!ownCheckout && ownCheckout.repo === state.session?.repository.path;
  const branchBase =
    (state.comparison.kind === "working" ? state.comparison.base : undefined) ??
    changesBase(
      state.repositories.find((entry) => entry.id === state.activeRepositoryId),
      state.activeBranch,
      onOwnCheckout ? ownCheckout.base : undefined,
    );
  const liveValue =
    state.comparison.kind === "working" && state.comparison.base ? "branch" : state.comparison.kind;
  // Quiet chrome names a live range by the branch at its head.
  const liveText = comparisonLabel(
    state.comparison,
    undefined,
    state.activeBranch ? { name: state.activeBranch, head: liveHead } : undefined,
  );
  // In Review, the row names the hand-off: its version and its age. The menu
  // lists the versions, newest first, then the commits that you commented
  // on. Git's comparisons are the Changes tab's. A version of several
  // checkouts has an item for each.
  const reviewNow = useMinuteClock(reviewShown);
  const handoffs = state.savedReview ? handoffTargets(state.savedReview) : [];
  const versionOf = (target: SavedReviewTarget) =>
    iterations.find((entry) => entry.targetIds.includes(target.id));
  const versionNumber = (target: SavedReviewTarget) => versionOf(target)?.number ?? 1;
  const latestVersion = iterations.at(-1)?.number ?? 1;
  // A version's description: its checkout, and for a range or a commit, the
  // names that Med saved with it.
  const placeOf = (target: SavedReviewTarget) =>
    [
      `${target.repo.split(/[\\/]/).at(-1)} · ${target.branch ?? "detached"}`,
      ...(target.comparison.kind === "range" || target.comparison.kind === "commit"
        ? [comparisonLabel(target.comparison, target.names).long]
        : []),
    ].join(" · ");
  // A stack's version is one item: the shown layer in that version, or its
  // bottom layer; the rail picks the layer.
  const versionHandoffs = state.savedReview?.parts
    ? handoffs.filter((target) => {
        const mates = handoffs.filter((other) => versionOf(other) === versionOf(target));
        const part = savedTarget?.part;
        return (mates.find((other) => !!part && other.part === part) ?? mates[0]) === target;
      })
    : handoffs;
  const versionChoices = reviewShown
    ? [
        ...versionHandoffs
          .map((target, index) => ({ target, index, number: versionNumber(target) }))
          .sort((a, b) => b.number - a.number || a.index - b.index)
          .map(({ target, number }) => {
            const places = versionHandoffs.filter(
              (other) => versionNumber(other) === number,
            ).length;
            const time = Date.parse(
              versionOf(target)?.createdAt ?? state.savedReview?.createdAt ?? "",
            );
            return {
              value: target.id,
              label: [
                `Version ${number}`,
                ...(places > 1 ? [target.repo.split(/[\\/]/).at(-1)!] : []),
                ...(Number.isFinite(time) ? [relativeTime(time, Math.max(reviewNow, time))] : []),
              ].join(" · "),
              description:
                number === latestVersion && latestVersion > 1
                  ? `${placeOf(target)} · the latest version`
                  : placeOf(target),
            };
          }),
        ...(state.savedReview?.targets ?? [])
          .filter((target) => target.commentReviewId)
          .map((target) => ({
            value: target.id,
            label: `Commit ${target.label}`,
            description: `${placeOf(target)} · a commit that you commented on`,
          })),
      ]
    : [];
  const reviewCommit =
    reviewShown && !state.savedView && state.comparison.kind === "commit"
      ? state.comparison.commit
      : null;
  const comparisonValue = reviewShown ? (reviewCommit ?? state.savedTargetId ?? "") : liveValue;
  const sessionFilter = "session" in state.comparison ? (state.comparison.session ?? null) : null;
  const liveChoices = [
    ...(workingAvailable && branchBase
      ? [
          {
            value: "branch",
            label: "Branch changes",
            description: `Commits since ${branchBase}, and uncommitted changes`,
          },
        ]
      : []),
    ...(workingAvailable
      ? [
          {
            value: "working",
            label: "Working changes",
            description: "HEAD to working files, including untracked",
          },
          {
            value: "staged",
            label: "Staged changes",
            description: "HEAD to the index",
          },
          {
            value: "unstaged",
            label: "Unstaged changes",
            description: "Index to working files",
          },
        ]
      : []),
    ...(!["branch", "working", "staged", "unstaged"].includes(liveValue)
      ? [
          {
            value: liveValue,
            label:
              state.comparison.kind === "commit"
                ? state.comparison.commit.slice(0, 7)
                : state.comparison.kind === "patch"
                  ? "Patch review"
                  : state.comparison.kind === "files"
                    ? "File comparison"
                    : // Quiet chrome names the range here, and only here.
                      quiet && state.comparison.kind === "range"
                      ? liveText.long
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
  const comparisonChoices: { value: string; label: string; description?: string }[] = reviewShown
    ? [
        ...versionChoices,
        ...(reviewCommit
          ? [
              {
                value: reviewCommit,
                label: reviewCommit.slice(0, 7),
                description: "A commit of the Review's range",
              },
            ]
          : []),
      ]
    : liveChoices.map((choice) =>
        // The trigger says when Changes keep only the session's files.
        sessionFilter && choice.value === liveValue
          ? { ...choice, label: `${choice.label} · this session` }
          : choice,
      );
  // The row's label: in full, or short in a narrow row (QuietChrome.tsx).
  const chosenLabel = comparisonChoices.find((choice) => choice.value === comparisonValue)?.label;
  const shownVersion = state.savedTargetId
    ? iterations.find((entry) => entry.targetIds.includes(state.savedTargetId!))?.number
    : undefined;
  const comparisonText: ComparisonLabel = reviewShown
    ? {
        long: chosenLabel ?? "",
        // A narrow row drops the age.
        short:
          reviewCommit || shownTarget?.commentReviewId
            ? (chosenLabel ?? "")
            : `Version ${shownVersion ?? 1}`,
      }
    : {
        // The branch's changes name the branch and its base.
        long:
          liveValue === "branch" && state.activeBranch && branchBase
            ? `${state.activeBranch} since ${branchBase}${sessionFilter ? " · this session" : ""}`
            : (chosenLabel ?? liveText.long),
        short: `${liveValue === "branch" ? "Branch" : liveText.short}${sessionFilter ? " · session" : ""}`,
      };
  // The host links a pull request that the thread's branch opened later
  // (src/host/pull-request-links.ts); the thread list names it first.
  const linkedPullRequest = thread?.pullRequestUrl;
  useEffect(() => {
    if (linkedPullRequest && linkedPullRequest !== state.savedReview?.pullRequestUrl)
      void controller.refreshSavedReview().catch(() => {});
  }, [linkedPullRequest, state.savedReview?.pullRequestUrl, controller]);

  // The turn recap (data/turn-recap.ts): a turn that ended while the reader
  // did not see its session ends the session thread with its facts, Review,
  // and Reply. A turn that ends while the session shows is seen.
  const watchingSession = useCallback(() => sessionVisible && shown(), [sessionVisible, shown]);
  const recap = useTurnRecap(hasSessions ? thread : undefined, watchingSession);
  const recapKey =
    thread && recap.endedAt !== undefined ? `${thread.id}:${recap.endedAt}` : undefined;
  // A recap that showed keeps its place once seen, out of sight, so nothing in
  // the thread moves. The next turn, a closed pane, or a hidden tab drops it.
  const [keptRecap, setKeptRecap] = useState<string>();
  if (recap.unseen && recapKey !== keptRecap) setKeptRecap(recapKey);
  else if (keptRecap !== undefined && !recap.unseen && (!sessionVisible || recapKey !== keptRecap))
    setKeptRecap(undefined);
  useEffect(() => () => setKeptRecap(undefined), []);
  // Review from the recap waits for the diff that it opens, then goes to the
  // Guide's first segment not viewed, or to the first file.
  const recapJump = useRef<"guide" | "review" | "changes" | null>(null);
  const firstUnviewed = useCallback(() => {
    const next =
      guideSections.find((section) => section.fileIds.some((id) => !guideViewedIds.has(id))) ??
      guideSections[0];
    openGuide(next ? { kind: "segment", key: next.key } : { kind: "overview" });
  }, [guideSections, guideViewedIds, openGuide]);
  const jumpReady = (jump: "guide" | "review" | "changes") => {
    const snapshot = controller.getSnapshot();
    if (snapshot.status !== "ready") return false;
    return jump === "changes" ? !snapshot.savedView && !snapshot.inReview : snapshot.savedView;
  };
  const finishJump = (jump: "guide" | "review" | "changes") => {
    recapJump.current = null;
    if (jump === "guide") firstUnviewed();
    else if (files[0]) reveal(files[0].id);
  };
  useEffect(() => {
    const jump = recapJump.current;
    if (jump && jumpReady(jump)) finishJump(jump);
  });
  const reviewTurn = () => {
    recap.see();
    // The review's keys, such as j and k in the Guide, go to the review.
    const active = document.activeElement;
    if (active instanceof HTMLElement && active.closest("[data-session-panel]")) active.blur();
    const jump = !reviewAvailable ? "changes" : hasGuide ? "guide" : "review";
    if (jump === "guide") {
      if (!jumpReady("guide")) openGuide({ kind: "overview" });
    } else selectTab(jump);
    if (jumpReady(jump)) finishJump(jump);
    else recapJump.current = jump;
  };
  const reviewTurnRef = useRef(reviewTurn);
  useLayoutEffect(() => {
    reviewTurnRef.current = reviewTurn;
  });
  // ⌥↵ opens the review while the recap shows, also from the message box.
  const recapKeyShown = recap.unseen && sessionVisible;
  useEffect(() => {
    if (!recapKeyShown) return;
    const keydown = (event: KeyboardEvent) => {
      if (event.key !== "Enter" || !event.altKey || event.metaKey || event.ctrlKey) return;
      if (event.shiftKey || event.isComposing || !shown()) return;
      event.preventDefault();
      event.stopPropagation();
      reviewTurnRef.current();
    };
    window.addEventListener("keydown", keydown, true);
    return () => window.removeEventListener("keydown", keydown, true);
  }, [recapKeyShown, shown]);
  const recapProps = useMemo(
    () =>
      keptRecap !== undefined && keptRecap === recapKey
        ? {
            facts: { changes: thread?.changes, checks: thread?.turn?.checks },
            hidden: !recap.unseen,
            onReview: () => reviewTurnRef.current(),
            onDismiss: recap.see,
          }
        : undefined,
    [keptRecap, recapKey, thread?.changes, thread?.turn?.checks, recap.unseen, recap.see],
  );
  const ownSession =
    leadSession && (leadSession.agent === "claude" || leadSession.agent === "codex")
      ? { agent: leadSession.agent, id: leadSession.id }
      : null;
  // A shared checkout holds other sessions' work too. Its Changes can keep
  // only the files that the thread's lead session edited.
  const canFilterSession =
    !reviewShown &&
    !!ownSession &&
    (!!thread?.shared || !!sessionFilter) &&
    ["working", "staged", "unstaged", "commit", "range"].includes(state.comparison.kind);
  const toggleSessionFilter = () => {
    if (!ownSession) return;
    const comparison = { ...state.comparison } as Comparison & { session?: unknown };
    if (sessionFilter) delete comparison.session;
    else comparison.session = ownSession;
    fileWorkspace.select("changes");
    void controller.selectComparison(comparison as Comparison);
  };
  const chooseComparison = (value: string) => {
    if (reviewShown) {
      if (value === reviewCommit) return;
      pendingSavedChanges.current = value;
      pendingIteration.current = null;
      fileWorkspace.select("changes");
      void controller.selectSavedTarget(value);
      return;
    }
    const session = sessionFilter ? { session: sessionFilter } : {};
    if (value === "branch" && branchBase)
      void controller.selectComparison({ kind: "working", base: branchBase, ...session });
    else if (value === "working" || value === "staged" || value === "unstaged")
      void controller.selectComparison({ kind: value, ...session });
  };
  const commands: ReviewCommand[] = [
    ...(stack && reviewAvailable
      ? [
          {
            id: "stack-next-unreviewed",
            label: `Next unreviewed ${stack.shape === "stack" ? "layer" : "part"}`,
            disabled: nextLayer < 0,
            run: showNextUnreviewed,
          },
          ...(stack.shape === "stack"
            ? [
                {
                  id: "stack-up",
                  label: "Layer above",
                  shortcut: "⌥ ↑",
                  disabled: layerIndex < 0 || layerIndex >= stack.layers.length - 1,
                  run: () => showLayer(layerIndex + 1),
                },
                {
                  id: "stack-down",
                  label: "Layer below",
                  shortcut: "⌥ ↓",
                  disabled: layerIndex <= 0,
                  run: () => showLayer(layerIndex - 1),
                },
                {
                  id: "stack-whole",
                  label: "Show the whole stack",
                  disabled: stackMode.kind === "whole",
                  run: () => showLayers(0, stack.layers.length - 1),
                },
              ]
            : []),
        ]
      : []),
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
      label: threadPicker ? "Move thread to a branch or worktree" : "Open branch or worktree",
      shortcut: "⌘ ⇧ G",
      disabled: !gitAvailable,
      run: () => openBranchPicker(false),
    },
    ...(workspace
      ? [
          {
            id: "new-workspace",
            managesFocus: true,
            label: "New workspace…",
            disabled: !gitAvailable,
            run: () => openBranchPicker(true),
          },
          {
            id: "switch-workspace",
            managesFocus: true,
            label: "Switch workspace…",
            shortcut: "⌃ ⇥",
            run: workspace.openSwitcher,
          },
          ...(isTab
            ? []
            : [
                {
                  id: "close-workspace",
                  label: "Close workspace",
                  // The home workspace and vaults stay.
                  disabled: workspace.pinned,
                  run: () => workspace.requestClose(workspace.id),
                },
              ]),
        ]
      : []),
    {
      id: "wrap",
      label: wrap ? "Disable line wrapping in diffs" : "Wrap lines in diffs",
      run: () => setWrap((value) => !value),
    },
    {
      id: "show-notes",
      label: showNotes ? "Hide comments" : "Show comments",
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
      id: "elements",
      label: "Open elements page",
      run: () => location.assign("/elements"),
    },
    { id: "reload", label: "Reload Med", run: () => location.reload() },
    {
      id: "restart-server",
      label: "Restart Med server and reload",
      run: requestServerRestart,
    },
    {
      id: "close-file",
      label: fileState.active === "search" ? "Close Search" : "Close current file",
      shortcut: "⌥ W",
      disabled: !activeFile && fileState.active !== "search",
      run: () => fileWorkspace.close(activeFile?.id ?? "search"),
    },
    {
      id: "close-files",
      label: "Close all files in this workspace",
      shortcut: "⌥ ⇧ W",
      disabled: !fileState.tabs.length,
      run: () => fileWorkspace.closeAll(),
    },
    {
      id: "close-others",
      label: "Close other files in this workspace",
      shortcut: "⌥ ⇧ O",
      disabled: !activeFile || fileState.tabs.length < 2,
      run: () => fileWorkspace.closeOthers(),
    },
    {
      id: "changes",
      label: state.savedReview ? "Show Changes" : "Return to Changes",
      run: () => selectTab("changes"),
    },
    ...(reviewAvailable
      ? [
          {
            id: "review",
            label: "Show Review",
            run: () => selectTab("review"),
          },
        ]
      : []),
    ...(hasGuide
      ? [
          {
            id: "guide",
            label: "Open the guide",
            run: () => openGuide({ kind: "overview" }),
          },
          ...(savedGuide
            ? [
                {
                  id: "guide-next",
                  label: "Next part of the guide",
                  shortcut: "j",
                  run: () => stepGuide(1),
                },
              ]
            : []),
        ]
      : []),
    ...(hasNotes
      ? [
          {
            id: "brief",
            label: "Open the notes",
            run: () => fileWorkspace.select("brief"),
          },
          {
            id: "copy-brief",
            label: "Copy the notes",
            run: () => copyNotes(notesText),
          },
        ]
      : []),
    ...(savedBrief ? [{ id: "remove-brief", label: "Remove the brief", run: removeBrief }] : []),
    ...(commitApi
      ? [
          {
            id: "commit",
            label: "Stage and commit changes",
            shortcut: "q",
            run: toggleCommit,
          },
        ]
      : []),
    {
      id: "paste-brief",
      label: state.savedReview
        ? savedBrief
          ? "Replace the brief from the clipboard"
          : "Attach a brief from the clipboard"
        : "Save these changes with a brief from the clipboard",
      shortcut: "⌘ V",
      disabled: !state.savedReview && !canSaveReview,
      run: pasteBrief,
    },
    {
      id: "blame",
      label: blameEnabled ? "Hide Git blame" : "Show Git blame in the gutter",
      shortcut: "⌥ B",
      disabled: !activeFile || fileState.file?.kind !== "text",
      run: toggleBlame,
    },
    {
      id: "line-blame",
      label: lineBlame ? "Hide line blame at the cursor" : "Show line blame at the cursor",
      run: () => setLineBlame((value) => !value),
    },
    {
      id: "content-search",
      managesFocus: true,
      label: "Search workspace file contents",
      shortcut: "⌘ ⇧ F",
      disabled: !browseSource,
      run: openSearch,
    },
    {
      id: "resume-picker",
      managesFocus: true,
      label: "Resume last file search",
      shortcut: "⌥ R",
      disabled: !browseSource,
      run: resumeFilePicker,
    },
    ...(shell ? foundCommands : []),
    ...(shell ? tabCommands : []),
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
            label: rightVisible ? "Hide files sidebar" : "Show files sidebar",
            run: toggleFilesSidebar,
          },
          ...(files.length > 1
            ? [
                {
                  id: "fold-files",
                  label: allCollapsed ? "Expand all files" : "Collapse all files",
                  run: toggleAllFiles,
                },
              ]
            : []),
          ...(found
            ? [
                {
                  id: "agent-session",
                  label: sessionVisible ? "Hide agent session" : "Show agent session",
                  shortcut: "⌘⇧B",
                  run: toggleSession,
                },
              ]
            : []),
          ...(state.savedReview
            ? [
                {
                  id: "agent-session",
                  label: sessionVisible ? "Hide agent session" : "Show agent session",
                  shortcut: "⌘⇧B",
                  run: toggleSession,
                },
                ...(agentPresets ?? [])
                  .filter((agent) => agent.available)
                  .map((agent) => ({
                    id: `new-session-${agent.id}`,
                    label: `New ${agent.name} session`,
                    run: () => void sessionStarter.start(agent.id).catch(() => {}),
                  })),
                // The lead session is open in a terminal or another app, where
                // Med cannot type.
                ...(leadSession && openIn(agentInbox.state, leadSession.id)
                  ? [
                      {
                        id: "continue-in-med",
                        label: "Continue in Med",
                        run: () =>
                          void continueInMed(leadSession.id).catch((error: unknown) =>
                            showToast(
                              error instanceof Error ? error.message : "Med did not continue it.",
                            ),
                          ),
                      },
                    ]
                  : []),
              ]
            : []),
          ...(panes.open.length > 1
            ? [
                {
                  id: "zoom-pane",
                  label: panes.zoom ? "Restore panes" : "Zoom the focused pane",
                  shortcut: "⌘ E",
                  run: () => panes.toggleZoom(panes.zoom ?? panes.focused()),
                },
                {
                  id: "balance-panes",
                  label: "Balance panes",
                  shortcut: "⌘⌃=",
                  disabled: panes.balanced,
                  run: panes.balance,
                },
              ]
            : []),
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
    {
      id: "next-file",
      label: "Go to next changed file",
      shortcut: "",
      run: () => navigateFile(1),
    },
    {
      id: "previous-file",
      label: "Go to previous changed file",
      run: () => navigateFile(-1),
    },
    {
      id: "next-hunk",
      label: "Go to next hunk",
      shortcut: "]",
      run: () => navigateHunk(1),
    },
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
        // The Changes rail's filter, when it shows; otherwise the pane's.
        if (filterRef.current?.offsetParent) return filterRef.current.focus();
        showPane("changed");
        requestAnimationFrame(() => filterRef.current?.focus());
      },
    },
    {
      id: "layout",
      label: `Use ${mode === "split" ? "unified" : "split"} diff layout`,
      disabled: mode === "unified" && !roomy,
      run: () => setMode(mode === "split" ? "unified" : "split"),
    },
    {
      id: "theme",
      managesFocus: true,
      label: "Change theme",
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
                  run: selectWorking,
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
      label: shell
        ? shell.sidebarVisible
          ? "Hide threads"
          : "Show threads"
        : changedVisible
          ? "Hide changed files"
          : "Show changed files",
      shortcut: "⌘ B",
      run: toggleReviewSidebar,
    },
    ...(shell
      ? [
          {
            id: "changed-files",
            label: changedVisible ? "Hide changed files" : "Show changed files",
            run: toggleChanged,
          },
        ]
      : []),
    {
      id: "zen",
      label: zen ? "Leave zen mode" : "Enter zen mode",
      shortcut: "⌥ Z",
      run: toggleZen,
    },
    {
      id: "chrome",
      label: quiet ? "Use full chrome" : "Use quiet chrome",
      run: () => setChromeMode(quiet ? "full" : "quiet"),
    },
    ...(comparisonActionsShown && !zen
      ? [
          {
            id: "compare-base",
            managesFocus: true,
            label: "Compare against a base branch…",
            run: compareAgainst,
          },
          {
            id: "push",
            managesFocus: true,
            label: "Push to remote…",
            disabled: !!pushBlocked,
            run: openPush,
          },
        ]
      : []),
    // The saved review's own actions, for zen mode, which hides its header.
    ...(state.savedReview && replyAgent
      ? [
          {
            id: "send-comments",
            label: `Send comments to ${replyAgent}`,
            run: () => showPane("session"),
          },
        ]
      : []),
    ...(state.savedReview?.commentCount
      ? [
          {
            id: "copy-comments",
            label: "Copy comments",
            run: () =>
              void controller.copyFeedback().then(
                ({ count }) => showToast(`Copied ${count} ${count === 1 ? "comment" : "comments"}`),
                (error: unknown) =>
                  showToast(error instanceof Error ? error.message : "The request failed."),
              ),
          },
        ]
      : []),
    // The question opens under the review's header, which zen hides.
    ...(state.savedReview?.commentCount && !zen
      ? [
          {
            id: "clear-comments",
            managesFocus: true,
            label: "Clear all comments…",
            run: () => clearComments(),
          },
        ]
      : []),
    ...(canFilterSession
      ? [
          {
            id: "session-files",
            label: sessionFilter ? "Show every changed file" : "Show only this session's files",
            run: toggleSessionFilter,
          },
        ]
      : []),
    ...(changesRail
      ? [
          {
            id: "changes-rail",
            label: railShown ? "Hide files and commits" : "Show files and commits",
            run: toggleRail,
          },
        ]
      : []),
    {
      id: "picker-preview",
      label: filePreviewShown ? "Hide file preview in Find file" : "Show file preview in Find file",
      run: () => setFilePreviewShown(!filePreviewShown),
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
    ...(askThread
      ? [
          {
            id: "ask",
            label: "Ask about the selection",
            shortcut: "a",
            disabled: !selection || !canAsk,
            run: startAsk,
          },
        ]
      : []),
  ];
  const guideContext: GuideContextId =
    activeFile && fileState.file?.kind === "text" ? (activeEditing ? "editor" : "file") : "review";
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
    // A thread chooses its first tab when its view is ready (`reviewOpened`).
    // The file opens after that, so that the choice does not replace it.
    if (
      state.savedReview &&
      reviewOpened.current !== state.savedReview.id &&
      state.status !== "error"
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
    fileWorkspace.open(path, undefined, browseSource, "Working files");
  }, [
    state.session,
    state.savedReview,
    state.status,
    state.repositories,
    browseSource,
    fileState.source,
    fileWorkspace,
    controller,
  ]);
  const skipped = useMemo(
    () => streamFiles.filter((file) => !file.metadata || mediaType(file.path)?.kind === "image"),
    [streamFiles],
  );
  const orphaned = notes.filter(
    (note) =>
      !note.parentId &&
      (note.resolution === "orphaned" ||
        note.resolution === "stale" ||
        !files.some((file) => file.path === note.path && file.metadata)),
  );
  const loadedCommit =
    state.review?.comparison.kind === "commit" ? state.review.comparison.commit : "";

  const savedReviewId = state.savedReview?.id;
  const savedImages = state.savedView && savedReviewId ? state.savedTargetId : null;
  const renderMetadataRows = useCallback(
    () => (
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
            {mediaType(file.path)?.kind === "image" && reviewId ? (
              <DiffImages
                path={file.path}
                previousPath={file.info.previousPath}
                status={file.info.status}
                reviewId={reviewId}
                saved={
                  savedReviewId && savedImages
                    ? { id: savedReviewId, target: savedImages }
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
                  onClick={(event) => openWorkingFile(file.path, event.metaKey || event.ctrlKey)}
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
    ),
    [skipped, reviewId, savedReviewId, savedImages, collapsed, openWorkingFile, prefetchFile],
  );
  // Once the reader pauses, the changed files in sight read their full text
  // ahead, and the workers highlight it, so that a first context expansion
  // waits for neither.
  const readAhead = useRef(() => {});
  const reviewReady = state.status === "ready";
  useEffect(() => {
    const host = streamRef.current;
    if (!host || !reviewReady) return;
    const byId = new Map(streamFiles.map((file) => [file.id, file]));
    const highlighted = new Set<string>();
    const highlight = (metadata: FileDiffMetadata, source: SourceResponse) => {
      const key = `${source.reviewId}:${source.path}`;
      // A large file's highlighting would take memory that it may not use.
      if (!workerPool || !metadata.isPartial || highlighted.has(key)) return;
      if (source.old.length + source.new.length > 1024 * 1024) return;
      highlighted.add(key);
      void workerPool
        .primeDiffHighlightCache(
          hydratePartialDiff("clone", metadata, loadedDiffFiles(metadata, source)),
        )
        .catch(() => {});
    };
    let cancel = () => {};
    readAhead.current = () => {
      cancel();
      cancel = whenFree(() => {
        const view = host.getBoundingClientRect();
        const inSight: string[] = [];
        for (const header of host.querySelectorAll<HTMLElement>("[data-stream-file]")) {
          const box = header.getBoundingClientRect();
          if (box.top > view.bottom) break;
          // The file whose header has scrolled away above still shows.
          if (box.top <= view.top) inSight.length = 0;
          inSight.push(header.dataset.streamFile!);
        }
        for (const id of inSight) {
          const metadata = byId.get(id)?.metadata;
          if (
            metadata?.hunks.length &&
            (metadata.type === "change" || metadata.type === "rename-changed")
          )
            void controller
              .preloadSources(metadata.name)
              ?.then((source) => highlight(metadata, source))
              .catch(() => {});
        }
      });
    };
    readAhead.current();
    return () => {
      cancel();
      readAhead.current = () => {};
    };
  }, [controller, reviewReady, streamFiles, workerPool]);
  // The diff stream's renderers stay the same between unrelated renders, so
  // Pierre does not render every file header and comment again.
  const onReviewScroll = useCallback(
    (position: number) => {
      readAhead.current();
      if (
        (fileState.active === "changes" || fileState.active === "guide") &&
        !restoringScroll.current
      ) {
        reviewScroll.current.delete(streamScope);
        reviewScroll.current.set(streamScope, position);
        while (reviewScroll.current.size > 256)
          reviewScroll.current.delete(reviewScroll.current.keys().next().value!);
      }
    },
    [fileState.active, streamScope],
  );
  // What the generated files and the dependency changes say in words, and
  // what the thread's agents did to the generated files (docs/GENERATED.md).
  const transcriptSessions = useMemo(
    () =>
      agentSessions.flatMap((session) =>
        session.agent === "claude" || session.agent === "codex"
          ? [{ agent: session.agent, id: session.id }]
          : [],
      ),
    [agentSessions],
  );
  const provenance = useProvenance(
    sessionFetch,
    groupGenerated ? (state.review?.repo ?? null) : null,
    transcriptSessions,
    state.files,
    generatedFiles,
  );
  const manifestPaths = useMemo(
    () =>
      guideDiff
        ? []
        : state.files
            .filter((file) => /(?:^|\/)package\.json$/.test(file.path) && !file.info.binary)
            .slice(0, 8)
            .map((file) => file.path),
    [guideDiff, state.files],
  );
  const loadManifest = useCallback(
    async (path: string) => {
      // After the diff: a read waits while others load.
      for (let attempt = 0; attempt < 40; attempt++) {
        const read = controller.preloadSources(path);
        if (read) return read;
        await new Promise((done) => setTimeout(done, 250));
      }
      return controller.loadSources(path);
    },
    [controller],
  );
  const manifests = useManifestChanges(loadManifest, state.review?.id ?? null, manifestPaths);
  const directDependencies = useMemo(() => {
    const names = new Set<string>();
    for (const changes of manifests.values())
      if (Array.isArray(changes)) for (const change of changes) names.add(change.name);
    return names;
  }, [manifests]);
  const generatedSummaries = useGeneratedSummaries(
    reviewScope,
    groupGenerated || manifestPaths.length ? state.files : NO_FILES,
    generatedFiles.marks,
    directDependencies,
  );
  const dependencyLookups = useDependencyLookups();
  const lookupPackages = useMemo(() => {
    const packages = new Map<string, { name: string; version: string }>();
    for (const changes of manifests.values())
      if (Array.isArray(changes))
        for (const change of changes)
          for (const version of [change.toVersion, change.fromVersion])
            if (version) packages.set(`${change.name}@${version}`, { name: change.name, version });
    return [...packages.values()];
  }, [manifests]);
  const dependencyInfo = useDependencyInfo(sessionFetch, lookupPackages, dependencyLookups);
  const dependencyCard = useMemo(
    () =>
      manifestPaths.length > 0 && (
        <DependencyCard
          manifests={manifestPaths.map((path) => ({
            id: state.files.find((file) => file.path === path)!.id,
            path,
            state: manifests.get(path) ?? "loading",
          }))}
          lockfiles={state.files.flatMap((file) => {
            const summary = generatedSummaries.get(file.id);
            return summary && generatedFiles.marks.get(file.id)?.kind === "lockfile"
              ? [{ id: file.id, path: file.path, summary }]
              : [];
          })}
          info={dependencyInfo}
          onLookups={setDependencyLookups}
          onReveal={reveal}
        />
      ),
    [
      manifestPaths,
      state.files,
      manifests,
      generatedSummaries,
      generatedFiles,
      dependencyInfo,
      reveal,
    ],
  );
  const renderCustomHeader = useCallback(
    (item: CodeViewItem<Annotation>) => {
      const path = item.type === "diff" ? item.fileDiff.name : item.file.name;
      const info = fileInfoById.get(item.id);
      const slash = path.lastIndexOf("/") + 1;
      const isCollapsed = collapsed.has(item.id);
      const renamedFrom =
        item.type === "diff" && item.fileDiff.prevName && item.fileDiff.prevName !== path
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
      const isViewed = viewedIds.has(item.id);
      const generated = generatedFiles.marks.get(item.id);
      const generatedFrom = fileInfoById.get(generatedFiles.sources.get(item.id) ?? "")?.path;
      const written = generated ? provenance.get(path) : undefined;
      return (
        <div data-stream-file={item.id} {...stylex.props(styles.diffHeader)}>
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
          <span {...stylex.props(styles.headerChevron, isCollapsed && styles.collapsed)}>
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
            onClick={(event) => openWorkingFile(path, event.metaKey || event.ctrlKey)}
            title={`Open full file · ${path}`}
          >
            <span {...stylex.props(styles.fileDirectory)}>{path.slice(0, slash)}</span>
            <span {...stylex.props(styles.fileName)}>{path.slice(slash)}</span>
          </button>
          {status && <span {...stylex.props(styles.statusBadge, status.tone)}>{status.label}</span>}
          {generated && (
            <span
              data-generated-kind={generated.kind}
              title={[
                generatedFrom
                  ? `Follows from ${generatedFrom}`
                  : generated.kind === "attributes"
                    ? "Git attributes mark this file generated"
                    : generated.kind === "declared"
                      ? "The hand-off marks this file generated"
                      : "A tool writes this file",
                written?.command && `Written by ${written.command}`,
              ]
                .filter(Boolean)
                .join(" · ")}
              {...stylex.props(styles.statusBadge, styles.statusGenerated)}
            >
              {GENERATED_LABELS[generated.kind]}
              {generatedFrom &&
                ` · from ${generatedFrom.slice(generatedFrom.lastIndexOf("/") + 1)}`}
            </span>
          )}
          {written?.edited && (
            <span
              title="An agent edited this generated file with an edit tool"
              {...stylex.props(styles.statusBadge, styles.statusEdited)}
            >
              Edited by hand
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
          {canMarkViewed && (
            <button
              type="button"
              role="checkbox"
              aria-checked={isViewed}
              aria-label={`Viewed ${path}`}
              title={isViewed ? "Viewed · folds the file (v)" : "Mark as viewed (v)"}
              onClick={() => setFilesViewed([item.id], !isViewed)}
              {...stylex.props(styles.viewedToggle, isViewed && styles.viewedOn)}
            >
              <span {...stylex.props(styles.viewedBox, isViewed && styles.viewedBoxOn)}>
                {isViewed && <Icon name="check" size={10} />}
              </span>
              Viewed
            </button>
          )}
        </div>
      );
    },
    [
      fileInfoById,
      collapsed,
      prefetchFile,
      openWorkingFile,
      viewedIds,
      canMarkViewed,
      setFilesViewed,
      generatedFiles,
      provenance,
    ],
  );
  // A link to a file in a comment opens the file at its line.
  const openCommentLink = useCallback(
    (href: string) => {
      const target = parseBriefHref(href);
      if (target) fileWorkspace.open(target.path, target.line);
    },
    [fileWorkspace],
  );
  const renderAnnotation = useCallback(
    (annotation: { metadata?: Annotation }) =>
      annotation.metadata?.draft ? (
        <NoteComposer
          key={JSON.stringify(annotation.metadata.draft)}
          target={annotation.metadata.draft}
          initialText={
            pendingDraft?.target === annotation.metadata.draft ? pendingDraft.note.text : undefined
          }
          initialError={
            pendingDraft?.target === annotation.metadata.draft ? pendingDraft.error : undefined
          }
          onSave={async (note) => {
            const submission = {
              target: annotation.metadata!.draft!,
              reviewId,
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
                      error: error instanceof Error ? error.message : "Could not save comment",
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
            setPendingDraft((current) => (current?.target === target ? null : current));
          }}
        />
      ) : annotation.metadata?.thread ? (
        <PullRequestThreadCard thread={annotation.metadata.thread} />
      ) : annotation.metadata?.finding ? (
        <CodexFindingCard
          finding={annotation.metadata.finding.finding}
          run={annotation.metadata.finding.run}
        />
      ) : annotation.metadata?.guide ? (
        <GuideNoteCard
          note={annotation.metadata.guide}
          author={guideAgent.name}
          mark={guideAgent.mark}
          createdAt={guideAgent.at}
          onReply={() => replyToGuideNote(annotation.metadata!.guide!)}
        />
      ) : annotation.metadata?.note ? (
        <NoteCard
          note={annotation.metadata.note}
          replies={notes.filter((note) => note.parentId === annotation.metadata?.note?.id)}
          onMutate={(mutation) => controller.mutateNote(mutation)}
          onOpenLink={openCommentLink}
        />
      ) : null,
    [pendingDraft, reviewId, notes, controller, guideAgent, replyToGuideNote, openCommentLink],
  );
  // The Guide's segment or commit heads the stream and ends it with the next part.
  const guideStray = useMemo(() => {
    if (!guideSection || !state.savedView) return [];
    // Notes on whole files, on unchanged lines, or on files outside the segment.
    const byId = new Map(state.files.map((file) => [file.id, file]));
    return guideSection.notes.filter(
      (note) =>
        !onLines(note) ||
        !guideSection.fileIds.includes(note.fileId) ||
        !shownLine(byId.get(note.fileId)?.metadata ?? null, note),
    );
  }, [guideSection, state.savedView, state.files]);
  const loadGuideCommit = useCallback(
    (id: string, signal: AbortSignal) => controller.loadCommitDetails(id, signal),
    [controller],
  );
  // Links in a summary: a file of the review opens in its segment, at its line.
  const openGuideLink = useCallback(
    (href: string) => {
      const target = parseBriefHref(href);
      if (!target) return;
      const file = matchReviewFile(target, shownGuideFiles, guideFiles.root);
      const section = file
        ? guideSection?.fileIds.includes(file.id)
          ? guideSection
          : guideSections.find((entry) => entry.fileIds.includes(file.id))
        : undefined;
      if (!file || !section) {
        fileWorkspace.open(target.path, target.line);
        return;
      }
      if (section !== guideSection || !guideDiff) openGuide({ kind: "segment", key: section.key });
      requestAnimationFrame(() =>
        target.line
          ? revealLine(
              file.id,
              target.line,
              target.endLine ?? target.line,
              file.info.status.startsWith("D") ? "deletions" : "additions",
            )
          : reveal(file.id),
      );
    },
    [
      shownGuideFiles,
      guideFiles.root,
      guideSection,
      guideSections,
      guideDiff,
      fileWorkspace,
      openGuide,
      revealLine,
      reveal,
    ],
  );
  const nextGuidePart = guideSection
    ? guideSections[guideSections.indexOf(guideSection) + 1]
    : undefined;
  const nextGuideCommit = commitIndex >= 0 ? guideCommits[commitIndex + 1] : undefined;
  const nextGuideLabel = nextGuidePart
    ? `${nextGuidePart.automatic ? "" : `${String(nextGuidePart.number).padStart(2, "0")} · `}${nextGuidePart.title}`
    : nextGuideCommit
      ? `${nextGuideCommit.id.slice(0, 7)} · ${nextGuideCommit.subject}`
      : undefined;
  const streamViewed =
    streamFiles.length > 0 && streamFiles.every((file) => viewedIds.has(file.id));
  const renderCodeViewHeader = useCallback(() => {
    if (!guideDiff) return dependencyCard || null;
    if (guideSection)
      return (
        <SegmentHeader
          section={guideSection}
          count={guideSections.length}
          viewed={guideSection.fileIds.filter((id) => viewedIds.has(id)).length}
          agent={guideAgent}
          stray={guideStray}
          onMarkAll={(value) => setFilesViewed(guideSection.fileIds, value)}
          onReply={replyToGuideNote}
          onOpenLink={openGuideLink}
        />
      );
    if (guideCommit)
      return (
        <CommitHeader
          commit={guideCommit}
          number={commitIndex + 1}
          count={guideCommits.length}
          totals={
            state.review
              ? {
                  additions: state.files.reduce((sum, file) => sum + file.info.additions, 0),
                  deletions: state.files.reduce((sum, file) => sum + file.info.deletions, 0),
                  files: state.files.length,
                }
              : undefined
          }
          loadDetails={loadGuideCommit}
        />
      );
    return null;
  }, [
    guideDiff,
    guideSection,
    guideSections.length,
    viewedIds,
    guideAgent,
    guideStray,
    setFilesViewed,
    replyToGuideNote,
    openGuideLink,
    guideCommit,
    commitIndex,
    guideCommits,
    state.review,
    state.files,
    loadGuideCommit,
    dependencyCard,
  ]);
  const generatedRows = useMemo<GeneratedRow[]>(
    () =>
      groupGenerated
        ? fileGroups.generated.map((file) => {
            const mark = generatedFiles.marks.get(file.id)!;
            const sourceId = generatedFiles.sources.get(file.id);
            const source = sourceId ? fileInfoById.get(sourceId) : undefined;
            const summary = generatedSummaries.get(file.id);
            const done = provenance.get(file.path);
            const warning = done?.edited
              ? "Edited by hand"
              : generatedFiles.lonelyLockfiles.has(file.id)
                ? "No manifest changed"
                : undefined;
            return {
              id: file.id,
              path: file.path,
              kind: mark.kind,
              additions: file.info.additions,
              deletions: file.info.deletions,
              viewed: viewedIds.has(file.id),
              ...(summary && { summary }),
              ...(done?.command && { command: done.command }),
              ...(source && sourceId ? { source: { id: sourceId, path: source.path } } : {}),
              ...(warning && { warning }),
            };
          })
        : [],
    [
      groupGenerated,
      fileGroups,
      generatedFiles,
      fileInfoById,
      viewedIds,
      generatedSummaries,
      provenance,
    ],
  );
  const toggleGenerated = useCallback(() => {
    if (generatedOpenRef.current) {
      generatedOpenRef.current = false;
      setGeneratedOpenScope(null);
    } else openGenerated();
  }, [openGenerated]);
  const generatedGroup = useMemo(
    () =>
      generatedRows.length > 0 && (
        <GeneratedGroup
          rows={generatedRows}
          open={generatedOpen}
          onToggle={toggleGenerated}
          onReveal={reveal}
          onViewed={canMarkViewed ? setFilesViewed : undefined}
        />
      ),
    [generatedRows, generatedOpen, toggleGenerated, reveal, canMarkViewed, setFilesViewed],
  );
  const renderCodeViewFooter = useCallback(
    () =>
      guideDiff ? (
        <>
          {skipped.length > 0 && renderMetadataRows()}
          <GuideFooter
            next={nextGuideLabel}
            allViewed={streamViewed}
            onNext={(mark) => {
              if (mark)
                setFilesViewed(
                  streamFiles.map((file) => file.id),
                  true,
                );
              stepGuide(1);
            }}
            onOverview={() => openGuide({ kind: "overview" })}
          />
        </>
      ) : (
        <>
          {skipped.length > 0 && renderMetadataRows()}
          {generatedGroup}
          {!skipped.length && (
            <div {...stylex.props(styles.streamEnd)}>
              <span {...stylex.props(styles.streamRule)} />
              End of review · {files.length} {files.length === 1 ? "file" : "files"}
              <span {...stylex.props(styles.streamRule)} />
            </div>
          )}
        </>
      ),
    [
      guideDiff,
      skipped,
      renderMetadataRows,
      generatedGroup,
      files.length,
      nextGuideLabel,
      streamViewed,
      setFilesViewed,
      streamFiles,
      stepGuide,
      openGuide,
    ],
  );

  // Where am I, and the way to another branch. It heads a branch's changes;
  // a saved review's header names its own branch.
  const identity = (
    <div {...stylex.props(styles.identity)}>
      {!shell && (
        <ToolButton
          label={changedVisible ? "Hide changed files" : "Show changed files"}
          shortcut="⌘ B"
          icon="panelLeft"
          aria-label="Toggle sidebar"
          aria-pressed={changedVisible}
          onClick={toggleReviewSidebar}
        />
      )}
      {gitAvailable && <BranchSwitch model={branches} onOpen={() => openBranchPicker(false)} />}
    </div>
  );
  const viewControls = (
    <span {...stylex.props(styles.viewControls)}>
      <ToolButton
        label="Commands"
        shortcut="⌘ K"
        icon="search"
        aria-label="Open command palette"
        onClick={() => setCommandsOpen(true)}
      />
      {!shell && (
        <ToolButton
          ref={zenToggle}
          label="Zen mode"
          shortcut="⌥ Z"
          icon="focus"
          aria-label="Enter zen mode"
          onClick={toggleZen}
        />
      )}
      {/* The thread pane closes from its own header. */}
      {(state.savedReview || found) && !sessionVisible && (
        <ToolButton
          label={sessionVisible ? "Hide agent session" : "Show agent session"}
          shortcut="⌘ ⇧ B"
          icon={found?.agent ?? leadIcon}
          aria-label="Toggle agent session"
          aria-pressed={sessionVisible}
          active={sessionVisible}
          onClick={toggleSession}
        />
      )}
      {browseSource && (
        <ToolButton
          label={rightVisible ? "Hide files" : "Show files"}
          icon="folder"
          aria-label="Toggle files sidebar"
          aria-pressed={rightVisible}
          onClick={toggleFilesSidebar}
        />
      )}
    </span>
  );
  // Quiet chrome leaves the branch to the title band, which names the checkout.
  const leading = !state.savedReview && !(quiet && shell) && (
    <>
      {identity}
      <span {...stylex.props(styles.headerDivider)} />
    </>
  );
  // Beside the thread, the review pane's own actions join the header's menu.
  const moreActions: MenuAction[] = [
    {
      label: "Commands",
      shortcut: "Mod+K",
      onClick: () => setCommandsOpen(true),
    },
    ...(!shell ? [{ label: "Zen mode", shortcut: "Alt+Z", onClick: toggleZen }] : []),
    ...(browseSource
      ? [
          {
            label: "Files",
            checked: rightVisible,
            choice: true,
            onClick: toggleFilesSidebar,
          },
        ]
      : []),
  ];
  // The diff's controls: in the toolbar above it, or in the review's one row
  // with quiet chrome, while the diff shows.
  const streamChrome = streamShown && !zen;
  // After the choices: in a shared checkout, the session's own files; with
  // quiet chrome, in Changes, other ways to choose what the diff compares.
  const compareActions = [
    ...(canFilterSession
      ? [
          {
            label: "Only this session's files",
            checked: !!sessionFilter,
            onSelect: toggleSessionFilter,
          },
        ]
      : []),
    // The checkout that the thread shows, and the base of its changes: each
    // shows its value and opens its picker.
    ...(threadPicker && !reviewShown
      ? [
          {
            label: "Thread checkout…",
            hint: state.activeBranch ?? state.session?.repository.path.split("/").at(-1),
            onSelect: () => openBranchPicker(false),
          },
        ]
      : []),
    ...(quiet && !reviewShown && comparisonActionsShown
      ? [
          workingAvailable
            ? { label: "Base branch…", hint: branchBase, onSelect: openCompare }
            : { label: "Compare against a branch…", onSelect: openCompare },
        ]
      : []),
    ...(quiet && !reviewShown && gitAvailable
      ? [{ label: "Compare two revisions…", onSelect: () => setRangeOpen(true) }]
      : []),
  ];
  // In a narrow row the comparison takes its short label, then goes into ⋯.
  const comparisonFit = useRowFit(comparisonSlot, quiet && streamChrome ? comparisonText : null);
  // A Review of one version names it, with nothing to choose. (Review has no
  // compare actions.)
  const stackRail = stack && reviewShown && !zen && (
    <StackRail
      stack={stack}
      current={Math.max(0, layerIndex)}
      mode={stackMode}
      progress={layerStates}
      next={nextLayer}
      onLayer={showLayer}
      onRange={showLayers}
      onNext={showNextUnreviewed}
    />
  );
  // Where the rail hides, the layers are a menu in the review's row.
  const layerMenu = stack &&
    reviewShown &&
    !zen &&
    !(railShown || (changedVisible && gitAvailable) || (guideTab && roomy)) && (
      <LayerMenu
        stack={stack}
        current={Math.max(0, layerIndex)}
        mode={stackMode}
        onLayer={showLayer}
        onRange={showLayers}
      />
    );
  const comparisonSelect =
    reviewShown && comparisonChoices.length <= 1 ? (
      <ChoiceLabel
        title={comparisonChoices[0]?.description ?? "Review version"}
        text={comparisonFit === "short" ? comparisonText.short : comparisonText.long}
      />
    ) : (
      <ChoiceSelect
        label={reviewShown ? "Review version" : "Comparison"}
        value={comparisonValue}
        choices={comparisonChoices}
        onChange={chooseComparison}
        actions={compareActions}
        {...(quiet && {
          // One control says what the diff compares, and changes it.
          triggerRef: comparisonTrigger,
          trigger: styles.rowComparisonTrigger,
          display: comparisonFit === "short" ? comparisonText.short : comparisonText.long,
        })}
      />
    );
  const comparisonActionsElement = comparisonActionsShown && actionRepo && (
    <ComparisonActions
      key={`${actionRepo}:${actionHead}:${actionBranch}`}
      ref={comparisonActions}
      triggers={!quiet}
      anchor={compareAnchor}
      targets={gitTargets.targets}
      targetsError={gitTargets.error}
      repo={actionRepo}
      head={actionHead}
      sourceBranch={actionBranch}
      comparison={state.comparison}
      {...(workingAvailable &&
        !reviewShown && {
          onBase: (base: string) => {
            fileWorkspace.select("changes");
            controller
              .setChangesBase({
                kind: "working",
                base,
                ...(sessionFilter && { session: sessionFilter }),
              })
              .catch((error: unknown) =>
                showToast(
                  `The thread did not keep the base. ${error instanceof Error ? error.message : String(error)}`,
                ),
              );
          },
        })}
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
  );
  const totals = state.review && (
    <span {...stylex.props(styles.toolbarTotals)}>
      <ChangeTotals
        files={state.review.files}
        range={`${shortRevision(state.review.base)} → ${shortRevision(state.review.head)}`}
      />
    </span>
  );
  const notesToggle = (
    <button
      {...stylex.props(ui.button, ui.pressable, styles.notesButton, showNotes && ui.active)}
      {...tooltip(showNotes ? "Hide comments" : "Show comments")}
      aria-label="Toggle notes"
      aria-pressed={showNotes}
      onClick={() => setShowNotes(!showNotes)}
    >
      <Icon name="note" size={15} />
      {notes.length > 0 && <span {...stylex.props(styles.notesCount)}>{notes.length}</span>}
    </button>
  );
  const viewSections: MenuAction[][] = [
    selectedFile && browseSource
      ? [
          {
            label: browseSource.kind === "worktree" ? "Open working file" : "Open snapshot file",
            letter: "o",
            onClick: () => openWorkingFile(selectedFile.path),
          },
          {
            label: "Show files sidebar",
            onClick: showFiles,
          },
        ]
      : [],
    [
      {
        label: "Find in diffs",
        shortcut: "⌘ F",
        letter: "f",
        onClick: openFind,
      },
      ...(gitAvailable
        ? [
            {
              label: "Compare revisions…",
              letter: "c",
              onClick: () => setRangeOpen(!rangeOpen),
            },
          ]
        : []),
    ],
    [
      {
        label: "Show comments",
        checked: showNotes,
        onClick: () => setShowNotes(!showNotes),
      },
      {
        label: "Wrap long lines",
        checked: wrap,
        letter: "w",
        onClick: () => setWrap(!wrap),
      },
    ],
    [
      {
        label: "Zen mode",
        shortcut: "⌥ Z",
        letter: "z",
        onClick: toggleZen,
      },
      {
        label: "Refresh review",
        letter: "r",
        disabled: state.status === "loading",
        onClick: () => void controller.refresh(),
      },
    ],
  ];
  const quietSections = useQuietMenu({
    diff: streamChrome
      ? {
          find: openFind,
          layout: { mode, canSplit: roomy, set: setMode },
          comments: { on: showNotes, toggle: () => setShowNotes(!showNotes) },
          wrap: { on: wrap, toggle: () => setWrap(!wrap) },
          rail: changesRail ? { on: railShown, toggle: toggleRail } : undefined,
          collapse:
            files.length > 1 ? { collapsed: allCollapsed, toggle: toggleAllFiles } : undefined,
          push: comparisonActionsShown ? { blocked: pushBlocked, open: openPush } : undefined,
          refresh: { disabled: state.status === "loading", run: () => void controller.refresh() },
          comparison:
            quiet && comparisonFit === "menu"
              ? {
                  label: comparisonText.long,
                  value: comparisonValue,
                  choices: comparisonChoices,
                  select: chooseComparison,
                  actions: compareActions,
                }
              : undefined,
        }
      : undefined,
    workingFile:
      streamChrome && selectedFile && browseSource
        ? {
            label: browseSource.kind === "worktree" ? "Open working file" : "Open snapshot file",
            open: () => openWorkingFile(selectedFile.path),
          }
        : undefined,
    session: state.savedReview || found ? { on: sessionVisible, toggle: toggleSession } : undefined,
    files: browseSource ? { on: rightVisible, toggle: toggleFilesSidebar } : undefined,
    openBranch:
      !state.savedReview && gitAvailable && shell ? () => openBranchPicker(false) : undefined,
    zen: toggleZen,
    commands: () => setCommandsOpen(true),
    shortcuts: () => setHelpOpen(true),
  });
  // The card's own row, in full chrome without a thread beside it. It names
  // a pull request; elsewhere the pull request is the window's title.
  const savedCardHeader = !!state.savedReview && !zen && !sessionVisible && !quiet;
  const savedHeader = (compact: boolean) =>
    state.savedReview && (
      <SavedReviewHeader
        ref={savedActions}
        controller={controller}
        state={state}
        compact={compact}
        quiet={quiet}
        more={compact ? (quiet ? quietSections : [moreActions]) : undefined}
        notesPickIteration={hasNotes}
        pullRequest={pullRequest}
        threadPlacement={pullRequestThreads.placement}
        codexReviews={codexReviews}
        findingPlacement={codexFindings.placement}
        sendTo={
          replyAgent
            ? {
                name: replyAgent,
                icon: leadIcon,
                drafts: agentInbox.state?.drafts.length ?? 0,
                open: () => showPane("session"),
              }
            : undefined
        }
        pickVersion={reviewShown && !streamChrome}
        onTarget={(id) => {
          pendingSavedChanges.current = id;
          pendingIteration.current = null;
          fileWorkspace.select("changes");
          void controller.selectSavedTarget(id);
        }}
      />
    );
  // The tabs stay while a workspace loads, so the branch switch in them does
  // not mount again; only a review without Git has a plain header.
  const plainHeader = state.session?.repository.git === false && !hasNotes && !hasGuide;
  // Quiet chrome's row, after the tabs: what the diff compares and the few
  // controls that stay in view, then the ⋯ menu (in a saved review's header).
  const quietTrailing = quiet && (
    <>
      {streamChrome && (
        <span
          ref={comparisonSlot}
          {...stylex.props(styles.rowComparison, comparisonFit === "menu" && styles.hiddenSurface)}
        >
          {comparisonFit !== "menu" && comparisonSelect}
        </span>
      )}
      {streamChrome && layerMenu}
      {/* The Commit tab's Stage all; its header would repeat the band's branch. */}
      {fileState.active === "commit" && commitApi && (
        <span ref={setStageSlot} {...stylex.props(styles.rowStage)} />
      )}
      {streamChrome && roomy && totals}
      {comparisonActionsElement}
      {streamChrome && notes.length > 0 && notesToggle}
      {state.savedReview ? (
        savedHeader(true)
      ) : (
        <ActionMenu
          label="More actions"
          trigger={[ui.button, ui.iconButton]}
          sections={quietSections}
        >
          <Icon name="more" size={15} />
        </ActionMenu>
      )}
    </>
  );
  const mainHeader = (controls: ReactNode) =>
    !plainHeader ? (
      <FileViewTabs
        panelId={`${idPrefix}file-view-panel`}
        pathActions={pathActions}
        leading={leading}
        keepTabs={quiet}
        trailing={
          quiet ? (
            <>
              {quietTrailing}
              {controls}
            </>
          ) : (
            <>
              {sessionVisible && !zen && savedHeader(true)}
              {!(sessionVisible && !zen && state.savedReview) && viewControls}
              {controls}
            </>
          )
        }
        showBrief={hasNotes}
        showReview={reviewAvailable}
        showCommit={!!commitApi}
        search={fileState.searchLabel}
        tabs={fileState.tabs.map((tab) => ({
          ...tab,
          ...(tab.source.kind === "vault"
            ? { sourcePath: vaultRoots.get(tab.source.id), sourceName: tab.sourceLabel }
            : {
                sourcePath: tab.source.repo,
                sourceName: checkoutNameFor(state.repositories, tab.source.repo),
              }),
          dirty: !!editorDrafts.get(JSON.stringify([tab.source, tab.path]))?.dirty,
        }))}
        active={shownTab}
        // The tabs keep their places as you switch: a thread with a Review
        // has no count, which Changes could not keep while Review shows.
        changesCount={state.review && !reviewAvailable ? state.files.length : undefined}
        onSelect={selectTab}
        onClose={fileWorkspace.close}
        onCloseOthers={fileWorkspace.closeOthers}
        onCloseAll={fileWorkspace.closeAll}
      />
    ) : (
      <header {...paneHandle} {...stylex.props(styles.mainHeader)}>
        {leading}
        <span {...stylex.props(ui.grow)} />
        {quiet ? quietTrailing : viewControls}
        {controls}
      </header>
    );
  // The tab is the card's first row, so the notice follows it.
  const linkError = fileLinkError && (
    <div role="alert" {...stylex.props(styles.notice, styles.error)}>
      {fileLinkError}
    </div>
  );
  // Where the thread works: its repository, and its branch or worktree. The
  // window's title band names it; without the shell, the session header does.
  const threadTarget = state.savedReview && threadCheckout(state.savedReview);
  const threadRepository =
    threadTarget &&
    state.repositories.find(
      (item) =>
        item.path === threadTarget.repo ||
        item.worktrees.some((tree) => tree.path === threadTarget.repo),
    );
  const threadPlace = threadTarget
    ? [threadRepository?.name ?? threadTarget.repo.split("/").at(-1), threadTarget.branch]
        .filter(Boolean)
        .join(" · ")
    : undefined;
  const sidePanes: PaneSpec[] = [
    ...(state.savedReview
      ? [
          {
            id: "session" as const,
            label: "Session",
            ariaLabel: "Agent session",
            icon: leadIcon,
            preload: sessionReady && hasSessions,
            render: (controls: ReactNode) => (
              <Suspense
                fallback={
                  // While its code loads, the session still leads the workspace.
                  sessionVisible && hasSessions ? (
                    <span hidden data-lead="" data-pending="" />
                  ) : null
                }
              >
                {agentSessions.length === 0 ? (
                  <SessionStart
                    starter={sessionStarter}
                    controls={controls}
                    repo={state.review?.repo}
                    title={
                      threadName ?? state.savedReview!.pullRequestTitle ?? state.savedReview!.title
                    }
                    detail={shell ? undefined : threadPlace}
                  />
                ) : (
                  <SessionPanel
                    key={state.savedReview!.id}
                    reviewId={state.savedReview!.id}
                    title={
                      threadName ?? state.savedReview!.pullRequestTitle ?? state.savedReview!.title
                    }
                    detail={shell ? undefined : threadPlace}
                    sessions={agentSessions}
                    root={state.review?.repo}
                    fetcher={sessionFetch}
                    inbox={agentInbox}
                    attachments={agentAttachments}
                    onRemoveAttachment={(id) =>
                      setAgentAttachments((list) => list.filter((entry) => entry.id !== id))
                    }
                    onOpenPath={openFromPane}
                    fileRefs={fileRefs}
                    onClose={() => closePane("session")}
                    pins={sessionPins}
                    controls={controls}
                    starter={sessionStarter}
                    lead={sessionVisible}
                    mentions={mentionSources}
                    onMentionsWanted={wantMentions}
                    openAgent={openAgent}
                    recap={recapProps}
                    onContinue={continueInMed}
                  />
                )}
              </Suspense>
            ),
          },
        ]
      : []),
    ...(found
      ? [
          {
            id: "session" as const,
            label: "Session",
            ariaLabel: "Agent session",
            icon: found.agent,
            preload: true,
            render: (controls: ReactNode) => (
              <Suspense fallback={null}>
                <FoundSessionPane
                  key={found.id}
                  session={found}
                  root={state.review?.repo}
                  fetcher={sessionFetch}
                  controls={controls}
                  onOpenPath={openFromPane}
                  fileRefs={fileRefs}
                  onClose={() => closePane("session")}
                  openAgent={openAgent}
                />
              </Suspense>
            ),
          },
        ]
      : []),
    ...(browseSource
      ? [
          {
            id: "files" as const,
            label: "Files",
            ariaLabel: "Workspace files",
            icon: "folder" as const,
            // The tree prepares in the background, as the sidebar did.
            preload: true,
            render: (controls: ReactNode) => (
              <RepositoryFiles
                key={JSON.stringify([sourceKey(browseSource), repositoryFiles.ignored])}
                {...repositoryFiles}
                sourceLabel={sourceLabel}
                repo={browseSource?.repo ?? null}
                pathActions={pathActions}
                selectedPath={activeFile?.path ?? selectedFile?.path ?? null}
                onPrefetch={prefetchFile}
                onOpen={openWorkingFile}
                onIgnoredChange={repositoryFiles.setIgnored}
                onRefresh={repositoryFiles.refresh}
                onClose={hideFilesSidebar}
                controls={controls}
              />
            ),
          },
        ]
      : []),
    // A question about lines, at the review's right, until Keep or Close.
    ...(questionView
      ? [
          {
            id: "question" as const,
            label: "Question",
            ariaLabel: "Question",
            icon: "ask" as const,
            onClose: closeQuestion,
            render: (controls: ReactNode) => (
              <Suspense fallback={null}>
                <QuestionPane
                  key={questionView.key}
                  view={questionView}
                  controls={controls}
                  onSend={(text) => void question.send(text)}
                  onStop={() => void question.stop()}
                  onKeep={keepQuestion}
                  root={state.review?.repo}
                  onOpenPath={openFromPane}
                  fileRefs={fileRefs}
                />
              </Suspense>
            ),
          },
        ]
      : []),
  ];
  const branchPicker = gitAvailable && (
    <BranchPicker
      repositories={state.repositories}
      entries={branches.entries}
      open={branchPickerOpen}
      onOpenChange={setBranchPickerOpen}
      onSelect={(entry, newWorkspace) =>
        !workspace
          ? branches.open(entry)
          : threadPicker && !newWorkspace && !branchPickerNew
            ? moveThreadTo(entry)
            : openBranch(entry, newWorkspace || branchPickerNew)
      }
      workspaces={
        workspace ? (branchPickerNew ? "new" : threadPicker ? "thread" : "here") : undefined
      }
      onPullRequest={workspace?.openPull}
      agents={agentPresets?.filter((agent) => agent.available)}
      onAddRepository={controller.addRepository}
      onRemoveRepository={async (id) => {
        await controller.removeRepository(id);
        workspace?.closeRepository(id, workspace.id);
      }}
      onRefresh={controller.refreshRepositories}
    />
  );
  if (!state.session && !state.repositories.length && state.status === "idle" && !state.error)
    return (
      <div {...stylex.props(styles.app)}>
        {branchPicker}
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
            onClick={() => openBranchPicker(false)}
          >
            Choose repositories
          </button>
        </div>
      </div>
    );

  const workspacePanes: PaneSpec[] = [
    {
      id: "review",
      label: state.savedReview ? "Review" : "Changes",
      ariaLabel: "Review",
      icon: "diff",
      fixed: true,
      render: (controls: ReactNode) => (
        <main ref={setMainElement} {...stylex.props(styles.main)} aria-label="Continuous review">
          {/* The review's own row heads the card; beside a thread, its actions
        join the tab row. */}
          {savedCardHeader && savedHeader(false)}
          {linkError}
          {zen ? <ZenExit onExit={toggleZen} /> : mainHeader(controls)}
          {quiet && state.status === "loading" && (
            <span role="presentation" {...stylex.props(styles.loadingTrack, styles.rowLoading)}>
              <span {...stylex.props(styles.loadingBar)} />
            </span>
          )}
          {state.savedView &&
            !zen &&
            !agentWorking &&
            state.savedDrift &&
            state.savedDrift !== dismissedDrift && (
              <div role="status" {...stylex.props(styles.notice, styles.drift)}>
                <span {...stylex.props(styles.driftText)}>
                  The checkout changed after this version of the Review.
                </span>
                <span {...stylex.props(ui.row)}>
                  <button
                    type="button"
                    disabled={refreshing}
                    onClick={() => startNotes(true)}
                    {...stylex.props(ui.button, ui.pressable, styles.driftAction)}
                  >
                    {refreshing ? "Refreshing…" : "Refresh review"}
                  </button>
                  <button
                    type="button"
                    onClick={() => selectTab("changes")}
                    {...stylex.props(ui.button, ui.pressable, styles.driftAction)}
                  >
                    Show Changes
                  </button>
                  <ToolButton
                    label="Dismiss"
                    icon="close"
                    onClick={() => setDismissedDrift(state.savedDrift)}
                  />
                </span>
              </div>
            )}
          <div
            id={`${idPrefix}file-view-panel`}
            role="tabpanel"
            aria-label={
              activeFile
                ? `File ${activeFile.path}`
                : fileState.active === "brief"
                  ? "Notes"
                  : fileState.active === "guide"
                    ? "Guide"
                    : fileState.active === "commit"
                      ? "Commit"
                      : fileState.active === "search"
                        ? "Search"
                        : reviewShown
                          ? "Review"
                          : "Changes"
            }
            {...stylex.props(styles.reviewSurface)}
          >
            <div
              {...stylex.props(
                styles.reviewSurface,
                !streamShown && !guideTab && styles.hiddenSurface,
              )}
              aria-hidden={!streamShown && !guideTab}
            >
              <div {...stylex.props(styles.guideRow)}>
                {guideTab && !zen && (
                  <GuideRail
                    sections={guideSections}
                    commits={guideCommits}
                    moreCommits={guideTarget?.moreCommits}
                    scope={guideScope}
                    filesById={guideFilesById}
                    viewed={guideViewedIds}
                    total={shownGuideFiles.length}
                    done={guideViewedIds.size}
                    onScope={openGuide}
                    onFile={(key, id) => {
                      if (guideDiff && guideSection?.key === key) reveal(id);
                      else {
                        // The chosen file, not the saved scroll, places the stream.
                        explicitReveal.current = true;
                        openGuide({ kind: "segment", key }, id);
                      }
                    }}
                    onToggleViewed={setFilesViewed}
                    top={stackRail}
                  />
                )}
                {railShown && (
                  <ChangesRail
                    top={stackRail}
                    repo={state.session?.repository.path ?? null}
                    pathActions={pathActions}
                    files={files}
                    total={state.files.length}
                    selected={state.selectedFileId}
                    filter={state.filter}
                    onFilter={controller.setFilter}
                    onSelect={reveal}
                    onPrefetch={prefetchFile}
                    onOpen={browseSource ? openChangedFile : undefined}
                    filterRef={filterRef}
                    {...rangeCommits}
                  />
                )}
                {guideOverview && (
                  <GuideOverview
                    title={
                      threadName ??
                      state.savedReview?.pullRequestTitle ??
                      state.savedReview?.title ??
                      "Review"
                    }
                    meta={guideMeta}
                    summary={resolvedGuide?.summary}
                    from={
                      guideSource &&
                      shownIteration !== undefined &&
                      guideSource.number !== shownIteration
                        ? guideSource.number
                        : undefined
                    }
                    agent={leadSession ? { name: guideAgent.name, mark: guideAgent.mark } : null}
                    sections={guideSections}
                    commits={guideCommits}
                    moreCommits={guideTarget?.moreCommits}
                    viewed={guideViewedIds}
                    total={shownGuideFiles.length}
                    done={guideViewedIds.size}
                    onScope={openGuide}
                    onWhole={showReviewDiff}
                    onOpenLink={openGuideLink}
                  />
                )}
                <div {...stylex.props(styles.reviewSurface, guideOverview && styles.hiddenSurface)}>
                  {/* Quiet chrome puts the toolbar's controls in the review's row and ⋯. */}
                  {!quiet && (
                    <div
                      {...stylex.props(styles.toolbar, zen && styles.hiddenSurface)}
                      hidden={zen}
                    >
                      {changesRail && (
                        <ToolButton
                          label={railShown ? "Hide files and commits" : "Show files and commits"}
                          icon="panelLeft"
                          aria-pressed={railShown}
                          active={railShown}
                          onClick={toggleRail}
                        />
                      )}
                      {layerMenu}
                      {comparisonSelect}
                      {comparisonActionsElement}
                      {totals}
                      <span {...stylex.props(ui.grow)} />
                      {files.length > 1 && (
                        <ToolButton
                          label={allCollapsed ? "Expand all files" : "Collapse all files"}
                          icon={allCollapsed ? "expandAll" : "collapseAll"}
                          aria-label={allCollapsed ? "Expand all files" : "Collapse all files"}
                          onClick={toggleAllFiles}
                        />
                      )}
                      <SegmentedControl<"split" | "unified">
                        label="Diff layout"
                        value={mode}
                        onChange={setMode}
                        options={[
                          roomy
                            ? { value: "split", label: "Split", icon: "split" }
                            : {
                                value: "split",
                                label: "Split needs a wider pane",
                                icon: "split",
                                disabled: true,
                              },
                          { value: "unified", label: "Unified", icon: "unified" },
                        ]}
                      />
                      {notesToggle}
                      <ActionMenu sections={viewSections} />
                      {state.status === "loading" && (
                        <span role="presentation" {...stylex.props(styles.loadingTrack)}>
                          <span {...stylex.props(styles.loadingBar)} />
                        </span>
                      )}
                    </div>
                  )}
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
                      <button
                        {...stylex.props(ui.button)}
                        onClick={() => void controller.refresh()}
                      >
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
                        {orphaned.length} preserved {orphaned.length === 1 ? "note" : "notes"}{" "}
                        outside this diff
                      </summary>
                      {orphaned.map((note) => (
                        <NoteCard
                          key={note.id}
                          note={note}
                          replies={notes.filter((reply) => reply.parentId === note.id)}
                          onMutate={(mutation) => controller.mutateNote(mutation)}
                          onOpenLink={openCommentLink}
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
                  <div ref={streamRef} {...stylex.props(styles.stream)}>
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
                        {!compactSelection && (
                          <span {...stylex.props(styles.selectionLabel)}>selected</span>
                        )}
                        <button
                          {...stylex.props(
                            ui.button,
                            ui.primary,
                            ui.pressable,
                            styles.selectionAction,
                          )}
                          aria-label="Add note"
                          onClick={startNote}
                        >
                          <Icon name="note" size={14} />
                          Add note
                          {!compactSelection && <kbd {...stylex.props(styles.selectionKey)}>c</kbd>}
                        </button>
                        {/* In a thread, Ask stays in its place; it waits while an answer comes. */}
                        {askThread && (
                          <button
                            type="button"
                            {...stylex.props(
                              ui.button,
                              ui.pressable,
                              styles.selectionAction,
                              styles.selectionAsk,
                            )}
                            aria-label="Ask"
                            title={askBlocked ?? `Ask ${askAgent} about these lines`}
                            disabled={!canAsk}
                            onClick={startAsk}
                          >
                            <Icon name="ask" size={14} />
                            Ask
                            {!compactSelection && (
                              <kbd {...stylex.props(styles.selectionKey, styles.selectionAskKey)}>
                                a
                              </kbd>
                            )}
                          </button>
                        )}
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
                      <ReviewCodeView
                        key={`${streamScope}:${state.review?.id}`}
                        ref={viewer}
                        onScroll={onReviewScroll}
                        items={items}
                        selectedLines={selection}
                        onSelectedLinesChange={setSelection}
                        options={options}
                        className={stylex.props(styles.codeView).className}
                        style={diffSurfaceStyle}
                        renderCustomHeader={renderCustomHeader}
                        renderAnnotation={renderAnnotation}
                        renderCodeViewHeader={renderCodeViewHeader}
                        renderCodeViewFooter={renderCodeViewFooter}
                      />
                    ) : (skipped.length || generatedRows.length) &&
                      state.status !== "loading" &&
                      !state.error ? (
                      <div style={{ overflow: "auto", height: "100%" }}>
                        {renderCodeViewHeader()}
                        {renderCodeViewFooter()}
                      </div>
                    ) : state.status !== "loading" && !state.error ? (
                      <div {...stylex.props(styles.emptyState)}>
                        <span
                          {...stylex.props(styles.emptyMark, !skipped.length && styles.emptyDone)}
                        >
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
              </div>
            </div>
            {hasNotes && briefMounted && state.savedReview && (
              <div
                {...stylex.props(
                  styles.reviewSurface,
                  fileState.active !== "brief" && styles.hiddenSurface,
                )}
                aria-hidden={fileState.active !== "brief"}
              >
                <Suspense fallback={null}>
                  <BriefView
                    key={state.savedReview.id}
                    brief={savedBrief}
                    briefFrom={
                      briefSource && briefSource.number !== shownIteration
                        ? briefSource.number
                        : undefined
                    }
                    pins={savedPins}
                    reveal={noteReveal}
                    prerender={iterations.flatMap((entry) => {
                      if (!entry.brief && !entry.pins?.length) return [];
                      const brief = iterations.findLast(
                        (earlier) => earlier.number <= entry.number && earlier.brief,
                      )?.brief;
                      const text = joinNotes([
                        ...(brief ? [brief.text] : []),
                        ...(entry.pins ?? []).map((pin) => pin.text),
                      ]).text;
                      return text !== notesText ? [text] : [];
                    })}
                    iterations={iterations
                      .filter((entry) => entry.brief || entry.pins?.length || entry.fresh)
                      .map(({ number, createdAt }) => ({ number, createdAt }))}
                    iteration={savedPins?.length ? shownIteration : briefSource?.number}
                    onIteration={showIteration}
                    files={state.files}
                    root={state.review?.repo}
                    active={fileState.active === "brief"}
                    loadSource={controller.loadSources}
                    onOpen={openBriefLocation}
                    onOpenPath={(path, line) => fileWorkspace.open(path, line)}
                    fileRefs={fileRefs}
                    readFile={readCheckoutFile}
                    onPaste={pasteBrief}
                    onCopy={copyNotes}
                    onRemove={removeBrief}
                    onStartNotes={() => startNotes()}
                    onDeleteNotes={deleteNotes}
                    onUnpin={(id) => void unpin(id)}
                    notes={notes}
                    onMutateNote={(mutation) => controller.mutateNote(mutation)}
                    comments={briefComments}
                    briefIteration={briefSource?.number}
                    onCommentBrief={(mutation) => controller.commentBrief(mutation)}
                  />
                </Suspense>
              </div>
            )}
            {commitApi && commitMounted && (
              <div
                {...stylex.props(
                  styles.reviewSurface,
                  fileState.active !== "commit" && styles.hiddenSurface,
                )}
                aria-hidden={fileState.active !== "commit"}
              >
                <Suspense fallback={null}>
                  <CommitView
                    api={commitApi}
                    revision={state.sourceRevision}
                    active={fileState.active === "commit"}
                    draftKey={`med:commit-message:${commitRepo}`}
                    onOpenFile={openWorkingFile}
                    stageIn={quiet && !zen && (!stageSlot || stageFits) ? stageSlot : undefined}
                    focusPath={commitPath}
                  />
                </Suspense>
              </div>
            )}
            {fileState.search !== undefined && browseSource && searchRepository && (
              <div
                {...stylex.props(
                  styles.reviewSurface,
                  fileState.active !== "search" && styles.hiddenSurface,
                )}
                aria-hidden={fileState.active !== "search"}
              >
                <SearchView
                  api={browseApi}
                  source={browseSource}
                  repository={searchRepository}
                  repositories={state.repositories}
                  query={fileState.search}
                  matchCase={!!fileState.searchCase}
                  active={fileState.active === "search"}
                  focusRequest={searchFocus}
                  onQueryChange={fileWorkspace.setSearch}
                  onMatchCaseChange={fileWorkspace.setSearchCase}
                  onOpen={openSearchMatch}
                  onLeave={leaveSearch}
                />
              </div>
            )}
            {activeFile && (
              <FullFileView
                editor={fileEditor}
                file={fileState.file}
                // A vault's file names its vault: the workspace names only its checkout.
                path={
                  activeFile.source.kind === "vault"
                    ? `${activeFile.sourceLabel} · ${activeFile.path}`
                    : activeFile.path
                }
                loading={fileState.loading}
                error={fileState.error}
                stale={fileState.stale}
                loadBlame={loadBlame}
                loadChanges={browseApi.changes ? loadFileChanges : undefined}
                blameEnabled={blameEnabled}
                onBlameEnabledChange={setFileBlame}
                lineBlame={lineBlame}
                loadCommit={loadCommit}
                sourceLabel={activeFile.sourceLabel}
                line={activeFile.line}
                column={activeFile.column}
                endLine={activeFile.endLine}
                revealed={activeFile.revealed}
                vimEnabled={vimEnabled}
                onNavigationReady={onNavigationReady}
                onSelectionReaderReady={onSelectionReaderReady}
                onDefinition={goToDefinition}
                onSymbolPreviewReady={onSymbolPreviewReady}
                onRefresh={refreshFile}
                onClose={closeActiveFile}
                onOpenFile={openLinkedFile}
                onOpenBefore={openBefore}
                onOpenAfter={openAfter}
                onReadingChange={setFileReading}
              />
            )}
          </div>
          {toast && (
            <div key={toast.id} role="status" {...stylex.props(styles.toast)}>
              {toast.text}
              {toast.restore !== undefined && (
                <button
                  {...stylex.props(styles.toastAction)}
                  onClick={() => {
                    const restore = toast.restore!;
                    setToast(null);
                    void setBrief(restore, restore ? "Brief restored." : "Brief removed.");
                  }}
                >
                  Undo
                </button>
              )}
            </div>
          )}
        </main>
      ),
    },
    ...(gitAvailable
      ? [
          {
            id: "changed",
            label: "Changed files",
            ariaLabel: "Changed files",
            icon: "diff" as const,
            render: (controls: ReactNode) => (
              <>
                <FileSidebar
                  controls={controls}
                  top={stackRail}
                  repo={state.session?.repository.path ?? null}
                  pathActions={pathActions}
                  files={files}
                  total={state.files.length}
                  selected={state.selectedFileId}
                  filter={state.filter}
                  onFilter={controller.setFilter}
                  onSelect={reveal}
                  onPrefetch={prefetchFile}
                  onOpen={browseSource ? openChangedFile : undefined}
                  filterRef={filterRef}
                />
                <RangeCommits {...rangeCommits} />
              </>
            ),
          },
        ]
      : []),
    ...sidePanes,
  ];
  const app = (
    <AgentReplyContext.Provider value={agentReply}>
      <div
        {...stylex.props(styles.app)}
        data-theme={activeTheme.id}
        data-sidebar-visible={shell ? shell.sidebarVisible : changedVisible}
        data-selected-branch={state.activeBranch ?? ""}
        data-selected-repository={state.activeRepositoryId ?? ""}
        data-selected-commit={loadedCommit}
        data-review-id={state.review?.id ?? ""}
        data-review-status={state.status}
        data-pending={state.status === "loading" || undefined}
        // Which pane a saved review shows first: its session, when on screen.
        data-leads={
          state.savedReview ? (sessionVisible && hasSessions ? "session" : "review") : undefined
        }
        data-file-count={state.files.length}
        data-active-file={activeFile?.path ?? ""}
      >
        {zen ? (
          <ZenHint loading={state.status === "loading"} session={!!state.savedReview} />
        ) : (
          !workspace && <BranchStrip model={branches} />
        )}
        {branchPicker}
        {/* A stack's band names the shown layer's pull request. */}
        {shownLayer?.pullRequestUrl && !savedCardHeader && (
          <InTitleBand
            lead={
              <PullRequestTitle
                url={shownLayer.pullRequestUrl}
                title={shownLayer.pullRequestTitle ?? shownLayer.title}
              />
            }
          />
        )}
        {state.savedReview?.pullRequestUrl && !shownLayer?.pullRequestUrl && !savedCardHeader && (
          <InTitleBand
            lead={
              <PullRequestTitle
                url={state.savedReview.pullRequestUrl}
                title={state.savedReview.pullRequestTitle ?? state.savedReview.title}
                pull={pullRequest.data?.pull}
              />
            }
            trail={
              <PullRequestPanel
                state={pullRequest}
                placement={pullRequestThreads.placement}
                words
              />
            }
          />
        )}
        <SaveReviewDialog
          brief={pendingBrief}
          files={state.files}
          root={state.review?.repo}
          comparisonLabel={state.review?.label ?? "These changes"}
          onClose={() => setPendingBrief(null)}
          onSave={async (title) => {
            const id = await controller.saveReview({
              title,
              brief: pendingBrief ?? undefined,
            });
            setPendingBrief(null);
            onOpenReview(id);
          }}
        />
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
                line,
                source,
                source.kind === "commit" ? `Commit ${source.oid.slice(0, 8)}` : sourceLabel,
                column,
              )
            }
          />
        )}
        <SymbolPicker
          sidebarWidth={316}
          beginFilePreview={beginFilePreview}
          open={symbolPickerOpen}
          onOpenChange={setSymbolPickerOpen}
          mode={symbolMode}
          onModeChange={setSymbolMode}
          source={
            symbolMode === "file"
              ? activeFile && activeFile.source.kind !== "vault"
                ? activeFile.source
                : null
              : browseSource
          }
          path={activeFile?.path}
          identity={fileState.file?.kind === "text" ? fileState.file.identity : undefined}
          currentFile={fileState.file && isBrowseFile(fileState.file) ? fileState.file : null}
          sourceRevision={state.sourceRevision}
          sourceLabel={
            symbolMode === "file" ? (activeFile?.sourceLabel ?? sourceLabel) : sourceLabel
          }
          api={browseApi}
          onOpen={(path, line, source, column) =>
            fileWorkspace.open(
              path,
              line,
              source,
              source.kind === "commit" ? `Commit ${source.oid.slice(0, 8)}` : sourceLabel,
              column,
            )
          }
        />
        <FilePicker
          repositories={state.repositories}
          vaults={vaults}
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
          onOpen={(path, line, source, label) =>
            fileWorkspace.open(
              path,
              line,
              source,
              source?.kind === "commit"
                ? `Commit ${source.oid.slice(0, 8)}`
                : (label ?? sourceLabel),
            )
          }
        />
        <div
          {...stylex.props(
            styles.workspace,
            (!!workspace || branches.visible.length < 2) && styles.workspaceTop,
            (zen || quiet) && styles.zenWorkspace,
          )}
          id={`${idPrefix}review-workspace`}
          role="tabpanel"
          aria-label={`${state.activeBranch ?? "Workspace"} review`}
        >
          <PaneTree state={panes} panes={workspacePanes} label="Workspace panes" />
          {quiet && !zen && <ConnectionNotice connection={state.connection} />}
        </div>
        {/* Quiet chrome has no status bar: the comparison names the review, a
            file's header its path, and ⋯ and ⌘K have the rest. */}
        <footer
          {...stylex.props(
            styles.statusbar,
            stylex.defaultMarker(),
            (zen || quiet) && styles.hiddenSurface,
          )}
          hidden={zen || quiet}
        >
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
              ? fileReading
                ? "Reading file"
                : editorDrafts.get(JSON.stringify([activeFile.source, activeFile.path]))?.editing
                  ? "Editing file · Vim"
                  : fileState.file?.media
                    ? fileState.file.kind === "video"
                      ? "Video"
                      : "Image"
                    : vimEnabled
                      ? "Read-only file · Vim"
                      : "Read-only file"
              : state.savedView
                ? "Saved review"
                : state.comparison.kind === "patch"
                  ? "Patch review"
                  : state.comparison.kind === "files"
                    ? "File comparison"
                    : state.comparison.kind === "commit" || state.comparison.kind === "range"
                      ? "Commit review"
                      : state.connection === "connected"
                        ? "Live changes"
                        : state.connection === "reconnecting"
                          ? "Reconnecting…"
                          : "Connecting…"}
          </span>
          {activeFile && (
            <span>
              {fileState.file
                ? `${fileState.file.size.toLocaleString()} bytes`
                : activeFile.sourceLabel}
            </span>
          )}
          <span {...stylex.props(ui.grow)} />
          <StatusPath
            shown={activeFile?.path ?? selectedFile?.path}
            commit={fileState.active === "commit" && !activeFile ? commitPath : null}
          />
          {!activeFile && state.metrics && (
            <span
              title="Request includes transfer; parse runs in a worker; frame measures React update to a frame after Pierre rendered."
              {...stylex.props(styles.performance, styles.onStatusHover)}
            >
              {Math.round(state.metrics.requestMs)} ms request · {Math.round(state.metrics.parseMs)}{" "}
              ms parse
              {frameMs !== null ? ` · ${Math.round(frameMs)} ms frame` : ""} ·{" "}
              {state.metrics.cacheHit
                ? "client cache"
                : state.review?.metrics.cacheHit
                  ? "server cache"
                  : "fresh"}
            </span>
          )}
          <button
            {...stylex.props(ui.button, styles.helpButton)}
            {...tooltip("Shortcuts and commands", "?")}
            onClick={() => setHelpOpen(true)}
            aria-label="Shortcuts and commands"
          >
            <kbd>?</kbd>
          </button>
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
    </AgentReplyContext.Provider>
  );
  return <ZenContext.Provider value={zen}>{app}</ZenContext.Provider>;
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
  from: {
    boxShadow: `0 0 0 0 color-mix(in srgb, ${tokens.green} 55%, transparent)`,
  },
  to: {
    boxShadow: `0 0 0 6px color-mix(in srgb, ${tokens.green} 0%, transparent)`,
  },
});
const reduced = "@media (prefers-reduced-motion: reduce)";
const headerBackground = `color-mix(in srgb, ${tokens.canvas} 96%, ${tokens.text})`;

const toastFade = stylex.keyframes({
  from: { opacity: 0 },
  to: { opacity: 1 },
});
const toastRise = stylex.keyframes({
  from: { opacity: 0, transform: "translate(-50%, 8px)" },
  to: { opacity: 1, transform: "translate(-50%, 0)" },
});
const styles = stylex.create({
  // The workspace fills its place in the window's shell.
  app: {
    position: "absolute",
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
  identity: { display: "flex", alignItems: "center", gap: 2, minWidth: 0 },
  mainHeader: {
    display: "flex",
    alignItems: "center",
    gap: 4,
    flexShrink: 0,
    height: 38,
    paddingInline: 6,
    boxSizing: "border-box",
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: tokens.line,
  },
  headerDivider: {
    width: 1,
    height: 16,
    marginInline: 6,
    backgroundColor: tokens.line,
    flexShrink: 0,
  },
  viewControls: {
    display: "flex",
    alignItems: "center",
    gap: 2,
    flexShrink: 0,
  },
  emptyRepositories: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    flex: "1",
    margin: 6,
    borderRadius: tokens.frame,
    backgroundColor: tokens.canvas,
    boxShadow: `0 0 0 1px ${tokens.line}`,
    color: tokens.muted,
    fontFamily: tokens.ui,
  },
  emptyAction: { marginTop: 14, paddingInline: 12 },
  // The frame holds both sidebars; the review sits on one inset card.
  workspace: { position: "relative", display: "flex", flex: "1", minHeight: 0, paddingInline: 6 },
  // Without the strip, the frame's own inset is the top margin.
  workspaceTop: { paddingTop: 6 },
  zenWorkspace: { paddingBottom: 6 },
  main: {
    position: "relative",
    minWidth: 0,
    flex: "1",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    backgroundColor: tokens.canvas,
    borderRadius: tokens.frame,
    boxShadow: `0 0 0 1px ${tokens.line}, 0 1px 3px #0000000f`,
  },
  reviewSurface: {
    position: "relative",
    display: "flex",
    flexDirection: "column",
    flex: "1",
    minHeight: 0,
    minWidth: 0,
  },
  hiddenSurface: { display: "none" },
  // The Guide's rail beside the stream, or beside its Overview.
  guideRow: {
    display: "flex",
    flex: "1",
    minHeight: 0,
    minWidth: 0,
    containerType: "inline-size",
  },
  // A file's Viewed mark at the end of its header, as on GitHub.
  // In a narrow pane the label and the totals give way before the file name;
  // the box stays.
  viewedToggle: {
    // Above the header's fold button, as the other header parts are.
    position: "relative",
    pointerEvents: "auto",
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    flexShrink: 100,
    minWidth: 27,
    overflow: "hidden",
    whiteSpace: "nowrap",
    height: 24,
    marginInlineStart: 4,
    paddingInline: 7,
    borderWidth: 0,
    borderRadius: `calc(6px * ${tokens.round})`,
    backgroundColor: { default: "transparent", ":hover": tokens.fill },
    color: { default: tokens.faint, ":hover": tokens.text },
    fontFamily: tokens.ui,
    fontSize: 11.5,
    cursor: "pointer",
    outline: {
      default: "none",
      ":focus-visible": `2px solid ${tokens.accentLine}`,
    },
    outlineOffset: -1,
  },
  viewedOn: { color: { default: tokens.muted, ":hover": tokens.text } },
  viewedBox: {
    display: "inline-flex",
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
    width: 13,
    height: 13,
    boxSizing: "border-box",
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: tokens.lineStrong,
    borderRadius: `calc(4px * ${tokens.round})`,
    color: tokens.canvas,
    transitionProperty: "background-color, border-color",
    transitionDuration: "120ms",
  },
  viewedBoxOn: { borderColor: tokens.green, backgroundColor: tokens.green },
  // One quiet message at a time, low in the review card, with an optional undo.
  toast: {
    position: "absolute",
    left: "50%",
    bottom: 18,
    zIndex: 30,
    display: "flex",
    alignItems: "center",
    gap: 12,
    height: 34,
    paddingInlineStart: 13,
    paddingInlineEnd: 10,
    borderRadius: `calc(10px * ${tokens.round})`,
    backgroundColor: tokens.raised,
    boxShadow: `0 0 0 1px ${tokens.lineStrong}, 0 12px 32px -14px rgb(0 0 0 / 0.5)`,
    color: tokens.text,
    fontFamily: tokens.ui,
    fontSize: 12,
    whiteSpace: "nowrap",
    transform: "translateX(-50%)",
    animationName: {
      default: toastRise,
      "@media (prefers-reduced-motion: reduce)": toastFade,
    },
    animationDuration: "220ms",
    animationTimingFunction: tokens.easeOut,
  },
  toastAction: {
    height: 24,
    paddingInline: 8,
    borderWidth: 0,
    borderRadius: `calc(6px * ${tokens.round})`,
    backgroundColor: { default: tokens.fill, ":hover": tokens.fillStrong },
    color: tokens.accent,
    fontFamily: tokens.ui,
    fontSize: 12,
    fontWeight: 500,
    cursor: "pointer",
    outline: {
      default: "none",
      ":focus-visible": `2px solid ${tokens.accentLine}`,
    },
  },
  // Diagnostics stay out of sight until the pointer rests on the status bar.
  onStatusHover: {
    opacity: { default: 0, [stylex.when.ancestor(":hover")]: 1 },
    transitionProperty: "opacity",
    transitionDuration: "160ms",
  },
  // A narrow pane drops the totals first, then truncates the comparison
  // labels; the view controls on the right always stay.
  toolbar: {
    position: "relative",
    containerType: "inline-size",
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
  toolbarTotals: {
    display: { default: "contents", "@container (max-width: 620px)": "none" },
  },
  notesButton: { gap: 5, minWidth: 28, paddingInline: 6 },
  notesCount: {
    fontFamily: tokens.code,
    fontSize: 10.5,
    fontVariantNumeric: "tabular-nums",
  },
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
  // Quiet chrome has no toolbar: the bar runs on the rule below the review's row.
  rowLoading: { top: 36, bottom: "auto", zIndex: 2 },
  // The comparison gives way first in a narrow row: useRowFit chooses a label
  // that fits, or ⋯.
  rowComparison: { display: "flex", flexGrow: 0, flexShrink: 1000, minWidth: 0 },
  rowStage: { display: "flex", flexShrink: 0 },
  // Quiet as a tab is: the row's text, not the toolbar's strong label.
  rowComparisonTrigger: {
    width: "100%",
    color: { default: tokens.muted, ":hover:not(:disabled)": tokens.text },
    fontWeight: 450,
  },
  loadingBar: {
    display: "block",
    width: "30%",
    height: "100%",
    borderRadius: `calc(1px * ${tokens.round})`,
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
    borderRadius: `calc(9px * ${tokens.round})`,
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
  // A choice, not a fault: the review's own colors.
  drift: {
    color: tokens.muted,
    backgroundColor: tokens.panel,
    paddingInlineEnd: 6,
  },
  driftText: {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  driftAction: { flexShrink: 0, height: 24, paddingInline: 8, fontSize: 12 },
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
    borderRadius: `calc(11px * ${tokens.round})`,
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
  selectionAction: {
    height: 30,
    minHeight: 30,
    paddingInlineStart: 9,
    paddingInlineEnd: 6,
  },
  selectionKey: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minWidth: 16,
    height: 16,
    marginInlineStart: 2,
    borderRadius: `calc(4px * ${tokens.round})`,
    backgroundColor: `color-mix(in srgb, ${tokens.canvas} 18%, transparent)`,
    fontFamily: tokens.ui,
    fontSize: 10,
    fontWeight: 500,
  },
  selectionClose: { width: 30, minWidth: 30, height: 30, minHeight: 30 },
  selectionAsk: { color: { default: tokens.text, ":hover:not(:disabled)": tokens.text } },
  selectionAskKey: { backgroundColor: tokens.fill },
  codeView: {
    flex: "1",
    minHeight: 0,
    height: "100%",
    overflow: "auto",
    scrollbarWidth: "thin",
  },
  diffHeader: {
    position: "relative",
    pointerEvents: "none",
    display: "flex",
    alignItems: "center",
    gap: 8,
    paddingBlock: 0,
    // The header spans the stream, as the code does. In zen, the first row
    // keeps clear of the window controls (see CardTab).
    paddingInlineStart: "calc(8px + var(--med-lift-start, 0px))",
    paddingInlineEnd: "calc(14px + var(--med-lift-end, 0px))",
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
    outline: {
      default: "none",
      ":focus-visible": `2px solid ${tokens.accentLine}`,
    },
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
    borderRadius: `calc(4px * ${tokens.round})`,
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
  statusGenerated: { color: tokens.muted, backgroundColor: tokens.fill },
  statusEdited: {
    color: tokens.warning,
    backgroundColor: `color-mix(in srgb, ${tokens.warning} 14%, transparent)`,
  },
  headerStats: {
    position: "relative",
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    flexShrink: 100,
    minWidth: 0,
    overflow: "hidden",
    fontFamily: tokens.code,
    fontSize: 11,
  },
  skipped: {
    paddingBlock: 6,
    paddingInline: 14,
    backgroundColor: tokens.canvas,
  },
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
    borderRadius: `calc(12px * ${tokens.round})`,
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
  statusItem: {
    display: "inline-flex",
    alignItems: "center",
    gap: 7,
    whiteSpace: "nowrap",
  },
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
  // The whole path while it fits; its folders give way first.
  selectedPath: {
    display: "flex",
    flexShrink: 1,
    minWidth: 0,
    maxWidth: "60%",
    color: tokens.faint,
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
    borderRadius: `calc(5px * ${tokens.round})`,
  },
});
