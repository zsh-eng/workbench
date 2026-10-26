import { strToU8, zipSync, type Zippable } from "fflate";

/**
 * A generated EPUB 3 shaped like a large technical book: chapters of
 * sections, each in its own file, with numbered subsections three levels
 * deep in the table of contents, and many figures. Every word is generated.
 */
export interface LargeEpubShape {
  title: string;
  /** Distinguishes otherwise identical books, so each is a new file. */
  identifier: string;
  chapters: number;
  sectionsPerChapter: number;
  subsectionsPerSection: number;
  /** Entries below each subsection, the fourth level. */
  topicsPerSubsection: number;
  figures: number;
}

export const LARGE_TECHNICAL_BOOK: LargeEpubShape = {
  title: "Generated Systems Handbook",
  identifier: "urn:test:generated-systems-handbook",
  chapters: 16,
  sectionsPerChapter: 10,
  subsectionsPerSection: 6,
  topicsPerSubsection: 1,
  figures: 600,
};

const WORDS = [
  "Latency",
  "Throughput",
  "Scheduler",
  "Observability",
  "Workload",
  "Characterization",
  "Methodology",
  "Saturation",
  "Utilization",
  "Profiling",
  "Tracing",
  "Contention",
  "Allocation",
  "Interrupts",
  "Virtualization",
  "Caching",
  "Queueing",
  "Benchmarking",
  "Instrumentation",
  "Tuning",
];

/** A long, numbered heading made of generated words. */
function heading(number: string, seed: number): string {
  const words = Array.from(
    { length: 5 },
    (_, index) => WORDS[(seed * 7 + index * 3) % WORDS.length],
  );
  return `${number} ${words.join(" and ")}`;
}

export interface LargeEpub {
  bytes: Uint8Array;
  /** Every entry of the table of contents, at any depth. */
  tocEntries: number;
  /** The label of the deepest entry in the last chapter. */
  lastTopic: string;
  spineItems: number;
}

/** A 1x1 transparent PNG. */
const PIXEL = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  ),
  (character) => character.charCodeAt(0),
);

export function largeEpub(shape: LargeEpubShape = LARGE_TECHNICAL_BOOK) {
  const files: Zippable = {};
  const manifest = [
    '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>',
  ];
  const spine: string[] = [];
  const nav: string[] = [];
  let tocEntries = 0;
  let lastTopic = "";

  for (let chapter = 1; chapter <= shape.chapters; chapter += 1) {
    const sections: string[] = [];
    for (let section = 1; section <= shape.sectionsPerChapter; section += 1) {
      const id = `ch${chapter}s${section}`;
      const href = `text/${id}.xhtml`;
      const sectionTitle = heading(`${chapter}.${section}`, chapter + section);
      const body = [`<h2 id="top">${sectionTitle}</h2>`];
      const subsections: string[] = [];
      for (let sub = 1; sub <= shape.subsectionsPerSection; sub += 1) {
        const subTitle = heading(`${chapter}.${section}.${sub}`, section + sub);
        body.push(
          `<h3 id="s${sub}">${subTitle}</h3>`,
          `<p>${WORDS.slice(0, 12).join(" ").toLowerCase()}.</p>`,
        );
        const topics: string[] = [];
        for (let topic = 1; topic <= shape.topicsPerSubsection; topic += 1) {
          lastTopic = heading(`${chapter}.${section}.${sub}.${topic}`, topic);
          body.push(`<h4 id="s${sub}t${topic}">${lastTopic}</h4>`);
          topics.push(
            `<li><a href="${href}#s${sub}t${topic}">${lastTopic}</a></li>`,
          );
          tocEntries += 1;
        }
        subsections.push(
          `<li><a href="${href}#s${sub}">${subTitle}</a>${
            topics.length ? `<ol>${topics.join("")}</ol>` : ""
          }</li>`,
        );
        tocEntries += 1;
      }
      files[`OEBPS/${href}`] = strToU8(
        `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>${sectionTitle}</title></head><body>${body.join("")}</body></html>`,
      );
      manifest.push(
        `<item id="${id}" href="${href}" media-type="application/xhtml+xml"/>`,
      );
      spine.push(`<itemref idref="${id}"/>`);
      sections.push(
        `<li><a href="${href}">${sectionTitle}</a><ol>${subsections.join("")}</ol></li>`,
      );
      tocEntries += 1;
    }
    nav.push(
      `<li><a href="text/ch${chapter}s1.xhtml">${heading(`Chapter ${chapter}`, chapter)}</a><ol>${sections.join("")}</ol></li>`,
    );
    tocEntries += 1;
  }

  for (let figure = 1; figure <= shape.figures; figure += 1) {
    const href = `images/figure-${String(figure).padStart(4, "0")}.png`;
    files[`OEBPS/${href}`] = PIXEL;
    manifest.push(
      `<item id="figure-${figure}" href="${href}" media-type="image/png"/>`,
    );
  }

  files["OEBPS/nav.xhtml"] = strToU8(
    `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Contents</title></head><body><nav epub:type="toc" id="toc"><ol>${nav.join("")}</ol></nav></body></html>`,
  );
  files["OEBPS/content.opf"] = strToU8(
    `<?xml version="1.0" encoding="utf-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">${shape.identifier}</dc:identifier><dc:title>${shape.title}</dc:title><dc:creator>Generated Author</dc:creator><dc:language>en</dc:language></metadata><manifest>${manifest.join("")}</manifest><spine>${spine.join("")}</spine></package>`,
  );
  files["META-INF/container.xml"] = strToU8(
    '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
  );

  // The mimetype comes first and uncompressed, as EPUB requires.
  const bytes = zipSync({
    mimetype: [strToU8("application/epub+zip"), { level: 0 }],
    ...files,
  });
  return {
    bytes,
    tocEntries,
    lastTopic,
    spineItems: spine.length,
  } satisfies LargeEpub;
}
