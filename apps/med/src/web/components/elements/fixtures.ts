import type { BrowseRead } from "../../../shared/browse";
import type { CodexReviewRun } from "../../../shared/codex-review";
import type { Commit, CommitDetails, Note, PullRequestComments } from "../../../shared/protocol";

// Sample data for the elements page. It uses Med's own vocabulary so each
// specimen reads like the product, not like placeholder text.

const minute = 60_000;
const hour = 60 * minute;
const day = 24 * hour;
const loaded = Date.now();
const id = (seed: string) => seed.repeat(40).slice(0, 40);

export const commits: Commit[] = [
  {
    id: id("ab41597644ef5adb"),
    parents: [id("9e2c41d0")],
    subject: "release(med): prepare macOS v0.1.7",
    author: "Sam Rivera",
    timestamp: loaded - 42 * minute,
    refs: ["HEAD -> main", "tag: med-v0.1.7", "origin/main"],
  },
  {
    id: id("9e2c41d0"),
    parents: [id("de69822a"), id("51f0b3c7")],
    subject: "Merge branch 'themes/code-colors'",
    author: "Sam Rivera",
    timestamp: loaded - 3 * hour,
    refs: [],
  },
  {
    id: id("51f0b3c7"),
    parents: [id("7c1d2e90")],
    subject: "feat(med): take selection and match colors from each theme",
    author: "Ada Okafor",
    timestamp: loaded - 5 * hour,
    refs: ["themes/code-colors"],
  },
  {
    id: id("de69822a"),
    parents: [id("cc1a6180")],
    subject: "perf(med): open the first vault note without the lazy-load delay",
    author: "Sam Rivera",
    timestamp: loaded - 9 * hour,
    refs: [],
  },
  {
    id: id("7c1d2e90"),
    parents: [id("cc1a6180")],
    subject: "fix(med): keep the find bar above sticky file headers",
    author: "Ada Okafor",
    timestamp: loaded - 26 * hour,
    refs: [],
  },
  {
    id: id("cc1a6180"),
    parents: [id("83afc7ab")],
    subject: "perf(med): fetch a saved review's first diff with the repository checks",
    author: "Sam Rivera",
    timestamp: loaded - 2 * day,
    refs: [],
  },
  {
    id: id("83afc7ab"),
    parents: [id("e85b40a3")],
    subject: "feat(med): link agent sessions to review workspaces",
    author: "Lin Park",
    timestamp: loaded - 3 * day,
    refs: [],
  },
  {
    id: id("e85b40a3"),
    parents: [id("60cf8c43")],
    subject: "feat(med): split the comparison totals by kind of file",
    author: "Sam Rivera",
    timestamp: loaded - 6 * day,
    refs: [],
  },
  {
    id: id("60cf8c43"),
    parents: [id("e6e887b9")],
    subject: "feat(med): redesign the Sources page",
    author: "Lin Park",
    timestamp: loaded - 12 * day,
    refs: [],
  },
  {
    id: id("e6e887b9"),
    parents: [],
    subject: "feat(med): make review comments quieter",
    author: "Ada Okafor",
    timestamp: loaded - 40 * day,
    refs: [],
  },
];

const details: Record<string, Omit<CommitDetails, "id">> = {
  [commits[0]!.id]: {
    body: "Bump the version in the README, install guide, and package manifest.",
    coAuthors: [],
    files: 5,
    additions: 9,
    deletions: 9,
  },
  [commits[1]!.id]: { body: "", coAuthors: [], files: 7, additions: 184, deletions: 22 },
  [commits[2]!.id]: {
    body: "Selection, find matches, and diff lines now use each theme's own editor colors.\nA selected line keeps its green or red, so a selection over a change still reads as a change.",
    coAuthors: ["Sam Rivera"],
    files: 6,
    additions: 241,
    deletions: 38,
  },
  [commits[3]!.id]: {
    body: "React's lazy() suspends on the first render even when the module is ready. Load the editor module while the vault opens and render it directly once it is loaded.",
    coAuthors: ["Claude"],
    files: 3,
    additions: 31,
    deletions: 4,
  },
};

/** Commit details after a short delay, like the host's /api/commit. */
export function loadCommitDetails(id: string, signal: AbortSignal): Promise<CommitDetails> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () =>
        resolve({
          id,
          ...(details[id] ?? { body: "", coAuthors: [], files: 2, additions: 12, deletions: 3 }),
        }),
      120,
    );
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(signal.reason);
    });
  });
}

export function commitDetails(id: string): CommitDetails {
  return { id, ...details[id]! };
}

const notePath = "src/web/data/relative-time.ts";
export const notes: Note[] = [
  {
    id: "note-1",
    path: notePath,
    side: "new",
    line: 18,
    endLine: 19,
    text: "Weeks read better than `14 days ago`, but the history panel is narrow. Is `wk` clear enough next to `mo`?",
    createdAt: new Date(loaded - 3 * hour).toISOString(),
    updatedAt: new Date(loaded - 3 * hour).toISOString(),
    resolution: "active",
  },
  {
    id: "note-2",
    path: notePath,
    side: "new",
    line: 18,
    endLine: 19,
    parentId: "note-1",
    text: "It matches the compact units we already use (`min`, `hr`). I kept `days` plural because it is the most common case.",
    createdAt: new Date(loaded - 2 * hour).toISOString(),
    updatedAt: new Date(loaded - 2 * hour).toISOString(),
    resolution: "active",
  },
];

const pr = "https://github.com/acme/med/pull/482";
const at = (ago: number) => new Date(loaded - ago).toISOString();

/** GitHub comments on the same change: an inline thread with a suggestion, an
 * outdated thread, review summaries, and conversation. */
export const pullRequest: PullRequestComments = {
  url: pr,
  head: id("c4f81e2"),
  fetchedAt: loaded,
  threads: [
    {
      id: 9101,
      path: notePath,
      side: "new",
      line: 24,
      startLine: null,
      originalLine: 24,
      comments: [
        {
          id: 9101,
          author: "mira-k",
          body: '`label` now holds the plural form, so the name reads backwards. Keep `unit` for the input and name the result for what it is:\n\n```suggestion\n  const shown = unit === "day" && count !== 1 ? "days" : unit;\n```',
          createdAt: at(5 * hour),
          url: `${pr}#discussion_r9101`,
        },
        {
          id: 9102,
          author: "sam-rivera",
          body: "Agreed. I will take it in the next iteration.",
          createdAt: at(4 * hour),
          url: `${pr}#discussion_r9102`,
        },
      ],
    },
    {
      id: 9120,
      path: notePath,
      side: "old",
      line: null,
      startLine: null,
      originalLine: 12,
      comments: [
        {
          id: 9120,
          author: "mira-k",
          body: "Is 30 days close enough to a month for the history panel?",
          createdAt: at(2 * day),
          url: `${pr}#discussion_r9120`,
        },
      ],
    },
  ],
  conversation: [
    {
      id: 7001,
      author: "sam-rivera",
      body: "Adds weeks between days and months, so the history panel no longer shows `21 days ago`.",
      createdAt: at(2 * day + hour),
      url: `${pr}#issuecomment-7001`,
    },
    {
      id: 7002,
      author: "ci-bot[bot]",
      body: "<!-- ci-report -->\nAll 214 checks passed on c4f81e2.",
      createdAt: at(3 * hour),
      url: `${pr}#issuecomment-7002`,
    },
  ],
  reviews: [
    {
      id: 8001,
      author: "mira-k",
      body: "One naming note inline; the rest reads well.",
      createdAt: at(5 * hour),
      url: `${pr}#pullrequestreview-8001`,
      state: "CHANGES_REQUESTED",
    },
    {
      id: 8002,
      author: "jordan-ito",
      body: "",
      createdAt: at(90 * minute),
      url: `${pr}#pullrequestreview-8002`,
      state: "APPROVED",
    },
  ],
};

/** A change with context, a word-level edit, removals, and additions. */
/** A Codex review of the same change, as `codex review --base main` writes it:
 * a finding in the diff and one beside it. */
export const codexReview: CodexReviewRun = {
  id: "019a6b2e-7c41-7d10-9e55-3f0c2a9b8d14:0",
  threadId: "019a6b2e-7c41-7d10-9e55-3f0c2a9b8d14",
  repo: "/Users/you/work/med",
  commit: id("c4f81e2"),
  createdAt: at(2 * hour),
  target: "changes against 'main'",
  verdict: "patch is correct",
  explanation:
    "The week unit fits between days and months. One label changes for dates that the history panel shows often.",
  findings: [
    {
      id: "019a6b2e-7c41-7d10-9e55-3f0c2a9b8d14:0:0",
      title: "Expect 4 wk for 28 and 29 days",
      body: "With `week` before `30 * day`, a commit from 29 days ago now reads `4 wk`, where the history panel showed `29 day`. Check that this is the label you want for the last days of a month.",
      priority: 2,
      confidence: 0.7,
      path: notePath,
      startLine: 18,
      endLine: 19,
    },
    {
      id: "019a6b2e-7c41-7d10-9e55-3f0c2a9b8d14:0:1",
      title: "Cover the week boundary",
      body: "No test reaches 7 days, so a change of `week` to `<=` would pass. Add cases for 6 and 7 days.",
      priority: 3,
      confidence: 0.6,
      path: "tests/relative-time.test.ts",
      startLine: 12,
      endLine: 12,
    },
  ],
};

export const relativeTimePatch = `diff --git a/${notePath} b/${notePath}
index 3f2a1c4..8be90d2 100644
--- a/${notePath}
+++ b/${notePath}
@@ -1,23 +1,26 @@
 const minute = 60_000;
 const hour = 60 * minute;
 const day = 24 * hour;
+const week = 7 * day;
${" "}
-/** Compact elapsed time; future author dates remain explicit for clock skew. */
+/** Compact elapsed time. Future author dates stay explicit for clock skew. */
 export function relativeTime(timestamp: number, now: number): string {
   const elapsed = now - timestamp;
   const distance = Math.abs(elapsed);
   if (distance < minute) return "just now";
-  const [size, label]: [number, string] =
+  const [size, unit]: [number, string] =
     distance < hour
       ? [minute, "min"]
       : distance < day
         ? [hour, "hr"]
-        : distance < 30 * day
+        : distance < week
           ? [day, "day"]
-          : distance < 365 * day
-            ? [30 * day, "mo"]
-            : [365 * day, "yr"];
+          : distance < 30 * day
+            ? [week, "wk"]
+            : distance < 365 * day
+              ? [30 * day, "mo"]
+              : [365 * day, "yr"];
   const count = Math.floor(distance / size);
-  const unit = label === "day" && count !== 1 ? "days" : label;
-  return elapsed < 0 ? \`in \${count} \${unit}\` : \`\${count} \${unit} ago\`;
+  const label = unit === "day" && count !== 1 ? "days" : unit;
+  return elapsed < 0 ? \`in \${count} \${label}\` : \`\${count} \${label} ago\`;
 }
`;

const themePath = "src/web/themes.ts";
/** A short change for the selection specimens. */
export const themePatch = `diff --git a/${themePath} b/${themePath}
index 41c9e02..a7d3b15 100644
--- a/${themePath}
+++ b/${themePath}
@@ -8,8 +8,9 @@
 export function applyTheme(theme: Theme, root: HTMLElement) {
   for (const [name, color] of Object.entries(theme.palette)) {
-    root.style.setProperty(\`--med-\${name}\`, color);
+    root.style.setProperty(\`--med-\${name}\`, normalize(color));
   }
-  root.style.colorScheme = "dark";
+  root.style.colorScheme = theme.appearance;
+  root.dataset.theme = theme.id;
   const page = root.ownerDocument;
   let meta = page.querySelector("meta[name=theme-color]");
   if (!meta) meta = page.createElement("meta");
`;

const relativeTimeSource = `const minute = 60_000;
const hour = 60 * minute;
const day = 24 * hour;
const week = 7 * day;

/** Compact elapsed time. Future author dates stay explicit for clock skew. */
export function relativeTime(timestamp: number, now: number): string {
  const elapsed = now - timestamp;
  const distance = Math.abs(elapsed);
  if (distance < minute) return "just now";
  const [size, unit]: [number, string] =
    distance < hour
      ? [minute, "min"]
      : distance < day
        ? [hour, "hr"]
        : distance < week
          ? [day, "day"]
          : distance < 30 * day
            ? [week, "wk"]
            : distance < 365 * day
              ? [30 * day, "mo"]
              : [365 * day, "yr"];
  const count = Math.floor(distance / size);
  const label = unit === "day" && count !== 1 ? "days" : unit;
  return elapsed < 0 ? \`in \${count} \${label}\` : \`\${count} \${label} ago\`;
}
`;

export function sampleFile(identity: string): BrowseRead {
  return {
    source: { kind: "worktree", repo: "elements" },
    path: notePath,
    kind: "text",
    size: relativeTimeSource.length,
    identity,
    text: relativeTimeSource,
  };
}

export const changedFiles = [
  { path: "src/web/themes.ts", additions: 184, deletions: 22 },
  { path: "src/web/components/HistoryPanel.tsx", additions: 96, deletions: 41 },
  { path: "src/web/components/diff-surface.ts", additions: 18, deletions: 2 },
  { path: "tests/browser/theme-colors.test.tsx", additions: 64, deletions: 0 },
  { path: "docs/THEMES.md", additions: 38, deletions: 6 },
  { path: "package.json", additions: 1, deletions: 1 },
  { path: "bun.lock", additions: 12, deletions: 9 },
];
