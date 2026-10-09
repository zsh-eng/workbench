// Every provisional string and link on the page. Change them here only.

const installCommand =
  "curl -fsSL https://raw.githubusercontent.com/zsh-eng/workbench/main/apps/med/install.sh | sh";

const repository = "https://github.com/zsh-eng/workbench";

export const site = {
  title: "Med: review what your agent changed",
  description:
    "Med is a local, keyboard-first review app for code changes made by Claude Code and Codex.",

  heading: "Review what your agent changed.",
  subtitle:
    "Med is a local, keyboard-first review app for code changes made by Claude Code and Codex. Read the diff, comment on lines, and copy your comments back to the agent.",

  installCommand,
  agentPrompt: `Install Med, a local app where I review your code changes. Run \`${installCommand}\`, then run \`med skills install\` so you know how to hand your work to me in Med. Register this repository with \`med add .\` and start Med with \`med web\`. When you finish a task, give me a Med review link.`,
  requirements: "macOS 13 or newer on Apple Silicon.",

  links: {
    github: `${repository}/tree/main/apps/med`,
    installDocs: `${repository}/blob/main/apps/med/docs/INSTALL.md`,
    agentDocs: `${repository}/blob/main/apps/med/docs/AGENT_INTEGRATION.md`,
    license: `${repository}/blob/main/apps/med/LICENSE`,
  },
  license: "MIT License",
};
