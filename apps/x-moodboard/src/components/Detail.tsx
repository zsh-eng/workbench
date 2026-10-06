import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ItemDetail, LibraryItem, Topic, UserEdit } from "../../shared/schema";
import { fetchDetail } from "../lib/api";
import { count, longDate, plural } from "../lib/format";
import type { CardGeometry } from "./Grid";
import type { Index, Library } from "../lib/model";
import { bestSrc, mediaImage, preloadImage } from "../lib/media";
import { EASE_IN_OUT, EASE_OUT, reducedMotion, T_FAST, T_SLOW } from "../lib/motion";
import { isEditable } from "../lib/prefs";
import { articleBody, segments, type Segment } from "../lib/text";
import { showToast } from "../lib/toasts";
import { ArrowOut, ChevronLeft, ChevronRight, CloseIcon, Heart, Link } from "./Icons";
import { Stage, usePauseWhenHidden } from "./Stage";
import { TopicEditor } from "./TopicEditor";

interface DetailProps {
  library: Library;
  index: Index;
  itemIndex: number;
  position: number | null;
  resultCount: number;
  favourite: boolean;
  terms: string[];
  origin: CardGeometry | null;
  closing: boolean;
  returnGeometry: (postId: string) => CardGeometry | null;
  onClose: () => void;
  onStep: (delta: 1 | -1) => void;
  onExited: () => void;
  onToggleFavourite: () => void;
  onSaveEdit: (edit: Omit<UserEdit, "editedAt">) => void;
  onResetEdit: () => void;
}

export function Detail(props: DetailProps) {
  const { library, index, itemIndex, position, resultCount, favourite, terms, origin, closing } = props;
  const item = library.items[itemIndex];
  const hasMedia = item.media.length > 0;
  const rootRef = useRef<HTMLDivElement>(null);
  const mediaRef = useRef<HTMLDivElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const [mediaIndex, setMediaIndex] = useState(() => Math.max(0, item.media.findIndex((m) => m.kind !== "missing")));
  const [actual, setActual] = useState(false);
  const [editing, setEditing] = useState(false);
  const firstPost = useRef(item.postId);
  const placeholder = item.postId === firstPost.current ? origin?.src ?? null : null;
  usePauseWhenHidden();

  // Reset per-post view state when stepping.
  const [shownPost, setShownPost] = useState(item.postId);
  if (shownPost !== item.postId) {
    setShownPost(item.postId);
    setMediaIndex(Math.max(0, item.media.findIndex((m) => m.kind !== "missing")));
    setActual(false);
    setEditing(false);
  }

  // ------------------------------------------------------------ enter

  useLayoutEffect(() => {
    const root = rootRef.current!;
    root.focus({ preventScroll: true });
    const reduce = reducedMotion();
    const backdrops = root.querySelectorAll<HTMLElement>(".detail-backdrop, .stage-bg");
    const chrome = root.querySelectorAll<HTMLElement>(".detail-bar, .aside:not(.aside--page), .stage-foot, .stage-strip, .page-content");
    if (reduce) {
      root.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 120 });
      return;
    }
    backdrops.forEach((el) => el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220, easing: EASE_OUT }));
    chrome.forEach((el) =>
      el.animate([{ opacity: 0, transform: "translateY(6px)" }, { opacity: 1, transform: "none" }], {
        duration: 260,
        delay: 70,
        easing: EASE_OUT,
        fill: "backwards",
      }),
    );
    const target = hasMedia ? mediaRef.current : surfaceRef.current;
    if (origin && target) morph(target, origin, "in", hasMedia);
    else if (target) target.animate([{ opacity: 0, transform: "scale(0.985)" }, { opacity: 1, transform: "none" }], { duration: 240, easing: EASE_OUT });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ------------------------------------------------------------ exit

  useEffect(() => {
    if (!closing) return;
    const root = rootRef.current!;
    // Finish even if the animation timeline is paused (hidden tab) or an animation is cancelled.
    let finished = false;
    const done = () => {
      if (finished) return;
      finished = true;
      window.clearTimeout(fallback);
      props.onExited();
    };
    const fallback = window.setTimeout(done, 450);
    const reduce = reducedMotion();
    const target = hasMedia ? mediaRef.current : surfaceRef.current;
    for (const a of root.getAnimations({ subtree: true })) {
      try {
        a.commitStyles();
      } catch {
        // Nothing to keep when the element is not rendered.
      }
      a.cancel();
    }
    if (reduce) {
      root.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 120, fill: "forwards" }).finished.then(done, done);
      return;
    }
    const geometry = props.returnGeometry(item.postId);
    const backdrops = root.querySelectorAll<HTMLElement>(".detail-backdrop, .stage-bg");
    const chrome = root.querySelectorAll<HTMLElement>(".detail-bar, .aside:not(.aside--page), .stage-foot, .stage-strip, .page-content, .stage-play");
    chrome.forEach((el) => el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: T_FAST, fill: "forwards" }));
    if (geometry && target && geometry.kind === (hasMedia ? "media" : "text")) {
      backdrops.forEach((el) => el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 260, easing: EASE_IN_OUT, fill: "forwards" }));
      morph(target, geometry, "out", hasMedia).finished.then(done, done);
    } else {
      root.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 180, easing: EASE_IN_OUT, fill: "forwards" }).finished.then(done, done);
    }
    return () => window.clearTimeout(fallback);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [closing]);

  // Crossfade between posts; the shell and toolbar stay still.
  const lastStep = useRef<1 | -1>(1);
  useLayoutEffect(() => {
    if (item.postId === firstPost.current || reducedMotion()) return;
    const content = rootRef.current?.querySelectorAll<HTMLElement>(".stage-media, .page, .aside-inner");
    content?.forEach((el) =>
      el.animate(
        [
          { opacity: 0, transform: `translateX(${lastStep.current * 18}px)` },
          { opacity: 1, transform: "none" },
        ],
        { duration: 220, easing: EASE_OUT },
      ),
    );
  }, [item.postId]);

  const step = (delta: 1 | -1) => {
    lastStep.current = delta;
    props.onStep(delta);
  };

  // Listen on window: focus can fall to <body> when a focused control unmounts (for example Play).
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
    if (closing || document.querySelector("dialog[open]")) return;
    const target = event.target as HTMLElement;
    const typing = isEditable(target);
    if (event.key === "Escape") {
      event.preventDefault();
      if (actual) setActual(false);
      else props.onClose();
      return;
    }
    if (typing || target.tagName === "VIDEO") return;
    const total = item.media.length;
    switch (event.key) {
      case "ArrowRight":
        event.preventDefault();
        return step(1);
      case "ArrowLeft":
        event.preventDefault();
        return step(-1);
      case "ArrowDown":
      case "]":
        if (total > 1) {
          event.preventDefault();
          setMediaIndex((i) => (i + 1) % total);
        }
        return;
      case "ArrowUp":
      case "[":
        if (total > 1) {
          event.preventDefault();
          setMediaIndex((i) => (i - 1 + total) % total);
        }
        return;
      case "f":
      case "F":
        event.preventDefault();
        return props.onToggleFavourite();
      case "z":
      case "Z":
        event.preventDefault();
        return setActual((a) => !a);
      case "o":
      case "O":
        event.preventDefault();
        window.open(item.url, "_blank", "noopener,noreferrer");
        return;
    }
  };

  const keyHandler = useRef(onKeyDown);
  keyHandler.current = onKeyDown;
  useEffect(() => {
    const handle = (event: KeyboardEvent) => keyHandler.current(event);
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, []);

  const atStart = position === null || position <= 0;
  const atEnd = position === null || position >= resultCount - 1;

  return (
    <div
      ref={rootRef}
      className={`detail${hasMedia ? " detail--media" : " detail--text"}`}
      role="dialog"
      aria-modal="true"
      aria-labelledby="detail-title"
      tabIndex={-1}
    >
      <div className="detail-backdrop" />
      <header className="detail-bar">
        <button type="button" className="bar-button" onClick={props.onClose} aria-label="Close (Escape)">
          <CloseIcon size={18} />
          <span className="bar-button-label">Library</span>
        </button>
        <p className="detail-position" aria-live="polite">
          {position === null ? "Not in the current results" : `${count(position + 1)} of ${count(resultCount)}`}
        </p>
        <div className="detail-bar-end">
          <button type="button" className="icon-button" onClick={() => step(-1)} disabled={atStart} aria-label="Previous post (←)">
            <ChevronLeft size={18} />
          </button>
          <button type="button" className="icon-button" onClick={() => step(1)} disabled={atEnd} aria-label="Next post (→)">
            <ChevronRight size={18} />
          </button>
          <a className="bar-link" href={item.url} target="_blank" rel="noreferrer noopener">
            Open on X <ArrowOut size={14} />
          </a>
        </div>
      </header>

      <div className="detail-body">
        {hasMedia ? (
          <Stage
            item={item}
            index={Math.min(mediaIndex, item.media.length - 1)}
            onIndex={setMediaIndex}
            actual={actual}
            onActual={setActual}
            placeholderSrc={placeholder}
            mediaRef={mediaRef}
          />
        ) : null}
        <Aside
          item={item}
          itemIndex={itemIndex}
          index={index}
          library={library}
          terms={terms}
          favourite={favourite}
          editing={editing}
          onEditing={setEditing}
          surfaceRef={surfaceRef}
          pageLayout={!hasMedia}
          onToggleFavourite={props.onToggleFavourite}
          onSaveEdit={(edit) => {
            props.onSaveEdit(edit);
            setEditing(false);
          }}
          onResetEdit={() => {
            props.onResetEdit();
            setEditing(false);
          }}
        />
      </div>

      <nav className="detail-dock" aria-label="Post navigation">
        <button type="button" className="dock-button" onClick={() => step(-1)} disabled={atStart}>
          <ChevronLeft size={18} /> Previous
        </button>
        <span className="detail-dock-position">{position === null ? "" : `${count(position + 1)} / ${count(resultCount)}`}</span>
        <button type="button" className="dock-button" onClick={() => step(1)} disabled={atEnd}>
          Next <ChevronRight size={18} />
        </button>
      </nav>
    </div>
  );
}

/**
 * Card ↔ detail morph. The detail element is laid out at its final place; we
 * animate it from (or to) the card's rect with transform and a clip for cropped cards.
 */
function morph(el: HTMLElement, card: CardGeometry, direction: "in" | "out", media: boolean): Animation {
  const final = el.getBoundingClientRect();
  const o = card.rect;
  el.style.transformOrigin = "0 0";
  let from: Keyframe;
  if (media) {
    const s = o.width / final.width;
    const clipBottom = Math.max(0, final.height - card.visibleHeight / s);
    from = {
      transform: `translate(${o.left - final.left}px, ${o.top - final.top}px) scale(${s})`,
      clipPath: `inset(0px 0px ${clipBottom}px 0px round ${card.radius / s}px)`,
    };
  } else {
    from = {
      transform: `translate(${o.left - final.left}px, ${o.top - final.top}px) scale(${o.width / final.width}, ${o.height / final.height})`,
      clipPath: "inset(0px 0px 0px 0px round 0px)",
    };
  }
  const to: Keyframe = { transform: "translate(0px, 0px) scale(1)", clipPath: "inset(0px 0px 0px 0px round 0px)" };
  return el.animate(direction === "in" ? [from, to] : [to, from], {
    duration: direction === "in" ? T_SLOW : 260,
    easing: direction === "in" ? EASE_OUT : EASE_IN_OUT,
    fill: direction === "in" ? "none" : "forwards",
  });
}

// ---------------------------------------------------------------- aside

interface AsideProps {
  item: LibraryItem;
  itemIndex: number;
  index: Index;
  library: Library;
  terms: string[];
  favourite: boolean;
  editing: boolean;
  onEditing: (editing: boolean) => void;
  surfaceRef: React.Ref<HTMLDivElement>;
  pageLayout: boolean;
  onToggleFavourite: () => void;
  onSaveEdit: (edit: Omit<UserEdit, "editedAt">) => void;
  onResetEdit: () => void;
}

function Text({ parts }: { parts: Segment[] }) {
  return (
    <>
      {parts.map((p, i) =>
        p.kind === "link" ? (
          <a key={i} href={p.href} target="_blank" rel="noreferrer noopener">
            {p.value.length > 42 ? `${p.value.slice(0, 40)}…` : p.value}
          </a>
        ) : p.kind === "mark" ? (
          <mark key={i}>{p.value}</mark>
        ) : (
          <span key={i}>{p.value}</span>
        ),
      )}
    </>
  );
}

function Aside(props: AsideProps) {
  const { item, itemIndex, index, library, terms, favourite, editing, pageLayout } = props;
  const [evidence, setEvidence] = useState<{ id: string; detail: ItemDetail | null; error: string | null }>({
    id: "",
    detail: null,
    error: null,
  });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    fetchDetail(item.id, controller.signal).then(
      (detail) => setEvidence({ id: item.id, detail, error: null }),
      (error: Error) => {
        if (error.name !== "AbortError") setEvidence({ id: item.id, detail: null, error: error.message });
      },
    );
    return () => controller.abort();
  }, [item.id, attempt]);

  const topics = index.effectiveTopics[itemIndex];
  const subtags = index.effectiveSubtags[itemIndex];
  const edited = index.edited[itemIndex] === 1;
  const body = articleBody(item.text, item.articleTitle);
  const missing = item.media.filter((m) => m.kind === "missing");
  const detail = evidence.id === item.id ? evidence.detail : null;
  const author = item.name?.trim() || `@${item.handle}`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(item.url);
      showToast({ tone: "info", message: "Post link copied" });
    } catch {
      showToast({ tone: "error", message: "Could not copy the link" });
    }
  };

  const notices: React.ReactNode[] = [];
  if (item.textState === "truncated")
    notices.push(
      <>
        The X bookmarks timeline cut this text short.{" "}
        <a href={item.url} target="_blank" rel="noreferrer noopener">
          Read the full post on X
        </a>
        .
      </>,
    );
  if (item.textState === "unverified") notices.push("Long post. The saved text may be incomplete; it has not been checked against X.");
  if (item.textState === "article")
    notices.push(
      <>
        Only the preview of this X article was saved.{" "}
        <a href={item.url} target="_blank" rel="noreferrer noopener">
          Read the article on X
        </a>
        .
      </>,
    );
  if (missing.length) notices.push(`${plural(missing.length, "media item")} from this post ${missing.length === 1 ? "was" : "were"} not saved locally.`);
  if (item.formats.includes("video-preview")) notices.push("Video preview — open original. Only the poster image was saved.");

  const content = (
    <>
      <div className="author">
        <p className="author-name" id="detail-title">
          {author}
        </p>
        <p className="author-meta">
          <a href={`https://x.com/${item.handle}`} target="_blank" rel="noreferrer noopener">
            @{item.handle}
          </a>
          <span aria-hidden="true"> · </span>
          <time dateTime={item.postedAt ?? undefined}>{longDate(item.postedAt)}</time>
        </p>
      </div>

      {item.articleTitle ? (
        <div className="article-head">
          <p className="eyebrow">X article · preview</p>
          <h2 className="article-title">{item.articleTitle}</h2>
        </div>
      ) : null}

      <div className="post-text">
        <Text parts={segments(body.trim(), terms)} />
        {item.textState === "truncated" || item.textState === "article" ? <span className="post-text-cut" aria-hidden="true"> …</span> : null}
      </div>

      {notices.length ? (
        <ul className="notices">
          {notices.map((n, i) => (
            <li key={i}>{n}</li>
          ))}
        </ul>
      ) : null}

      {item.quote ? (
        <figure className="quote">
          <figcaption className="eyebrow">
            Quoting {item.quote.handle ? `@${item.quote.handle}` : "another post"}
          </figcaption>
          {item.quote.text ? (
            <blockquote>
              <Text parts={segments(item.quote.text, terms)} />
            </blockquote>
          ) : (
            <p className="quiet">The quoted text was not saved{item.media.some((m) => m.role === "quoted") ? "; its media appears with this post" : ""}.</p>
          )}
          {item.quote.url ? (
            <a className="quiet-link" href={item.quote.url} target="_blank" rel="noreferrer noopener">
              Open quoted post <ArrowOut size={12} />
            </a>
          ) : null}
        </figure>
      ) : null}

      {detail?.snippetSummary ? (
        <aside className="generated">
          <p className="eyebrow">Summary of the saved snippet — written during archive review, not post text</p>
          <p>{detail.snippetSummary.text}</p>
        </aside>
      ) : null}
      {detail?.articleSummary ? (
        <aside className="generated">
          <p className="eyebrow">Summary written during archive review — the article body was not saved</p>
          <p>{detail.articleSummary.text}</p>
        </aside>
      ) : null}

      <section className="topics" aria-labelledby="topics-label">
        <div className="section-head">
          <p className="eyebrow" id="topics-label">
            Topics{edited ? " · edited by you" : item.topicReview ? " · suggested, needs review" : ""}
          </p>
          {!editing ? (
            <button type="button" className="text-button" onClick={() => props.onEditing(true)}>
              Edit
            </button>
          ) : null}
        </div>
        {editing ? (
          <TopicEditor
            taxonomy={library.taxonomy}
            topics={topics}
            subtags={subtags}
            edited={edited}
            onSave={props.onSaveEdit}
            onReset={props.onResetEdit}
            onCancel={() => props.onEditing(false)}
          />
        ) : topics.length ? (
          <ul className="topic-list">
            {topics.map((t: Topic) => (
              <li key={t}>
                <span className="topic-name">{t}</span>
                {subtags[t]?.length ? <span className="topic-subs">{subtags[t]!.join(", ")}</span> : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="quiet">No topic yet.</p>
        )}
        {edited && !editing ? (
          <p className="quiet small">Archive suggested: {item.topics.length ? item.topics.join(", ") : "no topic"}.</p>
        ) : null}
      </section>

      <div className="actions">
        <button type="button" className={`button${favourite ? " is-on" : ""}`} aria-pressed={favourite} onClick={props.onToggleFavourite}>
          <Heart size={16} filled={favourite} /> {favourite ? "Favourite" : "Add to favourites"}
        </button>
        <a className="button" href={item.url} target="_blank" rel="noreferrer noopener">
          Open on X <ArrowOut size={14} />
        </a>
        <button type="button" className="button button--icon" onClick={copy} aria-label="Copy post link">
          <Link size={16} />
        </button>
      </div>

      <details className="evidence">
        <summary>About this saved post</summary>
        {detail ? (
          <dl>
            <dt>Saved from</dt>
            <dd>X bookmarks · position {count(detail.bookmarkOrder)} in the export</dd>
            <dt>Text</dt>
            <dd>
              {detail.textSource}
              {item.textState === "verified" ? "; checked complete in a signed-in view" : ""}
              {detail.textNote && item.textState !== "verified" ? `. ${detail.textNote}` : ""}
            </dd>
            {detail.articleNote ? (
              <>
                <dt>Article</dt>
                <dd>{detail.articleNote}</dd>
              </>
            ) : null}
            <dt>Media</dt>
            <dd>
              {item.media.length
                ? `${plural(item.media.filter((m) => m.kind !== "missing").length, "item")} saved locally${missing.length ? `, ${missing.length} missing` : ""}`
                : "No photo or video attached"}
              {detail.mediaNotes.map((n) => (
                <span key={n} className="evidence-note">
                  {n}
                </span>
              ))}
            </dd>
            <dt>Topics</dt>
            <dd>
              {detail.topicConfidence} confidence{detail.topicBasis ? ` · ${detail.topicBasis}` : ""}
              {detail.reviewReasons.length ? ` · ${detail.reviewReasons.join("; ")}` : ""}
            </dd>
            {detail.signedInReview ? (
              <>
                <dt>Reviewed</dt>
                <dd>Signed-in review {detail.signedInReview.retrievedAt ? `on ${longDate(detail.signedInReview.retrievedAt)}` : ""}</dd>
              </>
            ) : null}
            {detail.extraction ? (
              <>
                <dt>Metadata</dt>
                <dd>
                  {detail.extraction.status.replace(/-/g, " ")}
                  {detail.extraction.extractor ? ` · ${detail.extraction.extractor}` : ""}
                </dd>
              </>
            ) : null}
            <dt>Post id</dt>
            <dd className="mono">{item.postId}</dd>
          </dl>
        ) : evidence.error && evidence.id === item.id ? (
          <p className="quiet">
            Details could not be loaded: {evidence.error}{" "}
            <button type="button" className="text-button" onClick={() => setAttempt((a) => a + 1)}>
              Try again
            </button>
          </p>
        ) : (
          <p className="quiet">Loading…</p>
        )}
      </details>
    </>
  );

  if (pageLayout) {
    return (
      <div className="aside aside--page">
        <div className="page">
          <div className="page-surface" ref={props.surfaceRef} />
          <div className="page-content aside-inner">{content}</div>
        </div>
      </div>
    );
  }
  return (
    <div className="aside">
      <div className="aside-inner">{content}</div>
    </div>
  );
}

/** Warm the next post's main image. */
export function preloadPost(item: LibraryItem | undefined) {
  if (!item) return;
  const first = item.media.find((m) => m.kind !== "missing");
  const image = first ? mediaImage(first) : null;
  if (image) preloadImage(bestSrc(image, 1100));
}
