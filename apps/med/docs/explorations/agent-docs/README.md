# Shorter agent docs for Med (proposal)

Status: proposal, 27 Oct 2026. The shipped docs are unchanged.

## The question

Do strong models such as Opus 5.5 need Med's long agent docs? Today an agent
gets 8 CLAUDE.md lines, a 216-line skill (9.9 KB), and `med docs agents`
prints the 656-line AGENT_INTEGRATION.md (31.5 KB).

## What we measured

There were 351 headless `claude -p` runs (Claude Code 2.1.295) on 11 graded
tasks with 2 reps per cell. Each run had its own Med server, state folder and
throwaway repositories. A script graded the final outcome from Med's saved
reviews. The tasks: working-tree hand-off, shared dirty checkout, commits on
main, feature branch with merge base, 3-branch stack, comments in a Med
thread, comments through `med review wait`, PR link, generated files in the
guide, two repositories, and an unregistered repository.

| Variant | Always loaded | Opus 5.5 | Haiku 5.5 | Sonnet 5.5 |
|---|---|---|---|---|
| full (today) | 216-line skill, 8 CLAUDE.md lines | 22/22 | 17/22\* | 19/22 |
| condensed (this proposal) | 69-line skill, 7 CLAUDE.md lines | 22/22 | 22/22 | not run |
| progressive | 29-line skill and pages read on demand | 22/22 | 18/22 | 20/22 |
| minimal | `med --help` only | 16/22 | 11/22 | 10/22 |
| none | no docs, no help | 16/22 | 10/22 | not run |

\* A harness fault (since fixed) caused some of Haiku's multi-repository
failures: both full runs, and one minimal and one none run.

On Opus, every doc variant passed every task. Without docs, Opus still did
the Git mechanics from the CLI help or its error messages: `--paths`,
start..HEAD, `--merge-base`, `--stack` and manifests. It failed only on three
Med conventions:

- it did not hand off a new version after it applied comments in a Med thread;
- it did not attach a guide;
- it ran `med add` on an unregistered repository without asking.

On Opus and Haiku, the long docs were never better than the condensed ones.
They were worse in one case. With the full skill, Sonnet and Haiku applied review comments, then
ran `med review update --key K --guide -` and not `med review create`. That
keeps the old capture, so the user reviews stale code. This happened in all
4 Sonnet and Haiku runs of that task with the full skill.

## Proposal

- `SKILL.md`: the condensed skill (69 lines, a third of today's).
- `thread-instructions.md`: the CLAUDE.md lines. They keep the Med-thread hand-off
  command always loaded. Sonnet and Haiku missed it when it was only on a
  reference page.
- `agents-guide.md`: a 150-line `med docs agents`. It replaces the 656-line
  guide for agents, and the UI and limits sections move to USAGE.md.

Before you replace the shipped files, run the condensed set on Sonnet 5.5
(22 runs).

## Move rules into the CLI

These rules are in the docs today. A CLI check can enforce each one and print
the next step:

- resolve `--repo` set to a subfolder;
- name the unregistered path and say "ask the user, then `med add <root>`";
- refuse an empty comparison (main..HEAD on main) and a clean `--working`;
- warn when `--base` moved and `--merge-base` is missing;
- warn about files that were dirty before the session;
- check the title (2–4 words, no repository name);
- default `--key` to the branch;
- warn when `review update --guide` runs on code that changed after the capture;
- check that lockfiles and generated files come last in the guide.

The eval report lists each check with what the CLI does now.
