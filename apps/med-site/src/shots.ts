// Alt text and layout sizes for the screenshots. Their pixel sizes come from
// screenshots.json, which `bun run screenshots` writes.

const full =
  "(min-width: 1184px) 1120px, (min-width: 640px) calc(100vw - 64px), calc(100vw - 32px)";
const half =
  "(min-width: 1184px) 544px, (min-width: 800px) calc(50vw - 48px), (min-width: 640px) calc(100vw - 64px), calc(100vw - 32px)";

export const shots = {
  review: {
    alt: "Med with a saved review named Search filters. The sidebar lists the workspaces, the history, and the changed files. A split diff of SearchBar.tsx shows a reviewer comment under line 29.",
    sizes: full,
    priority: true,
  },
  brief: {
    alt: "The Brief tab at iteration 2. The agent's sentence cites SearchBar.tsx line 9, and the cited line shows below it as a short diff.",
    sizes: half,
    priority: false,
  },
  search: {
    alt: "The Find file palette with TypeScript files from the repository and a preview of the selected file.",
    sizes: half,
    priority: false,
  },
};

export type ShotName = keyof typeof shots;
