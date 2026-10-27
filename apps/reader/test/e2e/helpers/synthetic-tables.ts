/**
 * Synthetic tables with the shapes of tables in technical books, for tests
 * and benchmarks. The text is made up here; no book's tables are copied.
 *
 * Shapes follow a catalogue of a systems book's 93 tables: mostly 2–4
 * columns of short text with one header row, a few tall (49 rows) or wide
 * (9 columns) ones, every cell's text in a `<p>`, code in some cells, and the
 * table in a `<figure>` under a `<figcaption>`. Every fifth table adds a
 * grouped header row with `colspan`, which that book lacks but others use.
 */

/** Rows × columns, in the order tables are made. */
const SHAPES: [rows: number, columns: number][] = [
  [10, 3],
  [6, 2],
  [21, 3],
  [8, 4],
  [12, 5],
  [16, 2],
  [49, 4],
  [9, 3],
  [21, 9],
  [14, 3],
];

const WORDS = [
  "queue",
  "latency",
  "sample",
  "counter",
  "buffer",
  "worker",
  "thread",
  "request",
  "storage",
  "device",
  "socket",
  "interval",
  "event",
  "wait",
  "lock",
  "batch",
  "page",
  "probe",
  "budget",
  "region",
  "limit",
  "average",
  "peak",
  "per",
  "second",
  "total",
  "time",
  "spent",
  "in",
  "the",
  "of",
  "on",
  "with",
];

const UNITS = ["ms", "µs", "KiB", "MiB", "%", "/s"];

/** A small deterministic generator, so each run builds the same tables. */
function generator(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function words(random: () => number, min: number, max: number): string {
  const count = min + Math.floor(random() * (max - min + 1));
  return Array.from(
    { length: count },
    () => WORDS[Math.floor(random() * WORDS.length)],
  ).join(" ");
}

function cellText(random: () => number, column: number): string {
  if (column === 0) {
    // A name: half are code, as option and field names are.
    const name = `${words(random, 1, 1)}_${words(random, 1, 1)}`;
    return random() < 0.5 ? `<code>${name}</code>` : words(random, 1, 3);
  }
  if (random() < 0.3) {
    const value = (random() * 1000).toFixed(random() < 0.5 ? 0 : 1);
    return `${value} ${UNITS[Math.floor(random() * UNITS.length)]}`;
  }
  return words(random, 2, 12);
}

/** One table, as a figure with its caption. `index` picks shape and text. */
export function syntheticTable(index: number): string {
  const [rows, columns] = SHAPES[index % SHAPES.length]!;
  const random = generator(index + 1);
  const header = Array.from(
    { length: columns },
    (_, column) =>
      `<th class="th"><p class="thead"><strong>${
        column === 0 ? "Name" : words(random, 1, 2)
      }</strong></p></th>`,
  ).join("\n");
  const grouped =
    index % 5 === 4 && columns >= 3
      ? `<tr>\n<th></th>\n<th colspan="${columns - 1}"><p class="theadc"><strong>${words(random, 1, 2)}</strong></p></th>\n</tr>\n`
      : "";
  const body = Array.from({ length: rows - 1 }, () => {
    const cells = Array.from(
      { length: columns },
      (_, column) =>
        `<td class="border"><p class="tab-para">${cellText(random, column)}</p></td>`,
    ).join("\n");
    return `<tr>\n${cells}\n</tr>`;
  }).join("\n");
  return `<figure class="table" id="synthetic-table-${index + 1}">
<figcaption>
<p class="title-t"><strong>Table ${index + 1}</strong> ${words(random, 2, 5)}</p>
</figcaption>
<table class="all">
<thead>
${grouped}<tr>
${header}
</tr>
</thead>
<tbody>
${body}
</tbody>
</table>
</figure>`;
}

/**
 * Inserts `count` synthetic tables into a chapter's XHTML, spread evenly
 * between its paragraphs.
 */
export function withSyntheticTables(xhtml: string, count: number): string {
  if (count <= 0) return xhtml;
  const ends = [...xhtml.matchAll(/<\/p>/g)].map(
    (match) => match.index! + match[0].length,
  );
  if (ends.length === 0) throw new Error("No paragraphs to place tables after");
  const at = new Map<number, number[]>();
  for (let table = 0; table < count; table++) {
    const end = ends[Math.floor(((table + 0.5) * ends.length) / count)]!;
    at.set(end, [...(at.get(end) ?? []), table]);
  }
  let result = "";
  let from = 0;
  for (const end of [...at.keys()].sort((a, b) => a - b)) {
    result += xhtml.slice(from, end);
    for (const table of at.get(end)!) result += `\n${syntheticTable(table)}`;
    from = end;
  }
  return result + xhtml.slice(from);
}
