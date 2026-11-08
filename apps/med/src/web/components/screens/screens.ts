/**
 * The screens of Med's design, in the order a review goes. Each is a scene of
 * the demo (src/web/demo.ts) on one of the recordings in public/screens, which
 * the website's screenshot script records from an invented project.
 */
export interface Screen {
  id: string;
  label: string;
  /** What the screen shows, in a sentence. */
  note: string;
  /** The demo's scene that sets the screen up. */
  scene: string;
  /** A recording in public/screens. */
  recording: string;
  /** A design that Med does not have yet: the prototype that shows it
   * (prototypes/Prototype.tsx), in place of the demo. */
  prototype?: string;
}

export const screens: readonly Screen[] = [
  {
    id: "review",
    label: "Review beside the session",
    note: "The agent's review of its changes, with the agent's session beside it and the thread in the sidebar.",
    scene: "review",
    recording: "hero.json",
  },
  {
    id: "changes",
    label: "Changes",
    note: "The changes as one stream of diffs, with the reviewer's comment on its lines.",
    scene: "comment",
    recording: "recording.json",
  },
  {
    id: "session",
    label: "Session",
    note: "The agent's session beside the changes it made.",
    scene: "session",
    recording: "recording.json",
  },
  {
    id: "brief",
    label: "The agent's summary",
    note: "Review opens on what the agent says it changed and why, with links to the lines it cites.",
    scene: "brief",
    recording: "recording.json",
  },
  {
    id: "commit",
    label: "Commit",
    note: "The files to stage, the message, and the push.",
    scene: "commit",
    recording: "recording.json",
  },
  {
    id: "replies",
    label: "Agent replies",
    note: "The agent answers a comment in its thread. A comment goes to an agent that Med runs from the comment, by the agent's mark.",
    scene: "replies",
    recording: "recording.json",
  },
  {
    id: "file-comments",
    label: "Comment in a file",
    note: "gc, or the + beside a line, comments on any file's lines. The arrow sends it to the agent now, the clock after its turn; the agent answers under it and resolves it. Its actions show on hover. ga asks about the lines instead.",
    scene: "files",
    recording: "recording.json",
  },
  {
    id: "comments",
    label: "All comments",
    note: "The header's comment button lists the thread's comments, on the diff and on files, newest first, with the open ones' count. A dot marks one not sent yet; the filter shows the resolved ones; a comment opens at its lines.",
    scene: "comments",
    recording: "recording.json",
  },
  {
    id: "hover",
    label: "A name's definition",
    note: "K, or the pointer resting on a name, shows where it is declared, its declaration, and its doc comment, from Med's symbol index; the file and line open it.",
    scene: "hover",
    recording: "recording.json",
  },
  {
    id: "diff-hover",
    label: "A name's definition, in the diff",
    note: "In the diff too, the pointer resting on a name shows its definition: from the old side's commit for a removed line, from the new side otherwise.",
    scene: "diff-hover",
    recording: "recording.json",
  },
  {
    id: "pulls",
    label: "Pull requests",
    note: "A page, as Settings is: the open pull requests that wait on you, then yours, a stack as one row. j and k move, ↵ opens it in a worktree, ⌘↵ with Claude reviewing it, ⌥↵ on GitHub. Read from GitHub with gh on open, on focus, and every five minutes.",
    scene: "pulls",
    recording: "recording.json",
  },
  {
    id: "superagent",
    label: "Superagent",
    note: "One thread that sees the others, on top of the sidebar: ask it where things stand, or to pass a direction to a thread (med thread send). Opus at high effort, which the thread's picker changes; Med briefs it once, the first time.",
    scene: "superagent",
    recording: "recording.json",
  },
  {
    id: "settings",
    label: "Settings",
    note: "Appearance: light, dark, or the system's choice between them, with a theme for each.",
    scene: "settings",
    recording: "recording.json",
  },
  {
    id: "ask-in-session",
    label: "Prototype: ask in a file, in a session",
    note: "Select lines in any file and press ga. While the agent waits, the question goes to its own thread, which answers it there. While it works, a fork of the session answers at once, so the work goes on; Reply asks the fork more.",
    scene: "",
    recording: "",
    prototype: "ask-in-session",
  },
  {
    id: "ask-in-workspace",
    label: "Prototype: ask in a file, without a session",
    note: "Outside a session, questions go to the repository's Questions session: one read-only Claude session per repository that Med keeps, so each answer builds on the last. Make a session starts a working session from the question.",
    scene: "",
    recording: "",
    prototype: "ask-in-workspace",
  },
  {
    id: "find-bar",
    label: "Prototype: one find bar",
    note: "⌘F in the diff, ⌘F in a file, and Vim's / and ? open the same bar: Match case, Whole word, and Regular expression, the count, and Previous and Next. In a file it is CodeMirror's search panel, so n and N go on from its query.",
    scene: "",
    recording: "",
    prototype: "find-bar",
  },
  {
    id: "notes",
    label: "Notes vault",
    note: "A folder of notes beside the code, read as Markdown.",
    scene: "notes",
    recording: "vault.json",
  },
];
