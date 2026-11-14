import { useDocumentTitle } from "./data/document-title";
import { DiffImages } from "./components/MediaView";
import { mediaType } from "../shared/media";
import { ToolButton } from "./components/ToolButton";
import { settingsCommands } from "./components/settings/settings-commands";
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
  type NoteMutation,
  type PullRequestThread,
  type SourceResponse,
} from "../shared/protocol";
import {
  changesCommits,
  hasReview,
  changesTarget,
  useReviewController,
  type ReviewController,
} from "./data/controller";
import { tokens, ui } from "./theme.stylex";
import { relativeTime, useMinuteClock } from "./data/relative-time";
import {
  ActionMenu,
  ChoiceSelect,
  CommandDialog,
  LineDialog,
  type ReviewCommand,
} from "./components/Controls";
import { ChangeTotals } from "./components/ChangeTotals";
import { DiffStat } from "./components/DiffStat";
import {
  ReviewHeader,
  ReviewTitle,
  ReviewTools,
  type DisplayOptions,
  type ReviewPage,
} from "./components/ReviewHeader";
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
import { NoteCard, NoteComposer, type NoteTarget } from "./components/NoteCard";
import { Icon, type IconName } from "./components/Icon";
import "./pierre-theme";
import { DEFAULT_CODE_VIEW_FILE_METRICS, hydratePartialDiff } from "@pierre/diffs";
import { useTheme } from "./themes";
import { ThemePicker } from "./components/ThemePicker";
import { BranchStrip, BranchSwitch, useBranchTabs } from "./components/BranchTabs";
import {
  InTitleBand,
  useInTitleBand,
  useAddPullRequest,
  useDisposeOnClose,
  useWindowDrafts,
  useShell,
  useTabCommands,
  useThread,
  useThreadReviews,
  useThreadReader,
  useWorkspace,
  useWorkspaceEntry,
  useWorkspaceInView,
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
  type AgentSession,
  type SavedReviewTarget,
  type Since,
} from "../shared/saved-review";
import { createBrowseApi, useBrowseFiles, useVaults, type BrowseApi } from "./data/browse";
import { useMentionSources } from "./data/mentions";
import { isBrowseFile, type FileRead } from "../shared/local-file";
import { createFileWorkspace, isFileTab, sourceKey, useFileWorkspace } from "./data/file-workspace";
import { FilesRail } from "./components/FilesRail";
import { PaneTree, usePaneTree, type PaneSpec } from "./components/PaneTree";
import type { PaneNode, Side } from "./data/pane-tree";
import { FilePicker } from "./components/FilePicker";
import { SEARCH_OPEN_EVENT, SearchView, type SearchOpen } from "./components/SearchView";
import { subscribeFileOpens, takeFileOpen, takeSearchOpen } from "./data/file-opens";
import { subscribeSubagentOpens, takeSubagentOpen } from "./data/tabs";
import { useTurnRecap } from "./data/turn-recap";
import { shortAge } from "./data/threads";
import { FindBar, NO_FIND_OPTIONS, type FindOptions } from "./components/FindBar";
import { findPattern } from "./data/search-highlights";
import { SymbolPicker } from "./components/SymbolPicker";
import {
  FullFileView,
  preloadFileEditor,
  type BeginFileSymbolPreview,
  type FileComments,
} from "./components/FullFileView";
import { preloadable } from "./components/preloadable";
import { FileViewTabs } from "./components/FileViewTabs";
import { checkoutNameFor } from "./data/checkout-names";
import { readBrowserToken } from "./data/auth";
import { createApi } from "./data/api";
import { browserFetch } from "./data/live";
import { z } from "zod";
import { COMMIT_KEY, createCommitApi, type CommitApi } from "./data/commit";
import {
  PullRequestThreadCard,
  AgentReplyContext,
  CodexFindingCard,
  PullRequestPanel,
  type AgentReplyTarget,
  type FindingPlacement,
  useCodexReviews,
  usePullRequestComments,
} from "./components/PullRequestComments";
import {
  PendingReviewContext,
  type PendingReviewInput,
  type PendingReviewTarget,
} from "./data/pending-review";
import { placeThreads } from "./data/pull-request";
import type { CodexFinding, CodexReviewRun } from "../shared/codex-review";
import { listComments, type ListedComment } from "./data/listed-comments";
import { record, sameScreen, screenOf, settle, step, type Screen } from "./data/navigation";
import { markCommentsRead, useCommentReads } from "./data/comment-reads";
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
  useRowWide,
  useSlotFits,
} from "./components/QuietChrome";
import { switchSetter, useViewSetting, viewSettings } from "./data/view-settings";
import { ShortcutGuide } from "./components/ShortcutGuide";
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
import type { SymbolDefinition, SymbolSearch } from "../shared/symbols";
import { hoverName, useSymbolHover, type SymbolHoverSource } from "./components/SymbolHover";

/** A token that the pointer entered, as Pierre gives it; a diff's has a side. */
interface DiffTokenEvent {
  side?: "deletions" | "additions";
  lineNumber: number;
  lineCharStart: number;
  tokenText: string;
  tokenElement: HTMLElement;
}
import { matchReviewFile, parseBriefHref } from "./data/file-links";
import { GuideRail } from "./components/guide/GuideRail";
import { GuideStepper } from "./components/guide/GuideStepper";
import { HandoffContext } from "./components/session/HandoffCard";
import { ChangesRail } from "./components/ChangesRail";
import { GuideOverview } from "./components/guide/GuideOverview";
import type { Offer, OverviewProof } from "./components/guide/OverviewParts";
import { isOpenFinding, readReviewOutput, withoutProof } from "../shared/review-output";
import roundLimitSkill from "../../skills/suggestions/round-limit/SKILL.md?raw";
import {
  CommitHeader,
  GuideFooter,
  SegmentHeader,
  SinceHeader,
} from "./components/guide/GuideHeader";
import { GuideThread } from "./components/guide/GuideThread";
import {
  answersGuideNote,
  resolveGuide,
  type GuideNote,
  type GuideScope,
  type GuideSection,
} from "./data/guide";
import type { ParsedReviewFile } from "../shared/review";
import type { SavedCommit } from "../shared/review-guide";
import { reviewPullRequest, sessionKey } from "../shared/threads";
import { reviewChanges } from "./data/review-place";
import { PullProgress } from "./components/PullWorkspace";
import { isPullReviewKey, parsePullUrl } from "../shared/pull-workspace";
import { basename } from "./data/bar-context";
import type { PathActions } from "./components/PathMenu";
import { diffSurfaceStyle, EXPANSION_LINES } from "./components/diff-surface";
import { highlightRules } from "./code-colors";
import { createDiffFindHighlights } from "./data/diff-find-highlights";
import { openIn, useAgentInbox } from "./data/agent-inbox";
import { CommentAgentContext, type CommentAgent } from "./data/comment-agent";
import { sendsNow } from "./components/SendNow";
import type { ComposerAttachment } from "./components/session/SessionComposer";
import type { SessionStarter } from "./components/session/SessionPanel";
import type { ThreadLink } from "./components/session/SessionSidePanel";
import { forkSession, useAgentPresets } from "./data/owned-session";
import { useFoundCommands } from "./data/found-threads";
import { createFileIndex } from "./data/file-refs";
import { CommentRefsContext, type FileRefs } from "./components/FileRefs";
import { HIGHLIGHTER } from "./pierre-theme";

const PullRequestView = lazy(() => import("./components/PullRequestView"));
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
/** The Session pane hides: its agent keeps working, and ⌘⇧B shows it again. */
/** The review hides while the session shows beside it; its pages, a file,
 * or Show review bring it back. */
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
const NO_SESSIONS: AgentSession[] = [];
/** What "Ask the agent to explain" puts in the session's message box (docs/PRACTICES.md). */
const EXPLAIN_REQUEST =
  "Before I read the diff, explain this change in an `## Explainer` section of at most 10 lines: why it exists, what to read first (with path:line), what changes in behaviour and what does not, and the risk.";
const NO_COMMITS: SavedCommit[] = [];
const NO_FILES: ParsedReviewFile[] = [];
const NO_SECTIONS: GuideSection[] = [];
const NO_GUIDE_NOTES: GuideNote[] = [];
// Pierre's view renders its file headers and comments again whenever it renders.
const ReviewCodeView = memo(CodeView) as typeof CodeView;
/** The review stream's file header, which sticks at its top. */
const STICKY_FILE_HEADER = DEFAULT_CODE_VIEW_FILE_METRICS.diffHeaderHeight;
/** A full commit ID (SHA-1 or SHA-256), not a name such as `worktree`. */
const FULL_OID = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;

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
];
const commandRank = (id: string) => {
  const rank = commonCommands.indexOf(id);
  return rank < 0 ? commonCommands.length : rank;
};

// The view settings outlast a restart, and every workspace and window shares
// them (data/view-settings.ts).
const setMode = (value: "split" | "unified") => viewSettings.diffLayout.set(value);
const setWrap = switchSetter(viewSettings.wrap, "on", "off");
const setShowNotes = switchSetter(viewSettings.comments, "shown", "hidden");
const setVimEnabled = switchSetter(viewSettings.vim, "on", "off");
const setLineBlame = switchSetter(viewSettings.lineBlame, "on", "off");

/** Where each pane opens beside the review, and its share of the room. */
const PANE_PLACES: Record<string, { near?: string; side: Side; share: number }> = {
  session: { near: "review", side: "left", share: 0.5 },
  review: { near: "session", side: "right", share: 0.5 },
  files: { near: "review", side: "right", share: 0.26 },
  // At the right of the row, with room from the thread and the review alike,
  // so that an answer has room to read.
};

/** The panes that ⌘E expands while they are in use, beside the review. */
const SESSION_PANES = ["session"];

/** The narrowest review pane that shows a split diff, in pixels. */
const SPLIT_MIN_WIDTH = 760;
/** The narrowest review pane that shows the Guide's rail on "auto"; the
 * Overview lists the segments in a narrower one. */
const GUIDE_RAIL_MIN_WIDTH = 721;
/** Below this width, the line selection bar leaves out its label and keys. */
const SELECTION_BAR_FULL_WIDTH = 420;

/** The review's pages, which Back and Forward show by name; other tabs are files. */
const PAGES = new Set(["review", "changes", "commit", "pull", "search", "guide", "files"]);

export function App({
  controller,
  browseApi: providedBrowseApi,
  loadBlame: providedBlameLoader,
  loadCommit: providedCommitLoader,
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
}) {
  const state = useReviewController(controller);
  // Inside a workspace host, the host owns the controller and the address.
  const workspace = useWorkspace();
  const workspaceId = workspace?.id;
  const shown = useWorkspaceShown();
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
  // Where the window's title band does not show this workspace, as on a page
  // that covers the workspaces or in a test, the review's row holds its pages.
  const bandShown = useInTitleBand();
  // The workspace's panes: the review, its thread, the file trees, and the
  // preview, tiled as the reader leaves them. Each workspace keeps its own.
  const entry = useWorkspaceEntry();
  // The thread that the workspace shows: its session, its reviews, and where
  // it works now.
  const threadId = entry?.kind === "thread" ? entry.threadId : undefined;
  const thread = useThread(threadId);
  const layoutKey =
    entry?.kind === "thread"
      ? `thread:${entry.threadId}`
      : entry?.kind === "repository"
        ? `repository:${entry.path ?? "default"}`
        : entry?.kind === "pull"
          ? `pull:${entry.url}`
          : undefined;
  const threadLayout = entry?.kind === "thread" || entry?.kind === "pull";
  // While the thread's agent works, its changes are expected: the drift bar waits.
  const agentWorking = thread?.state === "working";
  // Where the agent works now, such as another repository or branch. The
  // controller knows it; what the thread shows stays where the reader put it.
  const placePath = thread?.checkout;
  const placeRepository = thread?.repository?.id;
  const placeBase = thread?.base;
  useEffect(() => {
    if (!threadId) return;
    void controller
      .follow({
        id: threadId,
        ...(placePath && { path: placePath }),
        ...(placeRepository && { repositoryId: placeRepository }),
        ...(placeBase && { base: placeBase }),
      })
      .catch(() => {});
  }, [controller, threadId, placePath, placeRepository, placeBase]);
  const foundCommands = useFoundCommands(sessionFetch);
  const tabCommands = useTabCommands();
  // A tab closes with "Close tab"; "Close workspace" is for the others.
  const isTab = tabCommands.some((command) => command.id === "close-tab" && !command.disabled);
  // A thread opens on its session alone: the pages in the title band show
  // the review beside it. A pull request opens with both.
  const initialPanes = useCallback(
    (): PaneNode =>
      entry?.kind === "pull"
        ? {
            axis: "row",
            children: [{ id: "session" }, { id: "review" }],
            sizes: [0.5, 0.5],
          }
        : threadLayout
          ? { id: "session" }
          : { id: "review" },
    [threadLayout, entry?.kind],
  );
  const panes = usePaneTree({ key: layoutKey, initial: initialPanes });
  const sessionVisible = panes.isOpen("session");
  // A review behind a pane that fills the room, as an expanded thread, is
  // not on screen: a page shows it again.
  const reviewVisible = panes.isOpen("review") && (!panes.zoom || panes.zoom === "review");
  // Markdown files now read rendered or show their source in the file view
  // (FullFileView), so a saved layout's Preview pane has nothing to show;
  // the changed files are the Changes page's sidebar, not a pane.
  // The files' tree is the Files page's sidebar, not a pane.
  const retiredPreview = panes.isOpen("preview");
  const retiredChanged = panes.isOpen("changed");
  const retiredFiles = panes.isOpen("files");
  const closeRetired = panes.close;
  useEffect(() => {
    if (retiredPreview) closeRetired("preview");
    if (retiredChanged) closeRetired("changed");
    if (retiredFiles) closeRetired("files");
  }, [retiredPreview, retiredChanged, retiredFiles, closeRetired]);
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
  // The Commit tab's Stage all goes in the review's row.
  // In a narrow row it goes back to the Commit view's own header, so that
  // the tabs keep their labels.
  const [stageSlot, setStageSlot] = useState<HTMLElement | null>(null);
  const stageFits = useSlotFits(stageSlot, 72);
  // The review pane's Expand and Hide, at the row's end. A narrow row puts
  // them in ⋯, so that the tabs keep their labels.
  const [paneSlot, setPaneSlot] = useState<HTMLElement | null>(null);
  const paneControlsFit = useRowWide(paneSlot, 520);
  const savedActions = useRef<SavedReviewActions>(null);
  // The base branch menu opens below the comparison once the select closes.
  const openCompare = useCallback(
    () => requestAnimationFrame(() => comparisonActions.current?.openCompare()),
    [],
  );
  const openPush = useCallback(() => comparisonActions.current?.openPush(), []);
  const clearComments = useCallback(() => savedActions.current?.clearComments(), []);
  const filePreviewShown = useFilePreviewShown();
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
  const vimEnabled = useViewSetting(viewSettings.vim) === "on";
  const lineBlame = useViewSetting(viewSettings.lineBlame) === "on";
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
  // ⌘O opens the picker on the repositories; ⌘⇧G on every branch.
  const [branchPickerRepos, setBranchPickerRepos] = useState(false);
  const workerPool = useWorkerPool();
  const [diagnostics] = useState(createRenderDiagnostics);
  // Developers save the last render events from the console
  // (`medRenderDiagnostics.download()`); ⌘K keeps to reviewing.
  useEffect(() => {
    const target = window as Window & { medRenderDiagnostics?: typeof diagnostics };
    target.medRenderDiagnostics = diagnostics;
    return () => {
      if (target.medRenderDiagnostics === diagnostics) delete target.medRenderDiagnostics;
    };
  }, [diagnostics]);
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
  /** The checkout and the head that the diff on screen came from. */
  const diffRepo = state.review?.repo;
  const diffHead = state.review?.head;
  const browseSource = useMemo<BrowseSource | null>(() => {
    const repository = state.session?.repository;
    if (repository?.git === false) return null;
    // The checkout did not load, as when Med could not read it: the diff
    // still names its own checkout, so its files open from there.
    if (!repository) return diffRepo ? { kind: "worktree", repo: diffRepo } : null;
    // A saved review's files are the reviewed commit's, as the review shows
    // them; when the checkout has that commit checked out, its working files.
    if (
      state.savedView &&
      diffRepo &&
      diffHead &&
      FULL_OID.test(diffHead) &&
      (state.historyRef || repository.head !== diffHead)
    )
      return { kind: "commit", repo: diffRepo, oid: diffHead };
    if (state.historyRef)
      return branchHead ? { kind: "commit", repo: repository.path, oid: branchHead } : null;
    return { kind: "worktree", repo: repository.path };
  }, [
    state.session?.repository,
    state.savedView,
    state.historyRef,
    branchHead,
    diffRepo,
    diffHead,
  ]);
  /** What a file action says when this workspace has no files to open. */
  const cannotBrowse =
    state.session?.repository.git === false
      ? "This comparison has no Git checkout, so Med can't open its files."
      : `Med couldn't load this checkout, so it can't open its files${state.error ? `: ${state.error}` : ". Reload the page, or check the repository in Sources."}`;
  /** The saved review on screen, when Med no longer has its repository. */
  const missingRepository = useMemo(() => {
    if (!state.savedView || !state.error) return undefined;
    const target = state.savedReview?.targets.find((entry) => entry.id === state.savedTargetId);
    return target && !state.repositories.some((entry) => entry.id === target.repositoryId)
      ? target
      : undefined;
  }, [state.savedView, state.error, state.savedReview, state.savedTargetId, state.repositories]);
  const [addingRepository, setAddingRepository] = useState(false);
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
  const pendingTab = useRef<"review" | "changes" | null>(null);
  useEffect(() => {
    // The Pull request and the Guide belong to the saved review, so they stay
    // in front while another version's comparison, or a commit of the guide, loads.
    fileWorkspace.configure(
      workspaceKey,
      browseSource,
      sourceLabel,
      state.savedReview ? ["pull", "guide"] : [],
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
  const { show: revealPane } = panes;
  const fileRefs = useMemo<FileRefs>(
    () => ({
      index: fileIndex,
      // A tab like any other: closing it goes back to the tab before it.
      open: (ref, background) =>
        fileWorkspace.open(ref.path, ref.line, undefined, undefined, undefined, {
          background,
          endLine: ref.endLine ?? ref.line,
        }),
    }),
    [fileIndex, fileWorkspace],
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
  // The name that the reader gave the thread shows in place of the agent's title.
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
  // A hover over a name in a file: its definitions and doc comments.
  const hoverFile = fileState.file;
  const loadHover = useMemo(() => {
    const file = hoverFile;
    const hover = browseApi.hover;
    if (!file || !isBrowseFile(file) || file.kind !== "text" || !hover) return undefined;
    return (name: string, signal: AbortSignal) =>
      hover(file.source, file.path, file.identity, name, signal);
  }, [hoverFile, browseApi]);
  const openDefinition = useCallback(
    (definition: SymbolDefinition) => {
      const source = definition.source;
      fileWorkspace.open(
        definition.path,
        definition.line,
        source,
        source.kind === "commit" ? `Commit ${source.oid.slice(0, 8)}` : sourceLabel,
        definition.column,
      );
    },
    [fileWorkspace, sourceLabel],
  );
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
  const { close: closePane, show: showInTree } = panes;
  const showPane = useCallback(
    (id: string, options: { quiet?: boolean; zoom?: boolean } = {}) =>
      showInTree(id, { ...PANE_PLACES[id], ...options }),
    [showInTree],
  );
  // A file that opens shows: a zoomed pane, or a session that fills the row,
  // makes room for the review, as Restore does.
  const otherZoomed = !!panes.zoom && panes.zoom !== "review";
  useEffect(
    () =>
      fileWorkspace.onShow(() => {
        // Opening a file is a step: Back shows what showed before it.
        step();
        if (!reviewVisible || otherZoomed) showPane("review");
      }),
    [fileWorkspace, reviewVisible, otherZoomed, showPane],
  );
  // The workspace keeps one pane: hiding the session while the review is
  // hidden shows the review instead.
  const hideSession = useCallback(() => {
    if (!reviewVisible) showPane("review");
    closePane("session");
  }, [reviewVisible, showPane, closePane]);
  const toggleSession = useCallback(
    () => (sessionVisible ? hideSession() : showPane("session")),
    [sessionVisible, hideSession, showPane],
  );
  const toggleReview = useCallback(
    () => (reviewVisible ? sessionVisible && closePane("review") : showPane("review")),
    [reviewVisible, sessionVisible, closePane, showPane],
  );
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
  const preferredMode = useViewSetting(viewSettings.diffLayout);
  const codeSize = useViewSetting(viewSettings.codeSize);
  // Split diffs need room for two columns; a narrow review pane shows them
  // unified until it has room again.
  const [mainElement, setMainElement] = useState<HTMLElement | null>(null);
  const [roomy, setRoomy] = useState(true);
  const [guideRoomy, setGuideRoomy] = useState(true);
  const [compactSelection, setCompactSelection] = useState(false);
  useLayoutEffect(() => {
    if (!mainElement) return;
    const measure = () => {
      // A hidden workspace has no width; it keeps its layout for its return.
      const width = mainElement.clientWidth;
      if (!width) return;
      setRoomy(width >= SPLIT_MIN_WIDTH);
      setGuideRoomy(width >= GUIDE_RAIL_MIN_WIDTH);
      setCompactSelection(width < SELECTION_BAR_FULL_WIDTH);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(mainElement);
    return () => observer.disconnect();
  }, [mainElement]);
  const mode = preferredMode === "split" && !roomy ? "unified" : preferredMode;
  // A pane hidden from its header takes its button, and the focus, with it:
  // the button that shows it again, where it was, takes the focus. The review
  // widens as the pane goes, so the button can come a frame later, with room.
  const sessionShown = useRef(sessionVisible);
  const focusShow = useRef(false);
  useLayoutEffect(() => {
    const before = sessionShown.current;
    sessionShown.current = sessionVisible;
    const active = document.activeElement;
    const lost =
      !(active instanceof HTMLElement) || active === document.body || !active.checkVisibility();
    if (before && !sessionVisible) focusShow.current = lost;
    if (!focusShow.current) return;
    if (!lost || sessionVisible) {
      focusShow.current = false;
      return;
    }
    // The button can come a few frames later, as in the title band once the
    // review fills the window; a focus that moved on meanwhile stays.
    let frames = 0;
    let frame = 0;
    const focus = () => {
      const now = document.activeElement;
      if (now instanceof HTMLElement && now !== document.body && now.checkVisibility()) {
        focusShow.current = false;
        return;
      }
      const button = visibleElement('[data-pane-show="session"]');
      if (button) {
        focusShow.current = false;
        button.focus();
      } else if (++frames < 10) frame = requestAnimationFrame(focus);
    };
    focus();
    return () => cancelAnimationFrame(frame);
  }, [sessionVisible, roomy]);
  const wrap = useViewSetting(viewSettings.wrap) === "on";
  const showNotes = useViewSetting(viewSettings.comments) === "shown";
  const [findOpen, setFindOpen] = useState(false);
  const [find, setFind] = useState("");
  const [findOptions, setFindOptions] = useState<FindOptions>(NO_FIND_OPTIONS);
  // The match that shows, from 0; -1 before the first.
  const [findIndex, setFindIndex] = useState(-1);
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
  const previousRepositories = useRef({ controller, ids: new Set<string>() });
  useEffect(() => {
    const previous = previousRepositories.current;
    // Another review of the thread starts a controller, which has no list
    // until it reads one: no repository went away, and each checkout keeps
    // its open files and its scroll.
    if (previous.controller !== controller && !state.repositories.length) return;
    const current = new Set(state.repositories.map((repository) => repository.id));
    for (const id of previous.ids) {
      if (current.has(id)) continue;
      fileWorkspace.forgetRepository(id);
      for (const scope of reviewScroll.current.keys())
        if (JSON.parse(scope)[0] === id) reviewScroll.current.delete(scope);
    }
    previousRepositories.current = { controller, ids: current };
  }, [controller, fileWorkspace, state.repositories]);
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
      // The stream reports its scroll position, but places a position below
      // its sticky file header: the place comes back with the header added.
      viewer.current?.scrollTo({ type: "position", position: position + STICKY_FILE_HEADER });
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
  // The review that the selection and the draft belong to; they go when
  // another one loads.
  const shownReview = useRef("");
  useEffect(() => {
    let previousMetrics = controller.getSnapshot().metrics;
    return controller.subscribe(() => {
      const snapshot = controller.getSnapshot();
      const id = snapshot.review?.id ?? "";
      if (shownReview.current !== id) {
        setSelection(null);
        setDraft(null);
        setContextError(null);
      }
      if (snapshot.status === "loading" || snapshot.metrics !== previousMetrics)
        shownReview.current = id;
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
  // The thread's agent session: one, for a session's thread; none for a lone
  // review. A review that opens without its thread, as a link does until the
  // thread list arrives, shows the session that handed it off.
  const reviewSession = thread ? undefined : state.savedReview?.session;
  const threadSession = thread?.session ?? reviewSession;
  /** The thread whose session routes serve the session: its key. */
  const sessionThreadId = reviewSession ? sessionKey(reviewSession) : threadId;
  const agentSessions = useMemo(
    () => (threadSession ? [threadSession] : NO_SESSIONS),
    [threadSession],
  );
  const agentInbox = useAgentInbox(
    threadSession && sessionThreadId ? sessionThreadId : null,
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
    if (threadLayout && state.savedReview && !hasSessions) adoptPanes({ id: "review" });
  }, [threadLayout, state.savedReview, hasSessions, adoptPanes]);
  useEffect(() => {
    if (sessionReady || !hasSessions) return;
    return whenIdle(() => setSessionReady(true));
  }, [sessionReady, hasSessions]);
  useEffect(() => (panesPreloaded ? undefined : whenFree(preloadPanes)), []);
  // The agents that Med can start on a lone review, or in a pull request's
  // worktree from the branch picker.
  const agentPresets = useAgentPresets(!!state.savedReview || branchPickerOpen, sessionFetch);
  // An agent that starts on a lone review takes it: the session's thread
  // replaces the review's.
  const sessionStarter = useMemo<SessionStarter>(
    () => ({
      agents: agentPresets,
      start: async (preset) => {
        const started = await controller.startSession(preset);
        const reviewId = controller.getSnapshot().savedReview?.id;
        workspace?.open({ kind: "thread", threadId: started, ...(reviewId && { reviewId }) });
        if (workspace && started !== threadId) workspace.close(workspace.id);
      },
    }),
    [agentPresets, controller, workspace, threadId],
  );
  // Continue in Med: a fork of a Claude session that a terminal runs. The
  // fork takes the thread's place; the terminal keeps its session.
  const continueInMed = useCallback(async () => {
    if (!sessionThreadId) return;
    const { thread: next } = await createApi(sessionFetch ?? browserFetch, readBrowserToken()).json(
      `/api/sessions/${encodeURIComponent(sessionThreadId)}/continue`,
      z.object({ thread: z.string() }),
      { method: "POST" },
    );
    // The host links the thread's reviews to the fork.
    await controller.refreshSavedReview().catch(() => {});
    workspace?.open({ kind: "thread", threadId: next });
    if (workspace && next !== threadId) workspace.close(workspace.id);
    showPane("session");
  }, [sessionThreadId, threadId, sessionFetch, workspace, showPane, controller]);
  // Fork from here: the new thread opens as a tab of its own, in front.
  const forkFromHere = useCallback(
    async (_sessionId: string, at: string) => {
      if (!sessionThreadId) return;
      const forked = await forkSession(sessionThreadId, { at }, sessionFetch);
      workspace?.open({ kind: "thread", threadId: forked.id, title: forked.title });
    },
    [sessionThreadId, sessionFetch, workspace],
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
  // A comment goes to the agent from the comment when Med started that agent
  // and runs it. One that a terminal runs takes comments from its message.
  const inboxState = agentInbox.state;
  const sendAgentMessage = agentInbox.send;
  const commentAgent = useMemo<CommentAgent | null>(() => {
    if (!leadSession || !replyAgent || !inboxState?.owned.includes(leadSession.id)) return null;
    const unsent = new Set(inboxState.drafts.map((draft) => draft.id));
    const held = new Set(inboxState.messages.flatMap((message) => message.noteIds));
    return {
      name: replyAgent,
      mark: leadSession.agent === "acp" ? "agent" : leadSession.agent,
      sent: (id) => held.has(id) && !unsent.has(id),
      send: async (id) => {
        await sendAgentMessage({
          id: crypto.randomUUID(),
          text: "",
          noteIds: [id],
          attachments: [],
          images: [],
        });
      },
    };
  }, [leadSession, replyAgent, inboxState, sendAgentMessage]);
  /** Saves a new comment on lines, or a reply, and sends its thread to the
   * agent that Med runs while "Send to … now" is ticked (SendNow). A send
   * that fails leaves the comment saved, to send from the message box, and
   * says why. */
  const addNote = useCallback(
    async (note: NoteInput) => {
      const before = new Set(controller.getSnapshot().notes?.notes.map((entry) => entry.id));
      await controller.mutateNote({ type: "add", note });
      if (!commentAgent || !sendsNow()) return;
      // A reply goes as its thread, by the thread's first comment.
      const thread =
        note.parentId ??
        controller
          .getSnapshot()
          .notes?.notes.find(
            (entry) => !before.has(entry.id) && !entry.parentId && entry.text === note.text,
          )?.id;
      if (!thread) return;
      await commentAgent
        .send(thread)
        .catch((error: unknown) =>
          setContextError(
            `The ${note.parentId ? "reply" : "comment"} is saved, but did not reach ${commentAgent.name}: ${
              error instanceof Error ? error.message : "the send failed"
            }. Send it from the message box.`,
          ),
        );
    },
    [controller, commentAgent],
  );
  /** A change to the review's comments; a new one, or a reply, goes as
   * `addNote` sends it. */
  const mutateNote = useCallback(
    (mutation: NoteMutation) =>
      mutation.type === "add" ? addNote(mutation.note) : controller.mutateNote(mutation),
    [addNote, controller],
  );
  // An agent's reply changes the review where the page does not write: the
  // inbox says so, and the page reads the comments again.
  const inboxRevision = inboxState?.revision;
  const savedRevision = state.savedReview?.revision;
  useEffect(() => {
    if (inboxRevision !== undefined && savedRevision !== undefined && inboxRevision > savedRevision)
      void controller.refreshSavedReview().catch(() => {});
  }, [inboxRevision, savedRevision, controller]);
  const savedTarget = state.savedReview?.targets.find(
    (target) => target.id === state.savedTargetId,
  );
  const pullRequest = usePullRequestComments(
    useCallback((refresh: boolean) => controller.loadPullRequestComments(refresh), [controller]),
    state.savedReview?.pullRequestUrl
      ? `${state.savedReview.id} ${state.savedReview.pullRequestUrl}`
      : null,
    useCallback(
      (input: PendingReviewInput) => controller.changePullRequestReview(input),
      [controller],
    ),
  );
  // Comments, Med's, the agent's and GitHub's, link the files that they name
  // as the thread does, and also paths in their text and GitHub links to
  // the pull request's head.
  const pullRequestUrl = pullRequest.data?.url;
  const pullRequestHead = pullRequest.data?.head;
  const commentFileRefs = useMemo<FileRefs>(() => {
    const repo =
      pullRequestUrl && /^https:\/\/github\.com\/([^/]+\/[^/]+)\/pull\//i.exec(pullRequestUrl)?.[1];
    return {
      ...fileRefs,
      comments: {
        text: true,
        ...(repo && pullRequestHead ? { github: { repo, head: pullRequestHead } } : {}),
      },
    };
  }, [fileRefs, pullRequestUrl, pullRequestHead]);
  // The reader's pending review on GitHub: replies to its threads, and the
  // comments on a saved version, which Med keeps with that version.
  const pendingReview = useMemo<PendingReviewTarget | null>(() => {
    if (!state.savedReview?.pullRequestUrl) return null;
    const target = state.savedView
      ? state.savedReview.targets.find((entry) => entry.id === state.savedTargetId)
      : undefined;
    // GitHub's lines are the head's: only a version of the head, not captured
    // working changes, can add comments.
    const onHead = target && !target.captured && target.head === pullRequest.data?.head;
    return {
      ...(onHead ? { targetId: target.id } : {}),
      comments: pullRequest.data,
      write: pullRequest.write,
    };
  }, [
    state.savedReview,
    state.savedView,
    state.savedTargetId,
    pullRequest.data,
    pullRequest.write,
  ]);
  // GitHub thread lines refer to the pull request's head commit. Threads show
  // in the diff only when it shows that commit and the line (data/pull-request.ts).
  const pullRequestThreads = useMemo(
    () =>
      placeThreads(
        pullRequest.data,
        files,
        state.savedView
          ? { kind: "review", target: savedTarget, since: !!state.savedSince }
          : { kind: "changes", review: state.review },
      ),
    [pullRequest.data, state.savedView, state.savedSince, savedTarget, state.review, files],
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

  // A review has versions, each with its comparisons and guide. The guide
  // follows the shown comparison's version.
  const iterations = state.savedReview?.iterations ?? [];
  const shownIteration =
    iterations.findLast(
      (entry) => state.savedTargetId && entry.targetIds.includes(state.savedTargetId),
    )?.number ?? iterations.at(-1)?.number;
  // The Pull request tab: the review's pull request on GitHub.
  const livePullUrl = state.savedReview?.pullRequestUrl;
  const hasPullTab = !!livePullUrl;
  const showLivePull = hasPullTab;
  /** Increases to make the live view read GitHub now. */
  const [pullRefreshes, setPullRefreshes] = useState(0);
  const loadLivePull = useCallback(
    (refresh: boolean) => controller.loadLivePullRequest(refresh),
    [controller],
  );
  const loadCheckLog = useCallback((job: number) => controller.loadCheckLog(job), [controller]);
  // The Guide: the agent's segments over the saved comparison, and the range's
  // commits, to review one part at a time. A version without a guide keeps
  // the one before it.
  const guideSource = shownIteration
    ? iterations.findLast((entry) => entry.number <= shownIteration && entry.guide)
    : undefined;
  const savedGuide = !state.savedReview
    ? undefined
    : shownIteration
      ? guideSource?.guide
      : state.savedReview.guide;
  const guideTarget = savedTarget;
  const guideCommits = guideTarget?.commits ?? NO_COMMITS;
  // The review output of the shown version (docs/PRACTICES.md): its proof,
  // findings, and explainer, read from its own guide only, since an earlier
  // version's proof is not this version's.
  const ownGuideSummary =
    shownIteration === undefined || guideSource?.number === shownIteration
      ? savedGuide?.summary
      : undefined;
  const reviewOutput = useMemo(() => readReviewOutput([ownGuideSummary]), [ownGuideSummary]);
  const openFindings = reviewOutput.findings.filter(isOpenFinding).length;
  // A later version of a thread shows what changed since the reader's last review.
  const capturedVersions = iterations.filter((entry) => entry.targetIds.length);
  const laterVersion =
    shownIteration !== undefined &&
    capturedVersions.some((entry) => entry.number === shownIteration) &&
    capturedVersions.some((entry) => entry.number < shownIteration);
  const overviewParts =
    !!savedGuide ||
    !!reviewOutput.proof ||
    reviewOutput.findings.length > 0 ||
    !!reviewOutput.counts;
  const hasGuide = !!state.savedReview && (overviewParts || laterVersion);
  // Segments refer to the saved comparison's files. They stay while a commit
  // of the range shows in their place.
  const [guideFiles, setGuideFiles] = useState<{
    target: string | null;
    files: ParsedReviewFile[];
    root?: string;
  }>({ target: null, files: NO_FILES });
  if (
    state.savedView &&
    !state.savedSince &&
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
  // A commit of the saved range, picked in the Review's file sidebar, shows
  // with the version's comments and its message.
  const shownCommit = state.comparison.kind === "commit" ? state.comparison.commit : null;
  const commitIndex =
    state.inReview && !state.savedView && shownCommit
      ? guideCommits.findIndex((commit) => commit.id === shownCommit)
      : -1;
  const rangeCommit = commitIndex >= 0 ? guideCommits[commitIndex] : undefined;
  const guideTab = hasGuide && fileState.active === "guide";
  // A segment shows the saved comparison; Since shows it as only what changed
  // since an earlier version.
  const guideDiff =
    guideTab &&
    ((!!guideSection && state.savedView && !state.savedSince) ||
      (guideScope.kind === "since" && state.savedView && !!state.savedSince));
  const guideOverview = guideTab && !guideDiff;
  // What changed since the reader's last review: the host compares the
  // captures, and answers again when a comment, or opening a version, moves
  // the basis.
  const sinceKey =
    laterVersion && state.savedReview
      ? `${state.savedReview.id} ${shownIteration} ${state.savedReview.revision} ${(state.savedReview.readVersions ?? []).join(",")}`
      : null;
  const sinceScope = `${state.savedReview?.id} ${shownIteration}`;
  const [since, setSince] = useState<{ scope: string; value: Since | null } | null>(null);
  useEffect(() => {
    if (!sinceKey || shownIteration === undefined) return;
    let live = true;
    controller.loadSince(shownIteration).then(
      (value) => live && setSince({ scope: sinceScope, value }),
      () => live && setSince({ scope: sinceScope, value: null }),
    );
    return () => {
      live = false;
    };
  }, [controller, sinceKey, sinceScope, shownIteration]);
  // While a new answer loads, the last one for this version stays.
  const shownSince = sinceKey && since?.scope === sinceScope ? since.value : null;
  const sinceFrom = shownSince?.from;
  // The rail's Since row: the shown comparison's files, and the new commits.
  const sinceRow = useMemo(
    () =>
      shownSince && guideTarget
        ? {
            from: shownSince.from,
            files: shownSince.files.filter(
              (file) => file.target === guideTarget.id && file.change !== "gone",
            ).length,
            commits: new Set(shownSince.commits),
          }
        : undefined,
    [shownSince, guideTarget],
  );
  if (guideScope.kind === "since" && !laterVersion) setGuideScope({ kind: "overview" });
  // The pages are Review · Changes · Commit, or Pull request in Commit's
  // place once the branch has one. Review is what the agent handed off: a
  // saved version, with its Guide. Changes are the checkout's live diff. The
  // pane's "changes" view shows either diff, and "guide" is Review's.
  const reviewAvailable = !!state.savedReview && hasReview(state.savedReview);
  const reviewPages = useMemo<ReviewPage[]>(
    () => [
      ...(reviewAvailable ? [{ value: "review", label: "Review", icon: "guide" as const }] : []),
      { value: "changes", label: "Changes", icon: "diff" },
      ...(commitApi && !livePullUrl
        ? [{ value: "commit", label: "Commit", icon: "git" as const }]
        : []),
      ...(hasPullTab
        ? [{ value: "pull", label: "Pull request", icon: "pullRequest" as const }]
        : []),
      // The files of what the workspace shows: a screen of its own, with its
      // tree and its tabs, apart from the review's pages.
      ...(browseSource ? [{ value: "files", label: "Files", icon: "folder" as const }] : []),
    ],
    [reviewAvailable, commitApi, livePullUrl, hasPullTab, browseSource],
  );
  const reviewShown =
    reviewAvailable &&
    (fileState.active === "guide" || (fileState.active === "changes" && state.inReview));
  const shownTab = reviewShown
    ? "review"
    : fileState.active === "guide"
      ? "changes"
      : fileState.active;
  // The Files page: an open file, Search, or the page with no file open.
  const filesPage =
    fileState.active === "files" || fileState.active === "search" || isFileTab(fileState.active);
  // The diff stream shows in Review and Changes, and in the Guide for a segment or commit.
  const streamShown = fileState.active === "changes" || guideDiff;
  // Each page has its own sidebar. Changes (and a Review without a guide)
  // lists the changed files, with what the diff compares at its top.
  const changesRail = fileState.active === "changes" && gitAvailable;
  // Review's sidebar is its guide. Each page keeps whether its sidebar shows:
  // "auto" shows it in a review with room for it; the reader's choice holds
  // in any width, so a review at the edge of the breakpoint stays as chosen.
  const guideRail = guideTab;
  // The Files page's sidebar is the tree of the files.
  const filesRail = filesPage && !!browseSource;
  const railSetting = guideRail
    ? viewSettings.guideSidebar
    : filesRail
      ? viewSettings.filesSidebar
      : viewSettings.changesSidebar;
  const railChoice = useViewSetting(railSetting);
  // The session's side panel shows where its pane has room (SessionPanel.tsx).
  const sessionPanelChoice = useViewSetting(viewSettings.sessionPanel);
  const followUpChoice = useViewSetting(viewSettings.followUp);
  const [sessionSideRoom, setSessionSideRoom] = useState(false);
  const railRoom = guideRail ? guideRoomy : roomy;
  const railOpen = railChoice === "open" || (railChoice === "auto" && railRoom);
  const railShown = changesRail && railOpen;
  const guideRailShown = guideRail && railOpen;
  const filesRailShown = filesRail && railOpen;
  const toggleRail = useCallback(
    () => railSetting.set(railOpen ? "closed" : "open"),
    [railSetting, railOpen],
  );
  const railLabel = `${railOpen ? "Hide" : "Show"} ${guideRail ? "the guide" : filesRail ? "the files" : "changed files"}`;
  // The rail's own icon: what it lists, not a sidebar.
  const railIcon: IconName = guideRail ? "guide" : filesRail ? "folder" : "fileTree";
  // ⌘B shows or hides the window's thread list; alone, the page's sidebar.
  const toggleReviewSidebar = shell?.toggleSidebar ?? toggleRail;
  const sidebarShown = railShown || guideRailShown || filesRailShown;
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
  // The reader looked at the version on screen: the next version's "since"
  // starts here.
  const lookedIteration =
    state.status === "ready" && state.savedReview && (state.savedView || state.inReview)
      ? shownIteration
      : undefined;
  useEffect(() => {
    if (lookedIteration !== undefined) controller.markRead(lookedIteration).catch(() => {});
  }, [controller, lookedIteration]);
  const guideFilesById = useMemo(
    () => new Map(shownGuideFiles.map((file) => [file.id, file])),
    [shownGuideFiles],
  );
  // The Overview's line: where the change is, and how many files. Line counts
  // and hashes show only in a file's own header.
  const guideMeta = useMemo(() => {
    if (!guideTarget) return "";
    return [
      guideTarget.branch ?? guideTarget.repo.split("/").at(-1),
      guideTarget.captured
        ? guideTarget.label
        : guideTarget.names
          ? comparisonLabel(guideTarget.comparison, guideTarget.names).long
          : undefined,
      shownGuideFiles.length
        ? `${shownGuideFiles.length} ${shownGuideFiles.length === 1 ? "file" : "files"}`
        : undefined,
    ]
      .filter(Boolean)
      .join(" · ");
  }, [guideTarget, shownGuideFiles]);
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
  // A file to show once its segment's stream mounts.
  const [pendingGuideFile, setPendingGuideFile] = useState<string | null>(null);
  const openGuide = useCallback(
    (scope: GuideScope, fileId?: string) => {
      const snapshot = controller.getSnapshot();
      setGuideScope(scope);
      setSelection(null);
      fileWorkspace.select("guide");
      setPendingGuideFile(fileId ?? null);
      if (scope.kind === "since") {
        if (sinceFrom) void controller.showSince(sinceFrom);
        return;
      }
      if (!snapshot.savedView || snapshot.savedSince) void controller.showReview();
      // The file chosen in the rail opens, if it was folded.
      if (fileId)
        setCollapsed((current) => {
          if (!current.has(fileId)) return current;
          const next = new Set(current);
          next.delete(fileId);
          return next;
        });
    },
    [controller, fileWorkspace, sinceFrom],
  );
  // Since follows its basis: a new answer, such as after a comment, or another version.
  useEffect(() => {
    if (guideTab && guideScope.kind === "since" && sinceFrom && state.savedSince !== sinceFrom)
      void controller.showSince(sinceFrom);
  }, [controller, guideTab, guideScope.kind, sinceFrom, state.savedSince]);
  // A later hand-off opens on what is new since the reader last looked, once
  // for each hand-off; the Overview stays a click away in the rail.
  const freshKey =
    guideTab && guideScope.kind === "overview" && sinceRow?.files && state.savedReview
      ? `${state.savedReview.id} ${shownIteration}`
      : null;
  const openedFresh = useRef<string | null>(null);
  useEffect(() => {
    if (!freshKey || openedFresh.current === freshKey) return;
    openedFresh.current = freshKey;
    openGuide({ kind: "since" });
  }, [freshKey, openGuide]);
  // j and k step through the segments.
  const stepGuide = useCallback(
    (delta: number) => {
      const order: GuideScope[] = [
        { kind: "overview" },
        ...(sinceFrom ? [{ kind: "since" as const }] : []),
        ...guideSections.map((section) => ({ kind: "segment" as const, key: section.key })),
      ];
      const index = order.findIndex(
        (scope) => JSON.stringify(scope) === JSON.stringify(guideScope),
      );
      const next = order[Math.max(0, Math.min(order.length - 1, index + delta))];
      if (next && index + delta >= 0 && JSON.stringify(next) !== JSON.stringify(guideScope))
        openGuide(next);
    },
    [guideScope, guideSections, openGuide, sinceFrom],
  );
  const streamRef = useRef<HTMLDivElement>(null);
  // A file chosen in the rail shows once its segment's stream has mounted.
  useEffect(() => {
    // `path:` names a file of a diff that has not loaded yet, as in Since.
    const id = pendingGuideFile?.startsWith("path:")
      ? streamFiles.find((file) => `path:${file.path}` === pendingGuideFile)?.id
      : pendingGuideFile;
    if (!id || !guideDiff || !streamFiles.some((file) => file.id === id)) return;
    const frame = requestAnimationFrame(() => {
      setPendingGuideFile(null);
      viewer.current?.scrollTo({ type: "item", id, align: "start" });
    });
    return () => cancelAnimationFrame(frame);
  }, [pendingGuideFile, guideDiff, streamFiles]);
  // Keep the pull request mounted once shown, so its scroll position survives tab changes.
  const [pullMounted, setPullMounted] = useState(false);
  if (fileState.active === "pull" && !pullMounted) setPullMounted(true);
  // The Commit tab also stays mounted once shown, with its message and place.
  const [commitMounted, setCommitMounted] = useState(false);
  if (fileState.active === "commit" && commitApi && !commitMounted) setCommitMounted(true);
  // A closed file gives the screen back only to a tab that the row still shows.
  useLayoutEffect(
    () =>
      fileWorkspace.setAvailable((id) =>
        id === "guide"
          ? hasGuide
          : id === "pull"
            ? hasPullTab
            : id === "commit"
              ? !!commitApi
              : true,
      ),
    [fileWorkspace, hasGuide, hasPullTab, commitApi],
  );
  // The tab row in order, for Alt+number and ⌘⇧[ / ⌘⇧]; empty when the row is hidden.
  // Keys read the store at event time, so a quick second key sees the first one's tab.
  const tabRow = useCallback(() => {
    if (!browseSource && !hasPullTab && !reviewAvailable)
      return { order: [] as string[], active: "" };
    const { tabs, active, search } = fileWorkspace.getSnapshot();
    const inReview =
      reviewAvailable &&
      (active === "guide" || (active === "changes" && controller.getSnapshot().inReview));
    return {
      order: [
        ...(reviewAvailable ? ["review"] : []),
        ...(hasPullTab ? ["pull"] : []),
        "changes",
        ...(commitApi ? ["commit"] : []),
        ...(search !== undefined ? ["search"] : []),
        ...tabs.map((tab) => tab.id),
        // The Files page with no file open.
        ...(active === "files" ? ["files"] : []),
      ],
      active: inReview ? "review" : active === "guide" ? "changes" : active,
    };
  }, [browseSource, hasPullTab, reviewAvailable, commitApi, fileWorkspace, controller]);
  /** Shows a tab of the row: Review (its Guide, or its saved diff), Changes
   * (the checkout's live diff), Notes, Commit, or a file. */
  const showTab = useCallback(
    (id: string) => {
      pendingTab.current = null;
      if (!reviewVisible) showPane("review");
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
      if (id === "files") {
        // The Files page shows the file that showed last, else its tree.
        const { tabs, recent, search, active } = fileWorkspace.getSnapshot();
        if (active === "files" || active === "search" || isFileTab(active)) return;
        const last = recent.find(
          (each) =>
            (each === "search" && search !== undefined) || tabs.some((tab) => tab.id === each),
        );
        fileWorkspace.select(last ?? tabs.at(-1)?.id ?? "files");
        return;
      }
      fileWorkspace.select(id);
    },
    [hasGuide, openGuide, guideScope, fileWorkspace, controller, reviewVisible, showPane],
  );
  // Back and Forward (navigation.ts): the entry on screen holds the page or
  // file and the review that this workspace shows, and an entry that Back
  // or Forward reaches shows them again, with no step of its own.
  const inView = useWorkspaceInView();
  const entryReview = entry?.kind === "thread" ? entry.reviewId : undefined;
  const restoring = useRef<{ screen: Screen; until: number } | null>(null);
  const showScreen = useRef<(screen: Screen) => void>(() => {});
  useEffect(() => {
    showScreen.current = (screen) => {
      if (workspace && entry?.kind === "thread" && screen.review && screen.review !== entryReview)
        workspace.update(workspace.id, { reviewId: screen.review });
      const tab = screen.tab;
      const known =
        tab && (PAGES.has(tab) || fileWorkspace.getSnapshot().tabs.some((each) => each.id === tab));
      if (known && tab !== tabRow().active) showTab(tab);
    };
  });
  useEffect(() => {
    if (!inView || !workspaceId) return;
    const follow = () => {
      settle();
      const screen = screenOf(history.state);
      if (!screen || screen.workspace !== workspaceId) return;
      // A workspace that opens now chooses its page when its view is ready
      // (`reviewOpened`), which takes this one instead.
      restoring.current = { screen, until: Date.now() + 10_000 };
      showScreen.current(screen);
    };
    // An entry that Back reached while another workspace showed.
    follow();
    addEventListener("popstate", follow);
    return () => removeEventListener("popstate", follow);
  }, [inView, workspaceId]);
  useEffect(() => {
    if (!inView || !workspaceId) return;
    const screen: Screen = {
      workspace: workspaceId,
      ...(shownTab ? { tab: shownTab } : {}),
      ...(entryReview ? { review: entryReview } : {}),
    };
    // While an entry's screen shows again, the entry keeps it.
    const target = restoring.current;
    if (target && !sameScreen(target.screen, screen) && Date.now() < target.until) return;
    restoring.current = null;
    record(screen);
  }, [inView, workspaceId, shownTab, entryReview]);
  /** The reader shows a tab: a step that Back goes back from. */
  const selectTab = useCallback(
    (id: string) => {
      const active = tabRow().active;
      const onFiles = active === "files" || active === "search" || isFileTab(active);
      if (id !== active && !(id === "files" && onFiles)) step();
      showTab(id);
    },
    [showTab, tabRow],
  );
  // The files' tree is the Files page's sidebar: this shows the page with
  // it, or hides it there.
  const toggleFilesSidebar = useCallback(() => {
    if (filesRailShown) return viewSettings.filesSidebar.set("closed");
    viewSettings.filesSidebar.set("open");
    selectTab("files");
  }, [filesRailShown, selectTab]);
  // A file, or Commit, that opens while the review is hidden shows the
  // review. Review (or its Guide) and Changes take each other's place as a
  // saved review loads, which leaves the thread alone; their pages show it
  // themselves.
  const revealedTab = useRef(fileState.active);
  useEffect(() => {
    if (revealedTab.current === fileState.active) return;
    revealedTab.current = fileState.active;
    if (["review", "changes", "guide"].includes(fileState.active)) return;
    if (!reviewVisible) showPane("review");
  }, [fileState.active, reviewVisible, showPane]);
  /** q: open the Commit tab, or go back to the tab that showed before it,
   * by the rule that a closed tab follows. */
  const toggleCommit = useCallback(() => {
    fileWorkspace.select(
      fileWorkspace.getSnapshot().active === "commit" ? fileWorkspace.previous() : "commit",
    );
  }, [fileWorkspace]);
  // `q` in a file's Vim Normal or Visual mode (FileEditor, use-file-vim),
  // which keeps the key from the handler below: the workspace on screen.
  useEffect(() => {
    if (!commitApi) return;
    const press = () => {
      if (shown() && !visibleElement('[role="dialog"]')) toggleCommit();
    };
    window.addEventListener(COMMIT_KEY, press);
    return () => window.removeEventListener(COMMIT_KEY, press);
  }, [commitApi, shown, toggleCommit]);
  const [toast, setToast] = useState<{ id: number; text: string } | null>(null);
  const showToast = useCallback(
    (text: string) => setToast((current) => ({ id: (current?.id ?? 0) + 1, text })),
    [],
  );
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timer);
  }, [toast]);
  const pathActions = useMemo<PathActions>(
    () => ({
      reveal: (target: { repo: string; path: string }) =>
        controller.revealPath(target.repo, target.path),
      notify: (text: string) => showToast(text),
      openIn: {
        links: (repo) => controller.openInLinks(repo),
        open: (target, line, editor) =>
          controller.openInEditor(target.repo, target.path, line, editor),
      },
    }),
    [controller, showToast],
  );
  useEffect(() => {
    if (!hasPullTab && fileState.active === "pull") fileWorkspace.select("changes");
  }, [hasPullTab, fileState.active, fileWorkspace]);
  useEffect(() => {
    if (!hasGuide && fileState.active === "guide") fileWorkspace.select("changes");
  }, [hasGuide, fileState.active, fileWorkspace]);
  // A thread opens on its Review once the agent has handed one off: on its
  // Guide, or on its diff. Before a hand-off, it opens on its Changes. A hand-off that arrives later adds the Review tab
  // and does not move the reader. Tab choices stay until the next open.
  const reviewOpened = useRef<{ controller: ReviewController; review?: string } | null>(null);
  useEffect(() => {
    if (state.status !== "ready") return;
    const opened = reviewOpened.current;
    // Once per review that the workspace opens on; a first hand-off that
    // joins the open workspace (attachSavedReview) keeps the reader's place.
    if (
      opened?.controller === controller &&
      (!opened.review || opened.review === state.savedReview?.id)
    ) {
      if (!opened.review && state.savedReview) opened.review = state.savedReview.id;
      return;
    }
    reviewOpened.current = { controller, review: state.savedReview?.id };
    // Back, Forward, or a restart chose the page.
    const restored = restoring.current;
    if (restored?.screen.tab && Date.now() < restored.until)
      return showScreen.current(restored.screen);
    if (!state.savedReview) return;
    // The controller opens a thread with a hand-off on its Review's diff.
    if (reviewAvailable) fileWorkspace.select(hasGuide ? "guide" : "changes");
    else if (fileState.active === "guide" || fileState.active === "pull")
      fileWorkspace.select("changes");
  }, [
    controller,
    reviewAvailable,
    hasGuide,
    state.savedReview,
    state.status,
    fileState.active,
    fileWorkspace,
  ]);
  useEffect(() => {
    if (fileState.active === "commit" && !commitApi) fileWorkspace.select("changes");
  }, [commitApi, fileState.active, fileWorkspace]);
  // A refresh captures the review again as its next version, for a review
  // whose checkout changed after its capture.
  const [refreshing, setRefreshing] = useState(false);
  const refreshReview = useCallback(() => {
    setRefreshing(true);
    controller
      .refreshReview()
      .then(
        (iteration) => {
          const first = iteration?.targetIds[0];
          if (!iteration || !first) return;
          // The new version's diff shows once it loads.
          pendingSavedChanges.current = first;
          void controller.selectSavedTarget(first);
          showToast("Refreshed the Review.");
        },
        (error: unknown) =>
          showToast(error instanceof Error ? error.message : "The review could not refresh."),
      )
      .finally(() => setRefreshing(false));
  }, [controller, showToast]);
  const [dismissedDrift, setDismissedDrift] = useState<string | null>(null);
  /** Shows a file of the review, or lines of it, as a guide's link names them. */
  const openFileLocation = useCallback(
    (location: { fileId: string; start?: number; end?: number; side?: "old" | "new" }) => {
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
  /** Shows one of the review's comments at its line in Changes, from the
   * session's message box. */
  const openComment = useCallback(
    (id: string) => {
      const note = notes.find((entry) => entry.id === id);
      const snapshot = controller.getSnapshot();
      const file = note && snapshot.files.find((entry) => entry.path === note.path);
      if (!note || !file) return;
      if (!reviewVisible) showPane("review");
      if (!snapshot.visibleFiles.some((entry) => entry.id === file.id)) controller.setFilter("");
      const line = noteLine(file.metadata, note);
      revealLine(file.id, line, line, note.side === "old" ? "deletions" : "additions");
    },
    [notes, controller, reviewVisible, showPane, revealLine],
  );
  // All comments, in the review's header: the diff's and the files'.
  const savedFileComments = state.fileComments;
  const draftIds = inboxState?.drafts;
  const commentReads = useCommentReads();
  const listedComments = useMemo(
    () =>
      listComments(
        notes,
        savedFileComments ?? [],
        new Set(draftIds?.map((draft) => draft.id) ?? []),
        commentReads,
      ),
    [notes, savedFileComments, draftIds, commentReads],
  );
  const openListedComment = useCallback(
    (comment: ListedComment) => {
      // Opening a comment reads its answer.
      markCommentsRead([comment]);
      if (comment.kind === "diff") openComment(comment.id);
      else openFromPane(comment.path, comment.line);
    },
    [openComment, openFromPane],
  );
  /** Shows a GitHub thread at its line, from the Pull request tab. */
  const showPullThread = useCallback(
    (thread: PullRequestThread) => {
      const file = files.find((entry) => entry.path === thread.path);
      if (file && thread.line !== null)
        openFileLocation({
          fileId: file.id,
          side: thread.side,
          start: thread.line,
          end: thread.line,
        });
    },
    [files, openFileLocation],
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
  // that no hunk shows goes to its segment's header instead. Since keeps the
  // version's new lines; on a commit of the range, the host places them.
  const guideLineNotes = useMemo(
    () =>
      resolvedGuide
        ? [...resolvedGuide.notesByFile.values()].flat().filter((note) => note.line !== undefined)
        : NO_GUIDE_NOTES,
    [resolvedGuide],
  );
  const lensReview = rangeCommit && state.status === "ready" ? state.review : null;
  const [placedGuide, setPlacedGuide] = useState<{
    review: string;
    byPath: Map<string, GuideNote[]>;
  } | null>(null);
  useEffect(() => {
    const review = lensReview;
    const onCommit = review
      ? guideLineNotes.filter((note) => review.files.some((file) => file.path === note.path))
      : [];
    if (!review || !onCommit.length) return;
    let live = true;
    controller
      .placeLines(
        onCommit.map((note) => ({
          path: note.path,
          side: note.side,
          line: note.line!,
          ...(note.endLine ? { endLine: note.endLine } : {}),
        })),
      )
      .then(
        (spots) => {
          if (!live) return;
          const byPath = new Map<string, GuideNote[]>();
          onCommit.forEach((note, index) => {
            const spot = spots[index];
            if (spot)
              byPath.set(note.path, [
                ...(byPath.get(note.path) ?? []),
                { ...note, line: spot.line, endLine: spot.endLine },
              ]);
          });
          setPlacedGuide({ review: review.id, byPath });
        },
        () => {},
      );
    return () => {
      live = false;
    };
  }, [controller, lensReview, guideLineNotes]);
  const guideNotesByFile = useMemo(() => {
    if (state.savedView && !state.savedSince) return resolvedGuide?.notesByFile;
    let byPath: Map<string, GuideNote[]> | undefined;
    if (state.savedSince) {
      byPath = new Map();
      for (const note of guideLineNotes)
        if (note.side === "new") byPath.set(note.path, [...(byPath.get(note.path) ?? []), note]);
    } else if (placedGuide && placedGuide.review === lensReview?.id) byPath = placedGuide.byPath;
    if (!byPath) return undefined;
    return new Map(
      state.files.map((file) => [
        file.id,
        (byPath.get(file.path) ?? []).map((note) => ({ ...note, fileId: file.id })),
      ]),
    );
  }, [
    state.savedView,
    state.savedSince,
    state.files,
    resolvedGuide,
    guideLineNotes,
    placedGuide,
    lensReview?.id,
  ]);
  const items = useMemo<CodeViewItem<Annotation>[]>(() => {
    return streamFiles.flatMap((file) => {
      if (!file.metadata || mediaType(file.path)?.kind === "image") return [];
      const guideNotes = (guideNotesByFile?.get(file.id) ?? [])
        .filter(onLines)
        .filter((note) => shownLine(file.metadata, note));
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
            // The agent's comments come before the reader's: a note can answer
            // one, and then shows in its card (GuideThread).
            ...guideNotes.map((note): DiffLineAnnotation<Annotation> => ({
              side: note.side === "old" ? "deletions" : "additions",
              lineNumber: noteLine(file.metadata, note),
              metadata: { guide: note },
            })),
            ...notes
              .filter(
                (note) =>
                  note.path === file.path &&
                  !note.parentId &&
                  note.resolution !== "orphaned" &&
                  note.resolution !== "stale" &&
                  !guideNotes.some((guide) => answersGuideNote(note, guide)),
              )
              .map((note): DiffLineAnnotation<Annotation> => ({
                side: note.side === "old" ? "deletions" : "additions",
                lineNumber: noteLine(file.metadata, note),
                metadata: { note },
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

  // A name in the diff that the pointer rests on shows its definition, read
  // at the side's version: the base commit for deletions, the head commit or
  // the working tree for additions. A place in the diff names the file and
  // the side's version, then the name's line and column.
  const diffHoverReview = state.review;
  const diffHoverSource = useMemo<SymbolHoverSource | undefined>(() => {
    const review = diffHoverReview;
    const hover = browseApi.hover;
    if (!review || !hover || state.session?.repository.git === false) return undefined;
    const placeOf = (at: string) => JSON.parse(at) as [BrowseSource, string, number, number];
    return {
      key: JSON.stringify(["diff", review.id, review.base, review.head]),
      load(name, signal, at) {
        const [source, path] = placeOf(at);
        return hover(source, path, "", name, signal);
      },
      scopeOf: (at) => JSON.stringify(placeOf(at).slice(0, 2)),
      open: openDefinition,
    };
  }, [diffHoverReview, browseApi, state.session?.repository.git, openDefinition]);
  const diffHover = useSymbolHover(diffHoverSource);
  const { enter: diffHoverEnter, leave: diffHoverLeave } = diffHover;
  const diffHovering = !!diffHoverSource;
  const options = useMemo<CodeViewReactOptions<Annotation, undefined>>(
    () => ({
      theme: activeTheme.pierreTheme,
      preferredHighlighter: HIGHLIGHTER,
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
      ...(diffHovering
        ? {
            // CodeView hands the token callbacks to each diff itself, so the
            // diffs mark their tokens only when asked.
            useTokenTransformer: true,
            onTokenEnter(token: DiffTokenEvent, _event: PointerEvent, context: { type: string }) {
              const review = controller.getSnapshot().review;
              const name = hoverName(token.tokenText);
              if (
                !name ||
                !review ||
                !token.side ||
                context.type !== "diff" ||
                !("item" in context)
              )
                return diffHoverLeave();
              const file = (context as { item: { fileDiff: FileDiffMetadata } }).item.fileDiff;
              const old = token.side === "deletions";
              const oid = old ? review.base : review.head;
              const commit = FULL_OID.test(oid);
              if (old && !commit) return diffHoverLeave();
              const source: BrowseSource = commit
                ? { kind: "commit", repo: review.repo, oid }
                : { kind: "worktree", repo: review.repo };
              const path = old ? (file.prevName ?? file.name) : file.name;
              diffHoverEnter(
                JSON.stringify([source, path, token.lineNumber, token.lineCharStart]),
                name,
                () => token.tokenElement.getBoundingClientRect(),
              );
            },
            onTokenLeave() {
              diffHoverLeave();
            },
          }
        : {}),
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
      },
    }),
    [
      controller,
      theme,
      activeTheme,
      mode,
      wrap,
      reviewId,
      diagnostics,
      draft,
      findHighlights,
      diffHovering,
      diffHoverEnter,
      diffHoverLeave,
    ],
  );

  // Find in the diff: each line that matches, in the order the diff reads.
  // A line that both sides have counts once, on the new side.
  const findMatcher = useMemo(() => findPattern(find, findOptions), [find, findOptions]);
  const hitsOf = useCallback(
    (matcher: ReturnType<typeof findPattern>) => {
      if (!(matcher instanceof RegExp)) return [];
      const result: {
        id: string;
        side: "additions" | "deletions";
        line: number;
      }[] = [];
      const pattern = new RegExp(matcher.source, matcher.flags);
      const matches = (text: string | undefined) => {
        pattern.lastIndex = 0;
        return !!text && [...text.matchAll(pattern)].some((match) => match[0].length > 0);
      };
      for (const file of streamFiles) {
        const metadata = file.metadata;
        if (!metadata) continue;
        for (const hunk of metadata.hunks) {
          const lines = (side: "additions" | "deletions", index: number, count: number) => {
            const source = side === "additions" ? metadata.additionLines : metadata.deletionLines;
            const first = side === "additions" ? hunk.additionLineIndex : hunk.deletionLineIndex;
            const start = side === "additions" ? hunk.additionStart : hunk.deletionStart;
            for (let at = index; at < index + count && result.length < 1000; at++)
              if (matches(source[at])) result.push({ id: file.id, side, line: start + at - first });
          };
          for (const block of hunk.hunkContent) {
            if (block.type === "context") lines("additions", block.additionLineIndex, block.lines);
            else {
              lines("deletions", block.deletionLineIndex, block.deletions);
              lines("additions", block.additionLineIndex, block.additions);
            }
          }
        }
      }
      return result;
    },
    [streamFiles],
  );
  const hits = useMemo(() => hitsOf(findMatcher), [hitsOf, findMatcher]);
  useEffect(() => {
    const hit = findOpen ? hits[findIndex] : undefined;
    const path = hit && streamFiles.find((file) => file.id === hit.id)?.path;
    findHighlights.set(
      findOpen ? find : "",
      hit && path ? { path, side: hit.side, line: hit.line } : null,
      findOptions,
    );
  }, [findHighlights, findOpen, find, findOptions, hits, findIndex, streamFiles]);
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
  /** The next match, or the previous one; before any, the first or the last. */
  const stepHit = useCallback(
    (direction: 1 | -1) =>
      jumpHit(findIndex < 0 ? (direction > 0 ? 0 : -1) : findIndex + direction),
    [jumpHit, findIndex],
  );
  /** A new query or option: the diff goes to its first match, as typing in a
   * find bar does. */
  const findAgain = (query: string, options: FindOptions) => {
    setFind(query);
    setFindOptions(options);
    const first = hitsOf(findPattern(query, options))[0];
    setFindIndex(first ? 0 : -1);
    if (first) revealLine(first.id, first.line, first.line, first.side);
  };
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
  // Comments on the open file's lines go to the thread's agent as the
  // review's comments do: they wait in the message box until sent, and the
  // agent answers and resolves them in their threads (FileComments.tsx).
  const threadFileComments = state.fileComments;
  const activeFileSource = activeFile?.source;
  const activeFilePath = activeFile?.path;
  const fileComments = useMemo<FileComments | undefined>(() => {
    if (!threadId || activeFilePath === undefined || !activeFileSource) return undefined;
    if (activeFileSource.kind === "vault") return undefined;
    const source = activeFileSource;
    const same = (other: BrowseSource) =>
      other.kind === source.kind &&
      other.repo === source.repo &&
      (other.kind !== "commit" || (source.kind === "commit" && other.oid === source.oid));
    const send = async (id: string) => {
      if (!leadSession) throw new Error("This thread has no agent to send to.");
      await sendAgentMessage({
        id: crypto.randomUUID(),
        text: "",
        noteIds: [id],
        attachments: [],
        images: [],
      });
    };
    return {
      threads: threadFileComments.filter(
        (comment) => comment.path === activeFilePath && same(comment.source),
      ),
      unsent: new Set(inboxState?.drafts.map((draft) => draft.id) ?? []),
      agent: commentAgent ? { name: commentAgent.name, mark: commentAgent.mark } : null,
      async add(lines, text, how) {
        const before = new Set(controller.getSnapshot().fileComments.map((comment) => comment.id));
        const next = await controller.commentFile({
          add: { source, path: activeFilePath, ...lines, text },
        });
        const added = next.find((comment) => !before.has(comment.id));
        if (how !== "send" || !added) return;
        // A send that fails leaves the comment saved, with its Send button.
        await send(added.id).catch((error: unknown) =>
          setContextError(
            `The comment is saved, but did not reach ${commentAgent?.name ?? "the agent"}: ${
              error instanceof Error ? error.message : "the send failed"
            }.`,
          ),
        );
      },
      async mutate(mutation) {
        await controller.commentFile(mutation);
      },
      send,
    };
  }, [
    threadId,
    threadFileComments,
    activeFileSource,
    activeFilePath,
    leadSession,
    sendAgentMessage,
    inboxState,
    commentAgent,
    controller,
  ]);
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
      // 1, 2, and 3 show the pages, also while a file shows; in the session,
      // a number answers the agent's question.
      const pageAt = /^[1-9]$/.test(event.key) ? reviewPages[Number(event.key) - 1] : undefined;
      if (
        pageAt &&
        !editing &&
        !modal &&
        !visibleElement('[role="dialog"]') &&
        !(
          event.target instanceof Element &&
          event.target.closest('[data-file-pane="main"][tabindex="0"], [data-session-panel]')
        ) &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey
      ) {
        event.preventDefault();
        event.stopPropagation();
        if (!event.repeat) selectTab(pageAt.value);
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
          return;
        }
      }
      // ⌘⌥⇧B shows or hides the session rail where the pane has room for it.
      if (
        (event.metaKey || event.ctrlKey) &&
        event.altKey &&
        event.shiftKey &&
        event.code === "KeyB"
      ) {
        const toggle = visibleElement("[data-session-panel] [data-session-rail-toggle]");
        if (!toggle) return;
        event.preventDefault();
        event.stopPropagation();
        if (!event.repeat) toggle.click();
        return;
      }
      if (
        (event.metaKey || event.ctrlKey) &&
        event.altKey &&
        !event.shiftKey &&
        event.code === "KeyB" &&
        (changesRail || guideRail || filesRail)
      ) {
        // ⌘⌥B shows or hides the review's rail, the nested sidebar.
        event.preventDefault();
        event.stopPropagation();
        if (!event.repeat) toggleRail();
        return;
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
      // ⌘O opens a repository, and ⌘⇧O the symbols of the file, or of the
      // project with no file open; the browser never opens its own file dialog.
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "o") {
        if (event.shiftKey ? !browseSource : !gitAvailable) return;
        event.preventDefault();
        event.stopPropagation();
        if (event.repeat) return;
        if (event.shiftKey)
          openSymbols(activeFile && fileState.file?.kind === "text" ? "file" : "project");
        else {
          setCommandsOpen(false);
          setBranchPickerNew(false);
          setBranchPickerRepos(true);
          setBranchPickerOpen(true);
        }
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
        event.preventDefault();
        event.stopPropagation();
        if (event.repeat) return;
        // Find file says why it can't, rather than do nothing.
        if (event.shiftKey && !browseSource) return showToast(cannotBrowse);
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
        setBranchPickerRepos(false);
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
      // The Guide: j and k step through its parts.
      if (guideTab && (event.key === "j" || event.key === "k")) {
        event.preventDefault();
        event.stopPropagation();
        stepGuide(event.key === "j" ? 1 : -1);
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
        stepHit(1);
      } else if (event.key === "N" && find) {
        event.preventDefault();
        event.stopPropagation();
        stepHit(-1);
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
    stepHit,
    selection,
    startNote,
    toggleReviewSidebar,
    toggleSession,
    state.savedReview,
    browseSource,
    cannotBrowse,
    showToast,
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
    reviewPages,
    tabRow,
    selectTab,
    streamShown,
    guideTab,
    guideDiff,
    stepGuide,
    shown,
    changesRail,
    guideRail,
    filesRail,
    toggleRail,
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
  const openBranchPicker = (newWorkspace: boolean, repositoriesFirst = false) => {
    setBranchPickerNew(newWorkspace);
    setBranchPickerRepos(repositoriesFirst);
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
    // A thread shows the branch itself: its Changes, files and search are
    // that branch's. Med reads it; the agent's checkout is not touched.
    if (threadId && !newWorkspace) {
      entry.run();
      // Its Changes, not the tab that the checkout had in front last.
      pendingTab.current = "changes";
      fileWorkspace.select("changes");
      if (!reviewVisible) showPane("review");
      return;
    }
    const existing = workspace.match(target);
    if (existing && existing !== workspace.id) workspace.activate(existing);
    else if (!existing && newWorkspace) workspace.open(target);
    else if (!existing) entry.run();
  };
  // A branch that a reply names in code is a link that shows it here, as
  // the branch picker does; ⌘-click opens it beside.
  const shownRepository = state.activeRepositoryId;
  const namedBranches = branches.entries.filter(
    (entry) => entry.branch && (!shownRepository || entry.repositoryId === shownRepository),
  );
  const openNamedBranch = useRef<(name: string, background: boolean) => void>(() => {});
  useEffect(() => {
    openNamedBranch.current = (name, background) => {
      const entry = namedBranches.find((each) => each.branch === name);
      if (entry) openBranch(entry, background);
    };
  });
  // By the names alone, so that a refresh of the branches' heads does not
  // link every reply again.
  const branchNames = [...new Set(namedBranches.map((entry) => entry.branch!))].sort().join("\n");
  const sessionRefs = useMemo<FileRefs>(
    () =>
      branchNames
        ? {
            ...fileRefs,
            branches: {
              names: new Set(branchNames.split("\n")),
              open: (name, background) => openNamedBranch.current(name, background),
            },
          }
        : fileRefs,
    [fileRefs, branchNames],
  );
  // The workspace list names each workspace and shows its changed-file count.
  const reportTo = workspace?.update;
  const reportTitle =
    threadName ?? state.savedReview?.title ?? branches.current?.label ?? state.activeBranch;
  const reportPath = state.session?.repository.path;
  // A linked worktree, so closing the workspace can remove it.
  const reportWorktree = state.session?.worktrees.find((entry) => entry.path === reportPath)?.linked
    ? reportPath
    : undefined;
  // The repository of the checkout that the thread shows.
  const shownPath = state.session?.repository.path;
  const shownFamily = shownPath
    ? state.repositories.find(
        (repository) =>
          repository.path === shownPath ||
          repository.worktrees.some((tree) => tree.path === shownPath),
      )
    : undefined;
  const reportRepository = state.session?.repository.name;
  const reportReady = state.status === "ready";
  const reportCount = state.files.length;
  // A thread's place is its session's, as the thread list says, not the
  // checkout that a Review shows: that is what it views, which its band names.
  const reportPlace = entry?.kind !== "thread";
  const reportViewing = entry?.kind === "thread";
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
        viewingPath: undefined,
        viewingBranch: undefined,
        viewingRepository: undefined,
      });
    reportTo(workspaceId, {
      ...(reportTitle ? { title: reportTitle } : {}),
      ...(reportReady ? { detail: reportCount ? String(reportCount) : undefined } : {}),
      ...(reportPath && { worktree: reportWorktree }),
      ...(reportPath && reportPlace
        ? {
            path: reportPath,
            repository: reportRepository,
            repositoryId: state.activeRepositoryId ?? undefined,
            branch: state.activeBranch ?? undefined,
          }
        : {}),
      ...(reportPath && reportViewing
        ? {
            viewingPath: reportPath,
            viewingBranch: state.activeBranch ?? undefined,
            // A worktree goes by its repository's name, not by its folder's.
            viewingRepository: shownFamily?.name ?? reportRepository,
          }
        : {}),
    });
  }, [
    reportTo,
    workspaceId,
    reportEmpty,
    reportTitle,
    reportPlace,
    reportViewing,
    reportReady,
    reportCount,
    reportPath,
    reportWorktree,
    reportRepository,
    shownFamily?.name,
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
  /** Opens a file of the diff from the workspace's files, which follow the
   * diff on screen. A deleted file opens as it was. Without files, a toast
   * says why. */
  const openDiffFile = useCallback(
    (path: string, background = false) => {
      const review = state.review;
      const file = state.files.find((item) => item.path === path);
      if (review && file?.info.status.startsWith("D") && FULL_OID.test(review.base)) {
        fileWorkspace.open(
          path,
          undefined,
          { kind: "commit", repo: review.repo, oid: review.base },
          `Before · ${review.base.slice(0, 7)}`,
          undefined,
          { background },
        );
        return;
      }
      if (!browseSource) return showToast(cannotBrowse);
      openWorkingFile(path, background);
    },
    [
      state.review,
      state.files,
      browseSource,
      cannotBrowse,
      fileWorkspace,
      openWorkingFile,
      showToast,
    ],
  );
  const openChangedFile = useCallback(
    (id: string, background?: boolean) => {
      const file = files.find((item) => item.id === id);
      if (file) openDiffFile(file.path, background);
    },
    [files, openDiffFile],
  );
  const openVersion = useCallback(
    (path: string, side: "old" | "new") => {
      const review = state.review;
      if (!review) return;
      const file = state.files.find((item) => item.path === path);
      const oid = side === "old" ? review.base : review.head;
      const name = side === "old" ? (file?.info.previousPath ?? path) : path;
      if (FULL_OID.test(oid))
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
  const showReviewDiff = useCallback(() => {
    pendingSavedChanges.current = state.savedTargetId;
    fileWorkspace.select("changes");
    void controller.showReview();
  }, [state.savedTargetId, fileWorkspace, controller]);
  // The commits beside the diff, in the Changes page's sidebar: the
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
    fresh: reviewShown ? sinceRow?.commits : undefined,
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
  const pushable = FULL_OID.test(actionHead);
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
  // reader chose for the checkout where it works; else the review on screen
  // names the base of its own checkout.
  const onOwnCheckout = !!thread?.checkout && thread.checkout === state.session?.repository.path;
  const reviewsChanges = reviewChanges(
    state.repositories,
    changesTarget(state.savedReview, state.savedTargetId),
  );
  const branchBase =
    (state.comparison.kind === "working" ? state.comparison.base : undefined) ??
    changesBase(
      state.repositories.find((entry) => entry.id === state.activeRepositoryId),
      state.activeBranch,
      (onOwnCheckout ? thread.base : undefined) ??
        (reviewsChanges && reviewsChanges.path === state.session?.repository.path
          ? reviewsChanges.base
          : undefined),
    );
  const liveValue =
    state.comparison.kind === "working" && state.comparison.base ? "branch" : state.comparison.kind;
  // Quiet chrome names a live range by the branch at its head.
  const liveText = comparisonLabel(
    state.comparison,
    undefined,
    state.activeBranch ? { name: state.activeBranch, head: liveHead } : undefined,
  );
  // In Review, a hand-off of several checkouts has a menu of them, then the
  // commits that you commented on. It shows no versions: the Review is the
  // latest hand-off, and earlier ones stay only as its snapshots. Git's
  // comparisons are the Changes page's.
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
  const versionHandoffs = handoffs;
  const versionChoices = reviewShown
    ? [
        ...versionHandoffs
          .filter(
            (target) =>
              versionNumber(target) === latestVersion || target.id === state.savedTargetId,
          )
          .map((target) => {
            const time = Date.parse(
              versionOf(target)?.createdAt ?? state.savedReview?.createdAt ?? "",
            );
            return {
              value: target.id,
              label: [
                target.repo.split(/[\\/]/).at(-1)!,
                ...(Number.isFinite(time) ? [relativeTime(time, Math.max(reviewNow, time))] : []),
              ].join(" · "),
              description: placeOf(target),
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
                    : // The range is named here, and only here.
                      state.comparison.kind === "range"
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
  const comparisonText: ComparisonLabel = reviewShown
    ? {
        long: chosenLabel ?? "",
        // A narrow row drops the age.
        short:
          reviewCommit || shownTarget?.commentReviewId
            ? (chosenLabel ?? "")
            : (chosenLabel?.split(" · ")[0] ?? ""),
      }
    : {
        // The branch's changes name the branch and its base.
        long:
          liveValue === "branch" && state.activeBranch && branchBase
            ? `${state.activeBranch} since ${branchBase}${sessionFilter ? " · this session" : ""}`
            : (chosenLabel ?? liveText.long),
        short: `${liveValue === "branch" ? "Branch" : liveText.short}${sessionFilter ? " · session" : ""}`,
      };
  // The review on screen, as its thread lists it: its place and its pull
  // request. The panes show this one of the thread's reviews.
  const siblingReviews = useThreadReviews(threadId);
  const threadReview = siblingReviews.find((review) => review.id === state.savedReview?.id);
  // The host links a pull request that the review's branch opened later
  // (src/host/pull-request-links.ts); the thread list names it first.
  const linkedPullRequest = threadReview?.pullRequest?.url;
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
  // Review from the recap waits for the diff that it opens, then goes to what
  // is new since the reader last looked, or to the Guide's Overview.
  const recapJump = useRef<"guide" | "review" | "changes" | null>(null);
  const openFresh = useCallback(() => {
    openGuide(sinceFrom ? { kind: "since" } : { kind: "overview" });
  }, [openGuide, sinceFrom]);
  const jumpReady = (jump: "guide" | "review" | "changes") => {
    const snapshot = controller.getSnapshot();
    if (snapshot.status !== "ready") return false;
    return jump === "changes" ? !snapshot.savedView && !snapshot.inReview : snapshot.savedView;
  };
  const finishJump = (jump: "guide" | "review" | "changes") => {
    recapJump.current = null;
    if (jump === "guide") openFresh();
    else if (files[0]) reveal(files[0].id);
  };
  useEffect(() => {
    const jump = recapJump.current;
    if (jump && jumpReady(jump)) finishJump(jump);
  });
  const reviewTurn = () => {
    recap.see();
    if (!reviewVisible) showPane("review");
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
  // Add a pull request…: the thread gets one more review, which shows when
  // the host has saved it. Its steps cover the review until then.
  const [addPullOpen, setAddPullOpen] = useState(false);
  // A thread's first review joins the controller that shows its Changes, and
  // the reader stays there (attachSavedReview). This one the reader asked
  // for: its Review shows when the controller has it.
  const reviewToShow = useRef<string | null>(null);
  const addPull = useAddPullRequest((reviewId) => {
    if (workspace && reviewId !== state.savedReview?.id)
      workspace.update(workspace.id, { reviewId });
    revealPane("review");
    if (state.savedReview) selectTab("review");
    else reviewToShow.current = reviewId;
  });
  const attachedReview = state.savedReview?.id;
  useEffect(() => {
    if (!attachedReview || reviewToShow.current !== attachedReview) return;
    reviewToShow.current = null;
    selectTab("review");
  }, [attachedReview, selectTab]);
  const commands: ReviewCommand[] = [
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
      id: "vim-file-comment",
      managesFocus: true,
      label: "Comment on the file's line or selected lines, for the agent",
      shortcut: "gc",
      disabled: !fileComments || fileState.file?.kind !== "text",
      run: () => runFileNavigation("gc"),
    },
    {
      id: "vim-file-hover",
      managesFocus: true,
      label: "Show the definition of the name at the cursor",
      shortcut: "K",
      disabled: !loadHover,
      run: () => runFileNavigation("K"),
    },
    {
      id: "file-symbols",
      managesFocus: true,
      label: "Search symbols in current file",
      shortcut: "⌘ ⇧ O",
      disabled: !activeFile || fileState.file?.kind !== "text",
      run: () => openSymbols("file"),
    },
    {
      id: "project-symbols",
      managesFocus: true,
      label: "Search symbols in project commits",
      disabled: !browseSource,
      run: () => openSymbols("project"),
    },
    {
      id: "vim",
      label: vimEnabled ? "Disable Vim navigation in files" : "Enable Vim navigation in files",
      run: () => setVimEnabled((value) => !value),
    },
    {
      id: "open-repository",
      managesFocus: true,
      label: "Open repository…",
      shortcut: "⌘ O",
      disabled: !gitAvailable,
      run: () => openBranchPicker(false, true),
    },
    {
      id: "pull-requests",
      managesFocus: true,
      label: "Pull requests…",
      disabled: !workspace,
      run: () => workspace?.openPullRequests(),
    },
    // A session's thread takes a pull request as one more of its reviews.
    ...(addPull.add
      ? [
          {
            id: "add-pull-request",
            managesFocus: true,
            label: "Add a pull request…",
            run: () => setAddPullOpen(true),
          },
        ]
      : []),
    {
      id: "open-branch",
      managesFocus: true,
      label: "Open branch or worktree",
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
      disabled: !activeDiffFile || !FULL_OID.test(state.review?.base ?? ""),
      run: () => activeDiffFile && openVersion(activeDiffFile.path, "old"),
    },
    {
      id: "file-after",
      label: "Open after version of current file",
      disabled: !activeDiffFile || !FULL_OID.test(state.review?.head ?? ""),
      run: () => activeDiffFile && openVersion(activeDiffFile.path, "new"),
    },
    {
      id: "next-match",
      label: "Next diff search match",
      shortcut: "n",
      disabled: !find || !!activeFile,
      run: () => stepHit(1),
    },
    {
      id: "previous-match",
      label: "Previous diff search match",
      shortcut: "N",
      disabled: !find || !!activeFile,
      run: () => stepHit(-1),
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
            run: () => {
              showPane("review");
              openGuide({ kind: "overview" });
            },
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
    ...(hasPullTab
      ? [
          {
            id: "pull",
            label: showLivePull ? "Open the pull request" : "Open the pull request draft",
            run: () => fileWorkspace.select("pull"),
          },
        ]
      : []),
    ...(showLivePull
      ? [
          {
            id: "pull-request-refresh",
            label: "Read the pull request again from GitHub",
            run: () => {
              fileWorkspace.select("pull");
              setPullRefreshes((count) => count + 1);
            },
          },
        ]
      : []),
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
            label: filesRailShown ? "Hide files sidebar" : "Show files sidebar",
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
          ...(state.savedReview || hasSessions
            ? [
                {
                  id: "agent-session",
                  label: sessionVisible ? "Hide agent session" : "Show agent session",
                  shortcut: "⌘⇧B",
                  run: toggleSession,
                },
                // The review hides only beside the session.
                ...(sessionVisible || !reviewVisible
                  ? [
                      {
                        id: "review-pane",
                        label: reviewVisible ? "Hide review" : "Show review",
                        run: toggleReview,
                      },
                    ]
                  : []),
                // A lone review takes an agent: the session then holds it.
                ...(hasSessions ? [] : (agentPresets ?? []))
                  .filter((agent) => agent.available)
                  .map((agent) => ({
                    id: `new-session-${agent.id}`,
                    label: `New ${agent.name} session on this review`,
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
                          void continueInMed().catch((error: unknown) =>
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
      // The find box takes the focus, not what had it before the palette.
      managesFocus: true,
      label: "Find in diff contents",
      shortcut: "⌘ F",
      run: () => {
        fileWorkspace.select("changes");
        openFind();
      },
    },
    {
      id: "filter",
      managesFocus: true,
      label: "Filter changed files",
      run: () => {
        // The Changes sidebar's filter: the page and its sidebar show first.
        if (filterRef.current?.offsetParent) return filterRef.current.focus();
        selectTab("changes");
        viewSettings.changesSidebar.set("open");
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
    ...settingsCommands(),
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
    // Without the window's shell, ⌘B is the page's sidebar (⌘⌥B, below).
    ...(shell
      ? [
          {
            id: "sidebar",
            label: shell.sidebarVisible ? "Hide threads" : "Show threads",
            shortcut: "⌘ B",
            run: shell.toggleSidebar,
          },
        ]
      : []),
    ...(comparisonActionsShown
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
            ...(pushBlocked && { hint: pushBlocked }),
            run: openPush,
          },
        ]
      : []),
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
    ...(state.savedReview?.commentCount
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
    ...(changesRail || guideRail || filesRail
      ? [
          {
            id: "changes-rail",
            label: railLabel,
            shortcut: "⌘⌥B",
            run: toggleRail,
          },
        ]
      : []),
    // As the session rail's own button: where the session's pane has room.
    ...(sessionVisible && sessionSideRoom
      ? [
          {
            id: "session-rail",
            label: sessionPanelChoice === "closed" ? "Show session rail" : "Hide session rail",
            shortcut: "⌘⌥⇧B",
            run: () =>
              viewSettings.sessionPanel.set(sessionPanelChoice === "closed" ? "auto" : "closed"),
          },
        ]
      : []),
    ...(sessionVisible
      ? [
          {
            id: "follow-up",
            label:
              followUpChoice === "queue"
                ? "While the agent works, ⌘↩ sends now"
                : "While the agent works, ⌘↩ queues for the turn's end",
            run: () => viewSettings.followUp.set(followUpChoice === "queue" ? "now" : "queue"),
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
      reviewOpened.current?.review !== state.savedReview.id &&
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
                onOpen={() => openDiffFile(file.path)}
              />
            ) : (
              <>
                <Icon name="file" size={13} />
                <button
                  role="link"
                  {...stylex.props(styles.fileLink)}
                  onPointerEnter={() => prefetchFile(file.path)}
                  onFocus={() => prefetchFile(file.path)}
                  onClick={(event) => openDiffFile(file.path, event.metaKey || event.ctrlKey)}
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
    [skipped, reviewId, savedReviewId, savedImages, collapsed, openDiffFile, prefetchFile],
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
  // what the agent did to the generated files (docs/GENERATED.md): the
  // thread's session, else the session that handed off the review.
  const editSession = threadSession ?? state.savedReview?.session;
  const editAgent = editSession?.agent;
  const editSessionId = editSession?.id;
  const transcriptSessions = useMemo(
    () =>
      editSessionId && (editAgent === "claude" || editAgent === "codex")
        ? [{ agent: editAgent, id: editSessionId }]
        : [],
    [editAgent, editSessionId],
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
            onClick={(event) => openDiffFile(path, event.metaKey || event.ctrlKey)}
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
        </div>
      );
    },
    [fileInfoById, collapsed, prefetchFile, openDiffFile, generatedFiles, provenance],
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
    // Pierre also passes the file and the item; Med reads the metadata only.
    (annotation: { metadata?: Annotation }, ..._rest: unknown[]) =>
      annotation.metadata?.draft ? (
        <NoteComposer
          key={JSON.stringify(annotation.metadata.draft)}
          target={annotation.metadata.draft}
          sendable
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
              await addNote(note);
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
        <GuideThread
          note={annotation.metadata.guide}
          agent={guideAgent}
          notes={notes}
          onMutate={mutateNote}
          onOpenLink={openCommentLink}
        />
      ) : annotation.metadata?.note ? (
        <NoteCard
          note={annotation.metadata.note}
          replies={notes.filter((note) => note.parentId === annotation.metadata?.note?.id)}
          onMutate={mutateNote}
          onOpenLink={openCommentLink}
        />
      ) : null,
    [pendingDraft, reviewId, notes, addNote, mutateNote, guideAgent, openCommentLink],
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
  // A finding or a changed file on the Overview opens its line in the
  // Review's diff, in its segment when the guide has one.
  const openOverviewLink = useCallback(
    (href: string) => {
      const target = parseBriefHref(href);
      const file =
        target && state.savedView
          ? matchReviewFile(target, shownGuideFiles, guideFiles.root)
          : undefined;
      if (!target || !file || guideSections.some((section) => section.fileIds.includes(file.id)))
        return openGuideLink(href);
      if (target.line)
        revealLine(
          file.id,
          target.line,
          target.endLine ?? target.line,
          file.info.status.startsWith("D") ? "deletions" : "additions",
        );
      else reveal(file.id);
    },
    [
      state.savedView,
      shownGuideFiles,
      guideFiles.root,
      guideSections,
      openGuideLink,
      revealLine,
      reveal,
    ],
  );
  // Proof: what the agent wrote, or else the checks that the session ran in
  // the turn that made the latest version.
  const shownEntry = iterations.find((entry) => entry.number === shownIteration);
  const turn = thread?.turn;
  const turnProof: OverviewProof | undefined =
    !reviewOutput.proof &&
    turn?.checks?.length &&
    turn.startedAt !== undefined &&
    shownEntry &&
    shownEntry === iterations.at(-1) &&
    Date.parse(shownEntry.createdAt) >= turn.startedAt
      ? {
          checks: turn.checks.map((check) => ({
            command: check.name,
            status: check.status,
            ...(check.pass !== undefined || check.fail !== undefined
              ? {
                  result: [
                    check.pass !== undefined && `${check.pass} passed`,
                    check.fail && `${check.fail} failed`,
                  ]
                    .filter(Boolean)
                    .join(", "),
                }
              : {}),
          })),
          media: [],
          misses: [],
          notes: [],
          fromTurn: true,
        }
      : undefined;
  const overviewProof = reviewOutput.proof ?? turnProof;
  // A summary's proof shows once, in the Proof part above it, which counts
  // its checks and marks a failed one. A guide from an earlier version keeps
  // its proof: this version's Proof part does not show it.
  const guideSummary = resolvedGuide?.summary;
  const overviewSummary = !guideSummary
    ? reviewOutput.explainer
    : ownGuideSummary === guideSummary && reviewOutput.proof
      ? withoutProof(guideSummary) || reviewOutput.explainer
      : guideSummary;
  // Practices that would help this version, offered one at a time; each can
  // be dismissed for good (docs/PRACTICES.md#d-suggestion-pack).
  const overviewOffers: Offer[] = [];
  if ((shownIteration ?? 1) >= 4)
    overviewOffers.push({
      id: "round-limit",
      slot: "rounds",
      title: `Round ${shownIteration}`,
      text: "A change that needs a fourth round often needs another approach. The round-limit practice asks the agent to stop after 3 rounds and rethink.",
      action: { kind: "copy", label: "Copy skill", text: roundLimitSkill },
    });
  if (!overviewSummary && agentReply)
    overviewOffers.push({
      id: "explain-first",
      slot: "explainer",
      title: "No explanation yet",
      text: "Why the change exists and what to read first make the diff faster to read.",
      action: {
        kind: "run",
        label: "Ask the agent to explain",
        run: () =>
          agentReply.add({
            label: "Explain this change",
            text: EXPLAIN_REQUEST,
            icon: "ask",
          }),
      },
    });
  const nextGuidePart = guideSection
    ? guideSections[guideSections.indexOf(guideSection) + 1]
    : guideScope.kind === "since"
      ? guideSections[0]
      : undefined;
  const nextGuideLabel = nextGuidePart
    ? `${nextGuidePart.automatic ? "" : `${String(nextGuidePart.number).padStart(2, "0")} · `}${nextGuidePart.title}`
    : undefined;
  const renderCodeViewHeader = useCallback(() => {
    if (rangeCommit)
      return (
        <CommitHeader
          commit={rangeCommit}
          number={commitIndex + 1}
          count={guideCommits.length}
          hidden={state.notes?.hidden}
          onWhole={showReviewDiff}
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
    if (!guideDiff) return dependencyCard || null;
    if (guideSection)
      return (
        <SegmentHeader
          section={guideSection}
          count={guideSections.length}
          agent={guideAgent}
          stray={guideStray}
          notes={notes}
          repo={state.review?.repo}
          onMutate={mutateNote}
          onOpenLink={openGuideLink}
        />
      );
    if (guideScope.kind === "since" && shownSince)
      return (
        <SinceHeader
          since={shownSince}
          totals={{
            additions: state.files.reduce((sum, file) => sum + file.info.additions, 0),
            deletions: state.files.reduce((sum, file) => sum + file.info.deletions, 0),
            files: state.files.length,
          }}
          warnings={state.review?.warnings ?? []}
          onWhole={showReviewDiff}
        />
      );
    return null;
  }, [
    guideDiff,
    guideSection,
    guideSections.length,
    guideAgent,
    guideStray,
    notes,
    mutateNote,
    openGuideLink,
    rangeCommit,
    commitIndex,
    guideCommits,
    state.review,
    state.files,
    state.notes?.hidden,
    loadGuideCommit,
    dependencyCard,
    guideScope.kind,
    shownSince,
    showReviewDiff,
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
              ...(summary && { summary }),
              ...(done?.command && { command: done.command }),
              ...(source && sourceId ? { source: { id: sourceId, path: source.path } } : {}),
              ...(warning && { warning }),
            };
          })
        : [],
    [groupGenerated, fileGroups, generatedFiles, fileInfoById, generatedSummaries, provenance],
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
        />
      ),
    [generatedRows, generatedOpen, toggleGenerated, reveal],
  );
  const renderCodeViewFooter = useCallback(
    () =>
      guideDiff ? (
        <>
          {skipped.length > 0 && renderMetadataRows()}
          <GuideFooter
            next={nextGuideLabel}
            onNext={() => stepGuide(1)}
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
      stepGuide,
      openGuide,
    ],
  );

  // Where am I, and the way to another branch. It heads a branch's changes;
  // a saved review's header names its own branch.
  const identity = (
    <div {...stylex.props(styles.identity)}>
      {!shell && (changesRail || guideRail || filesRail) && (
        <ToolButton
          label={railLabel}
          shortcut="⌘ B"
          icon={railIcon}
          aria-label="Toggle sidebar"
          aria-pressed={railOpen}
          onClick={toggleReviewSidebar}
        />
      )}
      {gitAvailable && <BranchSwitch model={branches} onOpen={() => openBranchPicker(false)} />}
    </div>
  );
  // The title band names the checkout and its branch.
  const identityShown = !state.savedReview && !shell;
  // A hidden sidebar leaves its button at the start of the review's header
  // (the session's toggle does the same for the session). It hides from its
  // own edge (railHide).
  const railShow = (changesRail || guideRail || filesRail) && !railOpen && !identityShown && (
    <ToolButton
      icon={railIcon}
      label={railLabel}
      shortcut="Mod+Alt+B"
      aria-pressed={false}
      data-pane-show="rail"
      onClick={toggleRail}
    />
  );
  // Hiding the sidebar from its own button leaves the focus on the button
  // that shows it again.
  const railHide = (
    <ToolButton
      icon={railIcon}
      label={railLabel}
      shortcut="Mod+Alt+B"
      aria-pressed
      onClick={() => {
        toggleRail();
        requestAnimationFrame(() => visibleElement('[data-pane-show="rail"]')?.focus());
      }}
    />
  );
  const leading = (identityShown || railShow) && (
    <>
      {railShow}
      {identityShown && (
        <>
          {identity}
          <span {...stylex.props(styles.headerDivider)} />
        </>
      )}
    </>
  );
  // The diff's controls: in the review's one row, while the diff shows.
  const streamChrome = streamShown;
  // After the choices: in a shared checkout, the session's own files; in
  // Changes, other ways to choose what the diff compares.
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
    // The base of the thread's changes shows its value and opens its picker.
    ...(!reviewShown && comparisonActionsShown
      ? [
          workingAvailable
            ? { label: "Base branch…", hint: branchBase, onSelect: openCompare }
            : { label: "Compare against a branch…", onSelect: openCompare },
        ]
      : []),
    ...(!reviewShown && gitAvailable
      ? [{ label: "Compare two revisions…", onSelect: () => setRangeOpen(true) }]
      : []),
  ];
  // In a narrow row the comparison takes its short label, then goes into ⋯.
  // On the Changes page, what the diff compares tops its sidebar; elsewhere,
  // and while the sidebar hides, it is in the header's row or in ⋯.
  const comparisonInRail = railShown && shownTab === "changes" && streamChrome;
  // A Review of one checkout has nothing to choose, and shows nothing there.
  // (Review has no compare actions.)
  const comparisonShown = !reviewShown || comparisonChoices.length > 1;
  const comparisonFit = useRowFit(
    comparisonSlot,
    streamChrome && !comparisonInRail && comparisonShown ? comparisonText : null,
  );
  const comparisonSelect = comparisonShown && (
    <ChoiceSelect
      label={reviewShown ? "Review checkout" : "Comparison"}
      value={comparisonValue}
      choices={comparisonChoices}
      onChange={chooseComparison}
      actions={compareActions}
      // One control says what the diff compares, and changes it.
      triggerRef={comparisonTrigger}
      trigger={styles.rowComparisonTrigger}
      display={comparisonFit === "short" ? comparisonText.short : comparisonText.long}
    />
  );
  const comparisonActionsElement = comparisonActionsShown && actionRepo && (
    <ComparisonActions
      key={`${actionRepo}:${actionHead}:${actionBranch}`}
      ref={comparisonActions}
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
  const quietSections = useQuietMenu({
    comparison:
      streamChrome && comparisonFit === "menu"
        ? {
            label: comparisonText.long,
            value: comparisonValue,
            choices: comparisonChoices,
            select: chooseComparison,
            actions: compareActions,
          }
        : undefined,
    pane: paneControlsFit
      ? undefined
      : {
          label: "review",
          zoomed: panes.zoom === "review",
          zoom: panes.open.length > 1 ? () => panes.toggleZoom("review") : undefined,
        },
  });
  const quietFolded = quietSections.some((section) => section.length > 0);
  const savedHeader = (compact: boolean) =>
    state.savedReview && (
      <SavedReviewHeader
        ref={savedActions}
        controller={controller}
        state={state}
        compact={compact}
        comments={listedComments}
        onOpenComment={openListedComment}
        pullRequest={pullRequest}
        threadPlacement={pullRequestThreads.placement}
        codexReviews={codexReviews}
        findingPlacement={codexFindings.placement}
      />
    );
  // The tabs stay while a workspace loads, so the branch switch in them does
  // not mount again; only a review without Git has a plain header.
  const plainHeader = state.session?.repository.git === false && !hasPullTab && !hasGuide;
  // Quiet chrome's row, after the tabs: what the diff compares and the few
  // controls that stay in view, then the ⋯ menu (in a saved review's header).
  // Where the Guide's rail hides, as beside the session, its parts step in
  // the header, so the screen keeps three columns.
  const guideStepper = guideTab && !guideRailShown && (guideSections.length > 0 || !!sinceFrom) && (
    <GuideStepper
      sections={guideSections}
      since={!!sinceFrom}
      scope={guideScope}
      onScope={openGuide}
      onStep={stepGuide}
    />
  );
  // The comparison's line totals on the pages that show its diff; a hover
  // splits them by kind of file. A narrow row leaves them out.
  const totals = (shownTab === "review" || shownTab === "changes") &&
    paneControlsFit &&
    state.review &&
    state.review.files.length > 0 && (
      <ChangeTotals
        files={state.review.files}
        range={`${shortRevision(state.review.base)} → ${shortRevision(state.review.head)}`}
      />
    );
  // The page's own controls, in the header's second row after the pages.
  const pageTools = (
    <>
      {guideStepper}
      {streamChrome && !comparisonInRail && comparisonShown && (
        <span
          ref={comparisonSlot}
          {...stylex.props(styles.rowComparison, comparisonFit === "menu" && styles.hiddenSurface)}
        >
          {comparisonFit !== "menu" && comparisonSelect}
        </span>
      )}
      {totals}
      {/* The Commit tab's Stage all; its header would repeat the band's branch. */}
      {fileState.active === "commit" && commitApi && (
        <span ref={setStageSlot} {...stylex.props(styles.rowStage)} />
      )}
      {comparisonActionsElement}
    </>
  );
  // What acts on the whole review, in its title row: the pull request's
  // comments, then Copy comments.
  const reviewActions = (
    <>
      {state.savedReview?.pullRequestUrl && (
        <PullRequestPanel state={pullRequest} placement={pullRequestThreads.placement} />
      )}
      {savedHeader(true)}
    </>
  );
  // ⋯: what the second row folds away when narrow, before its pages.
  const rowMore = quietFolded && (
    <ActionMenu label="More actions" trigger={[ui.button, ui.iconButton]} sections={quietSections}>
      <Icon name="more" size={15} />
    </ActionMenu>
  );
  const pageValue = filesPage ? "files" : shownTab;
  const shownPage = reviewPages.some((entry) => entry.value === pageValue) ? pageValue : null;
  // Changes of a place that the reader chose are not the review's. The pull
  // request's own page is the pull request's, whatever Changes show.
  const apart = state.apart && shownPage !== "pull";
  // The review's name: its pull request's, when it has one.
  const pullName = state.savedReview?.pullRequestUrl && !apart && (
    <PullRequestTitle
      url={state.savedReview.pullRequestUrl}
      title={state.savedReview.pullRequestTitle ?? state.savedReview.title}
      pull={pullRequest.data?.pull}
    />
  );
  const display: DisplayOptions = {
    layout: { mode, canSplit: roomy, set: setMode },
    wrap: { on: wrap, toggle: () => setWrap(!wrap) },
    comments: { on: showNotes, toggle: () => setShowNotes(!showNotes) },
    size: { value: codeSize, set: (size) => viewSettings.codeSize.set(size) },
  };
  // Apart from the review, the row names the page, and the range beside it
  // names the branch.
  const reviewName =
    pullName ||
    (apart ? (
      <ReviewTitle reviewed={false} title="Changes" />
    ) : (
      <ReviewTitle
        reviewed={!!state.savedReview}
        title={
          state.savedReview
            ? (threadName ?? state.savedReview.title)
            : (state.session?.repository.path.split("/").at(-1) ?? "Changes")
        }
      />
    ));
  // A thread with several reviews: a caret at the name's end lists them, and
  // a choice shows that review in this one's place, with its checkout. The
  // rail's list hides while the session is narrow; the name never does.
  // A pull request's row of another review, in the session rail: its page
  // shows once that review does. Another way to a review drops it.
  const pullWanted = useRef<string | null>(null);
  const reviewLabels = siblingReviews.map((review) =>
    review.pullRequest
      ? `#${review.pullRequest.number} ${review.pullRequest.title ?? review.title}`
      : review.title,
  );
  const reviewSwitch = siblingReviews.length > 1 && workspace && (
    <ActionMenu
      label="Reviews of this thread"
      align="start"
      trigger={[ui.button, styles.reviewSwitch, !!pullName && styles.reviewSwitchPull]}
      sections={[
        siblingReviews.map((review, at) => ({
          // Two reviews with one title, such as one for each branch: each
          // names its branch, or else its place in the list.
          label:
            reviewLabels.indexOf(reviewLabels[at]!) === reviewLabels.lastIndexOf(reviewLabels[at]!)
              ? reviewLabels[at]!
              : `${reviewLabels[at]} · ${review.place?.branch ?? at + 1}`,
          checked: review.id === state.savedReview?.id && !apart,
          choice: true,
          onClick: () => {
            pullWanted.current = null;
            if (review.id !== state.savedReview?.id)
              workspace.update(workspace.id, { reviewId: review.id });
            selectTab("review");
          },
        })),
      ]}
    >
      <Icon name="chevron" size={12} />
    </ActionMenu>
  );
  // The pages, and what acts on the whole review, at the title band's end:
  // they show whether or not the review does. A page opens the review beside
  // the thread, and the page on screen, clicked again, hides it, so the
  // thread fills the workspace again.
  const choosePage = (value: string) => {
    if (reviewVisible && value === shownPage && sessionVisible && hasSessions) closePane("review");
    else selectTab(value);
  };
  const reviewTools = (
    <ReviewTools
      pages={{
        pages: plainHeader ? [] : reviewPages,
        page: reviewVisible ? shownPage : null,
        onPage: choosePage,
      }}
      actions={reviewActions}
      display={display}
    />
  );
  // The review's one row: its name, the page's own controls, and Expand at
  // its end. Without the title band, its end holds the pages too.
  const mainHeader = (controls: ReactNode) => (
    <>
      <ReviewHeader
        lead={leading}
        name={reviewName}
        choice={reviewSwitch}
        tools={pageTools}
        more={rowMore}
        end={!bandShown && reviewTools}
        controls={paneEnd(controls)}
      />
      {fileTabs}
    </>
  );
  // The pane's own control, Expand, at the row's end. The review has no Hide
  // button: its page in the title band, clicked again, hides it, as ⌘K does.
  const paneEnd = (controls: ReactNode) => (
    <span
      ref={setPaneSlot}
      {...stylex.props(styles.rowPane, !paneControlsFit && styles.hiddenSurface)}
    >
      {controls}
    </span>
  );
  const fileTabs = (
    <>
      {/* An open Search tab has a label, empty before a query. The tabs are
          the Files page's: the review's pages have none. */}
      {filesPage && (fileState.tabs.length > 0 || fileState.searchLabel !== undefined) && (
        <FileViewTabs
          panelId={`${idPrefix}file-view-panel`}
          pathActions={pathActions}
          showChanges={false}
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
          onSelect={selectTab}
          onClose={fileWorkspace.close}
          onCloseOthers={fileWorkspace.closeOthers}
          onCloseAll={fileWorkspace.closeAll}
        />
      )}
    </>
  );
  // The tab is the card's first row, so the notice follows it.
  const linkError = fileLinkError && (
    <div role="alert" {...stylex.props(styles.notice, styles.error)}>
      {fileLinkError}
    </div>
  );
  // Where the thread works: its repository, and its branch or worktree. The
  // window's title band names it; without the shell, the session header does.
  const threadCheckout = thread?.checkout;
  const threadPlace = threadCheckout
    ? [thread.repository?.name ?? threadCheckout.split("/").at(-1), thread.branch]
        .filter(Boolean)
        .join(" · ")
    : undefined;
  // A hand-off's card in the conversation opens the Review (HandoffCard.tsx).
  const reviewsClock = useMinuteClock(siblingReviews.length > 1);
  const handoffTitle = reviewAvailable
    ? (state.savedReview?.pullRequestTitle ?? state.savedReview?.title ?? "Review")
    : null;
  const handoff = useMemo(
    () =>
      handoffTitle === null
        ? null
        : {
            title: handoffTitle,
            open: () => {
              revealPane("review");
              selectTab("review");
            },
            id: savedReviewId,
            titles: new Map(siblingReviews.map((review) => [review.id, review.title])),
            openReview: (id: string) => {
              // Another of the thread's reviews shows in its place.
              pullWanted.current = null;
              if (id !== savedReviewId && workspace)
                workspace.update(workspace.id, { reviewId: id });
              revealPane("review");
              selectTab("review");
            },
          },
    [handoffTitle, revealPane, selectTab, savedReviewId, siblingReviews, workspace],
  );
  // The session rail lists what the thread has to read. Reviews: what the
  // agent handed off, newest first. Pull requests: each pull request of the
  // thread, which opens its own page. A review that Med captured from a
  // pull request's link is that pull request's change, not a hand-off: it is
  // listed with the pull requests alone.
  const several = siblingReviews.length > 1;
  // What the workspace shows, for the rail's Thread section. While another
  // place loads, the rail keeps the last one, as the title band does.
  const [railPlace, setRailPlace] = useState<{
    path: string;
    repository: string;
    familyId?: string;
    branch?: string;
    fromGit: boolean;
  } | null>(null);
  const placeNow = state.session
    ? {
        path: state.session.repository.path,
        repository: shownFamily?.name ?? state.session.repository.name,
        ...(shownFamily && { familyId: shownFamily.id }),
        ...(state.activeBranch && { branch: state.activeBranch }),
        fromGit: !!state.historyRef,
      }
    : null;
  if (
    placeNow &&
    (placeNow.path !== railPlace?.path ||
      placeNow.repository !== railPlace.repository ||
      placeNow.familyId !== railPlace.familyId ||
      placeNow.branch !== railPlace.branch ||
      placeNow.fromGit !== railPlace.fromGit)
  )
    setRailPlace(placeNow);
  const shownPlace = placeNow ?? railPlace;
  const ownFromPull = threadReview
    ? !!threadReview.fromPull
    : !!state.savedReview?.pullRequestUrl &&
      !!state.savedReview.key &&
      isPullReviewKey(state.savedReview.key);
  const reviewSettled = state.status === "ready" && !!state.savedView;
  useEffect(() => {
    // Once that review's own checkout shows: its first page would take the
    // page's place before then.
    if (!pullWanted.current || savedReviewId !== pullWanted.current || !reviewSettled) return;
    pullWanted.current = null;
    if (hasPullTab) fileWorkspace.select("pull");
  }, [savedReviewId, reviewSettled, hasPullTab, fileWorkspace]);
  const showReviewPage = (id: string | undefined, page: "review" | "pull") => {
    revealPane("review");
    if (id && id !== savedReviewId) {
      step();
      workspace?.update(workspace.id, { reviewId: id });
      pullWanted.current = page === "pull" ? id : null;
      if (page === "review") selectTab("review");
      return;
    }
    pullWanted.current = null;
    selectTab(page === "pull" && hasPullTab ? "pull" : "review");
  };
  const sessionReviews: ThreadLink[] = [
    ...(several
      ? siblingReviews.filter((review) => !review.fromPull)
      : reviewAvailable && !ownFromPull
        ? [undefined]
        : []
    ).map((review): ThreadLink => {
      const own = !review || review.id === savedReviewId;
      return {
        id: own ? "review" : `review-${review.id}`,
        icon: "guide",
        // The hand-off's own title; the pull request's is in its section.
        label: (own ? state.savedReview?.title : undefined) ?? review?.title ?? "Review",
        current: several && own && !apart,
        detail: own
          ? sinceRow?.files
            ? `${sinceRow.files} ${sinceRow.files === 1 ? "file" : "files"} new`
            : undefined
          : shortAge(review.updatedAt, reviewsClock),
        onOpen: () => showReviewPage(review?.id, "review"),
      };
    }),
  ];
  // The pull request of the review on screen, before the thread's list has it.
  const ownPull =
    threadReview?.pullRequest ??
    (state.savedReview?.pullRequestUrl
      ? reviewPullRequest(state.savedReview.pullRequestUrl, {
          title: state.savedReview.pullRequestTitle ?? undefined,
        })
      : undefined);
  const sessionPulls: ThreadLink[] = (
    several
      ? siblingReviews
      : ownPull && state.savedReview
        ? [{ id: state.savedReview.id, title: state.savedReview.title, pullRequest: ownPull }]
        : []
  ).flatMap((review): ThreadLink[] => {
    const pull = review.id === savedReviewId ? (ownPull ?? review.pullRequest) : review.pullRequest;
    if (!pull) return [];
    const own = review.id === savedReviewId;
    // What GitHub said of it last: the page's own read, else the thread list's.
    const said = (own ? pullRequest.data?.pull?.state : undefined) ?? pull.state;
    const numbered = `#${pull.number} `;
    return [
      {
        id: `pull-${review.id}`,
        icon: said === "merged" ? "merged" : said === "draft" ? "draft" : "pullRequest",
        ...(said && { tone: said }),
        label:
          pull.title ??
          (review.title.startsWith(numbered) ? review.title.slice(numbered.length) : review.title),
        detail: `#${pull.number}`,
        hint: said ? `Pull request #${pull.number}, ${said}` : `Pull request #${pull.number}`,
        current: several && own && ownFromPull && !apart,
        // Med's Pull request page, which links to GitHub; else GitHub.
        ...(own && !hasPullTab
          ? { href: pull.url }
          : { onOpen: () => showReviewPage(review.id, "pull") }),
      },
    ];
  });
  // The session's controls are at the title band's end while it shows and
  // the review does not fill the workspace.
  const sessionBandTools = sessionVisible && panes.zoom !== "review";
  const sidePanes: PaneSpec[] = [
    // A thread's session, or the session of a review that opens on its own.
    ...(entry?.kind === "thread" || state.savedReview
      ? [
          {
            id: "session" as const,
            label: "Session",
            ariaLabel: "Agent session",
            icon: leadIcon,
            onClose: hideSession,
            preload: sessionReady && hasSessions,
            render: () => (
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
                    repo={state.review?.repo}
                    detail={shell ? undefined : threadPlace}
                  />
                ) : (
                  <SessionPanel
                    key={sessionThreadId}
                    threadId={sessionThreadId!}
                    session={agentSessions[0]!}
                    root={state.review?.repo}
                    fetcher={sessionFetch}
                    inbox={agentInbox}
                    attachments={agentAttachments}
                    onRemoveAttachment={(id) =>
                      setAgentAttachments((list) => list.filter((entry) => entry.id !== id))
                    }
                    onOpenPath={openFromPane}
                    onOpenComment={openComment}
                    fileRefs={sessionRefs}
                    onSideRoom={setSessionSideRoom}
                    bandTools={sessionBandTools}
                    lead={sessionVisible}
                    waiting={state.status === "loading" && !state.session}
                    mentions={mentionSources}
                    onMentionsWanted={wantMentions}
                    openAgent={openAgent}
                    recap={recapProps}
                    onContinue={continueInMed}
                    onFork={forkFromHere}
                    reviews={sessionReviews}
                    pulls={sessionPulls}
                    place={
                      shownPlace || threadCheckout
                        ? {
                            // What the thread shows: a worktree goes by its
                            // repository's name. Before the first place
                            // loads, the agent's stands in.
                            repository:
                              shownPlace?.repository ??
                              thread?.repository?.name ??
                              basename(threadCheckout ?? ""),
                            ...((shownPlace ? shownPlace.branch : thread?.branch)
                              ? { branch: (shownPlace ? shownPlace.branch : thread?.branch)! }
                              : {}),
                            ...(gitAvailable && {
                              onRepository: () => openBranchPicker(false, true),
                              onBranch: () => openBranchPicker(false),
                            }),
                            // Where the agent works, which can be another place.
                            ...(thread?.branch && { agentBranch: thread.branch }),
                            ...(thread?.repository &&
                              shownPlace &&
                              thread.repository.id !== shownPlace.familyId && {
                                agentRepository: thread.repository.name,
                              }),
                            // Another checkout shows, or a branch from Git in
                            // the agent's own checkout.
                            ...(gitAvailable &&
                              threadCheckout &&
                              thread?.repository &&
                              shownPlace &&
                              (shownPlace.path !== threadCheckout || shownPlace.fromGit) && {
                                onAgentBranch: () => {
                                  pendingTab.current = "changes";
                                  void controller.selectWorktree(
                                    threadCheckout,
                                    thread.repository!.id,
                                  );
                                  fileWorkspace.select("changes");
                                  revealPane("review");
                                },
                              }),
                          }
                        : undefined
                    }
                  />
                )}
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
          : // In a thread, a branch shows in the thread; ⌘↵ opens it beside.
            openBranch(entry, newWorkspace || branchPickerNew)
      }
      repositoriesFirst={branchPickerRepos}
      workspaces={workspace ? (branchPickerNew ? "new" : "here") : undefined}
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
      // While the session hides, the review's Expand is Restore, which shows it.
      ...(!sessionVisible &&
        (state.savedReview || hasSessions) && {
          restore: {
            label: "Show agent session",
            shortcut: "Mod+Shift+B",
            onRestore: toggleSession,
            pane: "session",
          },
        }),
      render: (controls: ReactNode) => (
        <main ref={setMainElement} {...stylex.props(styles.main)} aria-label="Continuous review">
          {linkError}
          {mainHeader(controls)}
          {state.status === "loading" && (
            <span role="presentation" {...stylex.props(styles.loadingTrack, styles.rowLoading)}>
              <span {...stylex.props(styles.loadingBar)} />
            </span>
          )}
          {state.savedView &&
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
                    onClick={refreshReview}
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
                : fileState.active === "pull"
                  ? "Pull request"
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
            {addPull.adding && (
              // The steps of a pull request that joins the thread, where its
              // review shows next.
              <div {...stylex.props(styles.addingPull)}>
                <PullProgress
                  url={addPull.adding.url}
                  state={addPull.adding.state}
                  onRetry={addPull.retry}
                  onClose={addPull.dismiss}
                />
              </div>
            )}
            <div
              {...stylex.props(
                styles.reviewSurface,
                !streamShown && !guideTab && styles.hiddenSurface,
              )}
              aria-hidden={!streamShown && !guideTab}
            >
              <div {...stylex.props(styles.guideRow)}>
                {guideRailShown && (
                  <GuideRail
                    sections={guideSections}
                    scope={guideScope}
                    filesById={guideFilesById}
                    onScope={openGuide}
                    onFile={(key, id) => {
                      if (guideDiff && guideSection?.key === key) reveal(id);
                      else {
                        // The chosen file, not the saved scroll, places the stream.
                        explicitReveal.current = true;
                        openGuide({ kind: "segment", key }, id);
                      }
                    }}
                    since={sinceRow}
                    controls={railHide}
                  />
                )}
                {changesRail && (
                  <ChangesRail
                    hidden={!railShown}
                    controls={railHide}
                    range={
                      comparisonInRail && (
                        <div {...stylex.props(styles.railRange)}>{comparisonSelect}</div>
                      )
                    }
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
                    summary={overviewSummary}
                    from={
                      guideSource &&
                      shownIteration !== undefined &&
                      guideSource.number !== shownIteration
                        ? guideSource.number
                        : undefined
                    }
                    agent={leadSession ? { name: guideAgent.name, mark: guideAgent.mark } : null}
                    sections={guideSections}
                    proof={overviewProof}
                    findings={reviewOutput}
                    openFindings={openFindings}
                    since={shownSince}
                    offers={overviewOffers}
                    repo={state.review?.repo}
                    onSince={(file) => {
                      // Another comparison of the version shows first; Since follows it.
                      if (file && file.target !== state.savedTargetId)
                        void controller.selectSavedTarget(file.target);
                      openGuide({ kind: "since" }, file && `path:${file.path}`);
                    }}
                    onScope={openGuide}
                    onWhole={showReviewDiff}
                    onOpenLink={openOverviewLink}
                  />
                )}
                <div {...stylex.props(styles.reviewSurface, guideOverview && styles.hiddenSurface)}>
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
                      {missingRepository ? (
                        // Adding it back opens the review again.
                        <button
                          {...stylex.props(ui.button)}
                          disabled={addingRepository}
                          onClick={() => {
                            setAddingRepository(true);
                            controller
                              .addRepository(missingRepository.repo)
                              .catch((error: unknown) =>
                                showToast(
                                  `Couldn't add ${missingRepository.repo}: ${error instanceof Error ? error.message : String(error)}`,
                                ),
                              )
                              .finally(() => setAddingRepository(false));
                          }}
                        >
                          {addingRepository ? "Adding…" : "Add repository"}
                        </button>
                      ) : (
                        <button
                          {...stylex.props(ui.button)}
                          onClick={() => void controller.refresh()}
                        >
                          Retry
                        </button>
                      )}
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
                          onMutate={mutateNote}
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
                      <FindBar
                        inputRef={findRef}
                        query={find}
                        onQuery={(query) => findAgain(query, findOptions)}
                        options={findOptions}
                        onOptions={(options) => findAgain(find, options)}
                        count={
                          !find
                            ? null
                            : findMatcher && !(findMatcher instanceof RegExp)
                              ? findMatcher
                              : { current: findIndex + 1, total: hits.length }
                        }
                        onNext={() => stepHit(1)}
                        onPrevious={() => stepHit(-1)}
                        onClose={() => setFindOpen(false)}
                        placeholder="Find in changes"
                      />
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
                        <button
                          {...stylex.props(ui.button, ui.iconButton, styles.selectionClose)}
                          aria-label="Clear line selection"
                          onClick={clearLineSelection}
                        >
                          <Icon name="close" size={14} />
                        </button>
                      </div>
                    )}
                    {diffHover.element}
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
            {hasPullTab && pullMounted && state.savedReview && (
              <div
                {...stylex.props(
                  styles.reviewSurface,
                  fileState.active !== "pull" && styles.hiddenSurface,
                )}
                aria-hidden={fileState.active !== "pull"}
              >
                <Suspense fallback={null}>
                  {showLivePull && (
                    <PullRequestView
                      key={`${state.savedReview.id} ${livePullUrl}`}
                      reviewId={state.savedReview.id}
                      url={livePullUrl!}
                      title={state.savedReview.pullRequestTitle ?? state.savedReview.title}
                      active={fileState.active === "pull"}
                      comments={pullRequest}
                      placement={pullRequestThreads.placement}
                      root={state.review?.repo}
                      load={loadLivePull}
                      loadLog={loadCheckLog}
                      refreshes={pullRefreshes}
                      onShowThread={showPullThread}
                    />
                  )}
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
                    stageIn={!stageSlot || stageFits ? stageSlot : undefined}
                  />
                </Suspense>
              </div>
            )}
            {/* The Files page: the tree, and Search or a file beside it. The
                tree waits hidden on the other pages, with its folders as the
                reader left them, so the page shows it at once. */}
            <div {...stylex.props(styles.guideRow, !filesPage && styles.hiddenSurface)}>
              {browseSource && (
                <FilesRail
                  key={JSON.stringify([sourceKey(browseSource), repositoryFiles.ignored])}
                  hidden={!filesRailShown}
                  controls={railHide}
                  {...repositoryFiles}
                  sourceLabel={sourceLabel}
                  repo={browseSource?.repo ?? null}
                  pathActions={pathActions}
                  selectedPath={activeFile?.path ?? null}
                  onPrefetch={prefetchFile}
                  onOpen={openWorkingFile}
                  onIgnoredChange={repositoryFiles.setIgnored}
                  onRefresh={repositoryFiles.refresh}
                  onClose={toggleRail}
                />
              )}
              <div {...stylex.props(styles.reviewSurface)}>
                {fileState.active === "files" && (
                  <div {...stylex.props(styles.filesEmpty)}>
                    <p {...stylex.props(styles.filesEmptyTitle)}>No file open</p>
                    <p {...stylex.props(styles.filesEmptyNote)}>
                      Choose a file in the tree, or find one with ⌘⇧K.
                    </p>
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
                    comments={fileComments}
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
                    loadHover={loadHover}
                    onOpenDefinition={openDefinition}
                    onSymbolPreviewReady={onSymbolPreviewReady}
                    onRefresh={refreshFile}
                    onClose={closeActiveFile}
                    onOpenFile={openLinkedFile}
                    openIn={
                      activeFile.source.kind === "worktree"
                        ? {
                            actions: pathActions,
                            target: { repo: activeFile.source.repo, path: activeFile.path },
                          }
                        : undefined
                    }
                  />
                )}
              </div>
            </div>
          </div>
          {toast && (
            <div key={toast.id} role="status" {...stylex.props(styles.toast)}>
              {toast.text}
            </div>
          )}
        </main>
      ),
    },
    ...sidePanes,
  ];
  const app = (
    <AgentReplyContext.Provider value={agentReply}>
      <div
        {...stylex.props(styles.app)}
        data-theme={activeTheme.id}
        data-sidebar-visible={shell ? shell.sidebarVisible : sidebarShown}
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
        {!workspace && <BranchStrip model={branches} />}
        {branchPicker}
        <InTitleBand tools={reviewTools} />
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
          {...stylex.props(styles.workspace)}
          id={`${idPrefix}review-workspace`}
          role="tabpanel"
          aria-label={`${state.activeBranch ?? "Workspace"} review`}
        >
          <PaneTree
            state={panes}
            panes={workspacePanes}
            label="Workspace panes"
            // ⌘E expands the review, and opens it expanded while it hides;
            // in the thread beside the review, it expands the thread. The
            // thread has no Expand.
            expand={
              threadLayout
                ? {
                    id: "review",
                    own: SESSION_PANES,
                    onHidden: () => showPane("review", { zoom: true }),
                  }
                : undefined
            }
          />
          <ConnectionNotice connection={state.connection} />
        </div>
        <CommandDialog
          open={commandsOpen}
          onOpenChange={setCommandsOpen}
          commands={[...commands].sort((a, b) => commandRank(a.id) - commandRank(b.id))}
        />
        {addPull.add && (
          <LineDialog
            open={addPullOpen}
            onOpenChange={setAddPullOpen}
            title="Add a pull request"
            placeholder="Paste a pull request link"
            icon="pullRequest"
            empty="Paste a GitHub pull request link, such as https://github.com/owner/repo/pull/333."
            action={(line) => {
              const pull = parsePullUrl(line);
              return pull
                ? {
                    label: `Add pull request #${pull.number}`,
                    hint: `${pull.owner}/${pull.name}`,
                    run: () => {
                      revealPane("review");
                      addPull.add?.(pull.url);
                    },
                  }
                : null;
            }}
          />
        )}
        <ShortcutGuide
          open={helpOpen}
          onOpenChange={setHelpOpen}
          context={guideContext}
          commands={commands}
        />
      </div>
    </AgentReplyContext.Provider>
  );
  return (
    <PendingReviewContext.Provider value={pendingReview}>
      <CommentAgentContext.Provider value={commentAgent}>
        <HandoffContext.Provider value={handoff}>
          <CommentRefsContext.Provider value={commentFileRefs}>{app}</CommentRefsContext.Provider>
        </HandoffContext.Provider>
      </CommentAgentContext.Provider>
    </PendingReviewContext.Provider>
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
/** Abbreviate object IDs; keep symbolic endpoints such as "worktree" whole. */
function shortRevision(revision: string) {
  return FULL_OID.test(revision) ? revision.slice(0, 7) : revision;
}

const styles = stylex.create({
  // The workspace fills its place in the window's shell.
  app: {
    position: "absolute",
    inset: 0,
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    color: tokens.text,
    backgroundColor: tokens.canvas,
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
    backgroundColor: tokens.canvas,
    color: tokens.muted,
    fontFamily: tokens.ui,
  },
  emptyAction: { marginTop: 14, paddingInline: 12 },
  // The frame holds both sidebars; the review sits on one inset card.
  workspace: {
    position: "relative",
    display: "flex",
    flex: "1",
    minHeight: 0,
  },
  main: {
    position: "relative",
    minWidth: 0,
    flex: "1",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    backgroundColor: tokens.canvas,
  },
  reviewSurface: {
    position: "relative",
    display: "flex",
    flexDirection: "column",
    flex: "1",
    minHeight: 0,
    minWidth: 0,
  },
  // Over the review, as a pull request's workspace shows its steps.
  addingPull: {
    position: "absolute",
    inset: 0,
    zIndex: 5,
    display: "flex",
    justifyContent: "center",
    alignItems: "flex-start",
    overflow: "auto",
    paddingBlock: 56,
    paddingInline: 24,
    backgroundColor: tokens.canvas,
    fontSize: 12,
  },
  hiddenSurface: { display: "none" },
  // The Files page with no file open.
  filesEmpty: {
    display: "grid",
    alignContent: "center",
    justifyItems: "center",
    gap: 6,
    flex: "1",
    padding: 24,
    textAlign: "center",
  },
  filesEmptyTitle: { margin: 0, color: tokens.muted, fontSize: 13.5 },
  filesEmptyNote: { margin: 0, color: tokens.faint, fontSize: 12.5 },
  // The Guide's rail beside the stream, or beside its Overview.
  guideRow: {
    display: "flex",
    flex: "1",
    minHeight: 0,
    minWidth: 0,
    containerType: "inline-size",
  },
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
  // The Changes sidebar's range, under its heading.
  railRange: { display: "flex", minWidth: 0, paddingInline: 6, paddingBottom: 6 },
  // Empty while Stage all has no room here, and then no gap in the row.
  rowStage: { display: { default: "flex", ":empty": "none" }, flexShrink: 0 },
  // The caret after the review's name: faint until the pointer or focus.
  reviewSwitch: {
    flexShrink: 0,
    width: 20,
    height: 24,
    marginInlineStart: -4,
    padding: 0,
    justifyContent: "center",
    color: { default: tokens.faint, ":hover": tokens.text, ":focus-visible": tokens.text },
  },
  // After a pull request's number, which has no space of its own at its end.
  reviewSwitchPull: { marginInlineStart: 2 },
  rowPane: {
    display: { default: "flex", ":empty": "none" },
    alignItems: "center",
    gap: 2,
    flexShrink: 0,
  },
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
    // The header spans the stream, as the code does.
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
