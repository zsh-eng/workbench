# Schedules: read only

Med is a view on changes and agents, not a scheduler. It shows what Claude Code
scheduled and whether it can fire; it never runs, edits, or deletes a schedule.

## What Claude Code schedules

[Scheduled tasks](https://code.claude.com/docs/en/scheduled-tasks) in a
session come from three tools:

| Tool             | Input                                                               | Result (`toolUseResult`)                      |
| ---------------- | ------------------------------------------------------------------- | --------------------------------------------- |
| `CronCreate`     | `cron` (5 fields, local time), `prompt`, `recurring` (default true) | `id`, `humanSchedule`, `recurring`, `durable` |
| `CronDelete`     | `id`                                                                | the cancelled `id`                            |
| `ScheduleWakeup` | `delaySeconds` (60–3600), `prompt`, `reason`, or `stop`             | when it wakes                                 |

A job is **session-only** (`durable: false`): it lives in the session's
process, fires only while that process is idle, and is gone when it ends.
A recurring job expires 7 days after it was made. When a job fires, Claude Code
writes the prompt to the transcript as a user record with `isMeta: true` and
`turnOrigin: "scheduled"`; its text is the job's prompt, which is how Med
counts each job's fires.

**Verified on the real CLI (2.1.295, October 2026).** A Med thread's agent runs as
`claude -p --input-format stream-json` in a holder (`src/host/holder.ts`).
In that mode a `* * * * *` job fired every minute while stdin stayed open, a
one-shot job fired once at its minute, and `CronList` listed them. After the
process ended and `claude -p --resume <id>` started it again, the recurring
job was listed and fired again. So in Med a session's jobs fire while its tab
is open (and for `MED_AGENT_RELEASE_MS`, one minute, after the tab closes),
stop when Med releases the process, and come back when the session resumes,
within their 7 days.

## Desktop scheduled tasks

The Claude app runs [desktop scheduled
tasks](https://code.claude.com/docs/en/desktop-scheduled-tasks). Each is a
folder `~/.claude/scheduled-tasks/<name>/` (under `CLAUDE_CONFIG_DIR` when it
is set) with a `SKILL.md`:

```markdown
---
name: morning-triage
description: Triage new issues each weekday morning
---

Read the issues opened since yesterday, label each one, and list the three that
need a person first.
```

The front matter names and describes the task; the body is its prompt. The
schedule itself is the app's and is not in the file, so Med shows the task and
says that the app runs it. A missing folder means that the app has made none.

## In Med

- **Cards.** A thread shows each schedule tool's call as a card, also when its
  turn's work folds: the schedule in words ("Every hour at :23"), the prompt,
  recurring or one-shot, "expires in N days", and what became of it:
  Cancelled (a later `CronDelete`), Expired, Fired, or Missed. A session-only
  job says **Ends with its session**. A prompt that a schedule enqueued shows
  as "A scheduled prompt ran", and starts its turn.
- **Scheduled list.** The sidebar's Scheduled section (closed until opened)
  lists the tabs' jobs with their thread, schedule, prompt, and state:
  **Live** (its session's process runs, in Med or elsewhere), **Stopped**
  ("won't fire: its session ended · comes back if the session resumes"), and
  the ended ones. Then the Claude app's tasks. `GET /api/schedules` serves it
  (`src/host/schedules.ts`): it reads each transcript once, then from where it
  stopped, and parses only the lines that name a schedule tool.
