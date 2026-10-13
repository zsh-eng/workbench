import * as stylex from "@stylexjs/stylex";
import { useState } from "react";
import type { SavedCommit } from "../../../shared/review-guide";
import { AREA_LABELS, firstSentence, type GuideScope, type GuideSection } from "../../data/guide";
import { relativeTime } from "../../data/relative-time";
import { tokens, ui } from "../../theme.stylex";
import { Icon, type IconName } from "../Icon";
import { GuideMarkdown } from "./GuideMarkdown";
import { Progress } from "./Progress";

const pad = (value: number) => String(value).padStart(2, "0");

/**
 * The Guide's first page: what changed and why, then the segments to read and
 * the range's commits. Each row opens its part of the diff.
 */
export function GuideOverview({
  title,
  meta,
  summary,
  from,
  agent,
  sections,
  commits,
  moreCommits,
  viewed,
  total,
  done,
  onScope,
  onOpenLink,
}: {
  title: string;
  /** The comparison: branch, endpoints, and totals. */
  meta: string;
  summary?: string;
  /** The iteration the guide comes from, when the shown one has none. */
  from?: number;
  agent: { name: string; mark: IconName } | null;
  sections: readonly GuideSection[];
  commits: readonly SavedCommit[];
  moreCommits?: boolean;
  viewed: ReadonlySet<string>;
  total: number;
  done: number;
  onScope(scope: GuideScope): void;
  onOpenLink(href: string): void;
}) {
  const [now] = useState(Date.now);
  const next =
    sections.find((section) => section.fileIds.some((id) => !viewed.has(id))) ?? sections[0];
  const comments = sections.reduce((sum, section) => sum + section.notes.length, 0);
  return (
    <section aria-label="Guide overview" {...stylex.props(styles.page)}>
      <div {...stylex.props(styles.column)}>
        <p {...stylex.props(styles.eyebrow)}>
          {agent && (
            <span {...stylex.props(styles.agent)}>
              <Icon name={agent.mark} size={13} />
              Guide by {agent.name}
            </span>
          )}
          {!agent && sections.length > 0 && <span>Guide</span>}
          {from !== undefined && <span>· from iteration {from}</span>}
        </p>
        <h1 {...stylex.props(styles.title)}>{title}</h1>
        <p {...stylex.props(styles.meta)}>{meta}</p>
        {summary ? (
          <div {...stylex.props(styles.summary)}>
            <GuideMarkdown text={summary} size="lead" onOpenLink={onOpenLink} />
          </div>
        ) : (
          !sections.length && (
            <p {...stylex.props(styles.quiet)}>
              This review has no guide. Read it one commit at a time, or all at once in Changes.
            </p>
          )
        )}
        {(next || commits.length > 0) && (
          <div {...stylex.props(styles.start)}>
            <button
              type="button"
              onClick={() =>
                onScope(
                  next
                    ? { kind: "segment", key: next.key }
                    : { kind: "commit", id: commits[0]!.id },
                )
              }
              {...stylex.props(ui.button, ui.primary, ui.pressable, styles.startButton)}
            >
              {done > 0 && done < total ? "Continue" : "Start reviewing"}
              <Icon name="arrowLeft" size={13} style={{ transform: "rotate(180deg)" }} />
            </button>
            <span {...stylex.props(styles.startMeta)}>
              {sections.length > 0 &&
                `${sections.length} ${sections.length === 1 ? "segment" : "segments"}`}
              {sections.length > 0 &&
                comments > 0 &&
                ` · ${comments} ${comments === 1 ? "comment" : "comments"}`}
              {sections.length === 0 &&
                `${commits.length}${moreCommits ? "+" : ""} ${commits.length === 1 ? "commit" : "commits"}`}
              {total > 0 && ` · ${done} of ${total} files viewed`}
            </span>
          </div>
        )}
        {sections.length > 0 && (
          <>
            <h2 {...stylex.props(styles.label)}>Segments</h2>
            <ol {...stylex.props(styles.list)}>
              {sections.map((section) => {
                const seen = section.fileIds.filter((id) => viewed.has(id)).length;
                const sentence = firstSentence(section.summary);
                return (
                  <li key={section.key}>
                    <button
                      type="button"
                      onClick={() => onScope({ kind: "segment", key: section.key })}
                      {...stylex.props(styles.card)}
                    >
                      <span {...stylex.props(styles.number, section.automatic && styles.auto)}>
                        {section.automatic ? "··" : pad(section.number)}
                      </span>
                      <span {...stylex.props(styles.cardBody)}>
                        <span {...stylex.props(styles.cardTitle)}>{section.title}</span>
                        <span {...stylex.props(styles.cardMeta)}>
                          {section.critical && (
                            <span {...stylex.props(styles.critical)}>
                              <Icon name="alert" size={11} />
                              Needs care
                            </span>
                          )}
                          {section.area && (
                            <span {...stylex.props(styles.kind)}>{AREA_LABELS[section.area]}</span>
                          )}
                          {section.additions > 0 && (
                            <span {...stylex.props(ui.added)}>+{section.additions}</span>
                          )}
                          {section.deletions > 0 && (
                            <span {...stylex.props(ui.removed)}>−{section.deletions}</span>
                          )}
                          <span>
                            {section.fileIds.length}{" "}
                            {section.fileIds.length === 1 ? "file" : "files"}
                          </span>
                          {section.notes.length > 0 && (
                            <span {...stylex.props(styles.notes)}>
                              <Icon name="note" size={11} />
                              {section.notes.length}
                            </span>
                          )}
                        </span>
                        {sentence && <span {...stylex.props(styles.sentence)}>{sentence}</span>}
                      </span>
                      <span {...stylex.props(styles.progress)}>
                        <Progress value={seen} total={section.fileIds.length} />
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </>
        )}
        {commits.length > 0 && (
          <>
            <h2 {...stylex.props(styles.label)}>
              Commits
              <span {...stylex.props(styles.labelCount)}>
                {commits.length}
                {moreCommits ? "+" : ""}
              </span>
            </h2>
            <ol {...stylex.props(styles.list)}>
              {commits.map((commit) => (
                <li key={commit.id}>
                  <button
                    type="button"
                    onClick={() => onScope({ kind: "commit", id: commit.id })}
                    {...stylex.props(styles.commit)}
                  >
                    <span {...stylex.props(styles.sha)}>{commit.id.slice(0, 7)}</span>
                    <span {...stylex.props(styles.subject)}>{commit.subject}</span>
                    <span {...stylex.props(styles.when)}>
                      {commit.author} · {relativeTime(commit.timestamp, now)}
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          </>
        )}
      </div>
    </section>
  );
}

const styles = stylex.create({
  page: {
    flex: "1",
    minWidth: 0,
    minHeight: 0,
    overflowY: "auto",
    scrollbarWidth: "thin",
    containerType: "inline-size",
    backgroundColor: tokens.canvas,
    color: tokens.text,
    fontFamily: tokens.ui,
  },
  column: {
    boxSizing: "border-box",
    maxWidth: 760,
    marginInline: "auto",
    paddingTop: "clamp(28px, 6cqw, 56px)",
    paddingBottom: 72,
    paddingLeft: "clamp(20px, 5cqw, 48px)",
    paddingRight: "clamp(20px, 5cqw, 48px)",
  },
  eyebrow: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    margin: 0,
    color: tokens.faint,
    fontSize: 12,
  },
  agent: { display: "inline-flex", alignItems: "center", gap: 6, color: tokens.muted },
  title: {
    margin: 0,
    marginTop: 10,
    fontFamily: tokens.ui,
    fontSize: "clamp(22px, 3.4cqw, 28px)",
    fontWeight: 550,
    lineHeight: 1.2,
    letterSpacing: "-0.022em",
    textWrap: "balance",
  },
  meta: {
    marginTop: 10,
    marginBottom: 0,
    color: tokens.faint,
    fontFamily: tokens.code,
    fontSize: 11.5,
    fontVariantNumeric: "tabular-nums",
    overflowWrap: "anywhere",
  },
  summary: { marginTop: 26 },
  quiet: { marginTop: 22, marginBottom: 0, color: tokens.muted, fontSize: 14, lineHeight: 1.6 },
  start: { display: "flex", alignItems: "center", flexWrap: "wrap", gap: 14, marginTop: 28 },
  startButton: { minHeight: 32, paddingInline: 14, gap: 8, fontSize: 12.5 },
  startMeta: { color: tokens.faint, fontSize: 12 },
  label: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    marginTop: 44,
    marginBottom: 8,
    color: tokens.labelColor,
    fontFamily: tokens.ui,
    fontSize: tokens.labelSize,
    fontWeight: tokens.labelWeight,
    letterSpacing: tokens.labelTracking,
    textTransform: tokens.labelCase,
  },
  labelCount: { color: tokens.faint, fontFamily: tokens.code, fontSize: 10.5 },
  list: {
    listStyle: "none",
    margin: 0,
    padding: 0,
    borderTopWidth: 1,
    borderTopStyle: "solid",
    borderTopColor: tokens.line,
  },
  card: {
    display: "flex",
    alignItems: "flex-start",
    gap: 14,
    width: "100%",
    boxSizing: "border-box",
    paddingBlock: 14,
    paddingInline: 10,
    borderWidth: 0,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: tokens.line,
    backgroundColor: { default: "transparent", ":hover": tokens.fill },
    color: tokens.text,
    fontFamily: tokens.ui,
    textAlign: "left",
    cursor: "pointer",
    outline: { default: "none", ":focus-visible": `2px solid ${tokens.accentLine}` },
    outlineOffset: -2,
    transitionProperty: "background-color",
    transitionDuration: "120ms",
  },
  number: {
    flexShrink: 0,
    width: 20,
    paddingTop: 2,
    color: tokens.faint,
    fontFamily: tokens.code,
    fontSize: 12,
    fontVariantNumeric: "tabular-nums",
  },
  auto: { letterSpacing: "0.1em" },
  cardBody: { display: "flex", flexDirection: "column", gap: 5, flex: "1", minWidth: 0 },
  cardTitle: { fontSize: 14, fontWeight: 550, lineHeight: 1.35, letterSpacing: "-0.005em" },
  cardMeta: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 8,
    color: tokens.faint,
    fontFamily: tokens.code,
    fontSize: 10.5,
    fontVariantNumeric: "tabular-nums",
  },
  kind: {
    fontFamily: tokens.ui,
    fontSize: 10,
    fontWeight: 500,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
  },
  notes: { display: "inline-flex", alignItems: "center", gap: 3, color: tokens.accent },
  critical: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    color: tokens.warning,
    fontFamily: tokens.ui,
    fontSize: 10.5,
    fontWeight: 500,
  },
  sentence: { color: tokens.muted, fontSize: 12.5, lineHeight: 1.5 },
  progress: { display: "flex", paddingTop: 2 },
  commit: {
    display: "flex",
    alignItems: "baseline",
    gap: 12,
    width: "100%",
    boxSizing: "border-box",
    minHeight: 38,
    paddingBlock: 9,
    paddingInline: 10,
    borderWidth: 0,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: tokens.line,
    backgroundColor: { default: "transparent", ":hover": tokens.fill },
    color: tokens.text,
    fontFamily: tokens.ui,
    textAlign: "left",
    cursor: "pointer",
    outline: { default: "none", ":focus-visible": `2px solid ${tokens.accentLine}` },
    outlineOffset: -2,
  },
  sha: { flexShrink: 0, color: tokens.faint, fontFamily: tokens.code, fontSize: 11 },
  subject: {
    flex: "1",
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    fontSize: 13,
  },
  when: {
    display: { default: "inline", "@container (max-width: 520px)": "none" },
    flexShrink: 0,
    color: tokens.faint,
    fontSize: 11.5,
  },
});
