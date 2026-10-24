## 1. Text and theme tapped, nothing opens

Rule broken: Once things settle while online, the Text and theme sheet you tapped is on screen.
In the model, 2 different steps lead into this bug: "Tap Text and theme" and "The connection returns". The steps below are the shortest path that TLC found.

0. Start: Library (offline)
1. Open an article. Now: Reading (offline)
2. Tap Text and theme. Now: Text and theme loading (offline)
3. The sheet's code fails to load. Now: Text and theme tapped, nothing opens (offline)
4. The connection returns. Now: Text and theme tapped, nothing opens
