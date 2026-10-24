## 1. Committed a, b, n (the dialog counted a, b)

Rule broken: A commit holds exactly the files that the Commit dialog counted when you pressed Commit.
Why: Commit all staged a file that the dialog did not count.
In the model, one step leads into this bug: "Git commits". The steps below are the shortest path that TLC found.

0. Start: Shows a, b, nothing staged
1. You press Commit. Now: Committing a, b (Commit all)
2. An agent writes a new file. Now: Committing a, b (Commit all) (n new on disk)
   (1 hidden step: The commit starts)
3. Med stages the files for Commit all. Now: Committing a, b (Commit all) (n new on disk, Git has a, b, n staged)
4. The tab sends the commit. Now: Committing a, b (Commit all)
5. Git commits. Now: Committed a, b, n (the dialog counted a, b)

With the fix, step 3 (Med stages the files for Commit all) takes you to: Committing a, b (Commit all) (n new on disk, Git has a, b staged).

## 2. Committed b (the dialog counted a)

Rule broken: A commit holds exactly the files that the Commit dialog counted when you pressed Commit.
Why: another program staged a file while the commit waited for your stage, and the commit took what Git had staged.
In the model, one step leads into this bug: "Git commits". The steps below are the shortest path that TLC found.

0. Start: Shows a, b, nothing staged
1. You press Space on a. Now: Shows a staged (staging)
2. You press Commit. Now: Committing a
3. An agent stages a file. Now: Committing a (Git has b staged)
   (1 hidden step: Git refuses the stage)
4. The tab takes Git's answer. Now: Committing a
   (1 hidden step: The commit starts)
5. Git commits. Now: Committed b (the dialog counted a)

With the fix, after step 4, "The commit starts" happens and takes you to: The commit stopped: Git's staged files are not the counted ones.

## 3. Committed a (the dialog counted a, b)

Rule broken: A commit holds exactly the files that the Commit dialog counted when you pressed Commit.
Why: a stage failed, and the commit went on with fewer files.
In the model, one step leads into this bug: "Git commits". The steps below are the shortest path that TLC found.

0. Start: Shows a, b, nothing staged
1. An agent stages a file. Now: Shows a, b, nothing staged (Git has a staged)
2. The tab reads Git's status. Now: Shows a staged
3. You press Space on b. Now: Shows a, b staged (staging)
4. You press Commit. Now: Committing a, b
   (3 hidden steps: Git refuses the stage, The tab takes Git's answer, The commit starts)
5. Git commits. Now: Committed a (the dialog counted a, b)

With the fix, after step 4, "The commit starts" happens and takes you to: The commit stopped: Git's staged files are not the counted ones.
