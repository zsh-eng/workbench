import { getReadingFont } from "@/lib/reading-fonts";
import { cn } from "@/lib/utils";
import {
  isJustifiedTextAlign,
  type ReaderSettings,
} from "@/types/reader.types";

/** Alice's Adventures in Wonderland, chapter I (Lewis Carroll, 1865). */
const SAMPLE_TITLE = "Down the Rabbit-Hole";
const SAMPLE_PARAGRAPHS = [
  "Alice was beginning to get very tired of sitting by her sister on the bank, and of having nothing to do: once or twice she had peeped into the book her sister was reading, but it had no pictures or conversations in it, “and what is the use of a book,” thought Alice “without pictures or conversations?”",
  "So she was considering in her own mind (as well as she could, for the hot day made her feel very sleepy and stupid), whether the pleasure of making a daisy-chain would be worth the trouble of getting up and picking the daisies, when suddenly a White Rabbit with pink eyes ran close by her.",
];

/**
 * A page set as the books are: in the reading face, size, spacing and
 * alignment, on the paper on screen now, with a page number when pages
 * show them. Appearance keeps it in view while its settings change.
 *
 * `page` is a whole page, its foot cut off with a fade where the space ends;
 * `panel` is a fixed window onto its top, for the Reader's sidebar and a
 * phone.
 */
export function TypeSample({
  settings,
  variant,
  className,
}: {
  settings: ReaderSettings;
  variant: "page" | "panel";
  className?: string;
}) {
  const face = getReadingFont(settings.fontFamily).stack;
  const justify = isJustifiedTextAlign(settings.textAlign);
  const line = Math.round(settings.fontSize * settings.lineHeight);
  const page = variant === "page";
  const numbered = page && settings.showPageNumbers;
  return (
    <figure
      aria-label="Sample page"
      lang="en"
      data-type-sample={variant}
      className={cn(
        "relative m-0 overflow-hidden rounded-xl border border-border bg-background text-foreground",
        className,
      )}
      style={{
        fontFamily: face,
        fontSize: `${settings.fontSize}px`,
        lineHeight: `${line}px`,
      }}
    >
      <div
        style={{
          padding: page
            ? `${line + 8}px clamp(1.5rem, 9%, 3rem) ${numbered ? line * 3 : line + 8}px`
            : "1.25rem 1.375rem 0",
        }}
      >
        <p className="m-0 text-center italic">{SAMPLE_TITLE}</p>
        <span
          aria-hidden="true"
          className="mx-auto block h-px w-7 bg-foreground/30"
          style={{
            marginTop: Math.round(line * 0.4),
            marginBottom: Math.round(line * 0.6),
          }}
        />
        {SAMPLE_PARAGRAPHS.map((text, index) => (
          <p
            key={index}
            className="m-0"
            style={{
              textAlign: justify ? "justify" : "left",
              hyphens: justify ? "auto" : "manual",
              WebkitHyphens: justify ? "auto" : "manual",
              textIndent: index === 0 ? 0 : "1.5em",
            }}
          >
            {text}
          </p>
        ))}
      </div>
      {/* Where the space ends the text fades out; under a page number it
          is gone before the number, so the two never meet. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-0"
        style={{
          height: numbered ? line * 4 : page ? line * 1.5 : 56,
          backgroundImage: `linear-gradient(to bottom, transparent, var(--background) ${numbered ? "50%" : "100%"})`,
        }}
      />
      {numbered && (
        <span
          aria-hidden="true"
          className="absolute inset-x-0 text-center [font-variant-numeric:oldstyle-nums_proportional-nums]"
          style={{ bottom: Math.round(line * 0.9) }}
        >
          1
        </span>
      )}
    </figure>
  );
}
