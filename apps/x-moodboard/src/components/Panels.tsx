import { useEffect, useRef, useState, type ReactNode } from "react";
import { fetchInfo } from "../lib/api";
import { count, longDate } from "../lib/format";
import type { Library } from "../lib/model";
import { dismissToast, useToasts } from "../lib/toasts";
import { CloseIcon, Mark } from "./Icons";

// ---------------------------------------------------------------- toasts

export function Toasts() {
  const toasts = useToasts();
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast--${t.tone}`}>
          <p>{t.message}</p>
          {t.action ? (
            <button
              type="button"
              className="toast-action"
              onClick={() => {
                dismissToast(t.id);
                t.action!.run();
              }}
            >
              {t.action.label}
            </button>
          ) : null}
          <button type="button" className="toast-close" onClick={() => dismissToast(t.id)} aria-label="Dismiss">
            <CloseIcon size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- modal

/** Native modal dialog: focus containment, Escape and inert background come from the browser. */
export function Modal(props: { open: boolean; onClose: () => void; label: string; className?: string; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    if (props.open && !dialog.open) dialog.showModal();
    if (!props.open && dialog.open) dialog.close();
  }, [props.open]);
  return (
    <dialog
      ref={ref}
      className={`modal ${props.className ?? ""}`}
      aria-label={props.label}
      onClose={props.onClose}
      onClick={(e) => {
        if (e.target === ref.current) props.onClose();
      }}
    >
      {props.open ? props.children : null}
    </dialog>
  );
}

const SHORTCUTS: [string[], string][] = [
  [["/"], "Search (also ⌘K or Ctrl K)"],
  [["←", "↑", "→", "↓"], "Move between posts in the grid"],
  [["Enter"], "Open the focused post"],
  [["F"], "Favourite the focused post"],
  [["Esc"], "Close the post, or leave search"],
  [["←", "→"], "Previous and next post, in the open post"],
  [["[", "]"], "Previous and next image in a set"],
  [["Z"], "Actual size and fit, for large images"],
  [["O"], "Open the original post on X"],
  [["?"], "Show these shortcuts"],
];

export function ShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} label="Keyboard shortcuts" className="modal--small">
      <div className="modal-head">
        <h2>Keyboard</h2>
        <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
          <CloseIcon size={18} />
        </button>
      </div>
      <dl className="shortcuts">
        {SHORTCUTS.map(([keys, label]) => (
          <div key={label}>
            <dt>
              {keys.map((k) => (
                <kbd key={k}>{k}</kbd>
              ))}
            </dt>
            <dd>{label}</dd>
          </div>
        ))}
      </dl>
    </Modal>
  );
}

export function LibraryInfoDialog({ open, onClose, library }: { open: boolean; onClose: () => void; library: Library | null }) {
  const [info, setInfo] = useState<{ counts?: Record<string, unknown> } | null>(null);
  useEffect(() => {
    if (open) fetchInfo().then(setInfo, () => setInfo(null));
  }, [open, library?.version]);
  const counts = info?.counts as
    | { items: number; excluded: number; states: Record<string, number>; derivedFrames: number; noTopic: number; failedFiles: unknown[] }
    | undefined;
  return (
    <Modal open={open} onClose={onClose} label="About this library" className="modal--small">
      <div className="modal-head">
        <h2>About this library</h2>
        <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
          <CloseIcon size={18} />
        </button>
      </div>
      {library ? (
        <div className="info">
          <p>
            {count(library.items.length)} posts from your X bookmarks. Posts saved only elsewhere are left out
            {counts ? ` (${count(counts.excluded)} in this archive)` : ""}.
          </p>
          <dl className="info-list">
            <dt>Snapshot</dt>
            <dd className="mono">{library.version}</dd>
            <dt>Adopted</dt>
            <dd>{longDate(library.adoptedAt)}</dd>
            <dt>Archive written</dt>
            <dd>{longDate(library.source.generatedAt)}</dd>
            {counts ? (
              <>
                <dt>Text cut short</dt>
                <dd>{count(counts.states.truncated ?? 0)}</dd>
                <dt>Possibly incomplete</dt>
                <dd>{count(counts.states.unverified ?? 0)}</dd>
                <dt>Article previews</dt>
                <dd>{count(counts.states.article ?? 0)}</dd>
                <dt>Missing media</dt>
                <dd>{count(counts.states["missing-media"] ?? 0)}</dd>
                <dt>Video frames made locally</dt>
                <dd>{count(counts.derivedFrames)}</dd>
              </>
            ) : null}
          </dl>
          <p className="quiet">
            The archive is read-only. Favourites and topic edits are kept separately and survive refreshes. To adopt a newer
            archive, run <code>bun run import</code> in <code>apps/x-moodboard</code>; open windows update in place.
          </p>
        </div>
      ) : null}
    </Modal>
  );
}

// ---------------------------------------------------------------- states

export function LibraryState(props: { kind: "loading" | "missing" | "offline" | "error" | "empty"; message?: string; onRetry?: () => void }) {
  const [visible, setVisible] = useState(props.kind !== "loading");
  useEffect(() => {
    if (props.kind !== "loading") return;
    const t = setTimeout(() => setVisible(true), 350); // avoid a flash on fast loads
    return () => clearTimeout(t);
  }, [props.kind]);
  if (!visible) return <div className="state" aria-busy="true" />;
  const copy = {
    loading: { title: "Opening your library…", body: null },
    missing: {
      title: "No library imported yet",
      body: (
        <>
          Import your archive once, from <code>apps/x-moodboard</code>:
          <pre>bun run import --source /path/to/archive-folder</pre>
        </>
      ),
    },
    offline: {
      title: "The library server is not running",
      body: (
        <>
          Start it from <code>apps/x-moodboard</code> with <code>bun run start</code>, then try again.
        </>
      ),
    },
    error: { title: "The library could not be loaded", body: props.message },
    empty: { title: "Your library is empty", body: "The adopted archive has no X bookmarks." },
  }[props.kind];
  return (
    <div className="state" role={props.kind === "loading" ? "status" : "alert"} aria-busy={props.kind === "loading"}>
      <Mark size={28} />
      <h1>{copy.title}</h1>
      {copy.body ? <div className="state-body">{copy.body}</div> : null}
      {props.onRetry && props.kind !== "loading" ? (
        <button type="button" className="button" onClick={props.onRetry}>
          Try again
        </button>
      ) : null}
    </div>
  );
}

export function NoResults(props: { query: string; favouritesOnly: boolean; hasFilters: boolean; onClearSearch: () => void; onClearFilters: () => void; onShowAll: () => void }) {
  if (props.favouritesOnly && !props.query && !props.hasFilters) {
    return (
      <div className="empty">
        <h2>No favourites yet</h2>
        <p>Use the heart on a card, or press F, to keep a post here.</p>
        <button type="button" className="button" onClick={props.onShowAll}>
          Browse all posts
        </button>
      </div>
    );
  }
  return (
    <div className="empty">
      <h2>Nothing matches{props.query ? ` “${props.query}”` : ""}</h2>
      <p>Search looks at post text, authors, topics and subtags. It does not read text inside images or videos.</p>
      <div className="empty-actions">
        {props.query ? (
          <button type="button" className="button" onClick={props.onClearSearch}>
            Clear search
          </button>
        ) : null}
        {props.hasFilters ? (
          <button type="button" className="button" onClick={props.onClearFilters}>
            {props.query ? "Search all posts" : "Remove filters"}
          </button>
        ) : null}
      </div>
    </div>
  );
}
