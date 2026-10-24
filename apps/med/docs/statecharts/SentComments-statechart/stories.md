## 1. Comment edited, sent (the agent's message has the first comment)

Rule broken: A comment leaves your drafts only when the agent's message has its newest text.
Why: the edit landed after the host read the comment and before it stamped the message.
In the model, 2 different steps lead into this bug: "The host stores the message with the time" and "You edit the comment". The steps below are the shortest path that TLC found.

0. Start: Comment written, in your drafts
1. You press Send. Now: Comment written, sending
   (2 hidden steps: The host reads the drafts for the thread, The host reads the comments for the agent)
2. You edit the comment. Now: Comment edited, sending
3. The host stores the message with the time. Now: Comment edited, sent (the agent's message has the first comment)

With the fix, step 3 (The host stores the message with the time) takes you to: Comment edited, back in your drafts (the agent's message has the first comment).

## 2. Comment edited, sent (the agent's message has the edited comment, the thread shows the first comment)

Rule broken: The thread shows each sent comment as the agent's message has it.
Why: the edit landed between the host's two reads of the comment.
In the model, one step leads into this bug: "The host stores the message with the time". The steps below are the shortest path that TLC found.

0. Start: Comment written, in your drafts
1. You press Send. Now: Comment written, sending
   (1 hidden step: The host reads the drafts for the thread)
2. You edit the comment. Now: Comment edited, sending
   (1 hidden step: The host reads the comments for the agent)
3. The host stores the message with the time. Now: Comment edited, sent (the agent's message has the edited comment, the thread shows the first comment)

With the fix, step 3 (The host stores the message with the time) takes you to: Comment edited, back in your drafts (the agent's message has the first comment).
