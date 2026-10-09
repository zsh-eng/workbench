import * as stylex from "@stylexjs/stylex";
import type { Commit, CommitDetails } from "../../shared/protocol";
import { relativeTime } from "../data/relative-time";
import { tokens } from "../theme.stylex";
import { Icon } from "./Icon";

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});
// "type(scope)!: subject", as in Conventional Commits.
const CONVENTIONAL = /^([a-z]+)(?:\(([^)]+)\))?(!)?:\s+(.+)$/i;

function initials(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words.length > 1 ? words[0]![0]! + words.at(-1)![0]! : name.slice(0, 2);
  return letters.toUpperCase();
}

type Ref = { kind: "head" | "branch" | "tag"; name: string };
function parseRefs(refs: string[]): Ref[] {
  return refs
    .filter((ref) => ref !== "HEAD" && !ref.endsWith("/HEAD"))
    .map((ref) =>
      ref.startsWith("HEAD -> ")
        ? { kind: "head", name: ref.slice(8) }
        : ref.startsWith("tag: ")
          ? { kind: "tag", name: ref.slice(5) }
          : { kind: "branch", name: ref },
    );
}

/**
 * A commit's card: who and when, the message, its refs, and its size. The
 * color is the commit's graph lane, so the card matches the dot it came from.
 */
export function CommitCard({
  commit,
  color,
  details,
  now,
}: {
  commit: Commit;
  color: string;
  /** Undefined while loading; null when the details are not available. */
  details?: CommitDetails | null;
  now: number;
}) {
  const subject = commit.subject || "(no commit message)";
  const conventional = CONVENTIONAL.exec(subject);
  const refs = parseRefs(commit.refs);
  const authors = [commit.author, ...(details?.coAuthors ?? [])];
  return (
    <div {...stylex.props(styles.card, styles.lane(color))}>
      <header {...stylex.props(styles.header)}>
        <span {...stylex.props(styles.avatar)} aria-hidden="true">
          {initials(commit.author)}
        </span>
        <span {...stylex.props(styles.who)}>
          <span {...stylex.props(styles.author)}>
            {commit.author}
            {authors.length > 1 && (
              <span {...stylex.props(styles.coAuthors)}>
                {" "}
                with {authors.length === 2 ? authors[1] : `${authors.length - 1} others`}
              </span>
            )}
          </span>
          <time dateTime={new Date(commit.timestamp).toISOString()} {...stylex.props(styles.when)}>
            {relativeTime(commit.timestamp, now)} · {dateFormatter.format(commit.timestamp)}
          </time>
        </span>
        <span {...stylex.props(styles.hash)}>{commit.id.slice(0, 7)}</span>
      </header>
      <p {...stylex.props(styles.subject)}>
        {conventional ? (
          <>
            <span {...stylex.props(styles.type)}>
              {conventional[1]}
              {conventional[2] && <span {...stylex.props(styles.scope)}>{conventional[2]}</span>}
              {conventional[3]}
            </span>
            {conventional[4]}
          </>
        ) : (
          subject
        )}
      </p>
      {details?.body && <p {...stylex.props(styles.body)}>{details.body}</p>}
      {(refs.length > 0 || details) && (
        <footer {...stylex.props(styles.footer)}>
          {refs.map((ref) => (
            <span
              key={`${ref.kind}:${ref.name}`}
              {...stylex.props(styles.ref, ref.kind === "tag" && styles.tag)}
            >
              {ref.kind === "head" && <span {...stylex.props(styles.headDot)} />}
              {ref.kind !== "tag" && <Icon name="gitBranch" size={11} />}
              <span {...stylex.props(styles.refName)}>{ref.name}</span>
            </span>
          ))}
          {details && details.files > 0 && (
            <span {...stylex.props(styles.stats)}>
              <span>
                {details.files} {details.files === 1 ? "file" : "files"}
              </span>
              <span {...stylex.props(styles.added)}>+{details.additions}</span>
              <span {...stylex.props(styles.removed)}>−{details.deletions}</span>
            </span>
          )}
        </footer>
      )}
    </div>
  );
}

const lane = "var(--lane)";

const styles = stylex.create({
  lane: (color: string) => ({ "--lane": color }),
  card: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
    boxSizing: "border-box",
    width: 360,
    maxWidth: "calc(100vw - 32px)",
    padding: 12,
    color: tokens.text,
    fontFamily: tokens.ui,
    fontSize: 12,
    lineHeight: 1.5,
  },
  header: { display: "flex", alignItems: "center", gap: 9, minWidth: 0 },
  avatar: {
    flexShrink: 0,
    display: "grid",
    placeItems: "center",
    width: 24,
    height: 24,
    borderRadius: "50%",
    backgroundColor: `color-mix(in srgb, ${lane} 20%, ${tokens.raised})`,
    color: lane,
    fontSize: 9.5,
    fontWeight: 600,
    letterSpacing: "0.02em",
  },
  who: { display: "flex", flexDirection: "column", flex: "1", minWidth: 0 },
  author: {
    overflow: "hidden",
    whiteSpace: "nowrap",
    textOverflow: "ellipsis",
    fontWeight: 500,
    lineHeight: 1.35,
  },
  coAuthors: { color: tokens.muted, fontWeight: 400 },
  when: { color: tokens.muted, fontSize: 11, lineHeight: 1.35 },
  hash: {
    flexShrink: 0,
    alignSelf: "flex-start",
    paddingInline: 6,
    borderRadius: 5,
    backgroundColor: tokens.fill,
    color: tokens.muted,
    fontFamily: tokens.code,
    fontSize: 10.5,
    lineHeight: "18px",
    fontVariantNumeric: "tabular-nums",
  },
  subject: {
    margin: 0,
    fontSize: 13,
    fontWeight: 500,
    lineHeight: 1.45,
    overflowWrap: "anywhere",
    textWrap: "pretty",
  },
  type: {
    display: "inline-flex",
    alignItems: "baseline",
    gap: 4,
    marginInlineEnd: 6,
    paddingInline: 5,
    borderRadius: 4,
    backgroundColor: `color-mix(in srgb, ${lane} 15%, transparent)`,
    color: lane,
    fontFamily: tokens.code,
    fontSize: 11,
    fontWeight: 500,
    lineHeight: "18px",
    verticalAlign: "1px",
  },
  scope: {
    color: `color-mix(in srgb, ${lane} 70%, ${tokens.text})`,
    fontWeight: 400,
    "::before": { content: '"·"', marginInlineEnd: 4, opacity: 0.6 },
  },
  body: {
    margin: 0,
    marginTop: -4,
    color: tokens.muted,
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
    display: "-webkit-box",
    WebkitBoxOrient: "vertical",
    WebkitLineClamp: 6,
    overflow: "hidden",
  },
  footer: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 6,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopStyle: "solid",
    borderTopColor: tokens.line,
  },
  ref: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    maxWidth: 180,
    paddingInline: 6,
    borderRadius: 5,
    backgroundColor: tokens.accentSoft,
    color: tokens.accent,
    fontSize: 11,
    fontWeight: 500,
    lineHeight: "20px",
  },
  tag: {
    backgroundColor: "transparent",
    boxShadow: `inset 0 0 0 1px ${tokens.lineStrong}`,
    color: tokens.text,
  },
  headDot: {
    width: 6,
    height: 6,
    borderRadius: "50%",
    backgroundColor: tokens.accent,
  },
  refName: { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  stats: {
    display: "inline-flex",
    gap: 8,
    marginInlineStart: "auto",
    color: tokens.muted,
    fontSize: 11,
    fontVariantNumeric: "tabular-nums",
  },
  added: { color: tokens.green, fontFamily: tokens.code, fontSize: 10.5 },
  removed: { color: tokens.red, fontFamily: tokens.code, fontSize: 10.5 },
});
