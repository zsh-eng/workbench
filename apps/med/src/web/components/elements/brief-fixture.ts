// A sample brief for the elements page: every Markdown part a brief uses.

/** A flat mock of a review screen, drawn once, so the brief has a wide image. */
function sampleImage() {
  const width = 1400;
  const height = 620;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return "";
  const box = (x: number, y: number, w: number, h: number, color: string, radius = 10) => {
    context.fillStyle = color;
    context.beginPath();
    context.roundRect(x, y, w, h, radius);
    context.fill();
  };
  box(0, 0, width, height, "#16161a", 0);
  box(24, 24, 300, height - 48, "#1d1d22");
  box(348, 24, width - 372, height - 48, "#1b1b1f");
  for (let row = 0; row < 9; row++) box(44, 64 + row * 52, 220 - (row % 3) * 40, 14, "#34343c", 5);
  const lines: [number, string][] = [
    [0, "#34343c"],
    [0, "#34343c"],
    [1, "#5c2b33"],
    [2, "#24493a"],
    [2, "#24493a"],
    [0, "#34343c"],
    [1, "#5c2b33"],
    [2, "#24493a"],
    [0, "#34343c"],
    [0, "#34343c"],
  ];
  lines.forEach(([kind, color], index) => {
    const y = 72 + index * 48;
    if (kind) box(372, y - 12, width - 420, 38, kind === 1 ? "#2a1b1f" : "#172820", 6);
    box(396, y, 24, 14, "#4a4a55", 4);
    box(444, y, 180 + ((index * 97) % 420), 14, color === "#34343c" ? "#6d6d7a" : color, 5);
  });
  return canvas.toDataURL("image/png");
}

export function briefMarkdown() {
  return `# Code colors from each theme

Med now takes selection, find, and diff colors from each theme's own editor keys. This brief explains what changed, where the colors come from, and what to check in review.

## What changed

- \`code-colors.ts\` turns translucent theme colors into the targets that Pierre mixes into each line.
- A selected line keeps the red or green of a change, so a selected removal still reads as a removal.
- Find marks every match. The current match takes the theme's current-match color and an underline.

Pierre mixes in Lab space at a fixed weight, so the target lies past the color we want:

\`\`\`ts
// Lands the mix on the color VS Code would composite over the line.
const target = ground + (color - ground) / (1 - weight);
\`\`\`

## Theme sources

| Theme | Source | Selection | Current match | Why it looks this way |
| --- | --- | --- | --- | --- |
| Claude Light | Claude desktop app, Code tab | \`#0073e640\` | \`#ffd5008c\` | Find text turns black on the current match, so it stays readable on yellow. |
| Codex Dark | Codex desktop app | \`#83c3ff4d\` | \`#83c3ff4d\` | The current match is blue with an underline, as in Codex. |
| Cursor Light | Cursor 3.12, theme-cursor extension | \`#14141414\` | \`#ffd02c80\` | A neutral selection adds no tint over changed lines. |
| Paper Light | paper.design stylesheet | \`#4d94fb33\` | \`#f8c9ab\` | Paper has no syntax theme of its own; Med uses VS Code's Light+, as paper.design does. |

![A review with removed and added lines](${sampleImage()})

## How the parts fit

\`\`\`mermaid
flowchart LR
  T[Theme keys] --> C[code-colors.ts]
  C --> P[Diff line targets]
  C --> E[Editor selection]
  C --> H[Find highlights]
  subgraph Views
    P
    E
    H
  end
\`\`\`

\`\`\`mermaid
sequenceDiagram
  participant Page
  participant Host
  Page->>Host: GET /api/commit?id=…
  Host-->>Page: body, co-authors, size
  Note over Page,Host: Prefetched when a row is hovered
\`\`\`

> Review the light themes first. Their tints are the weakest, so a missing color shows there first.
`;
}
