## 1. Both show the phone's note, an older edit

Rule broken: Once both devices are done syncing, the note is its newest edit.
In the model, 2 different steps lead into this bug: "The web takes the account's note" and "The web sends its edit". The steps below are the shortest path that TLC found.

0. Start: No note yet
1. Edit the note on the phone. Now: The web shows no note, the phone the phone's note (the phone has not sent its edit)
2. Edit the note on the web. Now: The web shows the web's note, the phone the phone's note (the web has not sent its edit, the phone has not sent its edit)
3. The phone pulls. Now: The web shows the web's note, the phone the phone's note (the web has not sent its edit, the phone has not sent its edit, the phone is syncing)
4. The phone compares updatedAt. Now: The web shows the web's note, the phone the phone's note (the web has not sent its edit, the phone has not sent its edit, the phone is syncing)
5. The phone sends. Now: The web shows the web's note, the phone the phone's note (the web has not sent its edit)
6. The web takes the account's note. Now: Both show the phone's note, an older edit

With the fix, step 6 (The web takes the account's note) cannot happen, so you stay at: The web shows the web's note, the phone the phone's note (the web has not sent its edit).
