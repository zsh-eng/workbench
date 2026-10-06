import { memo, useEffect, useRef, useState, type MouseEvent, type PointerEvent } from "react";
import type { LibraryItem, Topic } from "../../shared/schema";
import { duration, count } from "../lib/format";
import type { Box, Density } from "../lib/layout";
import { bestSrc, coverOf, srcSet, videoUrl } from "../lib/media";
import { reducedMotion } from "../lib/motion";
import { articleBody, cardText, firstLine, linkDomain } from "../lib/text";
import { Heart, Play, Stack } from "./Icons";

/** Image revisions already shown once. Remounted cards skip the arrival fade. */
const shown = new Set<string>();

// Hover previews: muted, one at a time, after a short intent delay, mouse only.
const PREVIEW_DELAY = 350;
const PREVIEW_MAX_SECONDS = 180;
const PREVIEW_MAX_BYTES = 80 * 1024 * 1024;
let stopPreview: (() => void) | null = null;

function useHoverPreview(enabled: boolean) {
  const [active, setActive] = useState(false);
  const timer = useRef(0);
  const stop = useRef(() => setActive(false));
  const cancel = () => {
    window.clearTimeout(timer.current);
    if (stopPreview === stop.current) stopPreview = null;
    setActive(false);
  };
  const start = (event: PointerEvent) => {
    if (!enabled || event.pointerType !== "mouse" || reducedMotion()) return;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      if (stopPreview !== stop.current) stopPreview?.();
      stopPreview = stop.current;
      setActive(true);
    }, PREVIEW_DELAY);
  };
  useEffect(
    () => () => {
      window.clearTimeout(timer.current);
      if (stopPreview === stop.current) stopPreview = null;
    },
    [],
  );
  return { active, start, cancel };
}

interface CardProps {
  item: LibraryItem;
  box: Box;
  width: number;
  density: Density;
  captioned: boolean;
  favourite: boolean;
  topics: Topic[];
  tabIndex: 0 | -1;
  position: number;
  setSize: number;
  search: string;
  onOpen: (postId: string, card: HTMLElement) => void;
  onFocusCard: (postId: string) => void;
  onToggleFavourite: (postId: string) => void;
}

function author(item: LibraryItem) {
  return item.name?.trim() || `@${item.handle}`;
}

function describe(item: LibraryItem, favourite: boolean): string {
  const parts = [author(item)];
  const lead = item.articleTitle ?? firstLine(item.text);
  if (lead) parts.push(lead.length > 140 ? `${lead.slice(0, 140)}…` : lead);
  const visuals = item.media.filter((m) => m.kind !== "missing" && m.role !== "link-preview").length;
  const video = item.media.find((m) => m.kind === "video" && m.video);
  if (video && video.kind === "video" && video.video) parts.push(video.video.gif ? "GIF" : `video ${duration(video.video.duration)}`);
  else if (item.formats.includes("video-preview")) parts.push("video preview only");
  if (visuals > 1) parts.push(`${visuals} media`);
  if (item.textState === "truncated") parts.push("text cut short");
  if (item.textState === "article") parts.push("article preview");
  if (favourite) parts.push("favourite");
  return parts.join(", ");
}

function CardView(props: CardProps) {
  const { item, box, width, density, captioned, favourite, topics, tabIndex, position, setSize, search } = props;
  const linkRef = useRef<HTMLAnchorElement>(null);
  const cover = coverOf(item);
  const coverVideo = cover?.media.kind === "video" ? cover.media : null;
  const previewable =
    !!coverVideo?.video && coverVideo.video.duration <= PREVIEW_MAX_SECONDS && coverVideo.video.bytes <= PREVIEW_MAX_BYTES;
  const preview = useHoverPreview(previewable);

  const open = (event: MouseEvent) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
    event.preventDefault();
    props.onOpen(item.postId, linkRef.current!.closest<HTMLElement>(".card")!);
  };

  const visuals = item.media.filter((m) => m.kind !== "missing" && m.role !== "link-preview").length;
  const domain = item.formats.includes("link") ? linkDomain(item.text) : null;
  const cue =
    item.textState === "truncated"
      ? "Text cut short"
      : item.textState === "article"
        ? "Preview only"
        : item.states.includes("missing-media")
          ? "Media not saved"
          : (topics[0] ?? "");

  let body;
  if (cover) {
    const image = cover.image;
    const m = cover.media;
    const loaded = image ? shown.has(image.rev) : true;
    body = (
      <>
        <div
          className={`card-media fit-${box.fit}`}
          style={{ height: box.mediaH, backgroundColor: image?.tone ?? "var(--paper-sunk)" }}
        >
          {image ? (
            <img
              className={loaded ? "card-img is-shown" : "card-img"}
              src={bestSrc(image, width)}
              srcSet={srcSet(image)}
              sizes={`${width}px`}
              width={image.w || undefined}
              height={image.h || undefined}
              alt=""
              decoding="async"
              loading="lazy"
              draggable={false}
              onLoad={(e) => {
                shown.add(image.rev);
                e.currentTarget.classList.add("is-shown");
              }}
              onError={(e) => e.currentTarget.closest(".card-media")?.classList.add("is-broken")}
            />
          ) : null}
          {preview.active && coverVideo ? (
            <video
              className="card-preview"
              src={videoUrl(coverVideo)!}
              muted
              loop
              playsInline
              autoPlay
              preload="auto"
              aria-hidden="true"
              tabIndex={-1}
              onPlaying={(e) => e.currentTarget.classList.add("is-playing")}
            />
          ) : null}
          <span className="card-broken" aria-hidden="true">
            Image unavailable
          </span>
          {m.kind === "video" && m.video ? (
            <span className="card-badge">
              {m.video.gif ? (
                "GIF"
              ) : (
                <>
                  <Play size={10} />
                  {duration(m.video.duration)}
                </>
              )}
            </span>
          ) : m.kind === "video" ? (
            <span className="card-badge card-badge--note">Video preview — open original</span>
          ) : null}
          {visuals > 1 ? (
            <span className="card-count">
              <Stack size={13} />
              {count(visuals)}
            </span>
          ) : null}
        </div>
        {captioned ? (
          <div className="card-caption">
            <p className="card-excerpt">{item.articleTitle ?? firstLine(item.text)}</p>
            <p className="card-meta">
              <span className="card-author">{author(item)}</span>
              {domain ? <span className="card-domain">{domain}</span> : null}
              {item.textState === "truncated" ? <span className="card-flag">Text cut short</span> : null}
            </p>
          </div>
        ) : null}
      </>
    );
  } else {
    const text = cardText(articleBody(item.text, item.articleTitle));
    body = (
      <div className={`card-text card-text--${density}`} style={{ height: box.h }}>
        {item.textState === "article" ? <p className="card-kicker">X article</p> : null}
        {item.articleTitle ? (
          <h3 className="card-title" style={{ WebkitLineClamp: box.titleLines }}>
            {item.articleTitle}
          </h3>
        ) : null}
        {box.lines ? (
          <p className="card-body" style={{ WebkitLineClamp: box.lines }}>
            {text}
          </p>
        ) : null}
        <div className="card-foot">
          <span className="card-author">{author(item)}</span>
          <span className={cue === topics[0] ? "card-cue" : "card-cue card-cue--state"}>{cue}</span>
        </div>
      </div>
    );
  }

  return (
    <div
      role="listitem"
      className={`card${cover ? " card--media" : " card--text"}${favourite ? " is-favourite" : ""}`}
      data-post={item.postId}
      style={{ transform: `translate3d(${box.x}px, ${box.y}px, 0)`, width, height: box.h }}
      aria-posinset={position}
      aria-setsize={setSize}
      onPointerEnter={preview.start}
      onPointerLeave={preview.cancel}
    >
      <a
        ref={linkRef}
        className="card-link"
        href={`/post/${item.postId}${search}`}
        tabIndex={tabIndex}
        aria-label={describe(item, favourite)}
        onClick={open}
        onFocus={() => props.onFocusCard(item.postId)}
      >
        {body}
      </a>
      <button
        type="button"
        className="card-fav"
        tabIndex={-1}
        aria-pressed={favourite}
        aria-label={favourite ? "Remove from favourites" : "Add to favourites"}
        onClick={() => props.onToggleFavourite(item.postId)}
      >
        <Heart size={16} filled={favourite} />
      </button>
    </div>
  );
}

function same(a: CardProps, b: CardProps) {
  return (
    a.item === b.item &&
    a.box.x === b.box.x &&
    a.box.y === b.box.y &&
    a.box.h === b.box.h &&
    a.box.mediaH === b.box.mediaH &&
    a.box.fit === b.box.fit &&
    a.box.lines === b.box.lines &&
    a.box.titleLines === b.box.titleLines &&
    a.width === b.width &&
    a.density === b.density &&
    a.captioned === b.captioned &&
    a.favourite === b.favourite &&
    a.topics === b.topics &&
    a.tabIndex === b.tabIndex &&
    a.position === b.position &&
    a.setSize === b.setSize &&
    a.search === b.search &&
    a.onOpen === b.onOpen &&
    a.onFocusCard === b.onFocusCard &&
    a.onToggleFavourite === b.onToggleFavourite
  );
}

export const Card = memo(CardView, same);
