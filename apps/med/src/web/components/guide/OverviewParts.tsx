import * as stylex from "@stylexjs/stylex";
import { useState } from "react";
import type { ReviewFinding, ReviewOutput, ReviewProof } from "../../../shared/review-output";
import type { Since } from "../../../shared/saved-review";
import { tokens, ui } from "../../theme.stylex";
import { Icon } from "../Icon";

// The parts of a version's review output on the Overview (docs/PRACTICES.md#c-views):
// its proof, what changed since the reader's last review, and its findings.
// Each shows only when the version has it.

/** Proof, with where it comes from when the agent did not write it. */
export type OverviewProof = ReviewProof & { fromTurn?: boolean };

export function ProofPart({ proof }: { proof: OverviewProof }) {
  const failed = proof.checks.filter((check) => check.status === "failed").length;
  return (
    <section aria-label="Proof" {...stylex.props(styles.part)}>
      <h2 {...stylex.props(styles.label)}>
        Proof
        {proof.checks.length > 0 && (
          <span {...stylex.props(styles.count, failed > 0 && styles.failedCount)}>
            {failed
              ? `${failed} of ${proof.checks.length} failed`
              : `${proof.checks.length} ${proof.checks.length === 1 ? "check" : "checks"}`}
          </span>
        )}
        {proof.fromTurn && (
          <span {...stylex.props(styles.count)}>· from the session's last turn</span>
        )}
      </h2>
      {proof.checks.length > 0 && (
        <ul {...stylex.props(styles.list)}>
          {proof.checks.map((check, index) => (
            <li key={index} {...stylex.props(styles.row)}>
              <span
                aria-label={check.status}
                {...stylex.props(
                  styles.status,
                  check.status === "passed" && styles.passed,
                  check.status === "failed" && styles.failed,
                )}
              >
                {check.status === "unknown" ? (
                  <span {...stylex.props(styles.dot)} />
                ) : (
                  <Icon name={check.status === "passed" ? "check" : "close"} size={12} />
                )}
              </span>
              <code {...stylex.props(styles.command)}>{check.command}</code>
              {check.result && <span {...stylex.props(styles.result)}>{check.result}</span>}
            </li>
          ))}
        </ul>
      )}
      {proof.media.length > 0 && (
        <ul aria-label="Media" {...stylex.props(styles.list)}>
          {proof.media.map((path) => (
            <li key={path} {...stylex.props(styles.row)}>
              <span {...stylex.props(styles.status)}>
                <Icon name="image" size={12} />
              </span>
              <code {...stylex.props(styles.command)}>{path}</code>
            </li>
          ))}
        </ul>
      )}
      {proof.notes.length > 0 && (
        <ul {...stylex.props(styles.plain)}>
          {proof.notes.map((note, index) => (
            <li key={index}>
              <Inline text={note} />
            </li>
          ))}
        </ul>
      )}
      {proof.misses.length > 0 && (
        <>
          <h3 {...stylex.props(styles.sublabel)}>Not covered</h3>
          <ul aria-label="Not covered" {...stylex.props(styles.plain)}>
            {proof.misses.map((miss, index) => (
              <li key={index}>
                <Inline text={miss} />
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

const BASIS: Record<Since["basis"], string> = {
  approved: "the version that you approved",
  commented: "the version that you commented on",
  previous: "the version before",
};
const CHANGE: Record<Since["files"][number]["change"], string> = {
  changed: "Changed",
  new: "New",
  gone: "Gone",
};

export function SincePart({ since, onOpen }: { since: Since; onOpen(path: string): void }) {
  return (
    <section aria-label="Since your last review" {...stylex.props(styles.part)}>
      <h2 {...stylex.props(styles.label)}>
        Since version {since.from}
        <span {...stylex.props(styles.count)}>
          {since.files.length} {since.files.length === 1 ? "file" : "files"}
        </span>
      </h2>
      <p {...stylex.props(styles.quiet)}>
        {since.files.length
          ? `What changed since ${BASIS[since.basis]}.`
          : `No file changed since ${BASIS[since.basis]}.`}
      </p>
      {since.files.length > 0 && (
        <ul {...stylex.props(styles.list)}>
          {since.files.map((file) => (
            <li key={`${file.repo ?? ""}\0${file.path}`}>
              <button
                type="button"
                disabled={file.change === "gone"}
                onClick={() => onOpen(file.path)}
                {...stylex.props(styles.row, styles.button)}
              >
                <span {...stylex.props(styles.change, file.change === "new" && styles.passed)}>
                  {CHANGE[file.change]}
                </span>
                <code {...stylex.props(styles.command)}>{file.path}</code>
                {file.repo && (
                  <span {...stylex.props(styles.result)}>{file.repo.split(/[\\/]/).at(-1)}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const SEVERITY: Record<ReviewFinding["severity"], string> = {
  important: "Important",
  nit: "Nit",
  "pre-existing": "Pre-existing",
};
const STATE: Record<Exclude<ReviewFinding["state"], "open">, string> = {
  fixed: "Fixed",
  intentional: "Intentional",
  "wont-fix": "Won't fix",
};
/** Text with its `code` spans set in the code font, as review output writes them. */
function Inline({ text }: { text: string }) {
  return text.split(/(`[^`]+`)/).map((part, index) =>
    part.length > 2 && part.startsWith("`") && part.endsWith("`") ? (
      <code key={index} {...stylex.props(styles.inlineCode)}>
        {part.slice(1, -1)}
      </code>
    ) : (
      part
    ),
  );
}
const place = (finding: ReviewFinding) =>
  finding.file &&
  `${finding.file}${finding.line ? `:${finding.line}${finding.endLine ? `-${finding.endLine}` : ""}` : ""}`;

export function FindingsPart({
  output,
  open,
  onOpen,
}: {
  output: Pick<ReviewOutput, "findings" | "counts" | "nothingToFix">;
  /** How many findings still need work. */
  open: number;
  onOpen(href: string): void;
}) {
  const { findings, counts } = output;
  return (
    <section aria-label="Findings" {...stylex.props(styles.part)}>
      <h2 {...stylex.props(styles.label)}>
        Findings
        <span {...stylex.props(styles.count)}>
          {findings.length
            ? `${open} open`
            : counts
              ? `${counts.important} Important · ${counts.nit} Nit · ${counts.preExisting} Pre-existing`
              : "none"}
        </span>
      </h2>
      {!findings.length && output.nothingToFix && (
        <p {...stylex.props(styles.quiet)}>The review found nothing to fix.</p>
      )}
      {findings.length > 0 && (
        <ul {...stylex.props(styles.list)}>
          {findings.map((finding, index) => {
            const where = place(finding);
            const closed = finding.state !== "open";
            const body = (
              <>
                <span
                  {...stylex.props(
                    styles.severity,
                    finding.severity === "important" && !closed && styles.important,
                  )}
                >
                  {SEVERITY[finding.severity]}
                </span>
                <span {...stylex.props(styles.findingBody)}>
                  <span {...stylex.props(styles.findingTitle, closed && styles.closed)}>
                    <Inline text={finding.title} />
                  </span>
                  {(where || closed) && (
                    <span {...stylex.props(styles.findingMeta)}>
                      {where && <code {...stylex.props(styles.place)}>{where}</code>}
                      {closed && (
                        <span>
                          {STATE[finding.state as keyof typeof STATE]}
                          {finding.reason && (
                            <>
                              : <Inline text={finding.reason} />
                            </>
                          )}
                        </span>
                      )}
                    </span>
                  )}
                </span>
              </>
            );
            return (
              <li key={index}>
                {where ? (
                  <button
                    type="button"
                    onClick={() => onOpen(where)}
                    {...stylex.props(styles.finding, styles.button)}
                  >
                    {body}
                  </button>
                ) : (
                  <div {...stylex.props(styles.finding)}>{body}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** A practice that Med offers where it would help (docs/PRACTICES.md#d-suggestion-pack). */
export interface Offer {
  id: string;
  /** Where it shows: in place of the explainer, of the proof, or after the rounds. */
  slot: "explainer" | "proof" | "rounds";
  title: string;
  text: string;
  action:
    | { kind: "copy"; label: string; text: string }
    | { kind: "run"; label: string; run(): void };
}

const offerKey = (id: string) => `med:offer:${id}`;
/** Whether the reader dismissed an offer; it stays dismissed in this browser. */
export function offerDismissed(id: string) {
  try {
    return localStorage.getItem(offerKey(id)) === "dismissed";
  } catch {
    return false;
  }
}
export function dismissOffer(id: string) {
  try {
    localStorage.setItem(offerKey(id), "dismissed");
  } catch {
    /* Preferences can be unavailable in private storage. */
  }
}

/**
 * A review practice offered where it would help, such as proof-first on a
 * version without proof. Med suggests it; the reader copies it or dismisses it.
 */
export function PracticeOffer({ offer, onDismiss }: { offer: Offer; onDismiss(): void }) {
  const [copied, setCopied] = useState(false);
  const { action } = offer;
  return (
    <aside aria-label={offer.title} {...stylex.props(styles.offer)}>
      <div {...stylex.props(styles.offerBody)}>
        <span {...stylex.props(styles.offerTitle)}>{offer.title}</span>
        <span {...stylex.props(styles.offerText)}>{offer.text}</span>
      </div>
      <div {...stylex.props(styles.offerActions)}>
        <button
          type="button"
          onClick={() => {
            if (action.kind === "run") return action.run();
            void navigator.clipboard.writeText(action.text).then(
              () => setCopied(true),
              () => setCopied(false),
            );
          }}
          {...stylex.props(ui.button, ui.outlined, ui.pressable)}
        >
          {action.kind === "copy" && <Icon name={copied ? "check" : "copy"} size={12} />}
          {action.kind === "copy" && copied ? "Copied" : action.label}
        </button>
        <button type="button" onClick={onDismiss} {...stylex.props(ui.button, ui.pressable)}>
          Dismiss
        </button>
      </div>
    </aside>
  );
}

const reduced = "@media (prefers-reduced-motion: reduce)";
const appear = stylex.keyframes({
  from: { opacity: 0, transform: "translateY(4px)" },
  to: { opacity: 1, transform: "none" },
});

const styles = stylex.create({
  part: { marginTop: 36 },
  label: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    marginTop: 0,
    marginBottom: 8,
    color: tokens.labelColor,
    fontFamily: tokens.ui,
    fontSize: tokens.labelSize,
    fontWeight: tokens.labelWeight,
    letterSpacing: tokens.labelTracking,
    textTransform: tokens.labelCase,
  },
  sublabel: {
    marginTop: 14,
    marginBottom: 4,
    color: tokens.faint,
    fontFamily: tokens.ui,
    fontSize: 11.5,
    fontWeight: 500,
  },
  count: {
    color: tokens.faint,
    fontFamily: tokens.code,
    fontSize: 10.5,
    textTransform: "none",
    letterSpacing: "normal",
  },
  failedCount: { color: tokens.red },
  quiet: { marginTop: 0, marginBottom: 8, color: tokens.muted, fontSize: 12.5, lineHeight: 1.5 },
  list: {
    listStyle: "none",
    margin: 0,
    padding: 0,
    borderTopWidth: 1,
    borderTopStyle: "solid",
    borderTopColor: tokens.line,
  },
  plain: {
    margin: 0,
    marginTop: 8,
    paddingLeft: 18,
    color: tokens.muted,
    fontSize: 12.5,
    lineHeight: 1.6,
  },
  row: {
    display: "flex",
    alignItems: "baseline",
    gap: 10,
    width: "100%",
    boxSizing: "border-box",
    minHeight: 32,
    paddingBlock: 7,
    paddingInline: 10,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: tokens.line,
    color: tokens.text,
    fontFamily: tokens.ui,
    textAlign: "left",
  },
  button: {
    borderWidth: 0,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: tokens.line,
    backgroundColor: { default: "transparent", ":hover:not(:disabled)": tokens.fill },
    cursor: { default: "pointer", ":disabled": "default" },
    outline: { default: "none", ":focus-visible": `2px solid ${tokens.accentLine}` },
    outlineOffset: -2,
    transitionProperty: "background-color",
    transitionDuration: { default: "120ms", [reduced]: "0ms" },
  },
  status: {
    display: "inline-flex",
    alignSelf: "center",
    justifyContent: "center",
    flexShrink: 0,
    width: 14,
    color: tokens.faint,
  },
  passed: { color: tokens.green },
  failed: { color: tokens.red },
  dot: { width: 5, height: 5, borderRadius: "50%", backgroundColor: tokens.faint },
  command: {
    minWidth: 0,
    overflowWrap: "anywhere",
    fontFamily: tokens.code,
    fontSize: 12,
  },
  result: { flexShrink: 0, marginLeft: "auto", color: tokens.faint, fontSize: 12 },
  change: {
    flexShrink: 0,
    width: 56,
    color: tokens.muted,
    fontSize: 10,
    fontWeight: 500,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
  },
  finding: {
    display: "flex",
    alignItems: "flex-start",
    gap: 12,
    width: "100%",
    boxSizing: "border-box",
    paddingBlock: 10,
    paddingInline: 10,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: tokens.line,
    color: tokens.text,
    fontFamily: tokens.ui,
    textAlign: "left",
  },
  severity: {
    flexShrink: 0,
    width: 76,
    paddingTop: 2,
    color: tokens.faint,
    fontSize: 10,
    fontWeight: 500,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
  },
  important: { color: tokens.warning },
  findingBody: { display: "flex", flexDirection: "column", gap: 4, minWidth: 0 },
  findingTitle: { fontSize: 13, lineHeight: 1.45, overflowWrap: "anywhere" },
  closed: { color: tokens.muted },
  findingMeta: {
    display: "flex",
    flexWrap: "wrap",
    gap: 8,
    color: tokens.faint,
    fontSize: 11.5,
    lineHeight: 1.45,
  },
  place: { fontFamily: tokens.code, fontSize: 11, overflowWrap: "anywhere" },
  inlineCode: { fontFamily: tokens.code, fontSize: "0.92em" },
  offer: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 12,
    marginTop: 22,
    paddingBlock: 10,
    paddingInline: 12,
    borderRadius: `calc(8px * ${tokens.round})`,
    boxShadow: `inset 0 0 0 1px ${tokens.line}`,
    animationName: { default: appear, [reduced]: "none" },
    animationDuration: "180ms",
    animationTimingFunction: tokens.easeOut,
  },
  offerBody: { display: "flex", flexDirection: "column", gap: 3, flex: "1", minWidth: 220 },
  offerTitle: { color: tokens.text, fontSize: 12.5, fontWeight: 500 },
  offerText: { color: tokens.muted, fontSize: 12, lineHeight: 1.5 },
  offerActions: { display: "flex", alignItems: "center", gap: 4 },
});
