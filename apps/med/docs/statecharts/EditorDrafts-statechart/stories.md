## 1. Editing, saved (the file changed on disk)

Rule broken: Once Med has caught up, the editor tells you when the file on disk is not the text that it opened or saved.
Why: the editor has no notice for a file that changed on disk.
In the model, 3 different steps lead into this bug: "The editor takes the host's answer", "Med checks the file after a change on disk", and "You show this workspace". The steps below are the shortest path that TLC found.

0. Start: File not open
1. You open the file. Now: Editing, saved
2. Another program writes the file. Now: Editing, saved (the file changed on disk)
3. Med checks the file after a change on disk. Now: Editing, saved (the file changed on disk)

With the fix, step 3 (Med checks the file after a change on disk) takes you to: Editing, saved (the file changed on disk, and the editor says so).

## 2. Workspace closed (your unsaved text is gone)

Rule broken: Your unsaved text stays until you choose Discard draft.
Why: the draft that held your text closed with its workspace.
In the model, 4 different steps lead into this bug: "You close the workspace", "Med unloads the hidden workspace", "The host checks the file", and "The host checks the file again". The steps below are the shortest path that TLC found.

0. Start: File not open
1. You open the file. Now: Editing, saved
2. You type. Now: Editing, unsaved
3. You close the workspace. Now: Workspace closed (your unsaved text is gone)

With the fix, step 3 (You close the workspace) takes you to: Workspace closed, the draft waits in memory.

## 3. Saving (the file changed on disk, another program's change was replaced)

Rule broken: A save never replaces a change that another program made to the file.
Why: another program wrote the file after the host's last check, before the rename.
In the model, one step leads into this bug: "The host replaces the file". The steps below are the shortest path that TLC found.

0. Start: File not open
1. You open the file. Now: Editing, saved
2. You type. Now: Editing, unsaved
3. You save. Now: Saving
   (2 hidden steps: The host checks the file, The host checks the file again)
4. Another program writes the file. Now: Saving (the file changed on disk)
5. The host replaces the file. Now: Saving (the file changed on disk, another program's change was replaced)

With the fix you see the same states and steps, so the fix does not change this path.
