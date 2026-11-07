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
    id: "settings",
    label: "Settings",
    note: "Appearance: light, dark, or the system's choice between them, with a theme for each.",
    scene: "settings",
    recording: "recording.json",
  },
  {
    id: "ask-in-session",
    label: "Prototype: ask in a file, in a session",
    note: "Select lines in any file and press A. The question is a comment, and a fork of the session answers in its thread at once, so the session keeps working. Reply asks the same fork more; Send to Claude hands the thread to the session as a change to make.",
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
    id: "notes",
    label: "Notes vault",
    note: "A folder of notes beside the code, read as Markdown.",
    scene: "notes",
    recording: "vault.json",
  },
];
