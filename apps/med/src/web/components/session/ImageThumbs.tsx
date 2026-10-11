import * as stylex from "@stylexjs/stylex";
import { Dialog } from "@base-ui/react/dialog";
import { useState } from "react";
import { tokens, ui } from "../../theme.stylex";
import { Icon } from "../Icon";

/** The side of a thumbnail, and the space between thumbnails, as the styles
 * below set them. */
export const THUMB = 64;
export const THUMB_GAP = 6;

/** The height of a prompt's thumbnails in a bubble `width` wide. */
export function thumbsHeight(count: number, width: number) {
  if (!count) return 0;
  const perRow = Math.max(1, Math.floor((width + THUMB_GAP) / (THUMB + THUMB_GAP)));
  const rows = Math.ceil(count / perRow);
  return rows * THUMB + (rows - 1) * THUMB_GAP;
}

export interface ThumbImage {
  data: string;
  mimeType: string;
}

/**
 * The images in a prompt, as square thumbnails. A click shows the image at
 * full size; arrow keys step through the prompt's other images.
 */
export function ImageThumbs({ images }: { images: ThumbImage[] }) {
  const [shown, setShown] = useState<number | null>(null);
  const source = (image: ThumbImage) => `data:${image.mimeType};base64,${image.data}`;
  const current = shown === null ? undefined : images[shown];
  const step = (by: number) =>
    setShown((at) => (at === null ? at : (at + by + images.length) % images.length));
  return (
    <>
      <div {...stylex.props(styles.thumbs)}>
        {images.map((image, index) => (
          <button
            key={index}
            type="button"
            aria-label={images.length > 1 ? `Show image ${index + 1}` : "Show image"}
            onClick={() => setShown(index)}
            {...stylex.props(styles.thumb)}
          >
            <img alt="" src={source(image)} {...stylex.props(styles.thumbImage)} />
          </button>
        ))}
      </div>
      <Dialog.Root open={!!current} onOpenChange={(open) => !open && setShown(null)}>
        <Dialog.Portal>
          <Dialog.Backdrop {...stylex.props(ui.scrim, styles.backdrop, ui.instant)} />
          <Dialog.Popup
            {...stylex.props(styles.viewer, ui.instant)}
            onKeyDown={(event) => {
              if (images.length < 2) return;
              if (event.key === "ArrowRight") step(1);
              else if (event.key === "ArrowLeft") step(-1);
              else return;
              event.preventDefault();
            }}
          >
            <Dialog.Title {...stylex.props(styles.hidden)}>
              {images.length > 1 ? `Image ${(shown ?? 0) + 1} of ${images.length}` : "Image"}
            </Dialog.Title>
            {current && <img alt="" src={source(current)} {...stylex.props(styles.full)} />}
            <div {...stylex.props(styles.bar)}>
              {images.length > 1 && (
                <>
                  <button
                    type="button"
                    aria-label="Previous image"
                    onClick={() => step(-1)}
                    {...stylex.props(ui.button, ui.iconButton)}
                  >
                    <Icon name="arrowLeft" size={15} />
                  </button>
                  <span {...stylex.props(styles.count)}>
                    {(shown ?? 0) + 1} of {images.length}
                  </span>
                  <button
                    type="button"
                    aria-label="Next image"
                    onClick={() => step(1)}
                    {...stylex.props(ui.button, ui.iconButton, styles.next)}
                  >
                    <Icon name="arrowLeft" size={15} />
                  </button>
                </>
              )}
              <Dialog.Close aria-label="Close" {...stylex.props(ui.button, ui.iconButton)}>
                <Icon name="close" size={15} />
              </Dialog.Close>
            </div>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}

const styles = stylex.create({
  thumbs: { display: "flex", flexWrap: "wrap", gap: 6 },
  thumb: {
    display: "block",
    width: 64,
    height: 64,
    padding: 0,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: tokens.line,
    borderRadius: `calc(8px * ${tokens.round})`,
    overflow: "hidden",
    backgroundColor: tokens.panel,
    cursor: "zoom-in",
  },
  thumbImage: { display: "block", width: "100%", height: "100%", objectFit: "cover" },
  backdrop: { zIndex: 110 },
  viewer: {
    position: "fixed",
    inset: 0,
    zIndex: 111,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    padding: 24,
    outline: "none",
    pointerEvents: "none",
  },
  full: {
    display: "block",
    maxWidth: "100%",
    maxHeight: "calc(100% - 44px)",
    objectFit: "contain",
    borderRadius: `calc(8px * ${tokens.round})`,
    boxShadow: tokens.shadow,
    pointerEvents: "auto",
  },
  bar: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    padding: 3,
    borderRadius: `calc(8px * ${tokens.round})`,
    backgroundColor: tokens.panel,
    boxShadow: tokens.shadow,
    pointerEvents: "auto",
  },
  count: {
    minWidth: 48,
    color: tokens.muted,
    fontFamily: tokens.ui,
    fontSize: 12,
    textAlign: "center",
  },
  next: { transform: "scaleX(-1)" },
  hidden: {
    position: "absolute",
    width: 1,
    height: 1,
    overflow: "hidden",
    clipPath: "inset(50%)",
    whiteSpace: "nowrap",
  },
});
