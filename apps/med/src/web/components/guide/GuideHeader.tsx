import * as stylex from "@stylexjs/stylex";
import { useEffect, useState, type ReactNode } from "react";
import type { CommitDetails } from "../../../shared/protocol";
import type { SavedCommit } from "../../../shared/review-guide";
import type { GuideNote, GuideSection } from "../../data/guide";
import { relativeTime } from "../../data/relative-time";
import { tokens, ui } from "../../theme.stylex";
import { Icon, type IconName } from "../Icon";
import { GuideNoteCard } from "../PullRequestComments";
import { GuideMarkdown } from "./GuideMarkdown";
import { Progress } from "./Progress";

const pad = (value: number) => String(value).padStart(2, "0");

interface Agent {
  name: string;
  mark: IconName;
  at: string;
  /** False when no session wrote the guide, so the name is generic. */
  named: boolean;
}

/** The head of one segment in the diff stream: its place, title, summary, and
 * the comments that sit outside its changed lines. It scrolls with the diff. */
export function SegmentHeader({
  section,
  count,
  viewed,
  agent,
  stray,
  onMarkAll,
  onReply,
  onOpenLink,
}: {
  section: GuideSection;
  /** Segments in the guide. */
  count: number;
  viewed: number;
  agent: Agent;
  /** The segment's comments on lines that the diff does not show. */
  stray: readonly GuideNote[];
  onMarkAll(viewed: boolean): void;
  onReply(note: GuideNote): void;
  onOpenLink(href: string): void;
}) {
  const files = section.fileIds.length;
  const all = files > 0 && viewed >= files;
  return (
    <Frame
      eyebrow={
        <>
          <span {...stylex.props(styles.position)}>
            {section.automatic ? "··" : pad(section.number)}
            <span {...stylex.props(styles.of)}> / {pad(count)}</span>
          </span>
          {section.kind && <span {...stylex.props(styles.kind)}>{section.kind}</span>}
        </>
      }
      action={
        files > 0 && (
          <span {...stylex.props(styles.viewed)}>
            <Progress value={viewed} total={files} size={14} />
            <span>
              {viewed} of {files} viewed
            </span>
            <button
              type="button"
              onClick={() => onMarkAll(!all)}
              {...stylex.props(ui.button, ui.pressable, ui.outlined, styles.markAll)}
            >
              {all ? "Mark unviewed" : "Mark all viewed"}
              {!all && <kbd {...stylex.props(styles.key)}>⇧V</kbd>}
            </button>
          </span>
        )
      }
      title={section.title}
      meta={
        <>
          {section.additions > 0 && <span {...stylex.props(ui.added)}>+{section.additions}</span>}
          {section.deletions > 0 && <span {...stylex.props(ui.removed)}>−{section.deletions}</span>}
          <span>
            {files} {files === 1 ? "file" : "files"}
          </span>
          {section.notes.length > 0 && (
            <span {...stylex.props(styles.notes)}>
              <Icon name={agent.mark} size={12} />
              {section.notes.length} {section.notes.length === 1 ? "comment" : "comments"}
              {agent.named && ` from ${agent.name}`}
            </span>
          )}
        </>
      }
    >
      {section.summary && <GuideMarkdown text={section.summary} onOpenLink={onOpenLink} />}
      {section.unmatched.length > 0 && (
        <p {...stylex.props(styles.unmatched)}>
          Not in this comparison: {section.unmatched.join(", ")}
        </p>
      )}
      {stray.length > 0 && (
        <div {...stylex.props(styles.stray)}>
          <p {...stylex.props(styles.strayLabel)}>On unchanged lines</p>
          {stray.map((note) => (
            <div key={note.id} {...stylex.props(styles.strayItem)}>
              <span {...stylex.props(styles.strayPath)}>
                {note.path.split("/").at(-1)}:{note.line}
                {note.endLine ? `–${note.endLine}` : ""}
              </span>
              <GuideNoteCard
                note={note}
                author={agent.name}
                mark={agent.mark}
                createdAt={agent.at}
                embedded
                onReply={() => onReply(note)}
              />
            </div>
          ))}
        </div>
      )}
    </Frame>
  );
}

/** The head of one commit of the range: its subject, author, and message. */
export function CommitHeader({
  commit,
  number,
  count,
  totals,
  loadDetails,
}: {
  commit: SavedCommit;
  number: number;
  count: number;
  totals?: { additions: number; deletions: number; files: number };
  loadDetails(id: string, signal: AbortSignal): Promise<CommitDetails>;
}) {
  const [details, setDetails] = useState<CommitDetails | null>(null);
  useEffect(() => {
    const abort = new AbortController();
    loadDetails(commit.id, abort.signal).then(
      (next) => setDetails(next),
      () => {},
    );
    return () => abort.abort();
  }, [commit.id, loadDetails]);
  const [now] = useState(Date.now);
  const shown = details?.id === commit.id ? details : null;
  return (
    <Frame
      eyebrow={
        <>
          <span {...stylex.props(styles.position)}>
            Commit {number}
            <span {...stylex.props(styles.of)}> of {count}</span>
          </span>
          <span {...stylex.props(styles.sha)}>{commit.id.slice(0, 7)}</span>
        </>
      }
      title={commit.subject}
      meta={
        <>
          <span>{commit.author}</span>
          <span>{relativeTime(commit.timestamp, now)}</span>
          {totals && (
            <>
              {totals.additions > 0 && <span {...stylex.props(ui.added)}>+{totals.additions}</span>}
              {totals.deletions > 0 && (
                <span {...stylex.props(ui.removed)}>−{totals.deletions}</span>
              )}
              <span>
                {totals.files} {totals.files === 1 ? "file" : "files"}
              </span>
            </>
          )}
        </>
      }
    >
      {shown?.body && <p {...stylex.props(styles.body)}>{shown.body}</p>}
    </Frame>
  );
}

/** The end of a segment or commit: the next part, and the way back to the Overview. */
export function GuideFooter({
  next,
  allViewed,
  onNext,
  onOverview,
}: {
  /** The next part's label, such as "03 · Routes"; none at the end. */
  next?: string;
  allViewed: boolean;
  onNext(markViewed: boolean): void;
  onOverview(): void;
}) {
  return (
    <footer {...stylex.props(styles.footer)}>
      <span {...stylex.props(styles.rule)} />
      <div {...stylex.props(styles.footerRow)}>
        {next ? (
          <>
            {!allViewed && (
              <button
                type="button"
                onClick={() => onNext(true)}
                {...stylex.props(ui.button, ui.pressable, ui.outlined, styles.footerButton)}
              >
                <Icon name="check" size={13} />
                Mark viewed and continue
                <kbd {...stylex.props(styles.key)}>⇧V</kbd>
              </button>
            )}
            <button
              type="button"
              onClick={() => onNext(false)}
              {...stylex.props(
                ui.button,
                ui.pressable,
                allViewed ? ui.primary : null,
                styles.footerButton,
                styles.nextButton,
              )}
            >
              <span {...stylex.props(styles.nextLabel)}>Next</span>
              <span {...stylex.props(ui.truncate)}>{next}</span>
              <kbd {...stylex.props(styles.key, allViewed && styles.keyOnPrimary)}>j</kbd>
            </button>
          </>
        ) : (
          <>
            <span {...stylex.props(styles.endText)}>
              {allViewed ? "That was the last part." : "End of the guide."}
            </span>
            <button
              type="button"
              onClick={onOverview}
              {...stylex.props(ui.button, ui.pressable, ui.outlined, styles.footerButton)}
            >
              Back to the overview
            </button>
          </>
        )}
      </div>
    </footer>
  );
}

function Frame({
  eyebrow,
  action,
  title,
  meta,
  children,
}: {
  eyebrow: ReactNode;
  action?: ReactNode;
  title: string;
  meta: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header data-guide-header {...stylex.props(styles.frame)}>
      <div {...stylex.props(styles.top)}>
        {eyebrow}
        <span {...stylex.props(ui.grow)} />
        {action}
      </div>
      <h2 {...stylex.props(styles.title)}>{title}</h2>
      <div {...stylex.props(styles.meta)}>{meta}</div>
      {children && <div {...stylex.props(styles.content)}>{children}</div>}
    </header>
  );
}

const styles = stylex.create({
  frame: {
    boxSizing: "border-box",
    paddingTop: 26,
    paddingBottom: 22,
    paddingInline: 24,
    fontFamily: tokens.ui,
    color: tokens.text,
  },
  top: { display: "flex", alignItems: "center", gap: 10, minHeight: 28 },
  position: {
    color: tokens.text,
    fontFamily: tokens.code,
    fontSize: 11.5,
    fontVariantNumeric: "tabular-nums",
  },
  of: { color: tokens.faint },
  kind: {
    color: tokens.faint,
    fontSize: 10.5,
    fontWeight: 500,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
  },
  sha: { color: tokens.faint, fontFamily: tokens.code, fontSize: 11 },
  viewed: {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    color: tokens.faint,
    fontSize: 11.5,
    fontVariantNumeric: "tabular-nums",
  },
  markAll: { minHeight: 26, gap: 7, paddingInline: 9, fontSize: 11.5 },
  key: {
    color: tokens.faint,
    fontFamily: tokens.code,
    fontSize: 10,
  },
  title: {
    margin: 0,
    marginTop: 8,
    maxWidth: "36em",
    fontFamily: tokens.ui,
    fontSize: 21,
    fontWeight: 550,
    lineHeight: 1.25,
    letterSpacing: "-0.015em",
    textWrap: "balance",
  },
  meta: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    columnGap: 10,
    rowGap: 4,
    marginTop: 8,
    color: tokens.faint,
    fontFamily: tokens.code,
    fontSize: 11,
    fontVariantNumeric: "tabular-nums",
  },
  notes: {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    color: tokens.muted,
    fontFamily: tokens.ui,
    fontSize: 11.5,
  },
  content: { marginTop: 14 },
  body: {
    maxWidth: "68ch",
    margin: 0,
    color: tokens.muted,
    fontSize: 13,
    lineHeight: 1.6,
    whiteSpace: "pre-wrap",
  },
  unmatched: { marginTop: 10, marginBottom: 0, color: tokens.faint, fontSize: 11.5 },
  stray: {
    maxWidth: 640,
    marginTop: 16,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopStyle: "solid",
    borderTopColor: tokens.line,
  },
  strayLabel: { margin: 0, marginBottom: 4, color: tokens.faint, fontSize: 11 },
  strayItem: { paddingBlock: 6 },
  strayPath: { color: tokens.faint, fontFamily: tokens.code, fontSize: 10.5 },
  footer: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 18,
    paddingTop: 36,
    paddingBottom: 56,
    paddingInline: 24,
    fontFamily: tokens.ui,
  },
  rule: { width: 40, height: 1, backgroundColor: tokens.lineStrong },
  footerRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexWrap: "wrap",
    gap: 10,
    maxWidth: "100%",
  },
  footerButton: { minHeight: 32, gap: 8, paddingInline: 12, fontSize: 12.5 },
  nextButton: { maxWidth: 420 },
  nextLabel: { opacity: 0.6 },
  keyOnPrimary: { color: "inherit", opacity: 0.6 },
  endText: { color: tokens.faint, fontSize: 12.5 },
});
