import * as stylex from "@stylexjs/stylex";
import { useState } from "react";
import type { ReviewOutput } from "../../../shared/review-output";
import type { Since } from "../../../shared/saved-review";
import type { GuideScope, GuideSection } from "../../data/guide";
import { tokens, ui } from "../../theme.stylex";
import { Icon, type IconName } from "../Icon";
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

/**
 * The Guide's first page: the proof, what changed and why, what changed since
 * the reader's last review, and the findings. It does not repeat the
 * segments, which the rail lists. A part that the
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
  /** The files that changed since the reader's last review, after the first hand-off. */
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
          {from !== undefined && <span>· from an earlier hand-off</span>}
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
  // Two lines at most; a longer title shows whole in the tooltip.
});
