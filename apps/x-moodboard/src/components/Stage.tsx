import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { LibraryItem, Media } from "../../shared/schema";
import { bytes, duration } from "../lib/format";
import { bestSrc, captionUrl, mediaAspect, mediaImage, originalUrl, srcSet, thumbUrl, videoUrl } from "../lib/media";
import { reducedMotion } from "../lib/motion";
import { ArrowOut, ChevronLeft, ChevronRight, Expand, Play, Shrink } from "./Icons";

interface StageProps {
  item: LibraryItem;
  index: number;
  onIndex: (index: number) => void;
  actual: boolean;
  onActual: (actual: boolean) => void;
  /** Image already decoded by the card; shown until the sharper one arrives. */
  placeholderSrc: string | null;
  mediaRef: React.Ref<HTMLDivElement>;
}

function mediaLabel(item: LibraryItem, media: Media, index: number, total: number): string {
  const position = total > 1 ? `${index + 1} of ${total}` : "";
  const parts: string[] = [];
  if (media.kind === "photo") parts.push(media.role === "link-preview" ? "Link preview image" : "Photo");
  if (media.kind === "video") {
    if (media.video) {
      parts.push(media.video.gif ? "GIF" : "Video");
      if (!media.video.gif) parts.push(duration(media.video.duration));
      parts.push(`${media.video.w}×${media.video.h}`);
      if (!media.video.audio && !media.video.gif) parts.push("no sound");
      parts.push(bytes(media.video.bytes));
    } else parts.push("Video preview — open original");
  }
  if (media.kind === "missing") parts.push(media.expected === "video" ? "Video not saved" : "Photo not saved");
  if (media.kind === "photo" && media.image.w) parts.push(`${media.image.w}×${media.image.h}`);
  if (position) parts.unshift(position);
  if (media.role === "quoted") parts.push(`from the quoted post${item.quote?.handle ? ` by @${item.quote.handle}` : ""}`);
  return parts.filter(Boolean).join(" · ");
}

export function Stage({ item, index, onIndex, actual, onActual, placeholderSrc, mediaRef }: StageProps) {
  const media = item.media[index] ?? item.media[0];
  const total = item.media.length;
  const image = mediaImage(media);
  const aspect = mediaAspect(media);
  const naturalW = image?.w || (media.kind === "video" && media.video ? media.video.w : 0) || 1200;
  const [sharp, setSharp] = useState(false);
  const [playing, setPlaying] = useState(false);
  const canZoom = media.kind === "photo" && image && (image.w > 900 || image.h > 760);

  useEffect(() => {
    setSharp(false);
    setPlaying(false);
  }, [item.postId, index]);

  const gif = media.kind === "video" && media.video?.gif;
  const autoplay = gif && !reducedMotion();
  const showVideo = media.kind === "video" && media.video && (playing || autoplay);

  // Cap upscaling: small originals stay crisp rather than filling the stage.
  const maxWidth = media.kind === "video" && media.video ? Math.max(media.video.w, 640) : Math.max(naturalW * 2, 320);
  const style = {
    "--a": aspect,
    "--max-w": `${maxWidth}px`,
    "--natural-w": `${naturalW}px`,
    "--tone": image?.tone ?? "var(--paper-sunk)",
  } as CSSProperties;

  return (
    <div className="stage">
      <div className="stage-bg" aria-hidden="true" />
      <div className={`stage-frame${actual && canZoom ? " is-actual" : ""}`}>
        <figure className="stage-figure" style={style}>
        <div className="stage-media" ref={mediaRef} data-kind={media.kind}>
          {media.kind === "missing" ? (
            <div className="stage-missing">
              <p>{media.expected === "video" ? "This video was not saved locally." : "This photo was not saved locally."}</p>
              <p className="stage-missing-reason">{media.reason}</p>
              <a href={item.url} target="_blank" rel="noreferrer noopener">
                See it on X <ArrowOut size={14} />
              </a>
            </div>
          ) : null}
          {image && !showVideo ? (
            <>
              {placeholderSrc && !sharp ? <img className="stage-img stage-img--soft" src={placeholderSrc} alt="" decoding="sync" /> : null}
              <img
                key={`${item.postId}:${index}`}
                className={`stage-img${sharp ? " is-sharp" : ""}`}
                src={actual ? originalUrl(image) : bestSrc(image, 1100)}
                srcSet={actual ? undefined : srcSet(image)}
                sizes="(max-width: 760px) 100vw, 70vw"
                alt={(media.kind === "photo" && media.alt) || ""}
                decoding="async"
                draggable={false}
                onLoad={() => setSharp(true)}
              />
            </>
          ) : null}
          {showVideo && media.kind === "video" && media.video ? (
            <video
              key={media.video.path}
              className="stage-video"
              src={videoUrl(media)!}
              poster={image ? bestSrc(image, 1100) : undefined}
              controls={!gif}
              autoPlay
              muted={!!gif}
              loop={!!gif}
              playsInline
              preload="metadata"
              ref={(video) => {
                // Keep keyboard focus inside the dialog after Play unmounts; Space then pauses.
                if (video && playing && document.activeElement === document.body) video.focus({ preventScroll: true });
              }}
              onClick={gif ? (e) => (e.currentTarget.paused ? void e.currentTarget.play() : e.currentTarget.pause()) : undefined}
            >
              {media.video.captions.map((c) => (
                <track key={c.path} kind="captions" src={captionUrl(c.path, c.rev)} srcLang={c.lang} label={c.lang === "en" ? "English" : c.lang} />
              ))}
            </video>
          ) : null}
          {media.kind === "video" && media.video && !showVideo ? (
            <button type="button" className="stage-play" onClick={() => setPlaying(true)} aria-label={`Play ${gif ? "GIF" : "video"}`}>
              <Play size={26} />
            </button>
          ) : null}
          {media.kind === "video" && !media.video ? (
            <a className="stage-preview-note" href={item.url} target="_blank" rel="noreferrer noopener">
              Video preview — open original <ArrowOut size={14} />
            </a>
          ) : null}
        </div>
        <figcaption className="stage-foot">
          <p className="stage-caption">
            {mediaLabel(item, media, index, total)}
            {media.role === "quoted" && media.kind !== "missing" && media.sourcePost ? (
              <>
                {" "}
                <a href={media.sourcePost} target="_blank" rel="noreferrer noopener" className="stage-caption-link">
                  Open quoted post <ArrowOut size={12} />
                </a>
              </>
            ) : null}
          </p>
          <div className="stage-tools">
            {canZoom ? (
              <button
                type="button"
                className="icon-button"
                onClick={() => onActual(!actual)}
                aria-pressed={actual}
                aria-label={actual ? "Fit image to window (Z)" : "Show actual size (Z)"}
                title={actual ? "Fit (Z)" : "Actual size (Z)"}
              >
                {actual ? <Shrink size={18} /> : <Expand size={18} />}
              </button>
            ) : null}
          </div>
        </figcaption>
        </figure>
      </div>

      {total > 1 ? (
        <div className="stage-strip" role="group" aria-label={`${total} media items`}>
          <button type="button" className="icon-button" onClick={() => onIndex((index - 1 + total) % total)} aria-label="Previous image ([)">
            <ChevronLeft size={18} />
          </button>
          <div className="stage-thumbs">
            {item.media.map((m, i) => {
              const thumb = mediaImage(m);
              return (
                <button
                  key={i}
                  type="button"
                  className="stage-thumb"
                  aria-current={i === index ? "true" : undefined}
                  aria-label={`Show ${i + 1} of ${total}`}
                  onClick={() => onIndex(i)}
                  style={{ backgroundColor: thumb?.tone ?? "var(--paper-sunk)" }}
                >
                  {thumb ? <img src={thumb.thumbs.length ? thumbUrl(thumb, thumb.thumbs[0]) : originalUrl(thumb)} alt="" loading="lazy" decoding="async" /> : null}
                  {m.kind === "video" ? <span className="stage-thumb-mark"><Play size={9} /></span> : null}
                </button>
              );
            })}
          </div>
          <button type="button" className="icon-button" onClick={() => onIndex((index + 1) % total)} aria-label="Next image (])">
            <ChevronRight size={18} />
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** Pause any playing video when the page is hidden. */
export function usePauseWhenHidden() {
  const handler = useRef(() => {
    if (document.hidden) document.querySelectorAll("video").forEach((v) => v.pause());
  });
  useEffect(() => {
    const h = handler.current;
    document.addEventListener("visibilitychange", h);
    return () => document.removeEventListener("visibilitychange", h);
  }, []);
}
