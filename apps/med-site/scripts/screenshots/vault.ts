// A small Obsidian vault of Trailhead's design notes, for the demo's Notes
// scene: wiki links, backlinks, a table, and a Mermaid diagram.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const vaultNote = "Search filters.md";

const notes: Record<string, string> = {
  [vaultNote]: `# Search filters

Trail search should say why a trail is hidden. Today the list shrinks, and
nobody can tell which filter did it.

## What changes

- The search bar shows each active filter as a chip.
- A chip removes its filter. See [[Filter chips]].
- Screen readers hear the change: the list is \`aria-live="polite"\`.

## From query to chips

\`\`\`mermaid
flowchart LR
  Q[Query text] --> P[parseQuery] --> C[Chips]
\`\`\`

| Filter     | Example               |
| ---------- | --------------------- |
| Region     | \`region:alps\`         |
| Difficulty | \`difficulty:moderate\` |

Related: [[Trail data]] and [[Accessibility checklist]].
`,
  "Filter chips.md": `# Filter chips

One chip for each filter in the query, in the order typed. Back to
[[Search filters]].
`,
  "Trail data.md": `# Trail data

Each trail has a name, a region, and a difficulty. [[Search filters]] reads
all three.
`,
  "Accessibility checklist.md": `# Accessibility checklist

- Live regions for lists that change, as in [[Search filters]].
- Labels on every control.
`,
};

export const noteNames = Object.keys(notes);

export function createVault(dir: string) {
  mkdirSync(join(dir, ".obsidian"), { recursive: true });
  for (const [name, text] of Object.entries(notes)) {
    writeFileSync(join(dir, name), text);
  }
}
