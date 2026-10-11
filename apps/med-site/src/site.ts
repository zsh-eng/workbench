// Every provisional string and link on the page. Change them here only.

const installCommand =
  "curl -fsSL https://raw.githubusercontent.com/zsh-eng/workbench/main/apps/med/install.sh | sh";

export const repository = "https://github.com/zsh-eng/workbench";
/** Where the site is served; the docs' copied pages link to it. */
export const origin = "https://med.zsheng.app";

export const site = {
  title: "Med: review what your agent changed",
  description:
    "Med is a local, keyboard-first review app for the code changes that coding agents make.",

  // Headings have two lines: a statement in ink and a second line in grey.
  heading: "Review what your agent changed.",
  tagline: "A local review app for coding agents.",
  subtitle:
    "Comment on the diff, send your comments back to the agent, then commit and push.",
  closing: "Your agent did the work.",
  closingMore: "Read it in Med.",

  installCommand,
  agentPrompt: `Install Med, a local app where I review your code changes. Run \`${installCommand}\`, then run \`med skills install\` so you know how to hand your work to me in Med. Register this repository with \`med add .\` and start Med with \`med web\`. When you finish a task, give me a Med review link.`,
  requirements: "macOS 13 or newer on Apple Silicon.",

  links: {
    github: `${repository}/tree/main/apps/med`,
    // The docs pages render Med's guides (scripts/docs.ts).
    docs: "/docs",
    installDocs: "/docs#manual-install",
    agentDocs: "/docs/agents",
    license: `${repository}/blob/main/apps/med/LICENSE`,
    painting: `${repository}/tree/main/apps/med/scripts/painting`,
  },
  license: "MIT License",
};
