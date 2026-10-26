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

## Desktop scheduled tasks: left out

The Claude app runs [desktop scheduled
tasks](https://code.claude.com/docs/en/desktop-scheduled-tasks). Each has a
folder `~/.claude/scheduled-tasks/<name>/` (under `CLAUDE_CONFIG_DIR` when it
is set) with a `SKILL.md`, whose front matter names and describes the task
and whose body is its prompt. The schedule and whether the task is on are not
in that file. The app keeps them in its own store; on macOS that is most
likely
`~/Library/Application Support/Claude/claude-code-sessions/<account>/<organization>/scheduled-tasks.json`
(a `scheduledTasks` list), which only its owner can read. Its format is the app's own and is not
documented. On the computer that we checked (October 2026), the file held no
task, so we could not see the fields of one. The app's `scheduled-tasks` tool
gives a task's cron expression and whether it is on, but only to an agent in
the app, not to other programs.

Med lists only what will fire, and it cannot tell when, or whether, a desktop
task fires. So Med leaves the Claude app's tasks out; the app's own list shows
them. If the app documents its store, or the CLI gets a way to read it, Med
can list a task that is on, with its next time.

## In Med

- **Cards.** A thread shows each schedule tool's call as a card, also when its
  turn's work folds: the schedule in words ("Every hour at :23"), the prompt,
  recurring or one-shot, "expires in N days", and what became of it:
  Cancelled (a later `CronDelete`), Expired, Fired, or Missed. A session-only
  job says **Ends with its session**. A prompt that a schedule enqueued shows
  as "A scheduled prompt ran", and starts its turn.
- **Scheduled list.** The sidebar's Scheduled section lists only the jobs
  that will fire: the tabs' jobs whose session's process runs, in Med or
  elsewhere, and that are not cancelled, expired, fired, or past their time.
  Each shows its thread, schedule, prompt, and where its process runs. A job
  whose session ended, and every job that ended, stays in its thread's cards
  only. When no job will fire there is no section, not "Scheduled 0". The
  section reads every 30 seconds and on focus, also while it is closed, to
  know whether to show. `GET /api/schedules` serves it
  (`src/host/schedules.ts`): it finds each transcript once, reads it once,
  then from where it stopped, and parses only the lines that name a schedule
  tool.
