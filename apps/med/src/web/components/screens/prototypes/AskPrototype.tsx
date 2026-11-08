import * as stylex from "@stylexjs/stylex";
import { File } from "@pierre/diffs/react";
import type { LineAnnotation } from "@pierre/diffs";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { Note } from "../../../../shared/protocol";
import { HIGHLIGHTER } from "../../../pierre-theme";
import { tokens, ui } from "../../../theme.stylex";
import { useTheme } from "../../../themes";
import { codeSurfaceStyle, diffSurfaceStyle } from "../../diff-surface";
import { Icon } from "../../Icon";
import { NoteCard } from "../../NoteCard";
import { SessionSidebar } from "../../shell/SessionSidebar";
import {
  FILTERS_PATH,
  FILTERS_TS,
  sessionQuestion,
  sidebarThreads,
  workspaceQuestions,
  type Question,
} from "./fixtures";

// Prototype: ask about lines in any file, and the agent answers in the
// comment's thread at once. In a session's workspace a fork of the session
// answers, so the session keeps working; in a plain workspace, the
// repository's Questions session does, which keeps its context between
// questions. Static: the answer streams once, from fixtures.

/** The answer as it streams: a few characters at a time, once. */
function useStream(text: string, live: boolean) {
  const [shown, setShown] = useState(live ? 0 : text.length);
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(
      () =>
        setShown((count) => {
          if (count >= text.length) clearInterval(timer);
          return Math.min(text.length, count + 3);
        }),
      28,
    );
    return () => clearInterval(timer);
  }, [text, live]);
  return { text: text.slice(0, shown), done: shown >= text.length };
}

function QuestionThread({
  question,
  answerer,
  footer,
}: {
  question: Question;
  /** Who answers, as the thread names them. */
  answerer: string;
  footer(done: boolean): ReactNode;
}) {
  const stream = useStream(question.answer, question.streaming);
  const reply: Note = {
    ...question.note,
    id: `${question.note.id}-answer`,
    parentId: question.note.id,
    text: stream.text || "…",
    author: { agent: "claude" },
  };
  return (
    <div {...stylex.props(styles.thread)}>
      <NoteCard
        note={question.note}
        replies={[...(question.earlier ?? []), reply]}
        onMutate={async () => {}}
      />
      <div {...stylex.props(styles.threadFooter)}>
        <span {...stylex.props(styles.question)}>
          <Icon name="ask" size={12} />
          {stream.done
            ? `Answered by ${answerer}`
            : `${answerer[0]!.toUpperCase()}${answerer.slice(1)} is answering`}
        </span>
        {!stream.done && <span {...stylex.props(styles.dots)} aria-hidden="true" />}
        <span {...stylex.props(styles.grow)} />
        {stream.done ? footer(true) : <span {...stylex.props(styles.key)}>Esc stops</span>}
      </div>
    </div>
  );
}

function CodeFile({
  questions,
  selected,
  answerer,
  footer,
}: {
  questions: Question[];
  selected: { start: number; end: number };
  answerer: string;
  footer(question: Question): (done: boolean) => ReactNode;
}) {
  const { active } = useTheme();
  const annotations = useMemo<LineAnnotation<Question>[]>(
    () =>
      questions.map((question) => ({
        lineNumber: question.note.endLine ?? question.note.line,
        metadata: question,
      })),
    [questions],
  );
  return (
    <File<Question>
      file={{ name: FILTERS_PATH, contents: FILTERS_TS }}
      options={{
        theme: active.pierreTheme,
        themeType: active.appearance,
        preferredHighlighter: HIGHLIGHTER,
        disableFileHeader: true,
        overflow: "wrap",
        enableLineSelection: true,
      }}
      style={{ ...codeSurfaceStyle, ...diffSurfaceStyle }}
      lineAnnotations={annotations}
      selectedLines={selected}
      renderAnnotation={(annotation) => (
        <QuestionThread
          question={annotation.metadata}
          answerer={answerer}
          footer={footer(annotation.metadata)}
        />
      )}
    />
  );
}

function Window({ questions, children }: { questions: boolean; children: ReactNode }) {
  const threads = useMemo(() => sidebarThreads(questions), [questions]);
  return (
    <div {...stylex.props(styles.window)}>
      <aside {...stylex.props(styles.sidebar)}>
        <SessionSidebar
          threads={threads}
          current={questions ? null : "search"}
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

function PaneHeader({ title, branch, mark }: { title: string; branch: string; mark: ReactNode }) {
  return (
    <header {...stylex.props(styles.header)}>
      <Icon name="panelLeft" size={14} />
      {mark}
      <span {...stylex.props(styles.title)}>{title}</span>
      <span {...stylex.props(styles.branch)}>
        <Icon name="gitBranch" size={12} />
        {branch}
      </span>
    </header>
  );
}

function Tabs({ tabs }: { tabs: { label: string; icon: "file" | "brief"; current?: boolean }[] }) {
  return (
    <div {...stylex.props(styles.tabs)} role="tablist">
      {tabs.map((tab) => (
        <span
          key={tab.label}
          role="tab"
          aria-selected={!!tab.current}
          {...stylex.props(styles.tab, tab.current && styles.tabCurrent)}
        >
          <Icon name={tab.icon} size={13} />
          {tab.label}
        </span>
      ))}
    </div>
  );
}

function FileBar({ hint }: { hint: string }) {
  return (
    <div {...stylex.props(styles.fileBar)}>
      <span {...stylex.props(styles.path)}>
        <span {...stylex.props(styles.dir)}>src/search/</span>filters.ts
      </span>
      <span {...stylex.props(styles.grow)} />
      <span {...stylex.props(styles.hint)}>{hint}</span>
    </div>
  );
}

/** The session beside the file: it keeps working while the fork answers. */
function WorkingSession() {
  return (
    <section {...stylex.props(styles.pane, styles.session)} aria-label="Agent session">
      <header {...stylex.props(styles.header)}>
        <Icon name="claude" size={14} />
        <span {...stylex.props(styles.title)}>Claude</span>
        <span {...stylex.props(styles.state)}>Working</span>
      </header>
      <div {...stylex.props(styles.sessionBody)}>
        <p {...stylex.props(styles.prompt)}>
          Show the active filters in the search bar. Without them, people cannot see why trails are
          hidden.
        </p>
        <p {...stylex.props(styles.said)}>
          The search bar now shows the active filters as chips. I&apos;ll add a test for each label,
          then run the suite.
        </p>
        <p {...stylex.props(styles.tool)}>
          <Icon name="edit" size={13} />
          Edited <code {...stylex.props(styles.code)}>tests/search.test.ts</code>
        </p>
        <p {...stylex.props(styles.tool, styles.toolLive)}>
          <Icon name="terminal" size={13} />
          Running <code {...stylex.props(styles.code)}>bun test search</code>
          <span {...stylex.props(styles.grow)} />
          <span {...stylex.props(styles.faintText)}>0:42</span>
        </p>
      </div>
      <div {...stylex.props(styles.composer)}>
        <span {...stylex.props(styles.placeholder)}>Message Claude, or @ to mention…</span>
      </div>
    </section>
  );
}

const footerButton = (label: string, icon: "claude" | "check" | "sessions" | "reply") => (
  <button key={label} type="button" {...stylex.props(ui.button, styles.footerButton)}>
    <Icon name={icon} size={13} />
    {label}
  </button>
);

/** Ask in a file of a session's workspace: a fork of the session answers. */
export function AskInSession() {
  return (
    <Window questions={false}>
      <section {...stylex.props(styles.pane, styles.main)} aria-label="Search filters">
        <PaneHeader
          title="Search filters"
          branch="search-filters"
          mark={<Icon name="claude" size={14} />}
        />
        <Tabs
          tabs={[
            { label: "Review", icon: "brief" },
            { label: "filters.ts", icon: "file", current: true },
          ]}
        />
        <FileBar hint="Select lines, then A to ask or C to comment" />
        <div {...stylex.props(styles.scroll)}>
          <CodeFile
            questions={[sessionQuestion]}
            selected={{ start: 22, end: 24 }}
            answerer="a fork of this session"
            footer={() => () => [
              footerButton("Reply", "reply"),
              footerButton("Send to Claude", "claude"),
              footerButton("Resolve", "check"),
            ]}
          />
        </div>
      </section>
      <WorkingSession />
    </Window>
  );
}

/** The repository's Questions session: every question asked outside a
 * session, as turns of one read-only session, beside the file. */
function QuestionsSession() {
  const [earlier, current] = workspaceQuestions;
  return (
    <section {...stylex.props(styles.pane, styles.session)} aria-label="Questions session">
      <header {...stylex.props(styles.header)}>
        <Icon name="claude" size={14} />
        <span {...stylex.props(styles.title)}>Questions</span>
        <span {...stylex.props(styles.branch)}>trailhead · read-only</span>
        <span {...stylex.props(styles.state)}>Answering</span>
      </header>
      <div {...stylex.props(styles.sessionBody)}>
        <p {...stylex.props(styles.note)}>
          Med keeps one read-only Claude session per repository for questions asked outside a
          session. It reads, it does not edit, and each answer builds on the ones before.
        </p>
        {[earlier!, current!].map((question, index) => (
          <div key={question.note.id} {...stylex.props(styles.turn)}>
            <p {...stylex.props(styles.prompt)}>
              <span {...stylex.props(styles.cite)}>
                filters.ts:{question.note.line}
                {question.note.endLine ? `–${question.note.endLine}` : ""}
              </span>
              {question.note.text.replaceAll("`", "")}
            </p>
            {index === 0 ? (
              <p {...stylex.props(styles.said)}>
                From the query string: parseFilters reads ?difficulty= in query.ts:12, and leaves it
                undefined for “any”.
              </p>
            ) : (
              <p {...stylex.props(styles.tool, styles.toolLive)}>
                <Icon name="search" size={13} />
                Searching for <code {...stylex.props(styles.code)}>describeFilters</code>
              </p>
            )}
          </div>
        ))}
      </div>
      <div {...stylex.props(styles.composer)}>
        <span {...stylex.props(styles.placeholder)}>Ask about trailhead…</span>
      </div>
    </section>
  );
}

/** Ask in a file outside a session: the repository's Questions session answers. */
export function AskInWorkspace() {
  return (
    <Window questions>
      <section {...stylex.props(styles.pane, styles.main)} aria-label="trailhead">
        <PaneHeader title="trailhead" branch="main" mark={<Icon name="folder" size={14} />} />
        <Tabs tabs={[{ label: "filters.ts", icon: "file", current: true }]} />
        <FileBar hint="Questions go to the Questions session of trailhead" />
        <div {...stylex.props(styles.scroll)}>
          <CodeFile
            questions={workspaceQuestions.slice(1)}
            selected={{ start: 19, end: 27 }}
            answerer="Questions"
            footer={() => () => [
              footerButton("Reply", "reply"),
              footerButton("Make a session", "sessions"),
              footerButton("Resolve", "check"),
            ]}
          />
        </div>
      </section>
      <QuestionsSession />
    </Window>
  );
}

const dots = stylex.keyframes({
  "0%": { opacity: 0.25 },
  "50%": { opacity: 1 },
  "100%": { opacity: 0.25 },
});

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
    minWidth: 0,
    overflow: "hidden",
    borderRadius: tokens.frame,
    backgroundColor: tokens.canvas,
    boxShadow: `0 0 0 1px ${tokens.line}`,
  },
  main: { flex: "1" },
  session: { width: 420, flexShrink: 0, order: 2 },
  header: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    height: 44,
    flexShrink: 0,
    paddingInline: 14,
    color: tokens.muted,
    boxShadow: `inset 0 -1px ${tokens.line}`,
  },
  title: { color: tokens.text, fontSize: 13, fontWeight: 600 },
  branch: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    color: tokens.faint,
    fontFamily: tokens.code,
    fontSize: 11.5,
  },
  state: { marginInlineStart: "auto", color: tokens.muted, fontSize: 12 },
  tabs: {
    display: "flex",
    gap: 2,
    height: 34,
    flexShrink: 0,
    alignItems: "flex-end",
    paddingInline: 8,
    boxShadow: `inset 0 -1px ${tokens.line}`,
  },
  tab: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    height: 28,
    paddingInline: 12,
    borderTopLeftRadius: 8,
    borderTopRightRadius: 8,
    color: tokens.muted,
    fontSize: 12.5,
  },
  tabCurrent: {
    color: tokens.text,
    backgroundColor: tokens.canvas,
    boxShadow: `inset 1px 0 ${tokens.line}, inset -1px 0 ${tokens.line}, inset 0 1px ${tokens.line}`,
  },
  fileBar: {
    display: "flex",
    alignItems: "center",
    height: 34,
    flexShrink: 0,
    paddingInline: 16,
    fontSize: 12,
    boxShadow: `inset 0 -1px ${tokens.line}`,
  },
  path: { fontFamily: tokens.code, fontSize: 12 },
  dir: { color: tokens.faint },
  hint: { color: tokens.faint, fontSize: 12 },
  grow: { flex: "1" },
  scroll: { flex: "1", overflow: "auto", paddingBlock: 8 },
  thread: { paddingBlock: 2, fontFamily: tokens.ui },
  threadFooter: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    maxWidth: 600,
    marginInline: 10,
    marginTop: -2,
    marginBottom: 8,
    paddingInline: 4,
    color: tokens.faint,
    fontSize: 12,
  },
  question: { display: "inline-flex", alignItems: "center", gap: 5 },
  dots: {
    width: 6,
    height: 6,
    borderRadius: "50%",
    backgroundColor: tokens.accent,
    animationName: dots,
    animationDuration: "1.1s",
    animationIterationCount: "infinite",
  },
  key: { color: tokens.faint, fontSize: 11.5 },
  footerButton: { height: 26, gap: 5, paddingInline: 8, fontSize: 12 },
  sessionBody: {
    display: "flex",
    flexDirection: "column",
    gap: 14,
    flex: "1",
    paddingBlock: 18,
    paddingInline: 18,
    overflow: "hidden",
    fontSize: 13.5,
    lineHeight: 1.55,
  },
  prompt: {
    alignSelf: "flex-end",
    maxWidth: "85%",
    margin: 0,
    paddingBlock: 10,
    paddingInline: 14,
    borderRadius: 12,
    backgroundColor: tokens.raised,
  },
  said: { margin: 0 },
  note: { margin: 0, color: tokens.muted, fontSize: 12.5, lineHeight: 1.5 },
  turn: { display: "flex", flexDirection: "column", gap: 10 },
  cite: {
    display: "block",
    marginBottom: 4,
    color: tokens.muted,
    fontFamily: tokens.code,
    fontSize: 11.5,
  },
  tool: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    margin: 0,
    color: tokens.muted,
    fontSize: 12.5,
  },
  toolLive: { color: tokens.text },
  code: { fontFamily: tokens.code, fontSize: 12 },
  faintText: { color: tokens.faint, fontSize: 12 },
  composer: {
    margin: 12,
    minHeight: 76,
    paddingBlock: 12,
    paddingInline: 14,
    borderRadius: 12,
    boxShadow: `0 0 0 1px ${tokens.line}`,
    backgroundColor: tokens.raised,
  },
  placeholder: { color: tokens.faint, fontSize: 13.5 },
});
