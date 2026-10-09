import { PreviewCard } from "@base-ui/react/preview-card";
import * as stylex from "@stylexjs/stylex";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { BrowseRead } from "../../shared/browse";
import type { CommitDetails } from "../../shared/protocol";
import type { CommitLoader } from "../data/blame";
import { uncommitted, type LineBlame as Blame } from "../data/line-blame";
import { relativeTime } from "../data/relative-time";
import { tokens, ui } from "../theme.stylex";
import { CommitCard } from "./CommitCard";

/**
 * Rules for the label inside a code row. The text is generated content, so the
 * row keeps only code text for the caret, clicks, and copying. `row` scopes the
 * rules above the view's own token colors.
 */
export const lineBlameCSS = (row: string, color: string) => `
  ${row} [data-med-line-blame-label] { display: inline-block; max-width: min(64ch, 70vw); margin-left: 4ch; overflow: hidden; vertical-align: top; white-space: nowrap; text-overflow: ellipsis; font-family: ${tokens.ui}; font-size: 11px; font-weight: 400; color: ${color}; background: none; user-select: none; -webkit-user-select: none; cursor: default; }
  ${row} [data-med-line-blame-label]::before { content: attr(data-who); }
  ${row} [data-med-line-blame-label]::after { content: attr(data-summary); }`;

/**
 * The cursor line's author and age after its text, as in an editor's inline
 * blame. The view places `anchor` at the end of the row. Hovering the label
 * opens the commit's card; the card loads the message body and size then.
 */
export function LineBlame({
  blame,
  anchor,
  file,
  loadCommit,
}: {
  blame: Blame | null;
  anchor: HTMLElement;
  file: BrowseRead | null;
  loadCommit?: CommitLoader;
}) {
  const [openLine, setOpenLine] = useState<number | null>(null);
  const [details, setDetails] = useState(() => new Map<string, CommitDetails | null>());
  const requested = useRef(new Set<string>());
  const loaders = useRef(new AbortController());
  useEffect(() => {
    const abort = loaders.current;
    return () => abort.abort();
  }, []);
  if (!blame) return null;
  const { entry, now } = blame;
  const local = uncommitted(entry);
  const time = Date.parse(entry.date);
  const who = local
    ? "Not committed yet"
    : `${entry.author}${Number.isFinite(time) ? `, ${relativeTime(time, now)}` : ""}`;
  const key = `${file?.source.repo}\0${entry.commit}`;
  const prefetch = () => {
    if (local || !file || !loadCommit || requested.current.has(key)) return;
    requested.current.add(key);
    const settle = (value: CommitDetails | null) =>
      setDetails((current) => new Map(current).set(key, value));
    loadCommit(file.source.repo, entry.commit, loaders.current.signal).then(settle, () => {
      if (!loaders.current.signal.aborted) settle(null);
    });
  };
  return (
    <PreviewCard.Root
      open={!local && openLine === blame.line}
      onOpenChange={(open) => {
        if (open) prefetch();
        setOpenLine(open ? blame.line : null);
      }}
    >
      {createPortal(
        <PreviewCard.Trigger
          delay={350}
          closeDelay={150}
          render={<span />}
          tabIndex={-1}
          data-med-line-blame-label=""
          data-who={who}
          data-summary={!local && entry.summary ? ` · ${entry.summary}` : ""}
          aria-label={`Line ${blame.line}: ${who}${local ? "" : ` · ${entry.summary}`}`}
          onPointerEnter={prefetch}
        />,
        anchor,
      )}
      <PreviewCard.Portal>
        <PreviewCard.Positioner
          side="bottom"
          align="start"
          sideOffset={6}
          collisionPadding={8}
          {...stylex.props(styles.positioner)}
        >
          <PreviewCard.Popup {...stylex.props(styles.popup, ui.pop)}>
            <CommitCard
              commit={{
                id: entry.commit,
                parents: [],
                subject: entry.summary,
                author: entry.author,
                timestamp: time,
                refs: [],
              }}
              color={tokens.accent}
              details={loadCommit ? details.get(key) : null}
              now={now}
              copyable
            />
          </PreviewCard.Popup>
        </PreviewCard.Positioner>
      </PreviewCard.Portal>
    </PreviewCard.Root>
  );
}

const styles = stylex.create({
  positioner: {
    zIndex: 100,
    visibility: { default: "visible", ":is([data-anchor-hidden])": "hidden" },
  },
  popup: {
    backgroundColor: tokens.raised,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: tokens.lineStrong,
    borderRadius: 10,
    boxShadow: tokens.shadow,
  },
});
