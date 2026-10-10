// Every provisional string and link on the page. Change them here only.

const installCommand =
  "curl -fsSL https://raw.githubusercontent.com/zsh-eng/workbench/main/apps/med/install.sh | sh";

const repository = "https://github.com/zsh-eng/workbench";

export const site = {
  title: "Med: review what your agent changed",
  description:
    "Med is a local, keyboard-first review app for the code changes that coding agents make.",

  // Headings have two lines: a statement in ink and a second line in grey.
  heading: "Review what your agent changed.",
  tagline: "A local review app for coding agents.",
  subtitle:
    "Read what the agent did and why, comment on lines, and send your comments back to it. Then commit, push, and follow the pull request from the same window.",
  closing: "Your agent did the work.",
  closingMore: "Read it in Med.",

  installCommand,
  agentPrompt: `Install Med, a local app where I review your code changes. Run \`${installCommand}\`, then run \`med skills install\` so you know how to hand your work to me in Med. Register this repository with \`med add .\` and start Med with \`med web\`. When you finish a task, give me a Med review link.`,
  requirements: "macOS 13 or newer on Apple Silicon.",

  links: {
    github: `${repository}/tree/main/apps/med`,
    docs: `${repository}/blob/main/apps/med/docs/USAGE.md`,
    installDocs: `${repository}/blob/main/apps/med/docs/INSTALL.md`,
    agentDocs: `${repository}/blob/main/apps/med/docs/AGENT_INTEGRATION.md`,
    license: `${repository}/blob/main/apps/med/LICENSE`,
    painting: `${repository}/tree/main/apps/med/scripts/painting`,
  },
  license: "MIT License",
};
