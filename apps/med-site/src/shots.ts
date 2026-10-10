// Alt text and layout sizes for the screenshots. Their pixel sizes come from
// screenshots.json, which `bun run screenshots` writes.

// The review: a window on the painted panel, 88% of the panel's width from
// 640 px (src/styles.css, .painting). Below 960 px the tour shows the image at
// 3.6 times the window's width.
const wide =
  "(min-width: 1304px) 1092px, (min-width: 960px) calc(88vw - 57px), (min-width: 640px) calc(317vw - 205px), calc(360vw - 230px)";
// A feature's window: the right column of a chapter from 960 px, at most
// 748 px. Narrower screens show the scene at twice the window's width.
const chapter =
  "(min-width: 1304px) 748px, (min-width: 960px) calc(63.6vw - 81px), (min-width: 640px) calc(200vw - 128px), calc(200vw - 64px)";

export const shots = {
  review: {
    alt: "Med with the saved review Search filters at iteration 2. A split diff of SearchBar.tsx shows a reviewer comment under line 29. At the right, the Claude session pane shows the agent's last round and a message box with 1 comment, while Claude waits for the review.",
    sizes: wide,
    priority: true,
  },
  brief: {
    alt: "The Notes tab at iteration 2. The agent's sentence cites SearchBar.tsx line 9, and the cited line shows below it as a short diff. The header says that the notes cite 3 of 6 changed files.",
    sizes: chapter,
    priority: false,
  },
  comment: {
    alt: 'A reviewer comment under line 29 of SearchBar.tsx: Add aria-live="polite" to this list, so screen readers hear when the filters change.',
    sizes: chapter,
    priority: false,
  },
  session: {
    alt: "The reviewer comment on SearchBar.tsx beside the Claude session pane. The agent's reply ends with a review link, and a background command waits for the review. The message box holds 1 comment, and the status line says that Claude is waiting for your review.",
    sizes: chapter,
    priority: false,
  },
  commit: {
    alt: "The Commit tab with all 6 changed files staged. A dialog commits them to main with the message: Show active filters as chips.",
    sizes: chapter,
    priority: false,
  },
  notes: {
    alt: "The note Search filters in the Trailhead Notes vault: Markdown in the Vim editor at the left of its preview, which links to the note Filter chips. The sidebar lists the vault's four notes and the three notes that link to this one.",
    sizes: chapter,
    priority: false,
  },
};

export type ShotName = keyof typeof shots;
