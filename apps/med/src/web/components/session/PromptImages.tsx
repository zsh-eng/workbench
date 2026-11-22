import * as stylex from "@stylexjs/stylex";
import { useRef, useState, type ClipboardEvent, type DragEvent } from "react";
import {
  MAX_PROMPT_IMAGE_BYTES,
  PROMPT_IMAGE_TYPES,
  type PromptImage,
} from "../../../shared/agent-inbox";
import { tokens, ui } from "../../theme.stylex";
import { Icon } from "../Icon";
import { ImageViewer, imageSource } from "./ImageThumbs";
import { tooltip } from "../ToolButton";

// The images a prompt takes, pasted, dropped, or chosen, as a thread's message
// box and the New thread page both take them.

/** Images in one prompt at most, as the host takes them. */
export const MAX_IMAGES = 10;

export type DraftImage = PromptImage & { id: string };

/** An image file as base64, for a prompt. */
function readImage(file: File) {
  return new Promise<PromptImage>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      resolve({
        mimeType: file.type as PromptImage["mimeType"],
        data: String(reader.result).replace(/^data:[^,]*,/, ""),
      });
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

const hasImage = (files: File[]) => files.some((file) => file.type.startsWith("image/"));

/**
 * A prompt's images: `add` reads files, `field` gives a text field paste and
 * drop, and `onProblem` hears what Med could not take (or null once it took
 * them all).
 */
export function usePromptImages(onProblem: (problem: string | null) => void) {
  const [images, setImages] = useState<DraftImage[]>([]);
  const add = async (files: File[]) => {
    const found = files.filter((file) => file.type.startsWith("image/"));
    if (!found.length) return false;
    const usable = found.filter(
      (file) =>
        (PROMPT_IMAGE_TYPES as readonly string[]).includes(file.type) &&
        file.size <= MAX_PROMPT_IMAGE_BYTES,
    );
    onProblem(
      usable.length < found.length
        ? "Images can be PNG, JPEG, GIF, or WebP, up to 5 MB each."
        : images.length + usable.length > MAX_IMAGES
          ? `A message holds up to ${MAX_IMAGES} images.`
          : null,
    );
    const read = await Promise.all(usable.map(readImage));
    setImages((current) =>
      [...current, ...read.map((image) => ({ ...image, id: crypto.randomUUID() }))].slice(
        0,
        MAX_IMAGES,
      ),
    );
    return true;
  };
  return {
    images,
    add,
    remove: (image: DraftImage) =>
      setImages((current) => current.filter((entry) => entry !== image)),
    clear: () => setImages([]),
    /** What the host takes: the images without their IDs. */
    sent: () => images.map(({ mimeType, data }) => ({ mimeType, data })),
    /** A text field's paste and drop: images join the prompt, text pastes as text. */
    field: {
      onDragOver: (event: DragEvent) => {
        if (event.dataTransfer.types.includes("Files")) event.preventDefault();
      },
      onDrop: (event: DragEvent) => {
        const files = [...event.dataTransfer.files];
        if (!hasImage(files)) return;
        event.preventDefault();
        void add(files);
      },
      onPaste: (event: ClipboardEvent) => {
        const files = [...event.clipboardData.files];
        if (!hasImage(files)) return;
        event.preventDefault();
        void add(files);
      },
    },
  };
}

/** The prompt's images as thumbnails: a click shows one, × removes it. */
export function PromptImageList({
  images,
  onRemove,
}: {
  images: DraftImage[];
  onRemove(image: DraftImage): void;
}) {
  const [shown, setShown] = useState<number | null>(null);
  if (!images.length) return null;
  return (
    <>
      <div aria-label="Images to send" role="list" {...stylex.props(styles.images)}>
        {images.map((image, index) => (
          <span key={image.id} role="listitem" {...stylex.props(styles.image)}>
            <button
              type="button"
              aria-label={`Show attachment ${index + 1}`}
              onClick={() => setShown(index)}
              {...stylex.props(styles.imageShow)}
            >
              <img alt="" src={imageSource(image)} {...stylex.props(styles.imagePreview)} />
            </button>
            <button
              type="button"
              aria-label={`Remove attachment ${index + 1}`}
              onClick={() => onRemove(image)}
              {...stylex.props(styles.imageRemove)}
            >
              <Icon name="close" size={10} />
            </button>
          </span>
        ))}
      </div>
      <ImageViewer images={images} shown={shown} onShow={setShown} />
    </>
  );
}

/** The image button and its file picker. */
export function AddImagesButton({
  onAdd,
  disabled,
}: {
  onAdd(files: File[]): void;
  disabled?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={input}
        type="file"
        accept={PROMPT_IMAGE_TYPES.join(",")}
        multiple
        hidden
        onChange={(event) => {
          onAdd([...(event.target.files ?? [])]);
          event.target.value = "";
        }}
      />
      <button
        type="button"
        aria-label="Add images"
        {...tooltip("Add images, or paste them")}
        disabled={disabled}
        onClick={() => input.current?.click()}
        {...stylex.props(ui.button, ui.iconButton, styles.attach)}
      >
        <Icon name="image" size={15} />
      </button>
    </>
  );
}

const styles = stylex.create({
  images: { display: "flex", flexWrap: "wrap", gap: 6, paddingTop: 2 },
  // As large as a sent message's thumbnails (THUMB in ImageThumbs).
  image: { position: "relative", display: "block", width: 64, height: 64 },
  imageShow: {
    display: "block",
    width: "100%",
    height: "100%",
    padding: 0,
    borderWidth: 0,
    borderRadius: `calc(8px * ${tokens.round})`,
    backgroundColor: tokens.panel,
    cursor: "zoom-in",
    outline: { default: "none", ":focus-visible": `2px solid ${tokens.accentLine}` },
    outlineOffset: 2,
  },
  imagePreview: {
    display: "block",
    width: "100%",
    height: "100%",
    objectFit: "cover",
    borderRadius: `calc(8px * ${tokens.round})`,
    boxShadow: `0 0 0 1px ${tokens.line}`,
  },
  imageRemove: {
    position: "absolute",
    top: -5,
    right: -5,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 16,
    height: 16,
    padding: 0,
    borderWidth: 0,
    borderRadius: 999,
    backgroundColor: tokens.text,
    color: tokens.canvas,
    cursor: "pointer",
  },
  attach: { color: tokens.muted },
});
