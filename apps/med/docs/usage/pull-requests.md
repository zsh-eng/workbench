# Pull requests

Paste a pull request link, such as `https://github.com/owner/repo/pull/333`, in
**New workspace…**. Choose **Open pull request #333**, or **Open and review
with** an installed agent. The workspace shows each step:

1. Find the registered repository whose remote is `owner/repo`. Add an unknown
   repository first.
2. Read the pull request with `gh`.
3. Make a worktree in Med's state folder (`worktrees/repo/pr-333`). Your
   checkout and its branch do not change.
4. Check out the pull request there with `gh pr checkout`. If its branch is in
   use in another worktree, Med checks out its commit without a branch.
5. Fetch the base branch if it is not local, and save the review.
6. Start the agent in the worktree with a review prompt, if you chose one.

The same link opens the same worktree and review; a new head adds a
version. A failed step says why and offers **Retry**. When you are done,
right-click the workspace and choose **Close and remove worktree**. Med runs
`git worktree remove` without `--force`, so it keeps a worktree with changes,
a working agent, or a commit on no branch. The branch stays.

**Pull requests**, at the foot of the sidebar or in the command palette,
opens a page, as **Settings** does, that lists every open pull request that
involves you, in two parts. **Waiting on
you** has review requests for you or your teams, then your own pull requests
with changes requested, failing checks, or conflicts. **Yours** has the rest
of your open ones: draft, in review, approved. Your pull requests that stack,
each on the head branch of the one before, are one row from the base, such
as #420 → #421. Each row has the title, the repository and number, the
author, when it last changed, the review and checks as icons, and the size.
`j` and `k`, or the arrows, move. `↵` opens it in a worktree with its review,
as a pasted link does; `⌘↵`, or the agent button on the row, also starts
Claude there to review it; `⌥↵`, or the GitHub button, opens it on GitHub.

Med finds them with two GitHub searches through your `gh` sign-in
(`review-requested:@me` and `author:@me`), limited to the GitHub repositories
that your registered repositories' remotes name; **All of GitHub** drops that
limit. A remote on another GitHub host, such as GitHub Enterprise, is searched
on that host (`gh api --hostname`), when **Settings** › **Open in** counts the
host as GitHub: your choice there, or a host that answers as GitHub does.
When `gh` cannot read a host, such as one that it is not signed in to, the
page says why above the others' pull requests. It merges and approves nothing.

Med keeps the last list in its state folder (`pull-requests.json`), so the
page opens with it at once, also after a reload or a restart, and every window
shares it. **Updated 3 min ago** beside the title says when Med read it. When
the list is a minute old or more, Med reads GitHub again without a sign, and
the new list replaces the old one when it comes. While the page shows, Med
reads again every two minutes, and when the window shows again after a minute
or more. A hidden window, or another page, reads nothing. Each read is two
GitHub searches for each GitHub host, a small part of your API limit. The
refresh button beside the time reads GitHub now; when a read already runs, it
reads again after that one. Only the button turns while it reads. When a read
fails, the page keeps the last list and says why under the title. The page
shows its outline only when Med has no list yet and GitHub is slow to answer.

In a terminal, `med pr checkout 333` runs `gh pr checkout 333`, fetches the
base branch, and opens a saved review from the merge base to the head. It
passes options such as `--force` and `--branch` to `gh`, and `--no-open` prints
the launch URL instead. It needs the GitHub CLI, signed in.

A saved review with a pull request shows its GitHub comments. Med reads them
with `gh`. It writes only into your pending review, GitHub's draft that
nobody else sees until you submit it; it never resolves a thread or posts a
comment by itself.

- When the diff shows the pull request's head commit, each code thread shows on
  its line with the GitHub mark. This includes Changes when the branch tip is
  the pull request's head. A file with changes after that commit lists its
  threads instead.
- The comment count beside the title, such as "3 comments", opens the reviews,
  the general comments, and the threads that the diff cannot show, each with
  the reason.
- A thread whose agent opens a pull request later gets the link by itself: while
  the thread's tab is open, Med asks `gh` for an open pull request from its
  branch.
- A comment shows its Markdown, as Med's own comments and the agent's Guide
  comments do: code, lists, task lists, quotes, and links, which open in the
  browser. Raw HTML stays out, and a suggestion shows as code under
  **Suggested change**.
- Hover a comment for **Copy** and **Open on GitHub**. **Copy comments** copies
  only Med's comments.
- **Reply on GitHub** on a thread, and the GitHub button on a Med comment in a
  Review version on the pull request's head, add to your pending review. Med
  starts one when you have none. Its comments show **Pending**. A comment on
  another commit, or on captured working changes, cannot go: GitHub's lines
  belong to the head.
- **Your pending review** at the top of the panel says how many comments it
  holds. Add a summary, then **Submit comments**, **Approve** or **Request
  changes**; **Discard** deletes it on GitHub.
- Med reads again when the window gets focus, at most every 30 seconds, when
  you open the panel, after each change to your pending review, and with
  **Refresh** in the panel. **Hide comments** hides GitHub's comments and
  Med's.

## A pull request in a thread

A thread can hold several pull requests, as it holds several reviews. In a
session's thread, **Add a pull request…** in the palette (`⌘K`) takes a
pull request link. Med runs the steps of a pasted link, in the same worktree, and saves
the review as one more of the thread's reviews: no workspace opens for it.
The steps show where the review shows next, with **Retry** for a failed
one; **Hide** leaves the job running. The review then shows, and **Pull
requests** in the session rail lists it with its number; the colour of its
mark is its state. A row there opens that pull request's own page.
**Reviews** does not list it: that section has the agent's hand-offs alone.
Its **Changes** are
the worktree's branch. A link that the thread has already shows that
review. A pull request that is a review of another session's thread stays
there; one that opened on its own moves to the thread. An agent adds one
with `med thread pr <thread> <link>`.

## Live pull requests

When a review has a real pull request on GitHub, its **Pull request** tab shows
that pull request as GitHub has it, so you rarely need github.com. A review
links its pull request when the agent runs `med review update --pr <url>`,
or when Med finds one opened on the review's branch.

The page is one column.

- **The title** and its number, with **Open on GitHub** beside it, then one
  line: the state (Draft, Open, Merged, or Closed) in its colour, with its
  mark, then who wants to merge which branch into which.
- **One status box** shows only what stands between the pull request and
  merging. First what stops it, in words: conflicts, how many commits it is
  behind its base, a review that it needs, or failed checks. The count comes
  from GitHub's comparison, as GitHub's merge state says "behind" only under
  a branch rule. Then each failing or running check of the head commit, with
  its state, its time, and a link; the checks that passed are a count, which
  opens. A check that ran again shows its last run to start, as
  `gh pr checks` does, so a new run shows once it leaves the queue. A check
  that runs for two triggers, such as a push and a pull request, shows twice,
  with its trigger. **Show failed log** reads the end of a failed GitHub
  Actions job's log with `gh run view --log-failed`, only when you ask. The
  log opens at its last error. Copy it, or add it to the message for the
  agent. Last, where each reviewer stands.
- The description shows in Med's Markdown, with its images, also the ones that
  GitHub writes as HTML, and the words beside them. `<details>` folds under
  its `<summary>`, as on GitHub. Other raw HTML stays out.
  Med reads each image through its own server, as the page loads none from
  other sites. Paths and links to files of the checkout open the file, as in
  a comment. Images in comments stay links.
- A description, or a comment, taller than half a screen folds there. Its
  button names the sections that the fold hides: **Show more: Testing,
  Rollout**.
- **Your pending review** comes first; its comments say that only you see
  them. Then **one timeline**: comments, reviews, and code threads, by when
  each began. An approval or a change request with no text is one line, and
  so is an outdated thread, which opens. **Show in diff** opens a thread at
  its line; a thread that the diff cannot show says why.

Med reads while the tab is on screen: every 30 seconds while a check runs or
GitHub works out a merge, every 2 minutes otherwise, and every 5 minutes after
it merges or closes. The tab needs a gh whose `pr checks` takes `--json`. Each
read uses several of your sign-in's GitHub API calls,
so a hidden window or another tab makes no read, and the first look back reads
if the wait is over. Med waits twice as long after each failed read, and keeps
what it read last. When under a tenth of your API limit is left, Med reads
every 5 minutes and says so; when none is left, it waits until the limit
fills. **Read the pull request again from GitHub** in `⌘K` reads now, and
so does **Try again** after a failed read. The page names no read time.

The tab reads GitHub and changes nothing there, apart from your pending review:
a reply, or Submit, Approve, or Discard when you click it. It does not merge or
run checks again.

## Codex reviews

A saved review shows the findings of Codex reviews in its checkouts: run
`codex review --base main` in the worktree, or `/review` in a Codex session
there. Med reads `~/.codex/sessions`; it does not run Codex or change its
files. It lists reviews of a commit that the review shows, and reviews that ran
after the review was saved.

- On the commit that Codex reviewed, each finding shows at its last line with
  its priority, such as **P1**.
- The Codex count beside the title opens each verdict, the findings that the
  diff cannot show, and **Copy resume command**.
- A finding's **Add to the message** button, or **Add all to** the agent for a whole review,
  puts the findings in the next message to the review's agent.
