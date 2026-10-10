// Alt text and layout sizes for the screenshots. Their pixel sizes come from
// screenshots.json, which `bun run screenshots` writes.

// The review: a window on the painted panel, 88% of the panel's width from
// 640 px (src/styles.css, .painting). Below 960 px the tour shows the image at
// 3.6 times the window's width.
const wide =
  "(min-width: 1304px) 1092px, (min-width: 960px) calc(88vw - 57px), (min-width: 640px) calc(317vw - 205px), calc(360vw - 230px)";
// A feature's window: the right column of a chapter from 960 px, at most
// 748 px, and the column's full width below. Phones under 640 px show a
// capture of their own (scripts/render.ts).
const chapter =
  "(min-width: 1304px) 748px, (min-width: 960px) calc(63.6vw - 81px), calc(100vw - 64px)";

export const shots = {
  review: {
    alt: "Med with the saved review Search filters at iteration 2. A split diff of SearchBar.tsx shows a reviewer comment under line 29. At the right, the Claude session pane shows the agent's last round and a message box with 1 comment, while Claude waits for the review.",
    sizes: wide,
    priority: true,
  },
  brief: {
    alt: "The agent's brief at iteration 2. A sentence cites SearchBar.tsx line 9, and the cited lines show below it as a short diff. The header says that the brief cites 3 of 6 changed files.",
    sizes: chapter,
    priority: false,
  },
  comment: {
    alt: 'A short unified diff of SearchBar.tsx with a reviewer comment under line 29: Add aria-live="polite" to this list, so screen readers hear when the filters change.',
    sizes: chapter,
    priority: false,
  },
  session: {
    alt: "Claude's session: its last tool calls, its reply with a review link, a background command that waits for the review, and a message box with 1 comment. The status line says that Claude is waiting for your review.",
    sizes: chapter,
    priority: false,
  },
  commit: {
    alt: "The commit dialog for 6 files on main, with the message: Show active filters as chips.",
    sizes: chapter,
    priority: false,
  },
  notes: {
    alt: "The note Search filters in the Vim editor beside its preview, which links to the note Filter chips.",
    sizes: chapter,
    priority: false,
  },
};

export type ShotName = keyof typeof shots;
