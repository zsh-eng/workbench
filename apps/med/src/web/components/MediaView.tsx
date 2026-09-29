import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { FileRead } from "../../shared/local-file";
import { tokens } from "../theme.stylex";
import { ActionTooltip, ToolButton } from "./ToolButton";
import "./MediaView.css";
import { Icon } from "./Icon";

const visibility = new Map<Element, (near: boolean) => void>();
let observer: IntersectionObserver | undefined;
function observeMedia(element: Element, callback: (near: boolean) => void) {
  observer ??= new IntersectionObserver(
    (entries) => {
      for (const entry of entries) visibility.get(entry.target)?.(entry.isIntersecting);
    },
    { rootMargin: "200px" },
  );
  visibility.set(element, callback);
  observer.observe(element);
  return () => {
    observer?.unobserve(element);
    visibility.delete(element);
    if (!visibility.size) {
      observer?.disconnect();
      observer = undefined;
    }
  };
}

const theme = {
  "--media-bg": tokens.canvas,
  "--media-panel": tokens.panel,
  "--media-border": tokens.border,
  "--media-text": tokens.text,
  "--media-muted": tokens.muted,
} as CSSProperties;
export function mediaUrl(file: FileRead) {
  if (file.source.kind === "drop") return file.identity;
  return `/api/media?${new URLSearchParams({ source: JSON.stringify(file.source), path: file.path, identity: file.identity })}`;
}
function Preview({ src, label, video = false }: { src: string; label: string; video?: boolean }) {
  const [error, setError] = useState(false);
  if (error)
    return (
      <div className="med-media-error" role="status">
        {video
          ? "This video format or codec is not supported by the browser."
          : "Image preview unavailable. Refresh if the file changed."}
      </div>
    );
  return video ? (
    // Local files have no associated caption track; native controls expose embedded tracks.
    // oxlint-disable-next-line jsx-a11y/media-has-caption
    <video
      key={src}
      src={src}
      controls
      playsInline
      preload="metadata"
      aria-label={label}
      onError={() => setError(true)}
    />
  ) : (
    <img key={src} src={src} alt={label} decoding="async" onError={() => setError(true)} />
  );
}
export function MediaFileView({
  file,
  compact,
  onClose,
  onRefresh,
  refreshAvailable = true,
  stale,
}: {
  file: FileRead;
  compact?: boolean;
  onClose?(): void;
  onRefresh(): void;
  refreshAvailable?: boolean;
  stale?: boolean;
}) {
  const [actual, setActual] = useState(false);
  return (
    <section
      className="med-media-file"
      style={theme}
      aria-label="Full file"
      data-full-file-kind={file.kind}
    >
      {!compact && (
        <header className="med-media-header">
          <span className="med-media-name" title={file.path}>
            {file.path}
          </span>
          <span className="med-media-detail">
            {file.size < 1024
              ? `${file.size} B`
              : file.size < 1024 * 1024
                ? `${(file.size / 1024).toFixed(1)} KiB`
                : `${(file.size / (1024 * 1024)).toFixed(1)} MiB`}
          </span>
          {stale && <span className="med-media-detail">Changed on disk</span>}
          {file.kind === "image" && (
            <ActionTooltip label={actual ? "Fit image to pane" : "View image at actual size"}>
              <button
                className="med-media-fit"
                onClick={() => setActual((v) => !v)}
                aria-pressed={actual}
              >
                {actual ? "Fit" : "1:1"}
              </button>
            </ActionTooltip>
          )}
          {refreshAvailable && (
            <ToolButton label="Refresh file" icon="refresh" onClick={onRefresh} />
          )}
          {onClose && <ToolButton label="Close file" icon="close" onClick={onClose} />}
        </header>
      )}
      <div className="med-media-stage" data-actual={actual}>
        <Preview
          key={file.identity}
          src={mediaUrl(file)}
          label={file.path}
          video={file.kind === "video"}
        />
      </div>
    </section>
  );
}

/** Decode only near the viewport. Fixed height avoids jumps and releases offscreen images. */
export function DiffImages({
  path,
  previousPath,
  status,
  reviewId,
  saved,
  collapsed,
  onToggle,
  onOpen,
}: {
  path: string;
  previousPath?: string;
  status: string;
  reviewId: string;
  saved?: { id: string; target: string };
  collapsed: boolean;
  onToggle(): void;
  onOpen(): void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    if (root.current) return observeMedia(root.current, setNear);
  }, []);
  const url = (side: string) =>
    `/api/review-image?${new URLSearchParams({ path, side, ...(saved ? { saved: saved.id, target: saved.target } : { reviewId }) })}`;
  return (
    <div ref={root} className="med-media-diff" style={theme} data-media-diff={path}>
      <header className="med-media-header">
        <button
          className="med-media-collapse"
          aria-label={`${collapsed ? "Expand" : "Collapse"} ${path}`}
          aria-expanded={!collapsed}
          onClick={onToggle}
        />
        <span aria-hidden="true">
          <Icon
            name="chevron"
            size={12}
            style={{ transform: collapsed ? "rotate(-90deg)" : undefined }}
          />
        </span>
        <button
          className="med-media-path"
          role="link"
          onClick={(e) => {
            e.stopPropagation();
            onOpen();
          }}
        >
          {previousPath && previousPath !== path ? `${previousPath} → ` : ""}
          {path}
        </button>
      </header>
      {!collapsed && (
        <div className="med-media-pair">
          {(["old", "new"] as const).map((side) => (
            <figure key={side}>
              <figcaption>{side === "old" ? "Before" : "After"}</figcaption>
              <div className="med-media-thumbnail">
                {(side === "old" && status === "A") || (side === "new" && status === "D") ? (
                  <span className="med-media-detail">
                    {side === "old" ? "Added file" : "Deleted file"}
                  </span>
                ) : near ? (
                  <Preview
                    key={url(side)}
                    src={url(side)}
                    label={`${side === "old" ? "Before" : "After"}: ${path}`}
                  />
                ) : null}
              </div>
            </figure>
          ))}
        </div>
      )}
    </div>
  );
}
