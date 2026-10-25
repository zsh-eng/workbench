import { readFileSync } from "node:fs";
import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from "fflate";
import { SAMPLE_EPUB_PATH } from "./fixtures";

const OPF = "OEBPS/content.opf";
const COVER = "OEBPS/3005446287480825995_cover.jpg";

export interface EpubVariant {
  name: string;
  title: string;
  author: string;
  /** Another cover image, or `null` for a book without one. */
  cover?: { bytes: Uint8Array; mediaType: string } | null;
}

/**
 * The sample EPUB as another book: a new title, author and identifier, so
 * its file is new to the library, and optionally another cover or none.
 */
export function epubVariant(variant: EpubVariant) {
  const entries = unzipSync(readFileSync(SAMPLE_EPUB_PATH));
  let opf = strFromU8(entries[OPF]!)
    .replace(
      /<dc:title>[^<]*<\/dc:title>/,
      `<dc:title>${variant.title}</dc:title>`,
    )
    .replace(
      /<dc:creator id="author_0">[^<]*<\/dc:creator>/,
      `<dc:creator id="author_0">${variant.author}</dc:creator>`,
    )
    .replace(
      /<dc:identifier id="id">[^<]*<\/dc:identifier>/,
      `<dc:identifier id="id">urn:test:${variant.name}</dc:identifier>`,
    );
  if (variant.cover === null) {
    opf = opf
      .replace(/<meta name="cover"[^>]*\/>/, "")
      .replace(/<item [^>]*properties="cover-image"\/>/, "");
    delete entries[COVER];
  } else if (variant.cover) {
    opf = opf.replace(
      'media-type="image/jpeg" properties="cover-image"',
      `media-type="${variant.cover.mediaType}" properties="cover-image"`,
    );
    entries[COVER] = variant.cover.bytes;
  }
  entries[OPF] = strToU8(opf);
  // The mimetype comes first and uncompressed, as EPUB requires.
  const { mimetype, ...rest } = entries;
  const zip: Zippable = { mimetype: [mimetype!, { level: 0 }] };
  for (const [path, bytes] of Object.entries(rest)) zip[path] = bytes;
  return {
    name: `${variant.name}.epub`,
    mimeType: "application/epub+zip",
    buffer: Buffer.from(zipSync(zip)),
  };
}
