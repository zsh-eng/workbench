## 1. A link saved after Cancel

Rule broken: After you cancel the link bar, nothing you did in it gets saved.
In the model, one step leads into this bug: "The clipboard gives a link". The steps below are the shortest path that TLC found.

0. Start: Library
1. Tap +. Now: Link bar, empty
2. Tap Paste. Now: Link bar, waiting for the clipboard
3. Tap × or the list. Now: Library (an earlier Paste waits)
4. The clipboard gives a link. Now: A link saved after Cancel

With the fix, step 4 (The clipboard gives a link) cannot happen, so you stay at: Library (an earlier Paste waits).

## 2. Saved, but the filter hides the new link

Rule broken: When a save from the link bar is done, its card is in view.
In the model, 2 different steps lead into this bug: "The clipboard gives a link" and "Tap Save". The steps below are the shortest path that TLC found.

0. Start: Library
1. Search, or pick a topic. Now: Library, filtered
2. Tap +. Now: Link bar, empty
3. Type in the field. Now: Link bar, a link typed
4. Tap Save. Now: Saved, but the filter hides the new link

With the fix, step 4 (Tap Save) takes you to: Saved, the new link at the top.

## 3. A link saved after Cancel

Rule broken: When a save from the link bar is done, its card is in view.
In the model, one step leads into this bug: "The clipboard gives a link". The steps below are the shortest path that TLC found.

0. Start: Library
1. Tap +. Now: Link bar, empty
2. Tap Paste. Now: Link bar, waiting for the clipboard
3. Tap × or the list. Now: Library (an earlier Paste waits)
4. Search, or pick a topic. Now: Library, filtered (an earlier Paste waits)
5. The clipboard gives a link. Now: A link saved after Cancel

With the fix, step 5 (The clipboard gives a link) cannot happen, so you stay at: Library, filtered (an earlier Paste waits).

## 4. Saved, but the filter hides the new link (an earlier Paste waits)

Rule broken: When a save from the link bar is done, its card is in view.
In the model, one step leads into this bug: "Tap Save". The steps below are the shortest path that TLC found.

0. Start: Library
1. Search, or pick a topic. Now: Library, filtered
2. Tap +. Now: Link bar, empty
3. Tap Paste. Now: Link bar, waiting for the clipboard
4. Type in the field. Now: Link bar, waiting for the clipboard
5. Tap Save. Now: Saved, but the filter hides the new link (an earlier Paste waits)

With the fix, step 5 (Tap Save) takes you to: Saved, the new link at the top (an earlier Paste waits).
