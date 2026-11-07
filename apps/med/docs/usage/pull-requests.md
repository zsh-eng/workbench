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

## Live pull requests

When a review has a real pull request on GitHub, its **Pull request** tab shows
that pull request as GitHub has it, so you rarely need github.com. A review
from a branch with no pull request keeps the draft. This does not cover a stack:
each layer has its own pull request, and the band links to it.

The page is one column.

- **The title**, with **Open on GitHub** beside it, then one line: the state
  (Draft, Open, Merged, or Closed), who wants to merge which branch into
  which, and the number.
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
  GitHub writes as HTML, and the words beside them. Other raw HTML stays out.
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

## Pull request drafts

When an agent drafts a pull request with
[`med pr draft`](../AGENT_INTEGRATION.md#draft-a-pull-request), the review gets a
**Pull request** tab after **Review**, under **Pull request draft · revision
N**: its title, its description from the repository's template, and its
images. To comment on its words, select them and click **Comment** or press
`c`; the comments go to the agent with your other comments, and its next
draft replaces the shown one. **Create pull request…** asks
first, then runs `gh pr create` from the checkout's branch, as a draft unless
you clear **As a draft**. Med does not push: push the branch, with all of its
commits, first. GitHub
takes images only as links, so a local image stays out and the text names it;
Med says which ones to drag into the description on GitHub. Then the draft's
**Open on GitHub** opens the pull request, and the review links to it. The tab
then shows the [live pull request](#live-pull-requests). Its **Draft** button
shows the draft again, also a revision that the agent writes later.

A link in the draft can be `path`, `path:12`, `path:12-20`, `path#L12-L20`, an absolute
path, an editor link, or a GitHub blob URL. A unique suffix such as
`App.tsx:42` works. A link or a path in inline code to a file that the change
does not touch opens that file of the checkout as a tab, at its lines. Its
excerpt shows the cited lines from the checkout, marked **Not in the change**.
An absolute path inside the checkout shows as the path in the checkout.

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
- A finding's reply button, or **Add all to** the agent for a whole review,
  puts the findings in the next message to the review's agent.

## Stacks and sets

A thread can hold several reviews of one intent ([design](../STACKS.md)): a
**stack** of pull requests or branches, each on the one below, or a **set** of
independent ones. An agent makes one with
`med review create --stack 101 102 103 104` (bottom first) or `--set`; a
hand-off of one range whose base is the head of an open thread's top layer,
from the same session or with both pull requests, joins that thread as its
next layer.

- **Sidebar.** The thread is one session row, like any other.
- **Stack rail.** At the top of the Review's rail: the layers top to bottom,
  the base branch (such as `main`) under the bottom one, each with its number,
  title, pull request state, and comment count. A pull request that GitHub moved to
  another base says "on main". **This layer** shows the layer's own diff;
  **Whole stack** shows the base to the top layer's head; Shift-click a layer
  for the layers from the shown one to it. In a narrow pane the layers are a
  menu in the review's row.
- **Keys.** `⌥↑` and `⌥↓` go up and down the stack (in a sidebar row they move
  the tab).
- The title band names the shown layer's pull request. All layers use the
  thread's one checkout, so a switch keeps the session and its files.
- Drag a row onto the middle of another row of its repository and hold until
  that row is outlined to stack it on top; a quick drop only moves the row.
  The row's menu has **Stack on**, **Ungroup** (each layer above the
  first is a thread again), and **Treat as a set** or **Treat as a stack**.
