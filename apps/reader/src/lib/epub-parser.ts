import type {
  Book,
  BookFile,
  ManifestItem,
  SpineItem,
  TOCItem,
} from "@/lib/db";
import { BookImportError, type NotEpubFormat } from "@/lib/book-import-errors";
import type { FileId } from "@/lib/files";
import { unzip } from "fflate";

export interface ParsedEPUB {
  book: Book;
  files: BookFile[];
  coverBlob?: Blob;
}

export interface ParsedEPUBMetadata {
  title: string;
  author: string;
  manifest: ManifestItem[];
  spine: SpineItem[];
  toc: TOCItem[];
  coverImagePath?: string;
  metadata: {
    publisher?: string;
    language?: string;
    isbn?: string;
    description?: string;
    publicationDate?: string;
  };
}

export interface ParseEPUBOptions {
  sourceFileId: FileId;
  bookId?: string;
  fileName?: string;
}

/**
 * Extract and parse an EPUB file. A file that cannot be a readable book
 * throws a BookImportError that says why: not an EPUB, damaged,
 * DRM-protected, or missing its package or its reading order.
 */
export async function parseEPUB(
  file: Blob,
  options: ParseEPUBOptions,
): Promise<ParsedEPUB> {
  const createBlob = createDerivedBlobFactory(file);
  const arrayBuffer = await file.arrayBuffer();
  const uint8Array = new Uint8Array(arrayBuffer);

  const unzipped = await openArchive(uint8Array);
  if (isDrmProtected(unzipped)) throw new BookImportError({ kind: "drm" });

  // Parse container.xml to find the OPF file
  const opfPath = await findOPFPath(unzipped);
  const opfData = opfPath ? unzipped[opfPath] : undefined;
  if (!opfPath || !opfData) {
    throw new BookImportError({ kind: "incomplete", missing: "package" });
  }

  // Parse the OPF file
  const opfContent = new TextDecoder().decode(opfData);
  const opfDoc = new DOMParser().parseFromString(opfContent, "text/xml");

  // Extract metadata
  const metadata = extractMetadata(opfDoc);

  // Extract manifest
  const manifest = extractManifest(opfDoc, opfPath);

  // Extract spine
  const spine = extractSpine(opfDoc);
  if (!spine.some((item) => manifest.some((entry) => entry.id === item.idref)))
    throw new BookImportError({ kind: "incomplete", missing: "contents" });

  // Extract table of contents
  const toc = await extractTOC(opfDoc, manifest, unzipped, opfPath);

  const { coverBlob } = await extractCoverInfo(
    opfDoc,
    manifest,
    unzipped,
    createBlob,
  );

  // Generate unique ID
  const bookId = options.bookId ?? generateId();

  // Create Book object
  const book: Book = {
    id: bookId,
    sourceFileId: options.sourceFileId,
    title:
      metadata.title || options.fileName?.replace(/\.epub$/i, "") || "Untitled",
    author: metadata.author || "Unknown Author",
    cover: null,
    dateAdded: new Date().getTime(),
    fileSize: file.size,
    manifest,
    spine,
    toc,
    metadata: {
      publisher: metadata.publisher,
      language: metadata.language,
      isbn: metadata.isbn,
      description: metadata.description,
      publicationDate: metadata.publicationDate,
    },
  };

  // Create BookFile objects for all content files
  const bookFiles: BookFile[] = [];
  for (const [path, content] of Object.entries(unzipped)) {
    // Store all files from the EPUB
    const mediaType = getMediaType(path, manifest);
    bookFiles.push({
      id: `${bookId}:${path}`,
      bookId,
      path,
      content: createBlob(content, mediaType),
      mediaType,
    });
  }

  return {
    book,
    files: bookFiles,
    coverBlob,
  };
}

function createDerivedBlobFactory(
  source: Blob,
): (content: Uint8Array, mediaType: string) => Blob {
  const BlobConstructor =
    typeof File !== "undefined" && source instanceof File
      ? Blob
      : (source.constructor as typeof Blob);

  return (content, mediaType) =>
    new BlobConstructor([new Uint8Array(content).buffer as ArrayBuffer], {
      type: mediaType,
    }) as Blob;
}

/**
 * The archive's entries. Bytes that are no ZIP are another kind of file; a
 * ZIP that does not open is damaged; one without an EPUB's container or
 * mimetype is some other archive.
 */
async function openArchive(
  bytes: Uint8Array,
): Promise<Record<string, Uint8Array>> {
  if (!isZip(bytes))
    throw new BookImportError({ kind: "not-epub", format: sniffFormat(bytes) });
  let entries: Record<string, Uint8Array>;
  try {
    entries = await unzipAsync(bytes);
  } catch (error) {
    throw new BookImportError({ kind: "damaged" }, error);
  }
  const mimetype = entries.mimetype
    ? new TextDecoder().decode(entries.mimetype).trim()
    : null;
  if (!entries["META-INF/container.xml"] && mimetype !== "application/epub+zip")
    throw new BookImportError({ kind: "not-epub", format: "zip" });
  return entries;
}

/** A local file header, an empty archive's end record, or a spanned archive. */
function isZip(bytes: Uint8Array): boolean {
  return (
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    ((bytes[2] === 3 && bytes[3] === 4) ||
      (bytes[2] === 5 && bytes[3] === 6) ||
      (bytes[2] === 7 && bytes[3] === 8))
  );
}

function sniffFormat(bytes: Uint8Array): NotEpubFormat {
  const ascii = (start: number, length: number) =>
    String.fromCharCode(...bytes.subarray(start, start + length));
  // A PDF's header may follow a little junk, within its first kilobyte.
  if (ascii(0, 1024).includes("%PDF-")) return "pdf";
  // MOBI, AZW and AZW3 are Palm databases, typed at byte 60; Topaz is TPZ.
  if (ascii(60, 8) === "BOOKMOBI" || ascii(0, 3) === "TPZ") return "kindle";
  return "unknown";
}

/** Font obfuscation, which DRM-free books use, is not DRM. */
const FONT_OBFUSCATION = new Set([
  "http://www.idpf.org/2008/embedding",
  "http://ns.adobe.com/pdf/enc#RC",
]);

/**
 * DRM leaves its files in META-INF: Adobe's rights.xml, a Readium LCP
 * license, Apple's sinf.xml, or an encryption.xml that encrypts more than
 * fonts.
 */
function isDrmProtected(entries: Record<string, Uint8Array>): boolean {
  if (
    entries["META-INF/rights.xml"] ||
    entries["META-INF/license.lcpl"] ||
    entries["META-INF/sinf.xml"]
  )
    return true;
  const encryption = entries["META-INF/encryption.xml"];
  if (!encryption) return false;
  const doc = new DOMParser().parseFromString(
    new TextDecoder().decode(encryption),
    "text/xml",
  );
  return findElements(doc, "encryptionmethod").some(
    (method) => !FONT_OBFUSCATION.has(method.getAttribute("Algorithm") ?? ""),
  );
}

/**
 * Unzip the EPUB file asynchronously
 */
function unzipAsync(data: Uint8Array): Promise<Record<string, Uint8Array>> {
  return new Promise((resolve, reject) => {
    unzip(data, (err, result) => {
      if (err) reject(err);
      else resolve(result);
    });
  });
}

/**
 * Find the path to the OPF file by parsing META-INF/container.xml
 */
async function findOPFPath(
  files: Record<string, Uint8Array>,
): Promise<string | null> {
  const containerPath = "META-INF/container.xml";
  const containerData = files[containerPath];

  if (!containerData) {
    return null;
  }

  const containerXml = new TextDecoder().decode(containerData);
  const containerDoc = new DOMParser().parseFromString(
    containerXml,
    "text/xml",
  );

  const rootfile = containerDoc.querySelector("rootfile");
  return rootfile?.getAttribute("full-path") || null;
}

/**
 * Extract metadata from OPF
 */
function extractMetadata(opfDoc: Document): {
  title?: string;
  author?: string;
  publisher?: string;
  language?: string;
  isbn?: string;
  description?: string;
  publicationDate?: string;
} {
  const metadata: Record<string, string | undefined> = {};
  const metadataElement = findFirstElement(opfDoc, "metadata");
  if (!metadataElement) return metadata;

  // Title
  const titleEl = findFirstElement(metadataElement, "title");
  metadata.title = titleEl?.textContent?.trim();

  // Author/Creator
  const authorEl = findFirstElement(metadataElement, "creator");
  metadata.author = authorEl?.textContent?.trim();

  // Publisher
  const publisherEl = findFirstElement(metadataElement, "publisher");
  metadata.publisher = publisherEl?.textContent?.trim();

  // Language
  const languageEl = findFirstElement(metadataElement, "language");
  metadata.language = languageEl?.textContent?.trim();

  // ISBN (identifier)
  const identifiers = findElements(metadataElement, "identifier");
  for (const id of identifiers) {
    const scheme = id.getAttribute("opf:scheme") || id.getAttribute("scheme");
    if (scheme?.toLowerCase() === "isbn") {
      metadata.isbn = id.textContent?.trim();
      break;
    }
  }

  // Description
  const descEl = findFirstElement(metadataElement, "description");
  metadata.description = descEl?.textContent?.trim();

  // Publication Date
  const dateEl = findFirstElement(metadataElement, "date");
  metadata.publicationDate = dateEl?.textContent?.trim();

  return metadata;
}

function findFirstElement(
  root: Document | Element,
  localName: string,
): Element | undefined {
  return findElements(root, localName)[0];
}

function findElements(root: Document | Element, localName: string): Element[] {
  return Array.from(root.getElementsByTagName("*")).filter((element) => {
    const name = element.localName || element.tagName.split(":").at(-1);
    return name?.toLowerCase() === localName;
  });
}

/**
 * Extract manifest from OPF
 */
function extractManifest(opfDoc: Document, opfPath: string): ManifestItem[] {
  const manifest: ManifestItem[] = [];
  const manifestItems = opfDoc.querySelectorAll("manifest item");

  for (const item of Array.from(manifestItems)) {
    const id = item.getAttribute("id");
    const href = item.getAttribute("href");
    const mediaType = item.getAttribute("media-type");
    const properties = item.getAttribute("properties");

    if (id && href && mediaType) {
      manifest.push({
        id,
        href: resolveHref(href, opfPath),
        mediaType,
        properties: properties || undefined,
      });
    }
  }

  return manifest;
}

/**
 * Extract spine from OPF
 */
function extractSpine(opfDoc: Document): SpineItem[] {
  const spine: SpineItem[] = [];
  const spineItems = opfDoc.querySelectorAll("spine itemref");

  for (const item of Array.from(spineItems)) {
    const idref = item.getAttribute("idref");
    const linear = item.getAttribute("linear");
    const properties = item.getAttribute("properties");

    if (idref) {
      spine.push({
        idref,
        linear: linear !== "no",
        properties: properties || undefined,
      });
    }
  }

  return spine;
}

/**
 * Extract table of contents from NCX (EPUB2) or NAV (EPUB3)
 */
async function extractTOC(
  _opfDoc: Document,
  manifest: ManifestItem[],
  files: Record<string, Uint8Array>,
  opfPath: string,
): Promise<TOCItem[]> {
  // Try EPUB3 NAV first
  const navItem = manifest.find(
    (item) =>
      item.properties?.includes("nav") ||
      item.mediaType === "application/xhtml+xml",
  );

  if (navItem) {
    const navContent = files[navItem.href];
    if (navContent) {
      const navDoc = new DOMParser().parseFromString(
        new TextDecoder().decode(navContent),
        "text/html",
      );

      const navElement = Array.from(navDoc.getElementsByTagName("nav")).find(
        (element) =>
          element.id === "toc" ||
          Array.from(element.attributes).some(
            (attribute) =>
              attribute.name.split(":").at(-1) === "type" &&
              attribute.value.split(/\s+/).includes("toc"),
          ),
      );
      if (navElement) {
        return parseTOCFromNav(navElement, opfPath);
      }
    }
  }

  // Fallback to EPUB2 NCX
  const ncxItem = manifest.find(
    (item) => item.mediaType === "application/x-dtbncx+xml",
  );

  if (ncxItem) {
    const ncxContent = files[ncxItem.href];
    if (ncxContent) {
      const ncxDoc = new DOMParser().parseFromString(
        new TextDecoder().decode(ncxContent),
        "text/xml",
      );
      return parseTOCFromNCX(ncxDoc, opfPath);
    }
  }

  return [];
}

/**
 * Parse TOC from EPUB3 NAV document
 */
function parseTOCFromNav(navElement: Element, basePath: string): TOCItem[] {
  const toc: TOCItem[] = [];
  const ol = navElement.querySelector("ol");

  if (!ol) return toc;

  function parseList(listElement: Element): TOCItem[] {
    const items: TOCItem[] = [];
    const lis = listElement.querySelectorAll(":scope > li");

    for (const li of Array.from(lis)) {
      const anchor = li.querySelector("a");
      if (anchor) {
        const label = anchor.textContent?.trim() || "";
        const href = resolveHref(anchor.getAttribute("href") || "", basePath);

        const item: TOCItem = { label, href };

        // Check for nested list
        const nestedOl = li.querySelector("ol");
        if (nestedOl) {
          item.children = parseList(nestedOl);
        }

        items.push(item);
      }
    }

    return items;
  }

  return parseList(ol);
}

/**
 * Parse TOC from EPUB2 NCX document
 */
function parseTOCFromNCX(ncxDoc: Document, basePath: string): TOCItem[] {
  function parseNavPoint(navPoint: Element): TOCItem {
    const label =
      navPoint.querySelector("navLabel text")?.textContent?.trim() || "";
    const href = resolveHref(
      navPoint.querySelector("content")?.getAttribute("src") || "",
      basePath,
    );

    const item: TOCItem = { label, href };

    const children = navPoint.querySelectorAll(":scope > navPoint");
    if (children.length > 0) {
      item.children = Array.from(children).map((child) => parseNavPoint(child));
    }

    return item;
  }

  const navPoints = ncxDoc.querySelectorAll("navMap > navPoint");
  return Array.from(navPoints).map((np) => parseNavPoint(np));
}

/**
 * Extract the cover image and retain its declared media type.
 */
async function extractCoverInfo(
  opfDoc: Document,
  manifest: ManifestItem[],
  files: Record<string, Uint8Array>,
  createBlob: (content: Uint8Array, mediaType: string) => Blob,
): Promise<{
  coverImagePath?: string;
  coverBlob?: Blob;
}> {
  // Method 1: Look for cover in metadata
  const metaCover = opfDoc.querySelector('metadata meta[name="cover"]');
  if (metaCover) {
    const coverId = metaCover.getAttribute("content");
    if (coverId) {
      const coverItem = manifest.find((item) => item.id === coverId);
      if (coverItem && files[coverItem.href]) {
        const coverData = files[coverItem.href];
        return {
          coverImagePath: coverItem.href,
          coverBlob: createBlob(coverData, coverItem.mediaType),
        };
      }
    }
  }

  // Method 2: Look for properties="cover-image" in manifest
  const coverItem = manifest.find((item) =>
    item.properties?.includes("cover-image"),
  );
  if (coverItem && files[coverItem.href]) {
    const coverData = files[coverItem.href];
    return {
      coverImagePath: coverItem.href,
      coverBlob: createBlob(coverData, coverItem.mediaType),
    };
  }

  // Method 3: Look for common cover file names
  const commonCoverNames = [
    "cover.jpg",
    "cover.jpeg",
    "cover.png",
    "cover.gif",
  ];
  for (const item of manifest) {
    const fileName = item.href.split("/").pop()?.toLowerCase() || "";
    if (commonCoverNames.includes(fileName) && files[item.href]) {
      const coverData = files[item.href];
      return {
        coverImagePath: item.href,
        coverBlob: createBlob(coverData, item.mediaType),
      };
    }
  }

  // Method 4: Find first image in manifest
  const firstImage = manifest.find((item) =>
    item.mediaType.startsWith("image/"),
  );
  if (firstImage && files[firstImage.href]) {
    const coverData = files[firstImage.href];
    return {
      coverImagePath: firstImage.href,
      coverBlob: createBlob(coverData, firstImage.mediaType),
    };
  }

  return {};
}

/**
 * Resolve relative href to absolute path within EPUB
 */
function resolveHref(href: string, basePath: string): string {
  // Remove fragment identifier
  const cleanHref = href.split("#")[0];

  if (cleanHref.startsWith("/")) {
    return cleanHref.substring(1);
  }

  const baseDir = basePath.split("/").slice(0, -1).join("/");

  if (baseDir) {
    return `${baseDir}/${cleanHref}`;
  }

  return cleanHref;
}

/**
 * Get media type for a file path
 */
function getMediaType(path: string, manifest: ManifestItem[]): string {
  const manifestItem = manifest.find((item) => item.href === path);
  if (manifestItem) {
    return manifestItem.mediaType;
  }

  // Fallback to extension-based detection
  const ext = path.split(".").pop()?.toLowerCase();
  const mimeTypes: Record<string, string> = {
    xhtml: "application/xhtml+xml",
    html: "text/html",
    xml: "application/xml",
    css: "text/css",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    gif: "image/gif",
    svg: "image/svg+xml",
    js: "application/javascript",
    ttf: "font/ttf",
    otf: "font/otf",
    woff: "font/woff",
    woff2: "font/woff2",
  };

  return mimeTypes[ext || ""] || "application/octet-stream";
}

/**
 * Generate a unique ID
 */
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}
