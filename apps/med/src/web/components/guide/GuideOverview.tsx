import * as stylex from "@stylexjs/stylex";
import { useState } from "react";
import type { ReviewOutput } from "../../../shared/review-output";
import type { Since } from "../../../shared/saved-review";
import { AREA_LABELS, firstSentence, type GuideScope, type GuideSection } from "../../data/guide";
import { tokens, ui } from "../../theme.stylex";
import { Icon, type IconName } from "../Icon";
import { clippedTooltip } from "../ToolButton";
import { GuideMarkdown } from "./GuideMarkdown";
import {
  dismissOffer,
  FindingsPart,
  offerDismissed,
  PracticeOffer,
  ProofPart,
  SincePart,
  type Offer,
  type OverviewProof,
} from "./OverviewParts";

const pad = (value: number) => String(value).padStart(2, "0");

/**
 * The Guide's first page: the proof, what changed and why, what changed since
 * the reader's last review, the findings, then the segments to read. Each
 * row opens its part of the diff. A part that the
 * version does not have does not show.
 */
export function GuideOverview({
  title,
  meta,
  summary,
  from,
  agent,
  sections,
  proof,
  findings,
  openFindings = 0,
  since,
  offers = [],
  repo,
  onSince,
  onScope,
  onWhole,
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
  /** The version's proof, or the checks that its session ran. */
  proof?: OverviewProof;
  /** The version's findings, from its notes or guide (shared/review-output.ts). */
  findings?: Pick<ReviewOutput, "findings" | "counts" | "nothingToFix">;
  openFindings?: number;
  /** The files that changed since the reader's last review, from version 2. */
  since?: Since | null;
  /** Practices that would help here, most useful first; one shows at a time. */
  offers?: readonly Offer[];
  /** The review's checkout, for the summary's images. */
  repo?: string;
  /** Shows what changed since the last review, at a file when one is given. */
  onSince(file?: Since["files"][number]): void;
  onScope(scope: GuideScope): void;
  /** Shows the whole diff of the Review's version. */
  onWhole(): void;
  onOpenLink(href: string): void;
}) {
  const next = sections[0];
  const comments = sections.reduce((sum, section) => sum + section.notes.length, 0);
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(
    () => new Set(offers.filter((offer) => offerDismissed(offer.id)).map((offer) => offer.id)),
  );
  const offer = offers.find((entry) => !dismissed.has(entry.id) && !offerDismissed(entry.id));
  const offerIn = (slot: Offer["slot"]) =>
    offer?.slot === slot && (
      <PracticeOffer
        key={offer.id}
        offer={offer}
        onDismiss={() => {
          dismissOffer(offer.id);
          setDismissed((current) => new Set(current).add(offer.id));
        }}
      />
    );
  const hasFindings =
    !!findings && (findings.findings.length > 0 || !!findings.counts || !!findings.nothingToFix);
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
          {from !== undefined && <span>· from version {from}</span>}
        </p>
        <h1 {...stylex.props(styles.title)}>{title}</h1>
        <p {...stylex.props(styles.meta)}>{meta}</p>
        {proof ? <ProofPart proof={proof} /> : offerIn("proof")}
        {summary ? (
          <div {...stylex.props(styles.summary)}>
            <GuideMarkdown text={summary} size="lead" repo={repo} onOpenLink={onOpenLink} />
          </div>
        ) : offer?.slot === "explainer" ? (
          offerIn("explainer")
        ) : null}
        <div {...stylex.props(styles.start)}>
          {next && (
            <button
              type="button"
              onClick={() => onScope({ kind: "segment", key: next.key })}
              {...stylex.props(ui.button, ui.primary, ui.pressable, styles.startButton)}
            >
              Start reviewing
              <Icon name="arrowLeft" size={13} style={{ transform: "rotate(180deg)" }} />
            </button>
          )}
          <button
            type="button"
            onClick={onWhole}
            {...stylex.props(ui.button, !next && ui.primary, ui.pressable, styles.startButton)}
          >
            All files
          </button>
          <span {...stylex.props(styles.startMeta)}>
            {[
              sections.length > 0 &&
                `${sections.length} ${sections.length === 1 ? "segment" : "segments"}`,
              sections.length > 0 &&
                comments > 0 &&
                `${comments} ${comments === 1 ? "comment" : "comments"}`,
              openFindings > 0 &&
                `${openFindings} open ${openFindings === 1 ? "finding" : "findings"}`,
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </div>
        {since && <SincePart since={since} onOpen={onSince} />}
        {offerIn("rounds")}
        {hasFindings && <FindingsPart output={findings} open={openFindings} onOpen={onOpenLink} />}
        {sections.length > 0 && (
          <>
            <h2 {...stylex.props(styles.label)}>Segments</h2>
            <ol {...stylex.props(styles.list)}>
              {sections.map((section) => {
                const sentence = firstSentence(section.summary);
                return (
                  <li key={section.key}>
                    <button
                      type="button"
                      onClick={() => onScope({ kind: "segment", key: section.key })}
                      {...clippedTooltip(section.title)}
                      {...stylex.props(styles.card)}
                    >
                      <span {...stylex.props(styles.number, section.automatic && styles.auto)}>
                        {section.automatic ? "··" : pad(section.number)}
                      </span>
                      <span {...stylex.props(styles.cardBody)}>
                        <span data-clip="lines" {...stylex.props(styles.cardTitle)}>
                          {section.title}
                        </span>
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
                    </button>
                  </li>
                );
              })}
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
  // Two lines at most; a longer title shows whole in the tooltip.
  cardTitle: {
    display: "-webkit-box",
    WebkitBoxOrient: "vertical",
    WebkitLineClamp: 2,
    overflow: "hidden",
    overflowWrap: "anywhere",
    fontSize: 14,
    fontWeight: 550,
    lineHeight: 1.35,
    letterSpacing: "-0.005em",
  },
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
});
