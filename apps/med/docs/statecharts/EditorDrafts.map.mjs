// Chart labels for EditorDrafts, for statechart.mjs. The labels say what
// the reader sees in Med: the editor's dot, the save, and the workspace.

// The steps that the reader takes. Another program's write is not Med's.
export const readerActions = [
  "OpenFile",
  "Type",
  "Undo",
  "Save",
  "Discard",
  "Refresh",
  "Hide",
  "Show",
  "CloseWorkspace",
  "Reopen",
  "OtherWrite",
];

// The unsaved text is not in memory and not on its way to the disk.
function lost(v) {
  if (v.owed === "none") return false;
  if (v.held !== "none" && v.draft.doc === v.owed) return false;
  return !(["sent", "checked", "rechecked"].includes(v.save.at) && v.save.text === v.owed);
}

// The editor says that the file changed on disk. The model of the code has
// only the refused save's error; the fix model, with `read`, has the notice.
function banner(v) {
  if (v.held !== "store") return false;
  if (v.draft.refused) return true;
  if (!("read" in v)) return false;
  return !v.draft.saving && (v.stale || v.read !== v.draft.base);
}

function editor(v) {
  const d = v.draft;
  if (d.saving) return "Saving";
  if (d.refused && d.dirty) return "Save refused";
  return d.dirty ? "Editing, unsaved" : "Editing, saved";
}

// The label for one model state.
export function state(v) {
  const notes = [];
  let label;
  if (v.ws === "closed") {
    label =
      v.held === "parked" ? "Workspace closed, the draft waits in memory" : "Workspace closed";
  } else if (v.held === "none") {
    label = "File not open";
  } else {
    label = editor(v);
    if (v.disk !== v.draft.base)
      notes.push(
        banner(v) ? "the file changed on disk, and the editor says so" : "the file changed on disk",
      );
  }
  if (v.ws === "hidden") notes.push("workspace hidden");
  if (lost(v)) notes.push("your unsaved text is gone");
  if (v.clobbered) notes.push("another program's change was replaced");
  return notes.length ? `${label} (${notes.join(", ")})` : label;
}

// The group of one model state, for the chart's colours.
export function group(v) {
  if (lost(v)) return "Unsaved text lost";
  if (v.owed !== "none") return "Unsaved text kept";
  return "Nothing unsaved";
}
export const groupColors = {
  "Nothing unsaved": "#e8eef7",
  "Unsaved text kept": "#fdf1d8",
};

const STEPS = {
  Answer: "The editor takes the host's answer",
  CloseWorkspace: "You close the workspace",
  Discard: "You discard the draft",
  Hide: "You show another workspace",
  HostCheck: "The host checks the file",
  HostRecheck: "The host checks the file again",
  HostRename: "The host replaces the file",
  Notice: "Med checks the file after a change on disk",
  Recheck: "Med checks the file again after the save",
  OpenFile: "You open the file",
  OtherWrite: "Another program writes the file",
  Refresh: "You refresh the file",
  Reopen: "You open the workspace again",
  Save: "You save",
  Show: "You show this workspace",
  Type: "You type",
  Undo: "You undo to the saved text",
  UnloadWorkspace: "Med unloads the hidden workspace",
};
export function step(action) {
  return STEPS[action] ?? action;
}

// Why a bad state is bad.
export function cause(v, facts, invariant) {
  if (invariant === "UnsavedTextKept")
    return "the draft that held your text closed with its workspace";
  if (invariant === "SaveKeepsOtherChanges")
    return "another program wrote the file after the host's last check, before the rename";
  if (invariant === "ChangeShown")
    return "the editor has no notice for a file that changed on disk";
  return null;
}
