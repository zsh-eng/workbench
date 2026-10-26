# Review practices: read what exists, suggest the rest

Status: proposal, 27 October 2026 (round 5). Built: A, E.

**Med suggests review practices and never imposes them.** The user has their
own skills and workflows. Med reads whatever review output a hand-off holds
and shows it well. It offers practices as small skills to copy. It enforces a
practice only when a repository opts in. Med is a view of changes and agents,
not a scheduler or a gate.

Inputs: [agent practices](../../../docs/AGENT_PRACTICES.md) (d)–(f), the
agent-docs eval below, and the root [REVIEW.md](../../../REVIEW.md) as one
repository's review rules.

## The agent-docs eval

352 headless `claude -p` runs (Claude Code 2.1.295, 27 October 2026) on 11
graded tasks, 2 runs each, with a fresh Med server, state folder, and
repositories for each run. A script graded Med's saved reviews.

| Docs always loaded                        | Opus 5.5 | Sonnet 5.5 | Haiku 5.5 |
| ----------------------------------------- | -------- | ---------- | --------- |
| full: 216-line skill, 8 CLAUDE.md lines   | 22/22    | 19/22      | 17/22\*   |
| condensed: 69-line skill, 7 lines         | 22/22    | see below  | 22/22     |
| progressive: 29-line skill, pages on call | 22/22    | 20/22      | 18/22     |
| minimal: `med --help` only                | 16/22    | 10/22      | 11/22     |
| none                                      | 16/22    | not run    | 10/22\*   |

\* A harness fault, since fixed, failed some Haiku multi-repository runs.

- Without docs, Opus did the Git mechanics from `--help` and errors. It
  missed only Med's own conventions: a new version after a Med-thread fix
  round, a guide, and asking before `med add`.
- The full skill was never better than the condensed one, and once worse:
  Sonnet and Haiku answered comments with `review update --guide`, which
  keeps the stale capture (4 of 4 runs).
- Where a step sits matters more than how strongly it is worded: the wait
  step at line 150 of the full skill was skipped; at the top it was kept.

## A. Ship the eval findings

**CLI checks.** Each check prints the next step. Warnings are the default.
Only an empty hand-off and an unregistered repository refuse, because both
make a review that cannot be right.

| Rule the docs carried                   | Check in `med review`                                                                                                                                                  |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--repo` is the repository root         | Resolve a folder inside a repository to its root (`git rev-parse --show-toplevel`).                                                                                    |
| Ask before `med add`                    | Refuse: "`<root>` is not registered in Med. Ask the user, then run `med add <root>`."                                                                                  |
| Commits on main need a start commit     | Refuse an empty range; when the session's transcript gives its start, name `--base HEAD~N`.                                                                            |
| `--working` on a clean tree             | Refuse, and name the range form.                                                                                                                                       |
| Feature branches need `--merge-base`    | When `--base` has commits that `--head` lacks, compare from the merge base and say so. `--no-merge-base` keeps the two tips.                                           |
| `--paths` in a shared checkout          | After `--working` without `--paths`, list the changed files that this session's transcript never edited, and print the `update --paths` command.                       |
| Titles of 2–4 words, no repository name | Warn, and print `med review update --key K --title "…"`.                                                                                                               |
| One `--key` per task                    | Default the key to the branch (not the base branch), and print it. `update --key` also takes a review ID.                                                              |
| A fix round is a new version            | `update --guide` on a capture that the checkout has moved past warns: "the capture is older than the checkout; run `med review create --key K …` to make version N+1". |
| Wait after a hand-off                   | In a Claude Code session outside a Med thread, `create` prints the `med review wait --key K` line.                                                                     |
| Generated files last                    | The guide check names a segment of lockfiles or generated files that comes before other segments.                                                                      |
| Several repositories need a file        | `--manifest -` reads the manifest from standard input.                                                                                                                 |

Not built: an automatic version when a Med-thread turn ends with changes. That
would make Med decide when work is ready; the **Refresh review** bar and the
always-loaded thread line already cover it.

**Docs.** Ship the condensed set from the eval:

- `skills/med/SKILL.md` (about 70 lines): the critical steps first: one key,
  a guide, a new version for each fix round, wait or not, ask before
  `med add`, the link. Comparisons and guide rules follow.
- `skills/med/guide.md`: the 150-line guide. `med skills install` writes both
  files; `med docs agents` prints the guide.
- `skills/thread-instructions.md`: the condensed CLAUDE.md lines.
- Text that the CLI checks now carry goes (repository root, limits). UI,
  setup and limits move to USAGE.md. `AGENT_INTEGRATION.md` stays the long
  reference, `med docs reference`, without text written for older models.
- `docs/explorations/agent-docs/` is deleted; its numbers are above.

**Check.** One Sonnet run of the 11 tasks × 2 with the eval harness, on an
isolated Med (ports 5461–5469), against this build's docs and CLI.

## B. Read review output from any source

`src/shared/review-output.ts` reads Markdown leniently. The sources are a
version's notes: the brief (`--brief` or ⌘V), its pinned replies, and the
guide's summary. So output from the user's skills, `/code-review`, a pasted
Codex review, or a GitHub review reads the same. It recognises, where present:

- **Proof:** a section named Proof, Checks, Tests, Verification, Evidence, or
  "How I tested". Its items are checks: a command in backticks and a result
  ("42 passed", "✓", "failed", "exit 1"). Image and video paths are media.
  A "Not covered" / "What the checks miss" / "Gaps" list is what the checks
  miss.
- **Findings:** items tagged Important, Nit, or Pre-existing (inline, as
  `[Important]`, `**Nit**`, `Pre-existing:`, or by a heading above them;
  Codex's `[P0]`–`[P1]` read as Important, `[P2]`–`[P3]` as Nit), with the
  first `path:line` in the item. "Fixed", "Intentional", or "Won't fix",
  inline or in a sub-item, closes a finding; the text after it is the reason.
  A counts line ("2 Important, 1 Nit, 0 Pre-existing") is kept.
- **Explainer:** a section named Explainer, Why, What changed, Context, or
  Overview; the guide's summary counts too.
- **Generated files:** a Generated section or line with paths and globs. The
  CLI passes them as `--generated` (round 4) when the brief comes with
  `create`.

Nothing else changes: the Notes still show the whole text.

## C. Views

The Review's first page, the Overview, now shows when a version has any of:
a guide, two or more commits, proof, findings, or an earlier version. A
version with none of them opens as today.

1. **Proof** first, under the title: each check with its result, the media,
   and what the checks miss. Without written proof, the checks that the
   session ran in the turn that made this version (`turn.checks`).
2. **Since your last review** (version 2 and later): the files that changed
   since the last version that you approved or commented on, or else the
   version before, and the files no longer in the change. The host compares
   the captures' blob IDs.
3. **Findings**, with a count of the open ones in the Overview's start row.
   Each row opens its line.
4. **Approve version N**, beside Start reviewing. The host keeps it for each
   version (`POST /api/reviews/:id/approval`). The version menu marks
   approved versions. An approval is a record for the user, not a gate.

## D. Suggestion pack

`med skills suggest` lists small skills; `med skills suggest <name>` prints
one to copy into the user's own skills; `--to <dir>` writes it there. Med
never installs them by itself. Each is under 40 lines:

| Skill                | What it asks of the agent                                                         |
| -------------------- | --------------------------------------------------------------------------------- |
| `proof-first`        | List each check with its command and result, the media, and what it doesn't cover |
| `adversarial-review` | Fresh-context hunters, each on one bug class, then a vote; report only what wins  |
| `explain-first`      | Explain why and what to read first before the diff                                |
| `round-limit`        | After 3 review rounds, stop and rethink the approach                              |
| `review-md`          | A REVIEW.md template, after the root REVIEW.md                                    |
| `risk-levels`        | Set the risk level from the paths the change touches                              |

**Offers at the point of need**, in the Overview, each with Dismiss, which
lasts (`med:offer:<id>` in local storage):

- no explainer: **Ask the agent to explain** puts an explain-first request in
  the session's message box; the user sends it;
- no proof: the proof-first practice, with **Copy skill**;
- version 4 or later: the round-limit practice.

**Repository opt-in.** `git config med.checks proof,explainer,findings` turns
those suggestions into checks for that repository: `med review create`
refuses a hand-off without proof, without an explainer, or with an open
Important finding, and says what to add. The default is off.

## E. Formatting

`bun run format:check` passes: format the two inherited files and delete the
exploration.

## Critique

- **Parsing prose is guessing.** A heuristic can miss a finding or invent
  one. Mitigations: recognise only explicit tags and headings; never hide the
  source text; show nothing when unsure. Tests use real output shapes
  (`/code-review`, Codex `[P1]`, a hand-written brief).
- **The Overview for every version 2 adds a click** before the diff. It is
  one keystroke, and "since your last review" is what the reader needs on a
  second round. Kept, but only for versions with captures.
- **Defaulting to the merge base changes a meaning.** Only when the base has
  commits that the head lacks, which is the case the eval showed going wrong;
  the CLI says so and `--no-merge-base` restores the old comparison.
- **A default key merges hand-offs.** Two tasks on one branch become versions
  of one review. That matches "one key per task, such as the branch". The key
  is printed, and `--key` still wins. No default on the base branch.
- **"Since your last review" needs a "last review".** Med has no record of
  reading, so it uses approvals and comments, then the version before. Viewed
  marks stay as they are.
- **Session edits miss files that commands wrote** (formatters, codegen).
  The shared-checkout warning says "not edited by this session", not "not
  yours", and stays silent without a transcript.
- **Opt-in checks can block an agent.** Only with the repository's own key;
  the refusal names the key, so the user can turn it off.
- **The Sonnet check covers this build's docs and CLI together**, so a flip
  can come from either. Read flips with the transcripts.
