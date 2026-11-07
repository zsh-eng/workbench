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
    label: "The agent's notes",
    note: "What the agent says it changed and why, with the diffs it cites.",
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
    id: "notes",
    label: "Notes vault",
    note: "A folder of notes beside the code, read as Markdown.",
    scene: "notes",
    recording: "vault.json",
  },
];
