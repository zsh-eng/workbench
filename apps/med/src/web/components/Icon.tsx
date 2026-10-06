import type { CSSProperties, ReactNode } from "react";

// Med's own icon set, drawn by hand on a 16-pixel grid. Strokes are 1.5 px with
// round ends so icons share the weight of Geist at 12–13 px. Draw new icons at
// this size; do not scale 24-pixel sets down, because their strokes become thin.
export type IconName =
  | "branch"
  | "gitBranch"
  | "gitWorktree"
  | "chevron"
  | "file"
  | "search"
  | "refresh"
  | "settings"
  | "close"
  | "split"
  | "unified"
  | "wrap"
  | "sun"
  | "moon"
  | "theme"
  | "note"
  | "history"
  | "check"
  | "folder"
  | "arrowDown"
  | "arrowUp"
  | "command"
  | "copy"
  | "external"
  | "panelLeft"
  | "panelRight"
  | "plus"
  | "edit"
  | "trash"
  | "reply"
  | "save"
  | "preview"
  | "diff"
  | "commit"
  | "push"
  | "compare"
  | "pullRequest"
  | "github"
  | "testFile"
  | "focus"
  | "focusExit"
  | "selector";

const branch = (
  <>
    <circle cx="4.5" cy="3.25" r="1.75" />
    <circle cx="4.5" cy="12.75" r="1.75" />
    <circle cx="11.5" cy="3.25" r="1.75" />
    <path d="M4.5 5v6M11.5 5v1.5a2.25 2.25 0 0 1-2.25 2.25h-2.5A2.25 2.25 0 0 0 4.5 11" />
  </>
);
const frame = <rect x="1.75" y="2.75" width="12.5" height="10.5" rx="2" />;

const icons: Record<IconName, ReactNode> = {
  focus: (
    <>
      <path d="M2.75 5.75v-1.5a1.5 1.5 0 0 1 1.5-1.5h1.5M10.25 2.75h1.5a1.5 1.5 0 0 1 1.5 1.5v1.5M13.25 10.25v1.5a1.5 1.5 0 0 1-1.5 1.5h-1.5M5.75 13.25h-1.5a1.5 1.5 0 0 1-1.5-1.5v-1.5" />
      <circle cx="8" cy="8" r="1.25" fill="currentColor" stroke="none" />
    </>
  ),
  // Corners turned inward: the way back out of zen mode.
  focusExit: (
    <path d="M5.75 2.75v1.5a1.5 1.5 0 0 1-1.5 1.5h-1.5M13.25 5.75h-1.5a1.5 1.5 0 0 1-1.5-1.5v-1.5M10.25 13.25v-1.5a1.5 1.5 0 0 1 1.5-1.5h1.5M2.75 10.25h1.5a1.5 1.5 0 0 1 1.5 1.5v1.5" />
  ),
  selector: <path d="M5.5 6.25 8 3.75l2.5 2.5M5.5 9.75 8 12.25l2.5-2.5" />,
  github: (
    <path
      fill="currentColor"
      stroke="none"
      d="M8 0C3.58 0 0 3.58 0 8a8 8 0 0 0 5.47 7.59c.4.07.55-.17.55-.38v-1.49c-2.23.48-2.7-.95-2.7-.95-.36-.92-.89-1.17-.89-1.17-.73-.5.06-.49.06-.49.8.06 1.23.83 1.23.83.71 1.22 1.87.87 2.33.67.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.22 2.2.82A7.65 7.65 0 0 1 8 3.87c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.28.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48v2.19c0 .21.15.46.55.38A8 8 0 0 0 16 8c0-4.42-3.58-8-8-8Z"
    />
  ),
  testFile: (
    <>
      <path d="M5 1.75h6M6 1.75v4l-3.5 6a1.65 1.65 0 0 0 1.4 2.5h8.2a1.65 1.65 0 0 0 1.4-2.5l-3.5-6v-4M4.5 10h7" />
      <path d="m6 11.75 1 1 2.5-2.5" />
    </>
  ),
  branch,
  gitBranch: branch,
  gitWorktree: (
    <>
      <circle cx="4" cy="3.25" r="1.75" />
      <circle cx="12" cy="3.25" r="1.75" />
      <circle cx="8" cy="12.75" r="1.75" />
      <path d="M4 5v.75A2.25 2.25 0 0 0 6.25 8h3.5A2.25 2.25 0 0 0 12 5.75V5M8 8v3" />
    </>
  ),
  pullRequest: (
    <>
      <circle cx="4" cy="3.25" r="1.75" />
      <circle cx="4" cy="12.75" r="1.75" />
      <circle cx="12" cy="12.75" r="1.75" />
      <path d="M4 5v6M12 11V6.25a1.5 1.5 0 0 0-1.5-1.5H7.5M9.25 3 7.5 4.75 9.25 6.5" />
    </>
  ),
  commit: (
    <>
      <circle cx="8" cy="8" r="2.75" />
      <path d="M1.75 8h3.5M10.75 8h3.5" />
    </>
  ),
  compare: (
    <>
      <circle cx="4" cy="12.25" r="1.75" />
      <circle cx="12" cy="3.75" r="1.75" />
      <path d="M4 10.5V6.25a1.5 1.5 0 0 1 1.5-1.5h3.25M7.25 3.25l1.5 1.5-1.5 1.5M12 5.5v4.25a1.5 1.5 0 0 1-1.5 1.5H7.25M8.75 9.75l-1.5 1.5 1.5 1.5" />
    </>
  ),
  push: (
    <path d="M8 10.25v-7.5M4.75 6 8 2.75 11.25 6M2.75 9.75v2a1.5 1.5 0 0 0 1.5 1.5h7.5a1.5 1.5 0 0 0 1.5-1.5v-2" />
  ),
  diff: (
    <>
      <rect x="2.25" y="2.25" width="11.5" height="11.5" rx="2.75" />
      <path d="M8 4.75v4M6 6.75h4M6 11.25h4" />
    </>
  ),
  chevron: <path d="M4.5 6.25 8 9.75l3.5-3.5" />,
  file: (
    <>
      <path d="M9.25 1.75h-4.5a1.5 1.5 0 0 0-1.5 1.5v9.5a1.5 1.5 0 0 0 1.5 1.5h6.5a1.5 1.5 0 0 0 1.5-1.5v-7.5z" />
      <path d="M9.25 1.75v2.5a1 1 0 0 0 1 1h2.5" />
    </>
  ),
  folder: (
    <path d="M1.75 4.25a1.5 1.5 0 0 1 1.5-1.5h2.88a1.5 1.5 0 0 1 1.2.6l.84 1.12a1.5 1.5 0 0 0 1.2.6h3.38a1.5 1.5 0 0 1 1.5 1.5v5.68a1.5 1.5 0 0 1-1.5 1.5h-9.5a1.5 1.5 0 0 1-1.5-1.5z" />
  ),
  search: (
    <>
      <circle cx="7.25" cy="7.25" r="4.5" />
      <path d="m10.5 10.5 3.25 3.25" />
    </>
  ),
  refresh: (
    <path d="M2.75 8a5.25 5.25 0 0 1 9.8-2.63M12.55 2.63v2.75H9.8M13.25 8a5.25 5.25 0 0 1-9.8 2.63M3.45 13.38v-2.75H6.2" />
  ),
  settings: (
    <>
      <path d="M2.75 4.75h5.5M11.75 4.75h1.5M2.75 11.25h1.5M7.75 11.25h5.5" />
      <circle cx="10" cy="4.75" r="1.75" />
      <circle cx="6" cy="11.25" r="1.75" />
    </>
  ),
  close: <path d="m4.5 4.5 7 7M11.5 4.5l-7 7" />,
  plus: <path d="M8 3.25v9.5M3.25 8h9.5" />,
  check: <path d="m3.5 8.25 3 3 6-6.5" />,
  split: (
    <>
      {frame}
      <path d="M8 2.75v10.5" />
    </>
  ),
  unified: (
    <>
      {frame}
      <path d="M1.75 8h12.5" />
    </>
  ),
  panelLeft: (
    <>
      <path
        d="M3.75 2.75h2.5v10.5h-2.5a2 2 0 0 1-2-2v-6.5a2 2 0 0 1 2-2z"
        fill="currentColor"
        opacity=".28"
        stroke="none"
      />
      {frame}
      <path d="M6.25 2.75v10.5" />
    </>
  ),
  panelRight: (
    <>
      <path
        d="M12.25 2.75h-2.5v10.5h2.5a2 2 0 0 0 2-2v-6.5a2 2 0 0 0-2-2z"
        fill="currentColor"
        opacity=".28"
        stroke="none"
      />
      {frame}
      <path d="M9.75 2.75v10.5" />
    </>
  ),
  preview: (
    <>
      {frame}
      <path d="M8 2.75v10.5M10.25 6.25h1.75M10.25 9.25h1.75" />
    </>
  ),
  wrap: (
    <path d="M2.75 3.75h10.5M2.75 8h8.5a2.25 2.25 0 0 1 0 4.5H8.5M2.75 12.5h2.5M10 10.75l-1.75 1.75L10 14.25" />
  ),
  sun: (
    <>
      <circle cx="8" cy="8" r="2.75" />
      <path d="M8 1.75v1.5M8 12.75v1.5M1.75 8h1.5M12.75 8h1.5M3.58 3.58l1.06 1.06M11.36 11.36l1.06 1.06M3.58 12.42l1.06-1.06M11.36 4.64l1.06-1.06" />
    </>
  ),
  moon: <path d="M13.25 9.6A5.5 5.5 0 1 1 6.4 2.75a4.5 4.5 0 0 0 6.85 6.85z" />,
  theme: (
    <>
      <circle cx="8" cy="8" r="5.75" />
      <path d="M8 2.25a5.75 5.75 0 0 1 0 11.5z" fill="currentColor" stroke="none" />
    </>
  ),
  note: (
    <path d="M2.75 4.25a1.5 1.5 0 0 1 1.5-1.5h7.5a1.5 1.5 0 0 1 1.5 1.5v5.5a1.5 1.5 0 0 1-1.5 1.5H8l-2.75 2.25v-2.25h-1a1.5 1.5 0 0 1-1.5-1.5z" />
  ),
  history: (
    <>
      <path d="M2.75 8A5.25 5.25 0 1 0 4.5 4.1" />
      <path d="M4.75 1.6v2.75H2" />
      <path d="M8 5.25V8l1.75 1.5" />
    </>
  ),
  arrowDown: <path d="M8 2.75v10.5M3.75 9 8 13.25 12.25 9" />,
  arrowUp: <path d="M8 13.25V2.75M3.75 7 8 2.75 12.25 7" />,
  command: (
    <path d="M5.75 10.25v-6a1.5 1.5 0 1 0-1.5 1.5h7.5a1.5 1.5 0 1 0-1.5-1.5v7.5a1.5 1.5 0 1 0 1.5-1.5h-7.5a1.5 1.5 0 1 0 1.5 1.5z" />
  ),
  copy: (
    <>
      <rect x="5.25" y="5.25" width="8.5" height="8.5" rx="1.75" />
      <path d="M2.25 10.25v-6.5a1.5 1.5 0 0 1 1.5-1.5h6.5" />
    </>
  ),
  external: <path d="M5 11 11 5M5.75 5H11v5.25" />,
  edit: <path d="M10.6 2.9a1.6 1.6 0 0 1 2.26 2.26l-7.11 7.11-3 .98.98-3zM9.25 4.25l2.5 2.5" />,
  trash: (
    <path d="M2.75 4.25h10.5M6.25 4.25V3a.75.75 0 0 1 .75-.75h2a.75.75 0 0 1 .75.75v1.25M4.25 4.25l.62 8.36A1.5 1.5 0 0 0 6.37 14h3.26a1.5 1.5 0 0 0 1.5-1.39l.62-8.36" />
  ),
  reply: <path d="M6.25 4.25 2.75 7.75l3.5 3.5M2.75 7.75h6.5a4 4 0 0 1 4 4v.5" />,
  save: (
    <>
      <path d="M2.75 4.25a1.5 1.5 0 0 1 1.5-1.5h6.13a1.5 1.5 0 0 1 1.06.44l1.62 1.62a1.5 1.5 0 0 1 .44 1.06v6.38a1.5 1.5 0 0 1-1.5 1.5h-7.5a1.5 1.5 0 0 1-1.5-1.5z" />
      <path d="M5.25 13.25v-3a.5.5 0 0 1 .5-.5h4.5a.5.5 0 0 1 .5.5v3M5.75 2.75v2.5h3.5" />
    </>
  ),
};

export function Icon({
  name,
  size = 16,
  style,
}: {
  name: IconName;
  size?: number;
  style?: CSSProperties;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      style={{ flexShrink: 0, ...style }}
    >
      {icons[name]}
    </svg>
  );
}
