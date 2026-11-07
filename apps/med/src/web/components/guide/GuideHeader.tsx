import * as stylex from "@stylexjs/stylex";
import { useEffect, useState, type ReactNode } from "react";
import type { CommitDetails, Note, NoteMutation } from "../../../shared/protocol";
import type { Since } from "../../../shared/saved-review";
import type { SavedCommit } from "../../../shared/review-guide";
import { AREA_LABELS, type GuideNote, type GuideSection } from "../../data/guide";
import { relativeTime } from "../../data/relative-time";
import { tokens, ui } from "../../theme.stylex";
import { Icon, type IconName } from "../Icon";
import { GuideMarkdown } from "./GuideMarkdown";
import { GuideThread } from "./GuideThread";

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
  agent,
  stray,
  notes,
  repo,
  onMutate,
  onOpenLink,
}: {
  section: GuideSection;
  /** Segments in the guide. */
  count: number;
  agent: Agent;
  /** The segment's comments on lines that the diff does not show. */
  stray: readonly GuideNote[];
  /** The notes that can answer them. */
  notes: readonly Note[];
  /** The review's checkout, for the summary's images. */
  repo?: string;
  onMutate(mutation: NoteMutation): Promise<void>;
  onOpenLink(href: string): void;
}) {
  return (
    <Frame
      eyebrow={
        <>
          <span {...stylex.props(styles.position)}>
            {section.automatic ? "··" : pad(section.number)}
            <span {...stylex.props(styles.of)}> / {pad(count)}</span>
          </span>
          {section.area && <span {...stylex.props(styles.kind)}>{AREA_LABELS[section.area]}</span>}
          {section.critical && (
            <span {...stylex.props(styles.critical)}>
              <Icon name="alert" size={12} />
              Needs care
            </span>
          )}
        </>
      }
      title={section.title}
      meta={
        <>
          {section.additions > 0 && <span {...stylex.props(ui.added)}>+{section.additions}</span>}
          {section.deletions > 0 && <span {...stylex.props(ui.removed)}>−{section.deletions}</span>}
          <span>
            {section.fileIds.length} {section.fileIds.length === 1 ? "file" : "files"}
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
      {section.summary && (
        <GuideMarkdown text={section.summary} repo={repo} onOpenLink={onOpenLink} />
      )}
      {section.unmatched.length > 0 && (
        <p {...stylex.props(styles.unmatched)}>
          Not in this comparison: {section.unmatched.join(", ")}
        </p>
      )}
      {stray.length > 0 && (
        <div {...stylex.props(styles.stray)}>
          <p {...stylex.props(styles.strayLabel)}>
            {stray.every((note) => note.line === undefined)
              ? "On whole files"
              : stray.some((note) => note.line === undefined)
                ? "On whole files and lines the diff does not show"
                : "On lines the diff does not show"}
          </p>
          {stray.map((note) => (
            <div key={note.id} {...stylex.props(styles.strayItem)}>
              <span {...stylex.props(styles.strayPath)}>
                {note.line === undefined
                  ? note.path
                  : `${note.path.split("/").at(-1)}:${note.line}`}
                {note.endLine ? `–${note.endLine}` : ""}
              </span>
              <GuideThread
                note={note}
                agent={agent}
                notes={notes}
                embedded
                onMutate={onMutate}
                onOpenLink={onOpenLink}
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
  hidden = 0,
  loadDetails,
  onWhole,
}: {
  commit: SavedCommit;
  number: number;
  count: number;
  totals?: { additions: number; deletions: number; files: number };
  /** The version's comments on lines that this commit does not show. */
  hidden?: number;
  loadDetails(id: string, signal: AbortSignal): Promise<CommitDetails>;
  onWhole(): void;
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
      {hidden > 0 && <Elsewhere count={hidden} where="this commit" onWhole={onWhole} />}
    </Frame>
  );
}

/** Comments of the version that the shown part has no line for. */
function Elsewhere({ count, where, onWhole }: { count: number; where: string; onWhole(): void }) {
  return (
    <p {...stylex.props(styles.unmatched)}>
      {count} {count === 1 ? "comment is" : "comments are"} on lines that {where} does not show.{" "}
      <button type="button" onClick={onWhole} {...stylex.props(styles.inlineButton)}>
        Show all files
      </button>
    </p>
  );
}

const BASIS: Record<Since["basis"], string> = {
  approved: "you approved",
  commented: "you commented on",
  viewed: "you last looked at",
  previous: "before this one",
};

/** The head of "Since version N": only what changed since the reader's last review. */
export function SinceHeader({
  since,
  totals,
  hidden = 0,
  warnings,
  onWhole,
}: {
  since: Since;
  /** The shown comparison's part of it. */
  totals: { additions: number; deletions: number; files: number };
  hidden?: number;
  warnings: readonly string[];
  onWhole(): void;
}) {
  const gone = since.files.filter((file) => file.change === "gone");
  return (
    <Frame
      eyebrow={
        <span {...stylex.props(styles.kind)}>
          Since version {since.from} · the version {BASIS[since.basis]}
        </span>
      }
      title={`What changed since version ${since.from}`}
      meta={
        <>
          {totals.additions > 0 && <span {...stylex.props(ui.added)}>+{totals.additions}</span>}
          {totals.deletions > 0 && <span {...stylex.props(ui.removed)}>−{totals.deletions}</span>}
          <span>
            {totals.files} {totals.files === 1 ? "file" : "files"}
          </span>
        </>
      }
    >
      <p {...stylex.props(styles.body)}>
        Each file shows from version {since.from} to version {since.to}. Your comments stay on their
        lines.
      </p>
      {!!since.moved?.length && (
        <p {...stylex.props(styles.unmatched)}>
          Changed only with the base, as after a rebase: {since.moved.join(", ")}
        </p>
      )}
      {gone.length > 0 && (
        <p {...stylex.props(styles.unmatched)}>
          No longer changed: {gone.map((file) => file.path).join(", ")}
        </p>
      )}
      {warnings.map((warning) => (
        <p key={warning} {...stylex.props(styles.unmatched)}>
          {warning}
        </p>
      ))}
      {hidden > 0 && <Elsewhere count={hidden} where="this part" onWhole={onWhole} />}
    </Frame>
  );
}

/** The end of a segment or commit: the next part, and the way back to the Overview. */
export function GuideFooter({
  next,
  onNext,
  onOverview,
}: {
  /** The next part's label, such as "03 · Routes"; none at the end. */
  next?: string;
  onNext(): void;
  onOverview(): void;
}) {
  return (
    <footer {...stylex.props(styles.footer)}>
      <span {...stylex.props(styles.rule)} />
      <div {...stylex.props(styles.footerRow)}>
        {next ? (
          <button
            type="button"
            title="Next part (j)"
            onClick={onNext}
            {...stylex.props(
              ui.button,
              ui.pressable,
              ui.primary,
              styles.footerButton,
              styles.nextButton,
            )}
          >
            <span {...stylex.props(styles.nextLabel)}>Next</span>
            <span {...stylex.props(ui.truncate)}>{next}</span>
          </button>
        ) : (
          <>
            <span {...stylex.props(styles.endText)}>End of the guide.</span>
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
  critical: {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    color: tokens.warning,
    fontSize: 11.5,
    fontWeight: 500,
  },
  sha: { color: tokens.faint, fontFamily: tokens.code, fontSize: 11 },
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
    maxWidth: 768,
    margin: 0,
    color: tokens.muted,
    fontSize: 13,
    lineHeight: 1.6,
    whiteSpace: "pre-wrap",
  },
  unmatched: { marginTop: 10, marginBottom: 0, color: tokens.faint, fontSize: 11.5 },
  inlineButton: {
    padding: 0,
    borderWidth: 0,
    backgroundColor: "transparent",
    color: tokens.muted,
    font: "inherit",
    textDecoration: "underline",
    textUnderlineOffset: 2,
    cursor: "pointer",
  },
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
  endText: { color: tokens.faint, fontSize: 12.5 },
});
